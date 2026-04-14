'use strict'
module.exports = async function chambresRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const cacheKey = `chambres:${req.hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)
    const chambres = await fastify.db('chambres AS ch')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where('ch.hotel_id', req.hotelId)
      .select('ch.*','tc.nom AS type_chambre','tc.tarif_base')
      .orderBy('ch.etage').orderBy('ch.numero')
    const result = { chambres }
    await fastify.cache.set(cacheKey, result, 60)
    reply.send(result)
  })
  fastify.get('/:id', { preHandler: pre }, async (req, reply) => {
    const chambre = await fastify.db('chambres AS ch')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where({ 'ch.id': req.params.id, 'ch.hotel_id': req.hotelId })
      .select('ch.*','tc.nom AS type_chambre').first()
    if (!chambre) return reply.status(404).send({ erreur: 'Chambre introuvable' })
    const images = await fastify.db('images_chambres').where({ chambre_id: chambre.id }).orderBy('ordre')
    reply.send({ chambre, images })
  })
  fastify.put('/:id/statut', { preHandler: pre }, async (req, reply) => {
    await fastify.db('chambres').where({ id: req.params.id, hotel_id: req.hotelId }).update({ statut: req.body.statut })
    await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    reply.send({ message: 'Statut mis à jour' })
  })
  fastify.get('/disponibles', { preHandler: pre }, async (req, reply) => {
    const { date_arrivee, date_depart } = req.query
    if (!date_arrivee || !date_depart) return reply.status(400).send({ erreur: 'Dates requises' })
    const reservees = await fastify.db('reservations')
      .where({ hotel_id: req.hotelId })
      .whereNotIn('statut', ['annulee','no_show'])
      .where('date_arrivee', '<', date_depart)
      .where('date_depart', '>', date_arrivee)
      .pluck('chambre_id')
    const disponibles = await fastify.db('chambres AS ch')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where('ch.hotel_id', req.hotelId)
      .where('ch.hors_service', false)
      .whereNotIn('ch.id', reservees)
      .select('ch.*','tc.nom AS type_chambre','tc.tarif_base')
    reply.send({ chambres_disponibles: disponibles })
  })
}
