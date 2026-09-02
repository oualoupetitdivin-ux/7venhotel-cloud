'use strict'
module.exports = async function fournisseursRoutes(fastify) {
  const pre     = [fastify.authentifier, fastify.contexteHotel]
  const preAcces = [...pre, fastify.verifierRole(['manager', 'restaurant'])]

  fastify.get('/', { preHandler: preAcces }, async (req, reply) => {
    const { actif } = req.query
    let q = fastify.db('fournisseurs').where({ hotel_id: req.hotelId })
    q = q.where('actif', actif === 'false' ? false : true)
    const fournisseurs = await q.orderBy('nom')
    reply.send({ fournisseurs })
  })

  fastify.get('/:id', { preHandler: preAcces }, async (req, reply) => {
    const fournisseur = await fastify.db('fournisseurs')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .first()
    if (!fournisseur) return reply.status(404).send({ erreur: 'Fournisseur introuvable' })

    const bons = await fastify.db('bons_achat')
      .where({ fournisseur_id: fournisseur.id, hotel_id: req.hotelId })
      .orderBy('cree_le', 'desc')

    reply.send({ fournisseur, bons })
  })

  fastify.post('/', { preHandler: preAcces }, async (req, reply) => {
    const [fournisseur] = await fastify.db('fournisseurs').insert({
      ...req.body, hotel_id: req.hotelId
    }).returning('*')
    reply.status(201).send({ message: 'Fournisseur créé', fournisseur })
  })

  fastify.put('/:id', { preHandler: preAcces }, async (req, reply) => {
    const [fournisseur] = await fastify.db('fournisseurs')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(req.body)
      .returning('*')
    if (!fournisseur) return reply.status(404).send({ erreur: 'Fournisseur introuvable' })
    reply.send({ message: 'Fournisseur modifié', fournisseur })
  })

  fastify.delete('/:id', { preHandler: preAcces }, async (req, reply) => {
    const [fournisseur] = await fastify.db('fournisseurs')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ actif: false })
      .returning('*')
    if (!fournisseur) return reply.status(404).send({ erreur: 'Fournisseur introuvable' })
    reply.send({ message: 'Fournisseur archivé', fournisseur })
  })
}
