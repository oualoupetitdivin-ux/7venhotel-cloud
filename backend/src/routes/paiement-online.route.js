'use strict'
const { v4: uuidv4 } = require('uuid')
const { initierPaiement, verifierPaiement } = require('../services/cinetpay.service')

module.exports = async function paiementOnlineRoutes(fastify) {

  // ── POST /paiement-online/init — Créer une session de paiement CinetPay ──────
  fastify.post('/init', async (req, reply) => {
    const {
      reservation_id,
      montant,
      nom_client,
      prenom_client,
      email_client,
      telephone_client,
      hotel_id,
      hotel_slug,
    } = req.body

    if (!montant || Number(montant) <= 0) {
      return reply.status(400).send({ erreur: 'Montant invalide' })
    }
    if (!hotel_id && !hotel_slug) {
      return reply.status(400).send({ erreur: 'hotel_id ou hotel_slug requis' })
    }

    // Résoudre l'hôtel par hotel_id ou hotel_slug
    let hotel
    if (hotel_id) {
      hotel = await fastify.db('hotels').where({ id: hotel_id }).select('id', 'nom', 'slug').first()
    } else {
      hotel = await fastify.db('hotels').where({ slug: hotel_slug, actif: true }).select('id', 'nom', 'slug').first()
    }
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })

    const transactionId = `7VH-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`
    const baseUrl       = process.env.APP_BASE_URL || 'http://localhost:3000'
    const apiBaseUrl    = process.env.API_BASE_URL  || 'http://localhost:3001'

    // returnUrl vers la page de confirmation dynamique (avec hotel_slug)
    const slug      = hotel_slug || hotel.slug
    const returnUrl = `${baseUrl}/booking/${slug}/confirmation?tx=${transactionId}`
    const notifyUrl = `${apiBaseUrl}/api/v1/paiement-online/webhook`

    const desc = `Réservation ${hotel.nom} - ${new Date().toLocaleDateString('fr-FR')}`

    try {
      const { payment_url, sandbox } = await initierPaiement({
        transactionId,
        montant:         Number(montant),
        description:     desc,
        customerEmail:   email_client,
        customerName:    `${prenom_client || ''} ${nom_client || ''}`.trim() || 'Client',
        customerPhone:   telephone_client,
        returnUrl,
        notifyUrl,
      })

      // Enregistrer la transaction en base
      await fastify.db('paiements_online').insert({
        hotel_id:       hotel.id,
        reservation_id: reservation_id || null,
        transaction_id: transactionId,
        montant:        Number(montant),
        devise:         'XAF',
        statut:         'en_attente',
        customer_email: email_client   || null,
        customer_name:  `${prenom_client || ''} ${nom_client || ''}`.trim() || null,
        customer_phone: telephone_client || null,
        expire_le:      fastify.db.raw("NOW() + INTERVAL '30 minutes'"),
        metadata:       JSON.stringify({ sandbox: !!sandbox, reservation_id: reservation_id || null }),
      })

      return reply.status(201).send({ payment_url, transaction_id: transactionId, sandbox })
    } catch (err) {
      fastify.log.error({ err }, 'Erreur init paiement CinetPay')
      return reply.status(502).send({
        erreur: "Impossible d'initier le paiement",
        detail: err.message,
      })
    }
  })

  // ── GET /paiement-online/statut/:transactionId — Vérifier le statut ──────────
  fastify.get('/statut/:transactionId', async (req, reply) => {
    const paiement = await fastify.db('paiements_online')
      .where({ transaction_id: req.params.transactionId })
      .first()
    if (!paiement) return reply.status(404).send({ erreur: 'Transaction introuvable' })
    return reply.send({
      statut:         paiement.statut,
      transaction_id: paiement.transaction_id,
      montant:        paiement.montant,
      reservation_id: paiement.reservation_id,
    })
  })

  // ── POST /paiement-online/webhook — Webhook CinetPay (serveur à serveur) ─────
  // Pas d'auth JWT — appel externe de CinetPay
  fastify.post('/webhook', async (req, reply) => {
    const { cpm_trans_id: transactionId, cpm_result, cpm_site_id } = req.body

    // Vérification basique que le site_id correspond
    if (process.env.CINETPAY_SITE_ID && cpm_site_id !== process.env.CINETPAY_SITE_ID) {
      req.log.warn({ cpm_site_id, event: 'cinetpay_webhook' }, 'site_id invalide — webhook rejeté')
      return reply.status(403).send({ erreur: 'site_id invalide' })
    }

    const paiement = await fastify.db('paiements_online')
      .where({ transaction_id: transactionId })
      .first()
    if (!paiement) {
      req.log.warn({ transactionId, event: 'cinetpay_webhook' }, 'Transaction introuvable')
      return reply.status(404).send({ erreur: 'Transaction introuvable' })
    }

    // Idempotence — déjà traité
    if (paiement.statut === 'reussi') {
      req.log.info({ transactionId, event: 'cinetpay_webhook' }, 'Webhook idempotent — déjà traité')
      return reply.send({ ok: true })
    }

    // Double confirmation auprès de CinetPay
    const { statut, data } = await verifierPaiement(transactionId)

    await fastify.db('paiements_online')
      .where({ transaction_id: transactionId })
      .update({
        statut,
        cinetpay_id:    data?.pm_trans_id || transactionId,
        provider:       data?.payment_method || null,
        cinetpay_data:  JSON.stringify(req.body),
        paye_le:        statut === 'reussi' ? fastify.db.raw('NOW()') : null,
        mis_a_jour_le:  fastify.db.raw('NOW()'),
      })

    req.log.info({ transactionId, statut, event: 'cinetpay_webhook' }, 'Paiement CinetPay mis à jour')

    // Si paiement réussi et réservation liée → confirmer la réservation
    if (statut === 'reussi' && paiement.reservation_id) {
      try {
        await fastify.db('reservations')
          .where({ id: paiement.reservation_id })
          .update({
            statut:       'confirmee',
            mis_a_jour_le: fastify.db.raw('NOW()'),
          })
        req.log.info({
          transactionId,
          reservation_id: paiement.reservation_id,
          event:          'cinetpay_webhook',
        }, 'Réservation confirmée suite au paiement CinetPay')
      } catch (errResa) {
        // Logguer sans bloquer — le paiement est validé, la réservation peut être
        // réconciliée manuellement si nécessaire.
        req.log.error({
          transactionId,
          reservation_id: paiement.reservation_id,
          err:            { message: errResa.message },
          event:          'cinetpay_webhook',
        }, 'Paiement confirmé mais erreur confirmation réservation — réconciliation manuelle')
      }
    }

    return reply.send({ ok: true })
  })
}
