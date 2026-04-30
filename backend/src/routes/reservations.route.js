'use strict'

const { createReservationsService } = require('../services/reservations.service')
const { ValidationError }           = require('../errors')
const {
  validerCreation,
  validerCheckin,
  validerCheckout,
  validerAnnulation,
} = require('../validators/reservations.validator')

// ─────────────────────────────────────────────────────────────────────────────
// routes/reservations.js
//
// Transport HTTP uniquement.
// Aucune requête DB, aucune logique métier, aucun accès cache direct.
// Chaque handler : extraire → valider format → déléguer service → répondre.
//
// Les routes GET (liste, timeline, détail) sont conservées inline car elles
// n'ont pas encore été refactorisées — elles seront migrées vers le pattern
// repository/service dans la prochaine itération.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function reservationsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // Service instancié une fois à l'enregistrement — injection des dépendances
  const service = createReservationsService({ db: fastify.db, cache: fastify.cache })

  // ── GET / — Liste des réservations ────────────────────────────────────────
  // Conservé inline — sera migré vers service.lister() dans l'itération suivante
  fastify.get('/', { preHandler: pre }, async (request, reply) => {
    const { statut, date_debut, date_fin, chambre_id, page = 1, limite = 50 } = request.query

    const cacheKey = `reservations:${request.hotelId}:${JSON.stringify(request.query)}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    let query = fastify.db('reservations AS r')
      .leftJoin('clients AS c',        'c.id',  'r.client_id')
      .leftJoin('chambres AS ch',      'ch.id', 'r.chambre_id')
      .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
      .where('r.hotel_id', request.hotelId)
      .select(
        'r.id', 'r.numero_reservation', 'r.statut', 'r.statut_paiement',
        'r.date_arrivee', 'r.date_depart', 'r.nombre_nuits', 'r.source',
        'r.tarif_nuit', 'r.total_hebergement', 'r.total_taxes', 'r.total_general',
        'r.devise', 'r.reduction_pct', 'r.nombre_adultes', 'r.nombre_enfants',
        'r.chambre_id', 'r.cree_le',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'c.email AS email_client',
        'c.telephone AS telephone_client',
        'ch.numero AS numero_chambre',
        'ch.etage AS etage_chambre',
        'tc.nom AS type_chambre'
      )
      .orderBy('r.date_arrivee', 'asc')

    if (statut)     query = query.where('r.statut', statut)
    if (chambre_id) query = query.where('r.chambre_id', chambre_id)
    if (date_debut) query = query.where('r.date_depart',  '>=', date_debut)
    if (date_fin)   query = query.where('r.date_arrivee', '<=', date_fin)

    const offset = (parseInt(page) - 1) * parseInt(limite)
    const countQuery = fastify.db('reservations').where('hotel_id', request.hotelId)
    if (statut)     countQuery.where('statut', statut)
    if (chambre_id) countQuery.where('chambre_id', chambre_id)
    if (date_debut) countQuery.where('date_depart',  '>=', date_debut)
    if (date_fin)   countQuery.where('date_arrivee', '<=', date_fin)

    const [data, [{ total }]] = await Promise.all([
      query.clone().limit(parseInt(limite)).offset(offset),
      countQuery.count('id AS total'),
    ])

    const result = { data, pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) } }
    await fastify.cache.set(cacheKey, result, 30)
    return reply.send(result)
  })

  // ── GET /timeline ─────────────────────────────────────────────────────────
  fastify.get('/timeline', { preHandler: pre }, async (request, reply) => {
    const { debut, fin } = request.query
    const dateDebut = debut || new Date().toISOString().split('T')[0]
    const dateFin   = fin   || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const cacheKey = `timeline:${request.hotelId}:${dateDebut}:${dateFin}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [reservations, chambres] = await Promise.all([
      fastify.db('reservations AS r')
        .leftJoin('clients AS c', 'c.id', 'r.client_id')
        .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
        .where('r.hotel_id', request.hotelId)
        .where('r.date_arrivee', '<=', dateFin)
        .where('r.date_depart',  '>=', dateDebut)
        .whereNotIn('r.statut', ['annulee', 'no_show'])
        .select(
          'r.id', 'r.numero_reservation', 'r.date_arrivee', 'r.date_depart',
          'r.statut', 'r.chambre_id', 'r.tarif_nuit', 'r.devise',
          fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
          'ch.numero AS numero_chambre'
        ),

      fastify.db('chambres AS ch')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .where('ch.hotel_id', request.hotelId)
        .where('ch.hors_service', false)
        .select('ch.id', 'ch.numero', 'ch.etage', 'ch.statut', 'tc.nom AS type_chambre')
        .orderBy('ch.etage').orderBy('ch.numero'),
    ])

    const result = { reservations, chambres, periode: { debut: dateDebut, fin: dateFin } }
    await fastify.cache.set(cacheKey, result, 30)
    return reply.send(result)
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: pre }, async (request, reply) => {
    const reservation = await service.getParId(request.params.id, request.hotelId)
    return reply.send({ reservation })
  })

  // ── POST / — Créer une réservation ────────────────────────────────────────
  fastify.post('/', {
    preHandler: [...pre, fastify.verifierPermission('reservations.creer')],
  }, async (request, reply) => {
    const validation = validerCreation(request.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    // Source déduite : si l'endpoint est appelé par le staff → reception
    // Les réservations online passent par le portail booking (route publique)
    const donnees = {
      ...request.body,
      source: request.body.source || 'reception',
    }

    const reservation = await service.creerReservation(
      request.hotelId,
      request.tenantId,
      request.user.id,
      'staff',
      donnees
    )

    request.log.info(
      { reservation_id: reservation.id, hotel_id: request.hotelId, source: donnees.source },
      'Réservation créée'
    )
    return reply.status(201).send({ message: 'Réservation créée', reservation })
  })

  // ── POST /:id/confirmer ───────────────────────────────────────────────────
  fastify.post('/:id/confirmer', {
    preHandler: [...pre, fastify.verifierPermission('reservations.modifier')],
  }, async (request, reply) => {
    const reservation = await service.confirmerReservation(
      request.params.id,
      request.hotelId,
      request.user.id
    )

    request.log.info(
      { reservation_id: request.params.id, hotel_id: request.hotelId },
      'Réservation confirmée'
    )
    return reply.send({ message: 'Réservation confirmée', reservation })
  })

  // ── POST /:id/checkin ─────────────────────────────────────────────────────
  fastify.post('/:id/checkin', {
    preHandler: [...pre, fastify.verifierPermission('reservations.modifier')],
  }, async (request, reply) => {
    const validation = validerCheckin(request.params)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const resultat = await service.checkin(
      request.params.id,
      request.hotelId,
      request.user.id,
      request.user.role,
      request.ip
    )

    request.log.info(
      { reservation_id: request.params.id, hotel_id: request.hotelId, acteur: request.user.id },
      'Check-in effectué'
    )
    return reply.send({
      message:       'Check-in effectué avec succès',
      token_portail: resultat.token_portail,
      url_portail:   resultat.url_portail,
    })
  })

  // ── POST /:id/checkout ────────────────────────────────────────────────────
  fastify.post('/:id/checkout', {
    preHandler: [...pre, fastify.verifierPermission('reservations.modifier')],
  }, async (request, reply) => {
    const validation = validerCheckout(request.params)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const resultat = await service.checkout(
      request.params.id,
      request.hotelId,
      request.user.id
    )

    request.log.info(
      { reservation_id: request.params.id, hotel_id: request.hotelId, acteur: request.user.id },
      'Check-out effectué'
    )
    return reply.send({
      message:      'Check-out effectué — chambre en cours de nettoyage',
      tache_menage: resultat.tache_menage,
    })
  })

  // ── POST /:id/annuler ─────────────────────────────────────────────────────
  fastify.post('/:id/annuler', {
    preHandler: [...pre, fastify.verifierPermission('reservations.annuler')],
  }, async (request, reply) => {
    const validation = validerAnnulation(request.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const reservation = await service.annulerReservation(
      request.params.id,
      request.hotelId,
      request.user.id,
      request.body?.raison
    )

    request.log.info(
      { reservation_id: request.params.id, hotel_id: request.hotelId, acteur: request.user.id },
      'Réservation annulée'
    )
    return reply.send({ message: 'Réservation annulée', reservation })
  })
}
