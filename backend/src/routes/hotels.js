'use strict'
module.exports = async function hotelsRoutes(fastify) {
  const pre = [fastify.authentifier]
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const hotels = await fastify.db('hotels').where({ tenant_id: req.user.tenant_id }).select('*')
    reply.send({ hotels })
  })
  fastify.get('/:id', { preHandler: pre }, async (req, reply) => {
    const hotel = await fastify.db('hotels').where({ id: req.params.id, tenant_id: req.user.tenant_id }).first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })
    const params = await fastify.db('parametres_hotel').where({ hotel_id: hotel.id }).first()
    reply.send({ hotel, parametres: params })
  })
  fastify.put('/:id/parametres', { preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin','manager'])] }, async (req, reply) => {
    const existing = await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).first()
    if (existing) {
      await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).update(req.body)
    } else {
      await fastify.db('parametres_hotel').insert({ hotel_id: req.params.id, ...req.body })
    }
    await fastify.cache.delPattern('ai_ctx:*')
    reply.send({ message: 'Paramètres mis à jour' })
  })
}
