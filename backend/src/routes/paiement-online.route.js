'use strict'
const { v4: uuidv4 } = require('uuid')
const { initierPaiement, verifierPaiement } = require('../services/cinetpay.service')
const { createFacturationService }  = require('../services/facturation.service')
const { createReservationsService } = require('../services/reservations.service')

// ─────────────────────────────────────────────────────────────────────────────
// routes/paiement-online.route.js — passerelle CinetPay (booking public)
//
// ÉTAT RÉEL (LOT-GUEST-01) :
//   • Sans CINETPAY_SITE_ID / CINETPAY_API_KEY, cinetpay.service fonctionne en mode
//     SANDBOX : aucun appel CinetPay, aucun paiement réel, la réservation reste 'tentative'
//     (elle expire, ou la réception la confirme). Ce mode n'est JAMAIS présenté comme un succès.
//   • Avec les identifiants : redirection CinetPay réelle, webhook + double vérification.
//
// CORRECTIONS LOT-GUEST-01 :
//   • /init : le montant venait du client (body) → calculé côté serveur = solde du folio.
//             La réservation doit appartenir à l'hôtel indiqué.
//   • /webhook : la réservation était passée à 'confirmee' par UPDATE direct, sans paiement
//             au folio ni comptabilité. Désormais : paiement enregistré par le service
//             facturation (folio + logs + événement comptable), puis confirmation via le
//             service PMS (machine d'état + audit). Idempotent (idempotency_key cinetpay-<tx>).
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function paiementOnlineRoutes(fastify) {
  const facturation  = createFacturationService({ db: fastify.db, cache: fastify.cache })
  const reservations = createReservationsService({ db: fastify.db, cache: fastify.cache })

  // ── POST /paiement-online/init — Créer une session de paiement CinetPay ──────
  fastify.post('/init', { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { reservation_id, nom_client, prenom_client, email_client, telephone_client, hotel_id, hotel_slug } = req.body || {}

    if (!reservation_id || !/^[0-9a-f-]{36}$/i.test(reservation_id)) {
      return reply.status(400).send({ erreur: 'reservation_id requis', code: 'RESERVATION_REQUISE' })
    }
    if (!hotel_id && !hotel_slug) {
      return reply.status(400).send({ erreur: 'hotel_id ou hotel_slug requis' })
    }

    const hotel = hotel_id
      ? await fastify.db('hotels').where({ id: hotel_id }).select('id', 'nom', 'slug').first()
      : await fastify.db('hotels').where({ slug: hotel_slug, actif: true }).select('id', 'nom', 'slug').first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })

    const reservation = await fastify.db('reservations').where({ id: reservation_id, hotel_id: hotel.id }).first()
    if (!reservation) return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    if (!['tentative', 'confirmee', 'arrivee'].includes(reservation.statut)) {
      return reply.status(409).send({ erreur: `Réservation ${reservation.statut} — paiement impossible`, code: 'RESERVATION_NON_PAYABLE' })
    }

    // Montant = reste dû du folio (source de vérité serveur, jamais le body)
    const folio = await fastify.db('folios').where({ reservation_id: reservation.id, hotel_id: hotel.id }).first()
    const solde = folio ? Number((await fastify.db.raw('SELECT solde_du FROM get_solde_folio(?, ?)', [folio.id, hotel.id])).rows[0].solde_du) : 0
    if (!(solde > 0)) return reply.status(409).send({ erreur: 'Aucun montant dû', code: 'RIEN_A_PAYER' })

    const transactionId = `7VH-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`
    const baseUrl       = process.env.APP_BASE_URL || 'http://localhost:3000'
    const apiBaseUrl    = process.env.API_BASE_URL  || 'http://localhost:3001'
    const returnUrl     = `${baseUrl}/booking/${hotel.slug}/confirmation?tx=${transactionId}`
    const notifyUrl     = `${apiBaseUrl}/api/v1/paiement-online/webhook`

    try {
      const { payment_url, sandbox } = await initierPaiement({
        transactionId,
        montant:       solde,
        description:   `Réservation ${reservation.numero_reservation} - ${hotel.nom}`,
        customerEmail: email_client,
        customerName:  `${prenom_client || ''} ${nom_client || ''}`.trim() || 'Client',
        customerPhone: telephone_client,
        returnUrl,
        notifyUrl,
      })

      await fastify.db('paiements_online').insert({
        hotel_id:       hotel.id,
        reservation_id: reservation.id,
        transaction_id: transactionId,
        montant:        solde,
        devise:         reservation.devise || 'XAF',
        statut:         'en_attente',
        customer_email: email_client   || null,
        customer_name:  `${prenom_client || ''} ${nom_client || ''}`.trim() || null,
        customer_phone: telephone_client || null,
        expire_le:      fastify.db.raw("NOW() + INTERVAL '30 minutes'"),
        metadata:       JSON.stringify({ sandbox: !!sandbox, reservation_id: reservation.id }),
      })

      return reply.status(201).send({ payment_url, transaction_id: transactionId, sandbox, montant: solde })
    } catch (err) {
      fastify.log.error({ err }, 'Erreur init paiement CinetPay')
      return reply.status(502).send({ erreur: "Impossible d'initier le paiement", detail: err.message })
    }
  })

  // ── GET /paiement-online/statut/:transactionId ─────────────────────────────
  fastify.get('/statut/:transactionId', async (req, reply) => {
    const paiement = await fastify.db('paiements_online AS p')
      .leftJoin('reservations AS r', 'r.id', 'p.reservation_id')
      .where({ 'p.transaction_id': req.params.transactionId })
      .select('p.*', 'r.statut AS statut_reservation', 'r.numero_reservation')
      .first()
    if (!paiement) return reply.status(404).send({ erreur: 'Transaction introuvable' })
    return reply.send({
      statut:             paiement.statut,          // en_attente | reussi | echoue | sandbox
      sandbox:            !!(paiement.metadata && paiement.metadata.sandbox),
      transaction_id:     paiement.transaction_id,
      montant:            paiement.montant,
      numero_reservation: paiement.numero_reservation,
      statut_reservation: paiement.statut_reservation,   // état PMS réel
    })
  })

  // ── POST /paiement-online/webhook — Webhook CinetPay (serveur à serveur) ─────
  fastify.post('/webhook', async (req, reply) => {
    const { cpm_trans_id: transactionId, cpm_site_id } = req.body || {}

    if (process.env.CINETPAY_SITE_ID && cpm_site_id !== process.env.CINETPAY_SITE_ID) {
      req.log.warn({ cpm_site_id, event: 'cinetpay_webhook' }, 'site_id invalide — webhook rejeté')
      return reply.status(403).send({ erreur: 'site_id invalide' })
    }

    const paiement = await fastify.db('paiements_online').where({ transaction_id: transactionId }).first()
    if (!paiement) {
      req.log.warn({ transactionId, event: 'cinetpay_webhook' }, 'Transaction introuvable')
      return reply.status(404).send({ erreur: 'Transaction introuvable' })
    }

    // Double confirmation auprès de CinetPay (le corps du webhook n'est jamais cru)
    const { statut, data } = paiement.statut === 'reussi' ? { statut: 'reussi', data: null } : await verifierPaiement(transactionId)

    if (paiement.statut !== 'reussi') {
      await fastify.db('paiements_online')
        .where({ transaction_id: transactionId })
        .update({
          statut,
          cinetpay_id:   data?.pm_trans_id || transactionId,
          provider:      data?.payment_method || null,
          cinetpay_data: JSON.stringify(req.body),
          paye_le:       statut === 'reussi' ? fastify.db.raw('NOW()') : null,
          mis_a_jour_le: fastify.db.raw('NOW()'),
        })
    }

    // Paiement réel confirmé → chaîne PMS complète (idempotente : rejouer le webhook est sans effet)
    if (statut === 'reussi' && paiement.reservation_id) {
      try {
        const reservation = await fastify.db('reservations').where({ id: paiement.reservation_id, hotel_id: paiement.hotel_id }).first()
        const folio = await fastify.db('folios').where({ reservation_id: paiement.reservation_id, hotel_id: paiement.hotel_id }).first()
        const deja  = await fastify.db('paiements').where({ hotel_id: paiement.hotel_id, idempotency_key: `cinetpay-${transactionId}` }).first()
        if (!deja && folio) {
          // Passerelle → règlement sur compte bancaire : type 'carte' (mapping PAIEMENT banque)
          await facturation.creerPaiement(folio.id, paiement.hotel_id, reservation.tenant_id, null, {
            typePaiement: 'carte', montant: paiement.montant, devise: paiement.devise,
            notes: `CinetPay ${transactionId}${data?.payment_method ? ` (${data.payment_method})` : ''}`,
            idempotencyKey: `cinetpay-${transactionId}`,
          })
        }
        if (reservation && reservation.statut === 'tentative') {
          await reservations.confirmerReservation(reservation.id, paiement.hotel_id, null)
        }
        req.log.info({ transactionId, reservation_id: paiement.reservation_id, event: 'cinetpay_webhook' }, 'Paiement CinetPay intégré au PMS')
      } catch (err) {
        // Ex. réservation expirée entre-temps : paiement reçu à réconcilier (remboursement)
        req.log.error({ transactionId, reservation_id: paiement.reservation_id, err: { message: err.message }, event: 'cinetpay_webhook' },
          'Paiement CinetPay reçu mais intégration PMS impossible — réconciliation manuelle')
        await fastify.db('paiements_online').where({ transaction_id: transactionId })
          .update({ metadata: JSON.stringify({ ...(paiement.metadata || {}), reconciliation_requise: err.message }) })
      }
    }

    return reply.send({ ok: true })
  })
}
