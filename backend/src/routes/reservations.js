'use strict'

module.exports = async function reservationsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /reservations ─────────────────────────────────────────────
  fastify.get('/', { preHandler: pre }, async (request, reply) => {
    const { statut, date_debut, date_fin, chambre_id, page = 1, limite = 50 } = request.query

    const cacheKey = `reservations:${request.hotelId}:${JSON.stringify(request.query)}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    let query = fastify.db('reservations AS r')
      .leftJoin('clients AS c',  'c.id',  'r.client_id')
      .leftJoin('chambres AS ch','ch.id', 'r.chambre_id')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where('r.hotel_id', request.hotelId)
      .select(
        'r.*',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'c.email AS email_client',
        'c.telephone AS telephone_client',
        'ch.numero AS numero_chambre',
        'ch.etage',
        'tc.nom AS type_chambre'
      )
      .orderBy('r.date_arrivee', 'asc')

    if (statut)      query = query.where('r.statut', statut)
    if (chambre_id)  query = query.where('r.chambre_id', chambre_id)
    if (date_debut)  query = query.where('r.date_depart', '>=', date_debut)
    if (date_fin)    query = query.where('r.date_arrivee', '<=', date_fin)

    const offset = (parseInt(page) - 1) * parseInt(limite)
   const countQuery = fastify.db('reservations AS r')
  .where('r.hotel_id', request.hotelId)

if (statut)     countQuery.where('r.statut', statut)
if (chambre_id) countQuery.where('r.chambre_id', chambre_id)
if (date_debut) countQuery.where('r.date_depart', '>=', date_debut)
if (date_fin)   countQuery.where('r.date_arrivee', '<=', date_fin)

const [data, [{ total }]] = await Promise.all([
  query.clone().limit(parseInt(limite)).offset(offset),
  countQuery.count('r.id AS total')
])

    const result = { data, pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) } }
    await fastify.cache.set(cacheKey, result, 30)
    reply.send(result)
  })

  // ── GET /reservations/timeline ────────────────────────────────────
  fastify.get('/timeline', { preHandler: pre }, async (request, reply) => {
    const { debut, fin } = request.query
    const dateDebut = debut || new Date().toISOString().split('T')[0]
    const dateFin   = fin   || new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0]

    const cacheKey = `timeline:${request.hotelId}:${dateDebut}:${dateFin}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [reservations, chambres] = await Promise.all([
      fastify.db('reservations AS r')
        .leftJoin('clients AS c','c.id','r.client_id')
        .leftJoin('chambres AS ch','ch.id','r.chambre_id')
        .where('r.hotel_id', request.hotelId)
        .where('r.date_arrivee', '<=', dateFin)
        .where('r.date_depart',  '>=', dateDebut)
        .whereNotIn('r.statut', ['annulee','no_show'])
        .select('r.id','r.numero_reservation','r.date_arrivee','r.date_depart',
          'r.statut','r.chambre_id','r.tarif_nuit','r.devise',
          fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
          'ch.numero AS numero_chambre'),

      fastify.db('chambres AS ch')
        .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
        .where('ch.hotel_id', request.hotelId)
        .select('ch.id','ch.numero','ch.etage','ch.statut','tc.nom AS type_chambre')
        .orderBy('ch.etage').orderBy('ch.numero')
    ])

    const result = { reservations, chambres, periode: { debut: dateDebut, fin: dateFin } }
    await fastify.cache.set(cacheKey, result, 30)
    reply.send(result)
  })

  // ── GET /reservations/:id ─────────────────────────────────────────
  fastify.get('/:id', { preHandler: pre }, async (request, reply) => {
    const reservation = await fastify.db('reservations AS r')
      .leftJoin('clients AS c','c.id','r.client_id')
      .leftJoin('chambres AS ch','ch.id','r.chambre_id')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where('r.id', request.params.id)
      .where('r.hotel_id', request.hotelId)
      .select('r.*',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'c.email','c.telephone',
        'ch.numero AS numero_chambre','tc.nom AS type_chambre')
      .first()

    if (!reservation) return reply.status(404).send({ erreur: 'Réservation introuvable' })

    // Charger extras et folio
    const [extras, folio] = await Promise.all([
      fastify.db('extras_reservation').where({ reservation_id: reservation.id }),
      fastify.db('folios').where({ reservation_id: reservation.id }).first()
    ])

    reply.send({ ...reservation, extras, folio: folio || null })
  })

  // ── POST /reservations ────────────────────────────────────────────
  fastify.post('/', { preHandler: pre }, async (request, reply) => {
    const data = request.body
    const trx = await fastify.db.transaction()

    try {
      // Vérifier disponibilité chambre
      const conflit = await trx('reservations')
        .where({ chambre_id: data.chambre_id, hotel_id: request.hotelId })
        .whereNotIn('statut', ['annulee','no_show'])
        .where(function() {
          this.where('date_arrivee', '<', data.date_depart)
            .andWhere('date_depart', '>', data.date_arrivee)
        })
        .first()

      if (conflit) {
        await trx.rollback()
        return reply.status(409).send({
          erreur: 'Chambre non disponible',
          message: 'La chambre est déjà réservée pour ces dates',
          code: 'CONFLIT_DATES'
        })
      }

      const [reservation] = await trx('reservations').insert({
        hotel_id:    request.hotelId,
        tenant_id:   request.tenantId,
        client_id:   data.client_id,
        chambre_id:  data.chambre_id,
        statut:      data.statut || 'confirmee',
        date_arrivee: data.date_arrivee,
        date_depart:  data.date_depart,
        nombre_adultes: data.nombre_adultes || 2,
        nombre_enfants: data.nombre_enfants || 0,
        tarif_nuit:   data.tarif_nuit,
        devise:       data.devise || 'XAF',
        total_hebergement: data.total_hebergement,
        total_taxes:  data.total_taxes || 0,
        total_general: data.total_general,
        source:       data.source || 'direct',
        regime_repas: data.regime_repas || 'chambre_seule',
        preferences_client: data.preferences_client,
        notes_internes: data.notes_internes,
        creee_par:    request.user.id
      }).returning('*')

      // Créer folio vide
      await trx('folios').insert({
        reservation_id: reservation.id,
        hotel_id:       request.hotelId,
        client_id:      data.client_id,
        numero_folio:   'FOL-' + reservation.numero_reservation
      })

      await trx.commit()
      await fastify.cache.delPattern(`reservations:${request.hotelId}*`)
      await fastify.cache.delPattern(`timeline:${request.hotelId}*`)

      reply.status(201).send({ message: 'Réservation créée', reservation })
    } catch (err) {
      await trx.rollback()
      throw err
    }
  })

  // ── PUT /reservations/:id ─────────────────────────────────────────
  fastify.put('/:id', { preHandler: pre }, async (request, reply) => {
    const [updated] = await fastify.db('reservations')
      .where({ id: request.params.id, hotel_id: request.hotelId })
      .update({ ...request.body, mis_a_jour_le: fastify.db.fn.now() })
      .returning('*')

    if (!updated) return reply.status(404).send({ erreur: 'Réservation introuvable' })
    await fastify.cache.delPattern(`reservations:${request.hotelId}*`)
    reply.send({ message: 'Réservation mise à jour', reservation: updated })
  })

  // ── POST /reservations/:id/checkin ────────────────────────────────
  fastify.post('/:id/checkin', { preHandler: pre }, async (request, reply) => {
    const trx = await fastify.db.transaction()
    try {
      const { crypto } = require('crypto')
      const token = require('crypto').randomBytes(32).toString('hex')
      const expireQR = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours

      const [reservation] = await trx('reservations')
        .where({ id: request.params.id, hotel_id: request.hotelId })
        .update({
          statut: 'arrivee',
          heure_arrivee_reelle: trx.fn.now(),
          qr_token: token,
          qr_token_actif: true
        })
        .returning('*')

      if (!reservation) { await trx.rollback(); return reply.status(404).send({ erreur: 'Réservation introuvable' }) }

      // Mettre à jour statut chambre
      await trx('chambres')
        .where({ id: reservation.chambre_id })
        .update({
          statut: 'occupee',
          qr_session_token: token,
          qr_session_active: true,
          qr_session_expire: expireQR
        })

      // Créer session chambre
      await trx('sessions_chambre').insert({
        hotel_id:       request.hotelId,
        chambre_id:     reservation.chambre_id,
        reservation_id: reservation.id,
        token,
        expire_le: expireQR
      })

      await trx.commit()
      await fastify.cache.delPattern(`reservations:${request.hotelId}*`)

      const portalUrl = `${process.env.APP_URL}/room-portal/${token}`
      reply.send({
        message: 'Check-in effectué',
        qr_token: token,
        url_portail: portalUrl,
        reservation
      })
    } catch(err) { await trx.rollback(); throw err }
  })

  // ── POST /reservations/:id/checkout ───────────────────────────────
  fastify.post('/:id/checkout', { preHandler: pre }, async (request, reply) => {
    const trx = await fastify.db.transaction()
    try {
      const reservation = await trx('reservations')
        .where({ id: request.params.id, hotel_id: request.hotelId })
        .first()

      if (!reservation) { await trx.rollback(); return reply.status(404).send({ erreur: 'Réservation introuvable' }) }

      // Invalider QR token
      await trx('sessions_chambre').where({ token: reservation.qr_token }).update({ actif: false })
      await trx('reservations').where({ id: reservation.id }).update({
        statut: 'depart_aujourd_hui',
        heure_depart_reelle: trx.fn.now(),
        qr_token_actif: false
      })
      await trx('chambres').where({ id: reservation.chambre_id }).update({
        statut: 'sale',
        statut_menage: 'ouverte',
        qr_session_active: false
      })

      // Créer tâche de ménage automatique
      await trx('taches_menage').insert({
        hotel_id:   request.hotelId,
        chambre_id: reservation.chambre_id,
        statut:     'ouverte',
        priorite:   'haute',
        type_tache: 'nettoyage_depart',
        description: `Nettoyage après départ - Réservation ${reservation.numero_reservation}`,
        date_tache: new Date().toISOString().split('T')[0]
      })

      await trx.commit()
      await fastify.cache.delPattern(`reservations:${request.hotelId}*`)
      reply.send({ message: 'Check-out effectué et tâche de ménage créée' })
    } catch(err) { await trx.rollback(); throw err }
  })

  // ── DELETE /reservations/:id ──────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: [...pre, fastify.verifierPermission('reservations.annuler')]
  }, async (request, reply) => {
    const { raison } = request.body || {}
    const [updated] = await fastify.db('reservations')
      .where({ id: request.params.id, hotel_id: request.hotelId })
      .update({
        statut: 'annulee',
        annulee_par: request.user.id,
        raison_annulation: raison
      })
      .returning('id')

    if (!updated) return reply.status(404).send({ erreur: 'Réservation introuvable' })
    await fastify.cache.delPattern(`reservations:${request.hotelId}*`)
    reply.send({ message: 'Réservation annulée' })
  })
}
