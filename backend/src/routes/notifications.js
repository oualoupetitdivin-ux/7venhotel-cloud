'use strict'

module.exports = async function notificationsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /alertes — Alertes opérationnelles du jour ──────────────────────────
  // Accessible à tout utilisateur hôtel authentifié (réception, manager, etc.)
  fastify.get('/alertes', { preHandler: pre }, async (req, reply) => {
    const [arrivees, departs, checkinEnLigne] = await Promise.all([
      // Arrivées confirmées aujourd'hui (check-in à faire)
      fastify.db('reservations AS r')
        .leftJoin('clients AS c',  'c.id',  'r.client_id')
        .leftJoin('chambres AS ch','ch.id', 'r.chambre_id')
        .where({ 'r.hotel_id': req.hotelId, 'r.statut': 'confirmee' })
        .whereRaw('r.date_arrivee = CURRENT_DATE')
        .select(
          'r.id', 'r.numero_reservation',
          'ch.numero AS numero_chambre',
          fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client")
        )
        .orderBy('r.date_arrivee')
        .limit(20),

      // Départs aujourd'hui (check-out à faire)
      fastify.db('reservations AS r')
        .leftJoin('clients AS c',  'c.id',  'r.client_id')
        .leftJoin('chambres AS ch','ch.id', 'r.chambre_id')
        .where({ 'r.hotel_id': req.hotelId, 'r.statut': 'arrivee' })
        .whereRaw('r.date_depart = CURRENT_DATE')
        .select(
          'r.id', 'r.numero_reservation',
          'ch.numero AS numero_chambre',
          fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client")
        )
        .orderBy('r.date_depart')
        .limit(20),

      // Check-in en ligne en attente (client a confirmé, chambre pas encore attribuée par réception)
      fastify.db('reservations AS r')
        .leftJoin('clients AS c',  'c.id',  'r.client_id')
        .leftJoin('chambres AS ch','ch.id', 'r.chambre_id')
        .where({ 'r.hotel_id': req.hotelId, 'r.statut': 'arrivee' })
        .whereNull('r.qr_token')
        .select(
          'r.id', 'r.numero_reservation',
          'ch.numero AS numero_chambre',
          fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client")
        )
        .orderBy('r.date_arrivee')
        .limit(20),
    ])

    reply.send({
      total: arrivees.length + departs.length + checkinEnLigne.length,
      arrivees_jour:    arrivees,
      departs_jour:     departs,
      checkin_en_ligne: checkinEnLigne,
    })
  })
}
