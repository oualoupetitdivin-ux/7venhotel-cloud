'use strict'
module.exports = async function clientsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const { q, segment, page = 1, limite = 50 } = req.query
    let query = fastify.db('clients').where({ hotel_id: req.hotelId, actif: true })
    if (q) query = query.where(function() {
      this.whereILike('prenom', `%${q}%`).orWhereILike('nom', `%${q}%`).orWhereILike('email', `%${q}%`)
    })
    if (segment) query = query.where({ segment })
    const offset = (parseInt(page)-1) * parseInt(limite)
    const [data, [{ total }]] = await Promise.all([
      query.clone().select('id','prenom','nom','email','telephone','segment','points_fidelite','nombre_sejours','revenu_total','cree_le').orderBy('nom').limit(parseInt(limite)).offset(offset),
      query.clone().count('id AS total')
    ])
    reply.send({ data, pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) } })
  })
  fastify.get('/:id', { preHandler: pre }, async (req, reply) => {
    const client = await fastify.db('clients').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })
    const sejours = await fastify.db('reservations').where({ client_id: client.id }).orderBy('date_arrivee','desc').limit(10)
    reply.send({ client, sejours_recents: sejours })
  })
  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    const data = req.body
    if (data.mot_de_passe) {
      data.mot_de_passe_hash = await fastify.hashMotDePasse(data.mot_de_passe)
      delete data.mot_de_passe
    }
    const [client] = await fastify.db('clients').insert({
      ...data, hotel_id: req.hotelId, tenant_id: req.tenantId
    }).returning('*')
    reply.status(201).send({ message: 'Client créé', client })
  })
  fastify.put('/:id', { preHandler: pre }, async (req, reply) => {
    const data = { ...req.body }
    if (data.mot_de_passe) { data.mot_de_passe_hash = await fastify.hashMotDePasse(data.mot_de_passe); delete data.mot_de_passe }
    const [updated] = await fastify.db('clients').where({ id: req.params.id, hotel_id: req.hotelId }).update(data).returning('*')
    if (!updated) return reply.status(404).send({ erreur: 'Client introuvable' })
    reply.send({ message: 'Client mis à jour', client: updated })
  })
}
