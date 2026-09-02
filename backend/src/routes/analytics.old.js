'use strict'
module.exports = async function analyticsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/dashboard', { preHandler: pre }, async (req, reply) => {
    const cacheKey = `analytics:dash:${req.hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)
    const [tauxOcc, revJour, arrivees, departs, tachesOuvertes, ticketsUrgents] = await Promise.all([
      fastify.db.raw(`SELECT ROUND(COUNT(CASE WHEN statut='occupee' THEN 1 END)*100.0/NULLIF(COUNT(*),0),2) as taux FROM chambres WHERE hotel_id = ? AND NOT hors_service`, [req.hotelId]),
      fastify.db.raw(`SELECT COALESCE(SUM(total_general),0) as total FROM reservations WHERE hotel_id=? AND DATE(heure_arrivee_reelle)=CURRENT_DATE`, [req.hotelId]),
      fastify.db.raw(`SELECT COUNT(*) as total FROM reservations WHERE hotel_id=? AND date_arrivee=CURRENT_DATE AND statut='confirmee'`, [req.hotelId]),
      fastify.db.raw(`SELECT COUNT(*) as total FROM reservations WHERE hotel_id=? AND date_depart=CURRENT_DATE AND statut='arrivee'`, [req.hotelId]),
      fastify.db('taches_menage').where({ hotel_id: req.hotelId }).whereNotIn('statut',['validee']).count('id AS total').first(),
      fastify.db('tickets_maintenance').where({ hotel_id: req.hotelId, priorite: 'urgente' }).whereNotIn('statut',['resolu','ferme']).count('id AS total').first()
    ])
    const result = {
      taux_occupation: parseFloat(tauxOcc.rows[0]?.taux || 0),
      revenu_jour: parseFloat(revJour.rows[0]?.total || 0),
      arrivees_aujourd_hui: parseInt(arrivees.rows[0]?.total || 0),
      departs_aujourd_hui: parseInt(departs.rows[0]?.total || 0),
      taches_menage_ouvertes: parseInt(tachesOuvertes?.total || 0),
      tickets_urgents: parseInt(ticketsUrgents?.total || 0)
    }
    await fastify.cache.set(cacheKey, result, 60)
    reply.send(result)
  })
  fastify.get('/quotidiennes', { preHandler: pre }, async (req, reply) => {
    const { debut, fin } = req.query
    const data = await fastify.db('analytics_quotidiennes')
      .where({ hotel_id: req.hotelId })
      .where('date', '>=', debut || fastify.db.raw("CURRENT_DATE - INTERVAL '30 days'"))
      .where('date', '<=', fin || fastify.db.raw('CURRENT_DATE'))
      .orderBy('date')
    reply.send({ data })
  })
  fastify.get('/mensuelles', { preHandler: pre }, async (req, reply) => {
    const data = await fastify.db('analytics_mensuelles')
      .where({ hotel_id: req.hotelId })
      .orderBy('annee','desc').orderBy('mois','desc').limit(12)
    reply.send({ data })
  })
}
