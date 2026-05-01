'use strict'

const crypto = require('crypto')
const { createFacturationService } = require('../services/facturation.service')
const { createFacturationRepository } = require('../repositories/facturation.repository')

// ─────────────────────────────────────────────────────────────────────────────
// routes/webhook-mobile-money.route.js
//
// POST /api/v1/paiements/webhook/mobile-money
//
// RÈGLES DE SÉCURITÉ :
//   1. HMAC SHA256 obligatoire (header X-Signature)
//   2. Réponse toujours HTTP 200 sauf erreur de signature (401) ou
//      données malformées (400) — évite les retries infinis opérateur
//   3. Idempotent : un webhook reçu deux fois ne crédite qu'une fois
//   4. hotel_id lu depuis le paiement en DB — jamais depuis le body entrant
//   5. Vérification montant + devise avant toute confirmation
//
// Variable d'environnement requise :
//   MOBILE_MONEY_WEBHOOK_SECRET — secret partagé avec l'opérateur (min 32 chars)
// ─────────────────────────────────────────────────────────────────────────────

// ── Vérification HMAC ─────────────────────────────────────────────────────────
// Compare le header X-Signature avec HMAC-SHA256(secret, rawBody).
// Utilise timingSafeEqual pour éviter les attaques timing.
function verifierSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false

  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')

    // Normalise le format : certains opérateurs préfixent avec 'sha256='
    const received = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader

    // timingSafeEqual requiert des Buffer de même longueur
    const a = Buffer.from(expected,  'hex')
    const b = Buffer.from(received,  'hex')

    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function webhookMobileMoneyRoute(fastify) {

  const service = createFacturationService({ db: fastify.db, cache: fastify.cache })
  const repo    = createFacturationRepository(fastify.db)

  fastify.post('/webhook/mobile-money', {
    config: { rawBody: true },  // Fastify doit conserver rawBody pour HMAC
  }, async (req, reply) => {

    const debut = Date.now()

    // ── PATCH 6 — Vérification HMAC obligatoire ───────────────────────────
    const secret = process.env.MOBILE_MONEY_WEBHOOK_SECRET
    if (!secret) {
      req.log.error({ event: 'webhook_mobile_money', result: 'config_error' },
        'MOBILE_MONEY_WEBHOOK_SECRET absent — webhook désactivé')
      return reply.status(500).send({ erreur: 'Configuration serveur incomplète' })
    }

    const signatureHeader = req.headers['x-signature'] || req.headers['x-webhook-signature']

    // PATCH 4 — Header absent ou multiple (Fastify joint les multiples avec ',')
    if (!signatureHeader || signatureHeader.includes(',')) {
      req.log.warn({ event: 'webhook_mobile_money', result: 'signature_invalide', ip: req.ip },
        'Header de signature absent ou multiple — requête rejetée')
      return reply.status(401).send({ erreur: 'Signature invalide' })
    }

    // PATCH 1 — rawBody strict : HMAC calculé uniquement sur le body brut original.
    // JSON.stringify(req.body) peut diverger du payload reçu (ordre des clés, espaces).
    // Sans rawBody, toute vérification HMAC est non fiable.
    if (!req.rawBody) {
      req.log.error({ event: 'webhook_mobile_money', result: 'config_error' },
        'req.rawBody absent — plugin @fastify/rawbody non configuré')
      return reply.status(500).send({ erreur: 'Configuration serveur incomplète' })
    }

    if (!verifierSignature(req.rawBody, signatureHeader, secret)) {
      req.log.warn({
        event:      'webhook_mobile_money',
        result:     'signature_invalide',
        ip:         req.ip,
        user_agent: req.headers['user-agent'],
      }, 'Signature webhook invalide — requête rejetée')
      return reply.status(401).send({ erreur: 'Signature invalide' })
    }

    const { reference_externe, statut, montant, devise, numero } = req.body

    // ── PATCH 1 — Validation minimale du payload ──────────────────────────
    if (!reference_externe || typeof reference_externe !== 'string') {
      req.log.warn({ event: 'webhook_mobile_money', result: 'payload_invalide', champ: 'reference_externe' },
        'Webhook reçu sans reference_externe')
      return reply.status(400).send({ erreur: 'reference_externe requis' })
    }

    if (!statut || !['SUCCESS', 'FAILED'].includes(statut)) {
      req.log.warn({ event: 'webhook_mobile_money', result: 'payload_invalide', champ: 'statut' },
        'Webhook reçu avec statut invalide')
      return reply.status(400).send({ erreur: 'statut doit être SUCCESS ou FAILED' })
    }

    if (!montant || Number(montant) <= 0) {
      req.log.warn({ event: 'webhook_mobile_money', result: 'payload_invalide', champ: 'montant' },
        'Webhook reçu avec montant invalide')
      return reply.status(400).send({ erreur: 'montant doit être > 0' })
    }

    // ── Webhook FAILED — mise à jour statut DB + log ──────────────────────
    if (statut === 'FAILED') {
      try {
        const rowsEchoues = await fastify.db('paiements')
          .where({ reference_externe })
          .select('id', 'hotel_id', 'statut')

        if (rowsEchoues.length === 0) {
          req.log.warn({ event: 'webhook_mobile_money', reference_externe, statut: 'FAILED',
            result: 'ignored', raison: 'paiement_inconnu' },
            'Webhook FAILED pour reference inconnue — ignoré')
        } else if (rowsEchoues.length > 1) {
          req.log.error({ event: 'webhook_mobile_money', reference_externe, statut: 'FAILED',
            result: 'collision', nb_lignes: rowsEchoues.length },
            'CRITICAL — collision reference_externe FAILED multi-tenant — intervention manuelle')
        } else {
          const p = rowsEchoues[0]
          if (p.statut === 'en_attente') {
            await fastify.db('paiements')
              .where({ id: p.id, hotel_id: p.hotel_id })
              .update({ statut: 'echec', traite_le: fastify.db.fn.now() })
          }
          req.log.info({ event: 'webhook_mobile_money', reference_externe, statut: 'FAILED',
            hotel_id: p.hotel_id, result: 'ignored' },
            'Paiement mobile money échoué — statut mis à jour')
        }
      } catch (err) {
        req.log.error({ event: 'webhook_mobile_money', reference_externe,
          result: 'erreur_update_echec', err: { message: err.message } },
          'Erreur mise à jour statut echec')
      }
      return reply.send({ recu: true })
    }

    // ── PATCH 2 — Retrouver le paiement par reference_externe ────────────
    // Requête brute pour détecter les collisions multi-tenant (rows.length > 1)
    // avant d'utiliser le premier résultat.
    const rows = await fastify.db('paiements')
      .where({ reference_externe })
      .select('*')

    if (rows.length === 0) {
      req.log.warn({
        event:            'webhook_mobile_money',
        reference_externe,
        result:           'ignored',
        raison:           'paiement_inconnu',
      }, 'Webhook reçu pour reference inconnue — ignoré')
      return reply.send({ recu: true })
    }

    if (rows.length > 1) {
      req.log.error({
        event:            'webhook_mobile_money',
        reference_externe,
        result:           'collision',
        nb_lignes:        rows.length,
      }, 'CRITICAL — collision reference_externe multi-tenant — intervention manuelle requise')
      return reply.send({ recu: true })
    }

    const paiement = rows[0]

    const hotelId = paiement.hotel_id

    // ── PATCH 3 — Idempotence : paiement déjà confirmé ───────────────────
    if (paiement.statut === 'valide') {
      req.log.info({
        event:            'webhook_mobile_money',
        reference_externe,
        hotel_id:         hotelId,
        result:           'ignored',
        raison:           'deja_confirme',
      }, 'Webhook idempotent — paiement déjà confirmé')
      return reply.send({ recu: true })
    }

    // ── PATCH 4 — Vérification cohérence montant + devise ─────────────────
    const montantWebhook = Number(montant)
    const montantPaiement = Number(paiement.montant)

    if (Math.abs(montantWebhook - montantPaiement) > 0.01) {
      req.log.error({
        event:             'webhook_mobile_money',
        reference_externe,
        hotel_id:          hotelId,
        result:            'fraud',
        montant_webhook:   montantWebhook,
        montant_attendu:   montantPaiement,
      }, 'ALERTE FRAUDE — montant webhook incohérent avec paiement en DB')
      // HTTP 200 pour éviter les retries, mais aucune confirmation
      return reply.send({ recu: true })
    }

    if (devise && paiement.devise && devise !== paiement.devise) {
      req.log.error({
        event:            'webhook_mobile_money',
        reference_externe,
        hotel_id:         hotelId,
        result:           'fraud',
        devise_webhook:   devise,
        devise_attendue:  paiement.devise,
      }, 'ALERTE FRAUDE — devise webhook incohérente avec paiement en DB')
      return reply.send({ recu: true })
    }

    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WEBHOOK_TIMEOUT')), 2000)
      )

      const resultat = await Promise.race([
        service.confirmerPaiement(paiement.id, hotelId, null, reference_externe),
        timeout,
      ])

      req.log.info({
        event:            'webhook_mobile_money',
        reference_externe,
        hotel_id:         hotelId,
        paiement_id:      paiement.id,
        result:           resultat.idempotent ? 'ignored' : 'processed',
        idempotent:       resultat.idempotent,
        duree_ms:         Date.now() - debut,
      }, resultat.idempotent
        ? 'Webhook mobile money — déjà traité (idempotent)'
        : 'Webhook mobile money — paiement confirmé avec succès'
      )

      return reply.send({ recu: true })

    } catch (err) {
      if (err.message === 'WEBHOOK_TIMEOUT') {
        req.log.error({
          event:            'webhook_mobile_money',
          reference_externe,
          hotel_id:         hotelId,
          result:           'timeout',
          duree_ms:         Date.now() - debut,
        }, 'Timeout webhook — réconciliation manuelle requise')
        return reply.send({ recu: true })
      }

      req.log.error({
        event:            'webhook_mobile_money',
        reference_externe,
        hotel_id:         hotelId,
        result:           'erreur_interne',
        err:              { message: err.message, code: err.code },
        duree_ms:         Date.now() - debut,
      }, 'Erreur interne lors de la confirmation webhook — réconciliation manuelle requise')

      return reply.send({ recu: true })
    }
  })
}
