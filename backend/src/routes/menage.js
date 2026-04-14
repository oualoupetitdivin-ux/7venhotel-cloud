'use strict'
module.exports = async function menageRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/taches', { preHandler: pre }, async (req, reply) => {
    const { statut, assignee_a, date } = req.query
    let q = fastify.db('taches_menage AS t')
      .leftJoin('chambres AS ch','ch.id','t.chambre_id')
      .leftJoin('utilisateurs AS u','u.id','t.assignee_a')
      .where('t.hotel_id', req.hotelId)
      .select('t.*','ch.numero AS numero_chambre',fastify.db.raw("u.prenom || ' ' || u.nom AS nom_agent"))
    if (statut)     q = q.where('t.statut', statut)
    if (assignee_a) q = q.where('t.assignee_a', assignee_a)
    if (date)       q = q.where('t.date_tache', date)
    else            q = q.where('t.date_tache', fastify.db.raw('CURRENT_DATE'))
    const taches = await q.orderBy('t.priorite','desc').orderBy('t.cree_le')
    reply.send({ taches })
  })
  fastify.post('/taches', { preHandler: pre }, async (req, reply) => {
    const [tache] = await fastify.db('taches_menage').insert({
      ...req.body, hotel_id: req.hotelId
    }).returning('*')
    reply.status(201).send({ message: 'Tâche créée', tache })
  })
  fastify.put('/taches/:id/statut', { preHandler: pre }, async (req, reply) => {
    const { statut, notes } = req.body
    const updates = { statut }
    if (statut === 'en_cours') updates.heure_debut = fastify.db.fn.now()
    if (statut === 'terminee') updates.heure_fin = fastify.db.fn.now()
    if (notes) updates.notes = notes
    const [tache] = await fastify.db('taches_menage')
      .where({ id: req.params.id, hotel_id: req.hotelId }).update(updates).returning('*')
    if (!tache) return reply.status(404).send({ erreur: 'Tâche introuvable' })
    if (statut === 'validee') {
      await fastify.db('chambres').where({ id: tache.chambre_id }).update({ statut: 'libre_propre', statut_menage: 'validee' })
      await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    }
    reply.send({ message: 'Statut mis à jour', tache })
  })
  fastify.put('/taches/:id/assigner', { preHandler: pre }, async (req, reply) => {
    await fastify.db('taches_menage')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ assignee_a: req.body.utilisateur_id, statut: 'assignee' })
    reply.send({ message: 'Tâche assignée' })
  })
  fastify.get('/kanban', { preHandler: pre }, async (req, reply) => {
    const statuts = ['ouverte','assignee','en_cours','terminee','validee']
    const result = {}
    for (const s of statuts) {
      result[s] = await fastify.db('taches_menage AS t')
        .leftJoin('chambres AS ch','ch.id','t.chambre_id')
        .leftJoin('utilisateurs AS u','u.id','t.assignee_a')
        .where({ 't.hotel_id': req.hotelId, 't.statut': s })
        .where('t.date_tache', fastify.db.raw('CURRENT_DATE'))
        .select('t.*','ch.numero AS numero_chambre',fastify.db.raw("u.prenom || ' ' || u.nom AS nom_agent"))
    }
    reply.send({ kanban: result })
  })
}
