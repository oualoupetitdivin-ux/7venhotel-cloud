'use strict'
module.exports = async function catalogueRoutes(fastify) {
  const pre     = [fastify.authentifier, fastify.contexteHotel]
  const preAcces = [...pre, fastify.verifierRole(['manager', 'restaurant'])]

  // ── CATÉGORIES ────────────────────────────────────────────────────────────

  fastify.get('/categories', { preHandler: preAcces }, async (req, reply) => {
    const categories = await fastify.db('categories_menu')
      .where({ hotel_id: req.hotelId })
      .orderBy('ordre').orderBy('nom')
    reply.send({ categories })
  })

  fastify.post('/categories', { preHandler: preAcces }, async (req, reply) => {
    const [categorie] = await fastify.db('categories_menu').insert({
      ...req.body, hotel_id: req.hotelId
    }).returning('*')
    reply.status(201).send({ message: 'Catégorie créée', categorie })
  })

  fastify.put('/categories/:id', { preHandler: preAcces }, async (req, reply) => {
    const [categorie] = await fastify.db('categories_menu')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(req.body)
      .returning('*')
    if (!categorie) return reply.status(404).send({ erreur: 'Catégorie introuvable' })
    reply.send({ message: 'Catégorie modifiée', categorie })
  })

  fastify.delete('/categories/:id', { preHandler: preAcces }, async (req, reply) => {
    const [categorie] = await fastify.db('categories_menu')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ actif: false })
      .returning('*')
    if (!categorie) return reply.status(404).send({ erreur: 'Catégorie introuvable' })
    reply.send({ message: 'Catégorie archivée', categorie })
  })

  // ── ARTICLES ──────────────────────────────────────────────────────────────

  fastify.get('/articles', { preHandler: preAcces }, async (req, reply) => {
    const { categorie_id, actif } = req.query
    let q = fastify.db('articles_menu AS a')
      .leftJoin('categories_menu AS c', 'c.id', 'a.categorie_id')
      .where('a.hotel_id', req.hotelId)
      .select(
        'a.*',
        'c.nom AS categorie_nom',
        fastify.db.raw('(a.stock_actuel <= a.stock_minimum) AS alerte_stock'),
      )
    if (categorie_id) q = q.where('a.categorie_id', categorie_id)
    q = q.where('a.actif', actif === 'false' ? false : true)
    const articles = await q.orderBy('a.nom')
    reply.send({ articles })
  })

  // articles_menu.categorie (varchar, NOT NULL) est la colonne legacy utilisée par
  // restaurant.js (GET /menu) pour grouper l'affichage cuisine/POS. On la maintient
  // synchronisée avec le nom de categorie_id pour ne pas casser ce groupement.
  async function resoudreCategorieLegacy(req, categorieId) {
    if (!categorieId) return 'Autre'
    const cat = await fastify.db('categories_menu')
      .where({ id: categorieId, hotel_id: req.hotelId })
      .first()
    return cat?.nom || 'Autre'
  }

  fastify.post('/articles', { preHandler: preAcces }, async (req, reply) => {
    const categorie = req.body.categorie || await resoudreCategorieLegacy(req, req.body.categorie_id)
    const [article] = await fastify.db('articles_menu').insert({
      ...req.body, categorie, hotel_id: req.hotelId
    }).returning('*')
    reply.status(201).send({ message: 'Article créé', article })
  })

  fastify.put('/articles/:id', { preHandler: preAcces }, async (req, reply) => {
    const updates = { ...req.body }
    if (!updates.categorie && 'categorie_id' in updates)
      updates.categorie = await resoudreCategorieLegacy(req, updates.categorie_id)

    const [article] = await fastify.db('articles_menu')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updates)
      .returning('*')
    if (!article) return reply.status(404).send({ erreur: 'Article introuvable' })
    reply.send({ message: 'Article modifié', article })
  })

  fastify.delete('/articles/:id', { preHandler: preAcces }, async (req, reply) => {
    const [article] = await fastify.db('articles_menu')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ actif: false })
      .returning('*')
    if (!article) return reply.status(404).send({ erreur: 'Article introuvable' })
    reply.send({ message: 'Article archivé', article })
  })
}
