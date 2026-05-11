'use strict'

module.exports = async function analyticsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /analytics/dashboard ──────────────────────────────────────────────
  // KPI opérationnels temps réel — cache 60s
  // CORRECTIONS :
  //   taux_occupation : reservations actives (date_arrivee/date_depart) — pas statut ménage chambres
  //   revenu_jour     : lignes_folio du jour (ledger) + fallback tarif_nuit si folios absents
  //   encaissements_jour : paiements validés du jour
  //   ca_restaurant_jour : commandes servies du jour
  fastify.get('/dashboard', { preHandler: pre }, async (req, reply) => {
    const cacheKey = `analytics:dash:${req.hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [
      chambresQ,
      reservationsActivesQ,
      arrivees,
      departs,
      revenuFolioQ,
      revenuReservationQ,
      encaissementsQ,
      caRestoQ,
      tachesOuvertes,
      ticketsUrgents
    ] = await Promise.all([

      // Chambres disponibles (hors_service exclus)
      fastify.db.raw(
        `SELECT COUNT(*) AS disponibles
         FROM chambres
         WHERE hotel_id = ? AND hors_service = false`,
        [req.hotelId]
      ),

      // VRAI taux occupation : réservations avec client physiquement présent aujourd'hui
      // Statuts 'arrivee' et 'depart_aujourd_hui' = client dans la chambre
      fastify.db.raw(
        `SELECT COUNT(DISTINCT chambre_id) AS occupees
         FROM reservations
         WHERE hotel_id = ?
           AND date_arrivee <= CURRENT_DATE
           AND date_depart > CURRENT_DATE
           AND statut IN ('arrivee', 'depart_aujourd_hui')`,
        [req.hotelId]
      ),

      // Arrivées du jour : reservations attendues ou déjà checkées aujourd'hui
      fastify.db.raw(
        `SELECT COUNT(*) AS total
         FROM reservations
         WHERE hotel_id = ?
           AND date_arrivee = CURRENT_DATE
           AND statut IN ('confirmee', 'arrivee')`,
        [req.hotelId]
      ),

      // Départs du jour : clients dont le départ est aujourd'hui
      fastify.db.raw(
        `SELECT COUNT(*) AS total
         FROM reservations
         WHERE hotel_id = ?
           AND date_depart = CURRENT_DATE
           AND statut IN ('arrivee', 'depart_aujourd_hui')`,
        [req.hotelId]
      ),

      // VRAI revenu jour : lignes_folio avec date_facturation = aujourd'hui
      // Source de vérité financière — ledger immuable
      fastify.db.raw(
        `SELECT COALESCE(SUM(lf.montant_total), 0) AS total
         FROM lignes_folio lf
         JOIN folios f ON f.id = lf.folio_id
         WHERE f.hotel_id = ?
           AND lf.date_facturation = CURRENT_DATE`,
        [req.hotelId]
      ),

      // Fallback revenu : somme des tarifs_nuit des réservations actives
      // Utilisé si le ledger folio n'est pas encore alimenté
      fastify.db.raw(
        `SELECT COALESCE(SUM(tarif_nuit), 0) AS total
         FROM reservations
         WHERE hotel_id = ?
           AND date_arrivee <= CURRENT_DATE
           AND date_depart > CURRENT_DATE
           AND statut IN ('arrivee', 'depart_aujourd_hui')`,
        [req.hotelId]
      ),

      // Encaissements réels du jour : paiements confirmés
      fastify.db.raw(
        `SELECT COALESCE(SUM(montant), 0) AS total
         FROM paiements
         WHERE hotel_id = ?
           AND statut = 'valide'
           AND DATE(traite_le) = CURRENT_DATE`,
        [req.hotelId]
      ),

      // CA restaurant du jour : commandes effectivement servies
      fastify.db.raw(
        `SELECT COALESCE(SUM(total), 0) AS total
         FROM commandes_restaurant
         WHERE hotel_id = ?
           AND statut = 'servie'
           AND DATE(heure_servie) = CURRENT_DATE`,
        [req.hotelId]
      ),

      // Tâches ménage non terminées
      fastify.db('taches_menage')
        .where({ hotel_id: req.hotelId })
        .whereNotIn('statut', ['validee'])
        .count('id AS total')
        .first(),

      // Tickets maintenance urgents ouverts
      fastify.db('tickets_maintenance')
        .where({ hotel_id: req.hotelId, priorite: 'urgente' })
        .whereNotIn('statut', ['resolu', 'ferme'])
        .count('id AS total')
        .first()
    ])

    const disponibles = parseInt(chambresQ.rows[0]?.disponibles || 0)
    const occupees    = parseInt(reservationsActivesQ.rows[0]?.occupees || 0)
    const tauxOcc     = disponibles > 0
      ? Math.round((occupees / disponibles) * 10000) / 100
      : 0

    const revenuFolio       = parseFloat(revenuFolioQ.rows[0]?.total || 0)
    const revenuReservation  = parseFloat(revenuReservationQ.rows[0]?.total || 0)
    const revenuJour         = revenuFolio > 0 ? revenuFolio : revenuReservation

    const result = {
      taux_occupation:        tauxOcc,
      chambres_occupees:      occupees,
      chambres_disponibles:   disponibles,
      revenu_jour:            revenuJour,
      revenu_source:          revenuFolio > 0 ? 'folio' : 'reservation',
      encaissements_jour:     parseFloat(encaissementsQ.rows[0]?.total || 0),
      ca_restaurant_jour:     parseFloat(caRestoQ.rows[0]?.total || 0),
      arrivees_aujourd_hui:   parseInt(arrivees.rows[0]?.total || 0),
      departs_aujourd_hui:    parseInt(departs.rows[0]?.total || 0),
      taches_menage_ouvertes: parseInt(tachesOuvertes?.total || 0),
      tickets_urgents:        parseInt(ticketsUrgents?.total || 0)
    }

    await fastify.cache.set(cacheKey, result, 60)
    reply.send(result)
  })

  // ── GET /analytics/quotidiennes ───────────────────────────────────────────
  fastify.get('/quotidiennes', { preHandler: pre }, async (req, reply) => {
    const { debut, fin } = req.query
    const data = await fastify.db('analytics_quotidiennes')
      .where({ hotel_id: req.hotelId })
      .where('date', '>=', debut || fastify.db.raw("CURRENT_DATE - INTERVAL '30 days'"))
      .where('date', '<=', fin   || fastify.db.raw('CURRENT_DATE'))
      .orderBy('date')
    reply.send({ data })
  })

  // ── GET /analytics/mensuelles ─────────────────────────────────────────────
  fastify.get('/mensuelles', { preHandler: pre }, async (req, reply) => {
    const data = await fastify.db('analytics_mensuelles')
      .where({ hotel_id: req.hotelId })
      .orderBy('annee', 'desc').orderBy('mois', 'desc').limit(12)
    reply.send({ data })
  })
}
