'use strict'

const { createChambresService }   = require('../services/chambres.service')
const { ValidationError }         = require('../errors')
const {
  validerCreation,
  validerModification,
  validerDisponibilite,
  validerChangementStatut,
} = require('../validators/chambres.validator')

// ─────────────────────────────────────────────────────────────────────────────
// routes/chambres.js
//
// Transport HTTP uniquement.
// Aucune requête DB, aucune logique métier, aucun accès cache.
// Chaque handler : extraire → valider → déléguer au service → répondre.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function chambresRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // Service instancié une fois à l'enregistrement de la route
  const service = createChambresService({ db: fastify.db, cache: fastify.cache })

  // ── GET / ─────────────────────────────────────────────────────────────────
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const { statut, etage, type_chambre_id, hors_service } = req.query
    const resultat = await service.lister(req.hotelId, { statut, etage, typeId: type_chambre_id, horsService: hors_service })
    return reply.send(resultat)
  })

  // ── GET /disponibles ──────────────────────────────────────────────────────
  fastify.get('/disponibles', { preHandler: pre }, async (req, reply) => {
    const validation = validerDisponibilite(req.query)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { date_arrivee, date_depart, adultes, enfants, type_chambre_id } = req.query
    const resultat = await service.getDisponibles(req.hotelId, {
      dateArrivee: date_arrivee,
      dateDepart:  date_depart,
      adultes, enfants,
      typeId: type_chambre_id,
    })
    return reply.send(resultat)
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: pre }, async (req, reply) => {
    const resultat = await service.getParId(req.params.id, req.hotelId)
    return reply.send(resultat)
  })

  // ── POST / ────────────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: [...pre, fastify.verifierPermission('chambres.administrer')],
  }, async (req, reply) => {
    const validation = validerCreation(req.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const cree = await service.creer(req.hotelId, req.tenantId, req.body)
    req.log.info({ chambre_id: cree.id, hotel_id: req.hotelId }, 'Chambre créée')
    return reply.status(201).send({ message: 'Chambre créée avec succès', chambre: cree })
  })

  // ── PUT /:id ──────────────────────────────────────────────────────────────
  fastify.put('/:id', {
    preHandler: [...pre, fastify.verifierPermission('chambres.modifier')],
  }, async (req, reply) => {
    const validation = validerModification(req.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const mis = await service.modifier(req.params.id, req.hotelId, req.body)
    req.log.info({ chambre_id: req.params.id, hotel_id: req.hotelId }, 'Chambre modifiée')
    return reply.send({ message: 'Chambre mise à jour', chambre: mis })
  })

  // ── PATCH /:id/statut ─────────────────────────────────────────────────────
  fastify.patch('/:id/statut', {
    preHandler: [...pre, fastify.verifierPermission('chambres.modifier')],
  }, async (req, reply) => {
    const validation = validerChangementStatut(req.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { statut, hors_service, hors_service_raison } = req.body
    const mis = await service.changerStatut(req.params.id, req.hotelId, {
      statut,
      horsService:        hors_service,
      horsServiceRaison:  hors_service_raison,
    })
    req.log.info({ chambre_id: req.params.id, statut, hotel_id: req.hotelId }, 'Statut chambre modifié')
    return reply.send({ message: 'Statut mis à jour', chambre: mis })
  })

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [...pre, fastify.verifierPermission('chambres.administrer')],
  }, async (req, reply) => {
    await service.desactiver(req.params.id, req.hotelId)
    req.log.info({ chambre_id: req.params.id, hotel_id: req.hotelId }, 'Chambre désactivée')
    return reply.send({ message: 'Chambre désactivée avec succès' })
  })
}
