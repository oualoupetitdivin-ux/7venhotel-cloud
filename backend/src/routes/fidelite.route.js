'use strict'

const DEFAUTS_REGLES = {
  points_par_nuit:     10,
  points_par_1000_xaf: 5,
  seuil_silver:        200,
  seuil_gold:          500,
}

function calculerNiveau(solde, regles) {
  if (solde >= regles.seuil_gold) return 'gold'
  if (solde >= regles.seuil_silver) return 'silver'
  return 'bronze'
}

module.exports = async function fideliteRoutes(fastify) {
  const pre      = [fastify.authentifier, fastify.contexteHotel]
  const preRead   = [...pre, fastify.verifierPermission('fidelite.lire')]
  const preModif  = [...pre, fastify.verifierPermission('fidelite.modifier')]

  // ── GET /regles ──────────────────────────────────────────────────────────
  fastify.get('/regles', { preHandler: preRead }, async (req, reply) => {
    const regles = await fastify.db('regles_fidelite').where({ hotel_id: req.hotelId }).first()
    reply.send({ regles: regles || { hotel_id: req.hotelId, ...DEFAUTS_REGLES } })
  })

  // ── PUT /regles — upsert ────────────────────────────────────────────────
  fastify.put('/regles', { preHandler: preModif }, async (req, reply) => {
    const { points_par_nuit, points_par_1000_xaf, seuil_silver, seuil_gold } = req.body || {}

    const [regles] = await fastify.db('regles_fidelite')
      .insert({
        hotel_id: req.hotelId,
        points_par_nuit:     points_par_nuit ?? DEFAUTS_REGLES.points_par_nuit,
        points_par_1000_xaf: points_par_1000_xaf ?? DEFAUTS_REGLES.points_par_1000_xaf,
        seuil_silver:         seuil_silver ?? DEFAUTS_REGLES.seuil_silver,
        seuil_gold:           seuil_gold ?? DEFAUTS_REGLES.seuil_gold,
      })
      .onConflict('hotel_id')
      .merge({
        points_par_nuit:     points_par_nuit ?? DEFAUTS_REGLES.points_par_nuit,
        points_par_1000_xaf: points_par_1000_xaf ?? DEFAUTS_REGLES.points_par_1000_xaf,
        seuil_silver:         seuil_silver ?? DEFAUTS_REGLES.seuil_silver,
        seuil_gold:           seuil_gold ?? DEFAUTS_REGLES.seuil_gold,
        modifie_le:            fastify.db.fn.now(),
      })
      .returning('*')

    reply.send({ message: 'Règles de fidélité mises à jour', regles })
  })

  // ── GET /offres ──────────────────────────────────────────────────────────
  fastify.get('/offres', { preHandler: preRead }, async (req, reply) => {
    const { actif } = req.query
    let q = fastify.db('offres').where({ hotel_id: req.hotelId })
    if (actif !== undefined) q = q.where('actif', actif === 'true')
    const offres = await q.orderBy('cree_le', 'desc')
    reply.send({ offres })
  })

  // ── POST /offres ─────────────────────────────────────────────────────────
  fastify.post('/offres', { preHandler: preModif }, async (req, reply) => {
    const [offre] = await fastify.db('offres').insert({
      ...req.body, hotel_id: req.hotelId
    }).returning('*')
    reply.status(201).send({ message: 'Offre créée', offre })
  })

  // ── PUT /offres/:id ──────────────────────────────────────────────────────
  fastify.put('/offres/:id', { preHandler: preModif }, async (req, reply) => {
    const [offre] = await fastify.db('offres')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(req.body)
      .returning('*')
    if (!offre) return reply.status(404).send({ erreur: 'Offre introuvable' })
    reply.send({ message: 'Offre modifiée', offre })
  })

  // ── DELETE /offres/:id — désactiver ─────────────────────────────────────
  fastify.delete('/offres/:id', { preHandler: preModif }, async (req, reply) => {
    const [offre] = await fastify.db('offres')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ actif: false })
      .returning('*')
    if (!offre) return reply.status(404).send({ erreur: 'Offre introuvable' })
    reply.send({ message: 'Offre désactivée', offre })
  })

  // ── GET /clients/:clientId/points — historique ─────────────────────────
  fastify.get('/clients/:clientId/points', { preHandler: preRead }, async (req, reply) => {
    const client = await fastify.db('clients')
      .where({ id: req.params.clientId, hotel_id: req.hotelId })
      .select('id', 'prenom', 'nom', 'points_fidelite', 'niveau_fidelite')
      .first()
    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })

    const historique = await fastify.db('points_fidelite_log')
      .where({ client_id: req.params.clientId, hotel_id: req.hotelId })
      .orderBy('cree_le', 'desc')
      .limit(50)

    reply.send({ client, historique })
  })

  // ── POST /clients/:clientId/points — ajustement manuel ─────────────────
  fastify.post('/clients/:clientId/points', { preHandler: preModif }, async (req, reply) => {
    const { type_mouvement, points, motif } = req.body || {}

    if (!['credit', 'debit'].includes(type_mouvement))
      return reply.status(400).send({ erreur: 'type_mouvement invalide — valeurs acceptées : credit, debit' })

    const pts = Number(points)
    if (!(pts > 0))
      return reply.status(400).send({ erreur: 'points doit être un nombre positif' })

    const client = await fastify.db.transaction(async (trx) => {
      const clientAvant = await trx('clients')
        .where({ id: req.params.clientId, hotel_id: req.hotelId })
        .forUpdate()
        .first()
      if (!clientAvant) throw Object.assign(new Error('Client introuvable'), { statusCode: 404 })

      const regles = await trx('regles_fidelite').where({ hotel_id: req.hotelId }).first()
      const seuils = { seuil_silver: regles?.seuil_silver ?? DEFAUTS_REGLES.seuil_silver, seuil_gold: regles?.seuil_gold ?? DEFAUTS_REGLES.seuil_gold }

      const soldeAvant = clientAvant.points_fidelite || 0
      const soldeApres = Math.max(0, type_mouvement === 'credit' ? soldeAvant + pts : soldeAvant - pts)
      const nouveauNiveau = calculerNiveau(soldeApres, seuils)

      const [clientMisAJour] = await trx('clients')
        .where({ id: req.params.clientId, hotel_id: req.hotelId })
        .update({ points_fidelite: soldeApres, niveau_fidelite: nouveauNiveau })
        .returning(['id', 'prenom', 'nom', 'points_fidelite', 'niveau_fidelite'])

      await trx('points_fidelite_log').insert({
        hotel_id:       req.hotelId,
        client_id:      req.params.clientId,
        type_mouvement,
        points:         pts,
        solde_apres:    soldeApres,
        motif:          motif || (type_mouvement === 'credit' ? 'Ajustement manuel — crédit' : 'Ajustement manuel — débit'),
      })

      return clientMisAJour
    })

    reply.send({ message: 'Points ajustés', client })
  })
}
