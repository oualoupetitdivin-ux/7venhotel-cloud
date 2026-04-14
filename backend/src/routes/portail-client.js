'use strict'
module.exports = async function portailClientRoutes(fastify) {
  const authClient = async (req, reply) => {
    try {
      await req.jwtVerify()
      if (req.user.type !== 'client') throw new Error('Not a client token')
    } catch { return reply.status(401).send({ erreur: 'Non authentifié' }) }
  }
  fastify.get('/reservations', { preHandler: authClient }, async (req, reply) => {
    const reservations = await fastify.db('reservations AS r')
      .leftJoin('chambres AS ch','ch.id','r.chambre_id')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where({ 'r.client_id': req.user.id })
      .select('r.id','r.numero_reservation','r.date_arrivee','r.date_depart','r.statut','r.total_general','r.devise','tc.nom AS type_chambre','ch.numero AS numero_chambre')
      .orderBy('r.date_arrivee','desc')
    reply.send({ reservations })
  })
  fastify.get('/factures', { preHandler: authClient }, async (req, reply) => {
    const factures = await fastify.db('factures').where({ client_id: req.user.id }).orderBy('cree_le','desc')
    reply.send({ factures })
  })
  fastify.get('/profil', { preHandler: authClient }, async (req, reply) => {
    const client = await fastify.db('clients').where({ id: req.user.id }).select('id','prenom','nom','email','telephone','nationalite','pays_residence','segment','points_fidelite','niveau_fidelite','preferences','cree_le').first()
    reply.send({ client })
  })
  fastify.put('/profil', { preHandler: authClient }, async (req, reply) => {
    const data = { ...req.body }
    delete data.mot_de_passe_hash; delete data.id
    await fastify.db('clients').where({ id: req.user.id }).update(data)
    reply.send({ message: 'Profil mis à jour' })
  })
}
