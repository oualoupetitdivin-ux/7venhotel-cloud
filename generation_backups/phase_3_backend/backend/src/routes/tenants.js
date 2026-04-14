'use strict'
module.exports = async function tenantsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.verifierRole(['super_admin'])]
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const tenants = await fastify.db('tenants').select('*').orderBy('cree_le','desc')
    reply.send({ tenants })
  })
  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    const [tenant] = await fastify.db('tenants').insert(req.body).returning('*')
    reply.status(201).send({ message: 'Tenant créé', tenant })
  })
  fastify.put('/:id', { preHandler: pre }, async (req, reply) => {
    const [updated] = await fastify.db('tenants').where({ id: req.params.id }).update(req.body).returning('*')
    reply.send({ message: 'Tenant mis à jour', tenant: updated })
  })
}
