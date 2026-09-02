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
  const pre     = [fastify.authentifier, fastify.contexteHotel]
  const preRead = [...pre, fastify.verifierPermission('reservations.lire')]

  // Service instancié une fois à l'enregistrement — injection des dépendances
  const service = createReservationsService({ db: fastify.db, cache: fastify.cache })

  // ── GET / — Liste des réservations ────────────────────────────────────────
  // Conservé inline — sera migré vers service.lister() dans l'itération suivante
  fastify.get('/', { preHandler: preRead }, async (request, reply) => {
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
  fastify.get('/timeline', { preHandler: preRead }, async (request, reply) => {
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

  // ── GET /alertes — Alertes opérationnelles déterministes ────────────────
  // Règles SQL pures — sans IA, sans alertes_ia. Recalculées à chaque appel.
  // Rule 1 : confirmée + date_arrivee = aujourd'hui + heure >= 14h → check-in en retard
  // Rule 2 : tentative créée > 4h → paiement bloqué
  fastify.get('/alertes', { preHandler: preRead }, async (request, reply) => {
    const now   = new Date()
    const today = now.toISOString().split('T')[0]
    const alertes = []

    if (now.getHours() >= 14) {
      const retards = await fastify.db('reservations AS r')
        .leftJoin('clients AS c', 'c.id', 'r.client_id')
        .where({ 'r.hotel_id': request.hotelId, 'r.statut': 'confirmee' })
        .whereRaw("r.date_arrivee::date = ?::date", [today])
        .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
        .select(
          'r.id', 'r.numero_reservation', 'ch.numero AS numero_chambre',
          fastify.db.raw("COALESCE(c.prenom || ' ' || c.nom, 'Client inconnu') AS nom_client")
        )

      retards.forEach(r => alertes.push({
        id:       `checkin-retard-${r.id}`,
        type:     'operationnelle',
        severite: 'critique',
        titre:    `Check-in en retard : ${r.nom_client}`,
        message:  `Ch. ${r.numero_chambre || '?'} · ${r.numero_reservation}`,
      }))
    }

    const tentatives = await fastify.db('reservations AS r')
      .leftJoin('clients AS c', 'c.id', 'r.client_id')
      .where({ 'r.hotel_id': request.hotelId, 'r.statut': 'tentative' })
      .whereRaw("r.cree_le < NOW() - INTERVAL '4 hours'")
      .select(
        'r.id', 'r.numero_reservation',
        fastify.db.raw("COALESCE(c.prenom || ' ' || c.nom, 'Client inconnu') AS nom_client"),
        fastify.db.raw("ROUND(EXTRACT(EPOCH FROM (NOW() - r.cree_le))/3600)::int AS heures_depuis")
      )

    tentatives.forEach(r => alertes.push({
      id:       `paiement-attente-${r.id}`,
      type:     'operationnelle',
      severite: 'avertissement',
      titre:    `Paiement bloqué depuis ${r.heures_depuis}h : ${r.nom_client}`,
      message:  `Réservation tentative ${r.numero_reservation}`,
    }))

    // Rule 3: arrivée dont date_depart <= aujourd'hui → checkout à effectuer
    const departsAttente = await fastify.db('reservations AS r')
      .leftJoin('clients AS c', 'c.id', 'r.client_id')
      .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
      .where({ 'r.hotel_id': request.hotelId, 'r.statut': 'arrivee' })
      .whereRaw('r.date_depart::date <= CURRENT_DATE')
      .select(
        'r.id', 'r.numero_reservation', 'ch.numero AS numero_chambre',
        fastify.db.raw("COALESCE(c.prenom || ' ' || c.nom, 'Client inconnu') AS nom_client")
      )

    departsAttente.forEach(r => alertes.push({
      id:       `depart-attente-${r.id}`,
      type:     'operationnelle',
      severite: 'critique',
      titre:    `Départ à traiter : ${r.nom_client}`,
      message:  `Ch. ${r.numero_chambre || '?'} · ${r.numero_reservation}`,
    }))

    // Rule 4: chambres en statut 'sale' (post-checkout, ménage en attente)
    const chambresSales = await fastify.db('chambres')
      .where({ hotel_id: request.hotelId, statut: 'sale' })
      .select('id', 'numero')

    if (chambresSales.length > 0) {
      const nums = chambresSales.slice(0, 5).map(c => c.numero).join(', ')
      alertes.push({
        id:       `chambres-sales-${today}`,
        type:     'operationnelle',
        severite: chambresSales.length >= 3 ? 'critique' : 'avertissement',
        titre:    `${chambresSales.length} chambre${chambresSales.length > 1 ? 's' : ''} à nettoyer`,
        message:  `Ch. ${nums}${chambresSales.length > 5 ? '…' : ''}`,
      })
    }

    // Rule 5: nouvelles réservations en ligne récentes (< 4h) → signal à la réception
    const resasRecentes = await fastify.db('reservations AS r')
      .leftJoin('clients AS c', 'c.id', 'r.client_id')
      .where({ 'r.hotel_id': request.hotelId, 'r.statut': 'tentative' })
      .whereRaw("r.cree_le >= NOW() - INTERVAL '4 hours'")
      .select(
        'r.id', 'r.numero_reservation',
        fastify.db.raw("COALESCE(c.prenom || ' ' || c.nom, 'Client') AS nom_client"),
        fastify.db.raw("ROUND(EXTRACT(EPOCH FROM (NOW() - r.cree_le))/60)::int AS minutes_depuis")
      )
    resasRecentes.forEach(r => {
      const mins = r.minutes_depuis || 0
      const duree = mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h${String(mins % 60).padStart(2,'0')}`
      alertes.push({
        id:       `resa-online-${r.id}`,
        type:     'operationnelle',
        severite: 'info',
        titre:    `Réservation en ligne : ${r.nom_client}`,
        message:  `${r.numero_reservation} · il y a ${duree} — en attente de paiement`,
      })
    })

    return reply.send({ alertes })
  })

  // ── GET /:id ──────────────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: preRead }, async (request, reply) => {
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
      facture:      resultat.facture || null,
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
