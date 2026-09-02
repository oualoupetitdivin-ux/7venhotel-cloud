'use strict'
module.exports = async function achatsRoutes(fastify) {
  const pre     = [fastify.authentifier, fastify.contexteHotel]
  const preAcces = [...pre, fastify.verifierRole(['manager', 'restaurant'])]

  async function genererNumeroBon(trx, hotelId) {
    const annee = new Date().getFullYear()
    const { count } = await trx('bons_achat')
      .where({ hotel_id: hotelId })
      .whereRaw('EXTRACT(YEAR FROM cree_le) = ?', [annee])
      .count('* AS count')
      .first()
    const seq = String(Number(count) + 1).padStart(4, '0')
    return `BA-${annee}-${seq}`
  }

  // ── GET /achats/bons ──────────────────────────────────────────────────────
  fastify.get('/bons', { preHandler: preAcces }, async (req, reply) => {
    const { statut, fournisseur_id } = req.query
    let q = fastify.db('bons_achat AS b')
      .join('fournisseurs AS f', 'f.id', 'b.fournisseur_id')
      .where('b.hotel_id', req.hotelId)
      .select('b.*', 'f.nom AS fournisseur_nom')
    if (statut)          q = q.where('b.statut', statut)
    if (fournisseur_id)  q = q.where('b.fournisseur_id', fournisseur_id)
    const bons = await q.orderBy('b.cree_le', 'desc')
    reply.send({ bons })
  })

  fastify.get('/bons/:id', { preHandler: preAcces }, async (req, reply) => {
    const bon = await fastify.db('bons_achat AS b')
      .join('fournisseurs AS f', 'f.id', 'b.fournisseur_id')
      .where({ 'b.id': req.params.id, 'b.hotel_id': req.hotelId })
      .select('b.*', 'f.nom AS fournisseur_nom')
      .first()
    if (!bon) return reply.status(404).send({ erreur: 'Bon d\'achat introuvable' })

    const lignes = await fastify.db('lignes_bon_achat AS l')
      .join('articles_menu AS a', 'a.id', 'l.article_id')
      .where('l.bon_achat_id', bon.id)
      .select('l.*', 'a.nom AS article_nom', 'a.unite')

    reply.send({ bon, lignes })
  })

  // ── POST /achats/bons ─────────────────────────────────────────────────────
  fastify.post('/bons', { preHandler: preAcces }, async (req, reply) => {
    const { lignes, ...bonData } = req.body
    if (!bonData.fournisseur_id)
      return reply.status(400).send({ erreur: 'fournisseur_id requis' })
    if (!lignes?.length)
      return reply.status(400).send({ erreur: 'Au moins une ligne article requise' })

    const bon = await fastify.db.transaction(async (trx) => {
      const numero_bon = await genererNumeroBon(trx, req.hotelId)
      const [rowBon] = await trx('bons_achat').insert({
        ...bonData,
        hotel_id:   req.hotelId,
        numero_bon,
        cree_par:   req.user.id,
      }).returning('*')

      await trx('lignes_bon_achat').insert(lignes.map(l => ({
        bon_achat_id:       rowBon.id,
        article_id:         l.article_id,
        quantite_commandee: l.quantite_commandee,
        prix_unitaire:      l.prix_unitaire,
      })))

      return rowBon
    })

    reply.status(201).send({ message: 'Bon d\'achat créé', bon })
  })

  // ── PUT /achats/bons/:id ──────────────────────────────────────────────────
  fastify.put('/bons/:id', { preHandler: preAcces }, async (req, reply) => {
    const { lignes, ...bonData } = req.body

    const bon = await fastify.db.transaction(async (trx) => {
      const existant = await trx('bons_achat')
        .where({ id: req.params.id, hotel_id: req.hotelId })
        .first()
      if (!existant) throw Object.assign(new Error('Bon d\'achat introuvable'), { statusCode: 404 })

      const [rowBon] = await trx('bons_achat')
        .where({ id: req.params.id, hotel_id: req.hotelId })
        .update(bonData)
        .returning('*')

      // Les lignes ne peuvent être remplacées que tant que le bon n'a pas été réceptionné
      if (lignes?.length && existant.statut === 'brouillon') {
        await trx('lignes_bon_achat').where({ bon_achat_id: rowBon.id }).del()
        await trx('lignes_bon_achat').insert(lignes.map(l => ({
          bon_achat_id:       rowBon.id,
          article_id:         l.article_id,
          quantite_commandee: l.quantite_commandee,
          prix_unitaire:      l.prix_unitaire,
        })))
      }

      return rowBon
    })

    reply.send({ message: 'Bon d\'achat modifié', bon })
  })

  // ── POST /achats/bons/:id/recevoir ────────────────────────────────────────
  // body.lignes optionnel : [{ id (ligne_bon_achat), quantite_recue }]
  // Si omis, reçoit intégralement le solde restant de chaque ligne.
  fastify.post('/bons/:id/recevoir', { preHandler: preAcces }, async (req, reply) => {
    const receptionsDemandees = req.body?.lignes || null

    const bon = await fastify.db.transaction(async (trx) => {
      const bonActuel = await trx('bons_achat')
        .where({ id: req.params.id, hotel_id: req.hotelId })
        .forUpdate()
        .first()
      if (!bonActuel) throw Object.assign(new Error('Bon d\'achat introuvable'), { statusCode: 404 })
      if (['recu', 'annule'].includes(bonActuel.statut))
        throw Object.assign(new Error(`Bon déjà ${bonActuel.statut === 'recu' ? 'reçu' : 'annulé'}`), { statusCode: 409 })

      const lignes = await trx('lignes_bon_achat').where({ bon_achat_id: bonActuel.id })

      for (const ligne of lignes) {
        const demande = receptionsDemandees?.find(r => r.id === ligne.id)
        const solde   = Number(ligne.quantite_commandee) - Number(ligne.quantite_recue || 0)
        const qteRecue = demande ? Number(demande.quantite_recue) : solde
        if (!(qteRecue > 0)) continue

        const article = await trx('articles_menu')
          .where({ id: ligne.article_id, hotel_id: req.hotelId })
          .forUpdate()
          .first()
        if (!article) continue

        const stockAvant = Number(article.stock_actuel) || 0
        const stockApres = stockAvant + qteRecue

        await trx('mouvements_stock').insert({
          hotel_id:       req.hotelId,
          article_id:     article.id,
          type_mouvement: 'entree',
          quantite:       qteRecue,
          stock_avant:    stockAvant,
          stock_apres:    stockApres,
          motif:          `Réception bon d'achat ${bonActuel.numero_bon}`,
          bon_achat_id:   bonActuel.id,
          cree_par:       req.user.id,
        })

        await trx('articles_menu')
          .where({ id: article.id, hotel_id: req.hotelId })
          .update({ stock_actuel: stockApres })

        await trx('lignes_bon_achat')
          .where({ id: ligne.id })
          .update({ quantite_recue: Number(ligne.quantite_recue || 0) + qteRecue })
      }

      const lignesApres = await trx('lignes_bon_achat').where({ bon_achat_id: bonActuel.id })
      const complet = lignesApres.every(l => Number(l.quantite_recue) >= Number(l.quantite_commandee))

      const [rowBon] = await trx('bons_achat')
        .where({ id: bonActuel.id, hotel_id: req.hotelId })
        .update({
          statut:         complet ? 'recu' : 'recu_partiel',
          date_reception: trx.fn.now(),
        })
        .returning('*')

      return rowBon
    })

    reply.send({ message: 'Réception enregistrée', bon })
  })

  // ── DELETE /achats/bons/:id ───────────────────────────────────────────────
  fastify.delete('/bons/:id', { preHandler: preAcces }, async (req, reply) => {
    const bon = await fastify.db('bons_achat')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .first()
    if (!bon) return reply.status(404).send({ erreur: 'Bon d\'achat introuvable' })
    if (bon.statut !== 'brouillon')
      return reply.status(409).send({ erreur: 'Seul un bon en brouillon peut être annulé' })

    const [rowBon] = await fastify.db('bons_achat')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ statut: 'annule' })
      .returning('*')

    reply.send({ message: 'Bon d\'achat annulé', bon: rowBon })
  })
}
