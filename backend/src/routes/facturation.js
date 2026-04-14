'use strict'
module.exports = async function facturationRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/factures', { preHandler: pre }, async (req, reply) => {
    const factures = await fastify.db('factures').where({ hotel_id: req.hotelId }).orderBy('cree_le','desc').limit(100)
    reply.send({ factures })
  })
  fastify.post('/factures', { preHandler: pre }, async (req, reply) => {
    const [facture] = await fastify.db('factures').insert({ ...req.body, hotel_id: req.hotelId }).returning('*')
    reply.status(201).send({ message: 'Facture créée', facture })
  })
  fastify.get('/taxes', { preHandler: pre }, async (req, reply) => {
    const taxes = await fastify.db('taxes').where({ hotel_id: req.hotelId, active: true }).orderBy('ordre')
    reply.send({ taxes })
  })
  fastify.post('/taxes', { preHandler: pre }, async (req, reply) => {
    const [taxe] = await fastify.db('taxes').insert({ ...req.body, hotel_id: req.hotelId }).returning('*')
    reply.status(201).send({ message: 'Taxe créée', taxe })
  })
  fastify.put('/taxes/:id', { preHandler: pre }, async (req, reply) => {
    const [updated] = await fastify.db('taxes').where({ id: req.params.id, hotel_id: req.hotelId }).update(req.body).returning('*')
    reply.send({ message: 'Taxe mise à jour', taxe: updated })
  })
}
