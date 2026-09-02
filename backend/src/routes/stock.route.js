'use strict'

// Mouvements qui diminuent le stock — la quantité reçue est retranchée.
const MOUVEMENTS_SORTANTS = ['sortie', 'perte', 'transfert']
const TYPES_VALIDES = ['entree', 'sortie', 'perte', 'inventaire', 'transfert']

module.exports = async function stockRoutes(fastify) {
  const pre     = [fastify.authentifier, fastify.contexteHotel]
  const preAcces = [...pre, fastify.verifierRole(['manager', 'restaurant'])]

  // ── GET /stock ────────────────────────────────────────────────────────────
  fastify.get('/', { preHandler: preAcces }, async (req, reply) => {
    const articles = await fastify.db('articles_menu AS a')
      .leftJoin('categories_menu AS c', 'c.id', 'a.categorie_id')
      .where({ 'a.hotel_id': req.hotelId, 'a.actif': true })
      .select(
        'a.id', 'a.nom', 'a.unite', 'a.stock_actuel', 'a.stock_minimum',
        'a.cout_revient', 'a.prix', 'a.devise',
        'c.nom AS categorie_nom',
        fastify.db.raw('(a.stock_actuel <= a.stock_minimum) AS alerte_stock'),
      )
      .orderBy('a.nom')
    reply.send({ articles })
  })

  // ── GET /stock/alertes ────────────────────────────────────────────────────
  fastify.get('/alertes', { preHandler: preAcces }, async (req, reply) => {
    const articles = await fastify.db('articles_menu AS a')
      .leftJoin('categories_menu AS c', 'c.id', 'a.categorie_id')
      .where({ 'a.hotel_id': req.hotelId, 'a.actif': true })
      .whereRaw('a.stock_actuel <= a.stock_minimum')
      .select('a.id', 'a.nom', 'a.unite', 'a.stock_actuel', 'a.stock_minimum', 'c.nom AS categorie_nom')
      .orderBy('a.stock_actuel')
    reply.send({ articles })
  })

  // ── POST /stock/mouvement ─────────────────────────────────────────────────
  fastify.post('/mouvement', { preHandler: preAcces }, async (req, reply) => {
    const { article_id, type_mouvement, quantite, motif, commande_id, bon_achat_id } = req.body

    if (!article_id || !type_mouvement || quantite === undefined || quantite === null)
      return reply.status(400).send({ erreur: 'article_id, type_mouvement et quantite sont requis' })

    if (!TYPES_VALIDES.includes(type_mouvement))
      return reply.status(400).send({ erreur: `type_mouvement invalide — valeurs acceptées : ${TYPES_VALIDES.join(', ')}` })

    const qte = Number(quantite)
    if (!(qte > 0))
      return reply.status(400).send({ erreur: 'quantite doit être un nombre positif' })

    const mouvement = await fastify.db.transaction(async (trx) => {
      const article = await trx('articles_menu')
        .where({ id: article_id, hotel_id: req.hotelId })
        .forUpdate()
        .first()
      if (!article) throw Object.assign(new Error('Article introuvable'), { statusCode: 404 })

      const stockAvant = Number(article.stock_actuel) || 0
      let stockApres
      if (type_mouvement === 'inventaire') {
        stockApres = qte // ajustement au comptage réel — quantite = nouveau stock absolu
      } else if (type_mouvement === 'entree') {
        stockApres = stockAvant + qte
      } else {
        stockApres = Math.max(0, stockAvant - qte)
      }

      const [rowMouvement] = await trx('mouvements_stock').insert({
        hotel_id:       req.hotelId,
        article_id,
        type_mouvement,
        quantite:       qte,
        stock_avant:    stockAvant,
        stock_apres:    stockApres,
        motif:          motif || null,
        commande_id:    commande_id || null,
        bon_achat_id:   bon_achat_id || null,
        cree_par:       req.user.id,
      }).returning('*')

      await trx('articles_menu')
        .where({ id: article_id, hotel_id: req.hotelId })
        .update({ stock_actuel: stockApres })

      return rowMouvement
    })

    reply.status(201).send({ message: 'Mouvement enregistré', mouvement })
  })

  // ── GET /stock/historique ─────────────────────────────────────────────────
  fastify.get('/historique', { preHandler: preAcces }, async (req, reply) => {
    const { article_id, type_mouvement, date_debut, date_fin } = req.query
    let q = fastify.db('mouvements_stock AS m')
      .join('articles_menu AS a', 'a.id', 'm.article_id')
      .leftJoin('utilisateurs AS u', 'u.id', 'm.cree_par')
      .where('m.hotel_id', req.hotelId)
      .select(
        'm.*', 'a.nom AS article_nom', 'a.unite',
        fastify.db.raw("u.prenom || ' ' || u.nom AS nom_agent"),
      )
    if (article_id)     q = q.where('m.article_id', article_id)
    if (type_mouvement)  q = q.where('m.type_mouvement', type_mouvement)
    if (date_debut)      q = q.where('m.cree_le', '>=', date_debut)
    if (date_fin)         q = q.where('m.cree_le', '<=', date_fin)
    const mouvements = await q.orderBy('m.cree_le', 'desc').limit(200)
    reply.send({ mouvements })
  })
}
