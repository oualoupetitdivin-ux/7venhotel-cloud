'use strict'
module.exports = async function utilisateursRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.verifierRole(['super_admin','manager'])]
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const users = await fastify.db('utilisateurs')
      .where({ tenant_id: req.user.tenant_id })
      .select('id','email','prenom','nom','role','actif','derniere_connexion','avatar_url','hotel_id')
      .orderBy('nom')
    reply.send({ utilisateurs: users })
  })
  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    const data = { ...req.body }
    data.mot_de_passe_hash = await fastify.hashMotDePasse(data.mot_de_passe || 'TempPass@2024!')
    delete data.mot_de_passe
    data.tenant_id = req.user.tenant_id
    const [user] = await fastify.db('utilisateurs').insert(data).returning(['id','email','prenom','nom','role'])
    reply.status(201).send({ message: 'Utilisateur créé', utilisateur: user })
  })
  fastify.put('/:id', { preHandler: pre }, async (req, reply) => {
    const data = { ...req.body }
    if (data.mot_de_passe) { data.mot_de_passe_hash = await fastify.hashMotDePasse(data.mot_de_passe); delete data.mot_de_passe }
    const [updated] = await fastify.db('utilisateurs').where({ id: req.params.id, tenant_id: req.user.tenant_id }).update(data).returning('*')
    reply.send({ message: 'Utilisateur mis à jour', utilisateur: updated })
  })
  fastify.delete('/:id', { preHandler: pre }, async (req, reply) => {
    await fastify.db('utilisateurs').where({ id: req.params.id, tenant_id: req.user.tenant_id }).update({ actif: false })
    reply.send({ message: 'Utilisateur désactivé' })
  })
}
