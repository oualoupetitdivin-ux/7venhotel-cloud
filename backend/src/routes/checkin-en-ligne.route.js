'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/checkin-en-ligne.route.js — préfixe /api/v1/checkin-en-ligne (LOT-GUEST-01)
//
//   POST /lien            staff (reservations.modifier) — génère / régénère le lien
//   GET  /:token          public (jeton du lien) — dossier de pré-arrivée
//   POST /:token          public (jeton du lien) — soumission, usage unique
//
// Le jeton n'est jamais journalisé ni renvoyé après génération ; seul son hash est en base.
// ─────────────────────────────────────────────────────────────────────────────

const { createCheckinEnLigneService } = require('../services/checkin-en-ligne.service')

module.exports = async function checkinEnLigneRoutes(fastify) {
  const service = createCheckinEnLigneService({ db: fastify.db })
  const limite = { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }

  fastify.post('/lien', {
    preHandler: [fastify.authentifier, fastify.contexteHotel, fastify.verifierPermission('reservations.modifier')],
  }, async (req, reply) => {
    const { reservation_id } = req.body || {}
    if (!reservation_id || !/^[0-9a-f-]{36}$/i.test(reservation_id))
      return reply.status(400).send({ erreur: 'reservation_id requis', code: 'CHAMPS_REQUIS' })
    const lien = await service.genererLien({ reservationId: reservation_id, hotelId: req.hotelId, acteurId: req.user.id })
    return reply.status(201).send(lien)
  })

  fastify.get('/:token', limite, async (req, reply) => {
    return reply.send(await service.contexte(req.params.token))
  })

  fastify.post('/:token', limite, async (req, reply) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    return reply.send(await service.completer(req.params.token, req.body, ip))
  })
}
