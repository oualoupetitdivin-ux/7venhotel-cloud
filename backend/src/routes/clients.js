'use strict'
module.exports = async function clientsRoutes(fastify) {
  const pre      = [fastify.authentifier, fastify.contexteHotel]
  const preRead   = [...pre, fastify.verifierPermission('clients.lire')]
  const preCreate = [...pre, fastify.verifierPermission('clients.creer')]
  const preModif  = [...pre, fastify.verifierPermission('clients.modifier')]

  fastify.get('/', { preHandler: preRead }, async (req, reply) => {
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

  fastify.get('/:id', { preHandler: preRead }, async (req, reply) => {
    const client = await fastify.db('clients').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })
    const sejours = await fastify.db('reservations').where({ client_id: client.id }).orderBy('date_arrivee','desc').limit(10)
    reply.send({ client, sejours_recents: sejours })
  })

  fastify.post('/', { preHandler: preCreate }, async (req, reply) => {
    const CHAMPS = ['titre','prenom','nom','email','telephone','indicatif_pays',
                    'nationalite','pays_residence','date_naissance',
                    'type_document','numero_document','date_expiration_document',
                    'adresse','ville','code_postal','segment','notes_internes']
    const insertData = {}
    for (const k of CHAMPS) {
      if (req.body[k] !== undefined) insertData[k] = req.body[k]
    }
    if (req.body.mot_de_passe) {
      insertData.mot_de_passe_hash = await fastify.hashMotDePasse(req.body.mot_de_passe)
    }
    const [client] = await fastify.db('clients').insert({
      ...insertData, hotel_id: req.hotelId, tenant_id: req.tenantId
    }).returning('*')
    reply.status(201).send({ message: 'Client créé', client })
  })

  fastify.put('/:id', { preHandler: preModif }, async (req, reply) => {
    const CHAMPS = ['titre','prenom','nom','email','telephone','indicatif_pays',
                    'nationalite','pays_residence','date_naissance',
                    'type_document','numero_document','date_expiration_document',
                    'adresse','ville','code_postal','segment','actif','notes_internes']
    const updateData = {}
    for (const k of CHAMPS) {
      if (req.body[k] !== undefined) updateData[k] = req.body[k]
    }
    if (req.body.mot_de_passe) {
      updateData.mot_de_passe_hash = await fastify.hashMotDePasse(req.body.mot_de_passe)
    }
    const [updated] = await fastify.db('clients')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updateData)
      .returning('*')
    if (!updated) return reply.status(404).send({ erreur: 'Client introuvable' })
    reply.send({ message: 'Client mis à jour', client: updated })
  })
}
