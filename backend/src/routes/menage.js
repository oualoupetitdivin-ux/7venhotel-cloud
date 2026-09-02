'use strict'
module.exports = async function menageRoutes(fastify) {
  const pre      = [fastify.authentifier, fastify.contexteHotel]
  const preRead   = [...pre, fastify.verifierPermission('menage.lire')]
  const preCreate = [...pre, fastify.verifierPermission('menage.creer')]
  const preModif  = [...pre, fastify.verifierPermission('menage.modifier')]
  const preAdmin  = [...pre, fastify.verifierPermission('menage.valider')]

  // ── GET /menage/taches ─────────────────────────────────────────────────
  fastify.get('/taches', { preHandler: preRead }, async (req, reply) => {
    const { statut, assignee_a, date } = req.query
    let q = fastify.db('taches_menage AS t')
      .leftJoin('chambres AS ch', 'ch.id', 't.chambre_id')
      .leftJoin('utilisateurs AS u', 'u.id', 't.assignee_a')
      .where('t.hotel_id', req.hotelId)
      .select(
        't.*', 'ch.numero AS numero_chambre',
        fastify.db.raw("u.prenom || ' ' || u.nom AS nom_agent"),
        fastify.db.raw("EXTRACT(EPOCH FROM (NOW() - t.cree_le))/60 AS minutes_depuis_creation"),
        fastify.db.raw("CASE WHEN t.heure_debut IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - t.heure_debut))/60 END AS minutes_en_cours"),
      )
    if (statut)     q = q.where('t.statut', statut)
    if (assignee_a) q = q.where('t.assignee_a', assignee_a)
    if (date)       q = q.where('t.date_tache', date)
    else            q = q.where('t.date_tache', fastify.db.raw('CURRENT_DATE'))
    const taches = await q.orderBy('t.priorite', 'desc').orderBy('t.cree_le')
    reply.send({ taches })
  })

  // ── POST /menage/taches ────────────────────────────────────────────────
  fastify.post('/taches', { preHandler: preCreate }, async (req, reply) => {
    const [tache] = await fastify.db('taches_menage').insert({
      ...req.body, hotel_id: req.hotelId
    }).returning('*')
    reply.status(201).send({ message: 'Tâche créée', tache })
  })

  // ── PUT /menage/taches/:id/statut ──────────────────────────────────────
  fastify.put('/taches/:id/statut', { preHandler: preModif }, async (req, reply) => {
    const { statut, notes } = req.body

    // Fetch first to compute duree_minutes accurately
    const tacheActuelle = await fastify.db('taches_menage')
      .where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!tacheActuelle) return reply.status(404).send({ erreur: 'Tâche introuvable' })

    const updates = { statut, mis_a_jour_le: fastify.db.fn.now() }
    if (statut === 'en_cours') updates.heure_debut = fastify.db.fn.now()
    if (statut === 'terminee') {
      updates.heure_fin = fastify.db.fn.now()
      // duree_minutes est une colonne GENERATED ALWAYS — calculée auto par PostgreSQL
    }
    if (notes) updates.notes = notes

    const [tache] = await fastify.db('taches_menage')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updates).returning('*')

    if (statut === 'validee') {
      await fastify.db('chambres')
        .where({ id: tache.chambre_id })
        .update({ statut: 'libre_propre', statut_menage: 'validee' })
      await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    }
    reply.send({ message: 'Statut mis à jour', tache })
  })

  // ── PUT /menage/taches/:id/assigner ───────────────────────────────────
  fastify.put('/taches/:id/assigner', { preHandler: preAdmin }, async (req, reply) => {
    const [tache] = await fastify.db('taches_menage')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ assignee_a: req.body.utilisateur_id, statut: 'assignee', mis_a_jour_le: fastify.db.fn.now() })
      .returning('*')
    if (!tache) return reply.status(404).send({ erreur: 'Tâche introuvable' })
    reply.send({ message: 'Tâche assignée', tache })
  })

  // ── GET /menage/kanban ─────────────────────────────────────────────────
  fastify.get('/kanban', { preHandler: preRead }, async (req, reply) => {
    const { date } = req.query
    const dateCible = date || fastify.db.raw('CURRENT_DATE')
    const statuts = ['ouverte', 'assignee', 'en_cours', 'terminee', 'validee']
    const result = {}
    for (const s of statuts) {
      result[s] = await fastify.db('taches_menage AS t')
        .leftJoin('chambres AS ch', 'ch.id', 't.chambre_id')
        .leftJoin('utilisateurs AS u', 'u.id', 't.assignee_a')
        .where({ 't.hotel_id': req.hotelId, 't.statut': s })
        .where('t.date_tache', dateCible)
        .select(
          't.*', 'ch.numero AS numero_chambre',
          fastify.db.raw("u.prenom || ' ' || u.nom AS nom_agent"),
          fastify.db.raw("EXTRACT(EPOCH FROM (NOW() - t.cree_le))/60 AS minutes_depuis_creation"),
          fastify.db.raw("CASE WHEN t.heure_debut IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - t.heure_debut))/60 END AS minutes_en_cours"),
        )
    }
    reply.send({ kanban: result })
  })

  // ── GET /menage/performance ────────────────────────────────────────────
  fastify.get('/performance', { preHandler: preRead }, async (req, reply) => {
    const { date } = req.query
    const dateCible = date || new Date().toISOString().slice(0, 10)

    const stats = await fastify.db('taches_menage AS t')
      .where({ 't.hotel_id': req.hotelId })
      .where('t.date_tache', dateCible)
      .select(
        fastify.db.raw('COUNT(*) AS total'),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut IN ('terminee','validee')) AS terminees"),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut = 'validee') AS validees"),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut = 'en_cours') AS en_cours"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_debut - t.cree_le))/60) FILTER (WHERE t.heure_debut IS NOT NULL)) AS avg_reponse_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_fin - t.heure_debut))/60) FILTER (WHERE t.heure_fin IS NOT NULL AND t.heure_debut IS NOT NULL)) AS avg_nettoyage_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_fin - t.cree_le))/60) FILTER (WHERE t.heure_fin IS NOT NULL)) AS avg_total_min"),
        fastify.db.raw("MAX(EXTRACT(EPOCH FROM (t.heure_fin - t.heure_debut))/60) FILTER (WHERE t.heure_fin IS NOT NULL AND t.heure_debut IS NOT NULL) AS max_nettoyage_min"),
        fastify.db.raw("MIN(EXTRACT(EPOCH FROM (t.heure_fin - t.heure_debut))/60) FILTER (WHERE t.heure_fin IS NOT NULL AND t.heure_debut IS NOT NULL) AS min_nettoyage_min"),
      )
      .first()

    const parAgent = await fastify.db('taches_menage AS t')
      .leftJoin('utilisateurs AS u', 'u.id', 't.assignee_a')
      .where({ 't.hotel_id': req.hotelId })
      .where('t.date_tache', dateCible)
      .whereNotNull('t.assignee_a')
      .groupBy('t.assignee_a', 'u.prenom', 'u.nom')
      .select(
        't.assignee_a AS agent_id',
        fastify.db.raw("u.prenom || ' ' || u.nom AS nom_agent"),
        fastify.db.raw('COUNT(*) AS taches_total'),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut IN ('terminee','validee')) AS taches_terminees"),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut = 'en_cours') AS en_cours"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_debut - t.cree_le))/60) FILTER (WHERE t.heure_debut IS NOT NULL)) AS avg_reponse_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_fin - t.heure_debut))/60) FILTER (WHERE t.heure_fin IS NOT NULL AND t.heure_debut IS NOT NULL)) AS avg_nettoyage_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_fin - t.cree_le))/60) FILTER (WHERE t.heure_fin IS NOT NULL)) AS avg_total_min"),
      )
      .orderByRaw("COUNT(*) FILTER (WHERE t.statut IN ('terminee','validee')) DESC")

    // 7-day trend
    const trend = await fastify.db('taches_menage AS t')
      .where({ 't.hotel_id': req.hotelId })
      .whereBetween('t.date_tache', [
        fastify.db.raw("CURRENT_DATE - INTERVAL '6 days'"),
        fastify.db.raw('CURRENT_DATE'),
      ])
      .groupBy('t.date_tache')
      .select(
        't.date_tache',
        fastify.db.raw('COUNT(*) AS total'),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut IN ('terminee','validee')) AS terminees"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_fin - t.heure_debut))/60) FILTER (WHERE t.heure_fin IS NOT NULL AND t.heure_debut IS NOT NULL)) AS avg_nettoyage"),
      )
      .orderBy('t.date_tache')

    reply.send({ stats, parAgent, trend, date: dateCible })
  })

  // ── GET /menage/agents ─────────────────────────────────────────────────
  fastify.get('/agents', { preHandler: preRead }, async (req, reply) => {
    const agents = await fastify.db('utilisateurs')
      .where({ hotel_id: req.hotelId, role: 'housekeeping', actif: true })
      .select('id', 'prenom', 'nom', 'email', 'telephone', 'cree_le')
      .orderBy('prenom')

    const dateCible = new Date().toISOString().slice(0, 10)
    const workloads = await fastify.db('taches_menage AS t')
      .where({ 't.hotel_id': req.hotelId })
      .where('t.date_tache', dateCible)
      .whereNotNull('t.assignee_a')
      .groupBy('t.assignee_a')
      .select(
        't.assignee_a AS agent_id',
        fastify.db.raw('COUNT(*) AS total'),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut IN ('terminee','validee')) AS terminees"),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut = 'en_cours') AS en_cours"),
        fastify.db.raw("COUNT(*) FILTER (WHERE t.statut IN ('ouverte','assignee')) AS en_attente"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (t.heure_fin - t.heure_debut))/60) FILTER (WHERE t.heure_fin IS NOT NULL AND t.heure_debut IS NOT NULL)) AS avg_nettoyage"),
      )

    const workloadMap = workloads.reduce((acc, w) => { acc[w.agent_id] = w; return acc }, {})
    const agentsAvecCharge = agents.map(a => ({
      ...a,
      charge: workloadMap[a.id] || { total: 0, terminees: 0, en_cours: 0, en_attente: 0, avg_nettoyage: null }
    }))

    reply.send({ agents: agentsAvecCharge })
  })
}
