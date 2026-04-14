'use strict'
module.exports = async function maintenanceRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/tickets', { preHandler: pre }, async (req, reply) => {
    const { statut, priorite } = req.query
    let q = fastify.db('tickets_maintenance AS t')
      .leftJoin('chambres AS ch','ch.id','t.chambre_id')
      .leftJoin('utilisateurs AS u','u.id','t.assigne_a')
      .where('t.hotel_id', req.hotelId)
      .select('t.*','ch.numero AS numero_chambre',fastify.db.raw("u.prenom||' '||u.nom AS nom_technicien"))
    if (statut)   q = q.where('t.statut', statut)
    if (priorite) q = q.where('t.priorite', priorite)
    const tickets = await q.orderBy('t.priorite','desc').orderBy('t.cree_le','desc')
    reply.send({ tickets })
  })
  fastify.post('/tickets', { preHandler: pre }, async (req, reply) => {
    const [ticket] = await fastify.db('tickets_maintenance').insert({
      ...req.body, hotel_id: req.hotelId, signale_par: req.user.id
    }).returning('*')
    if (req.body.hors_service && req.body.chambre_id) {
      await fastify.db('chambres').where({ id: req.body.chambre_id }).update({ statut: 'hors_service', hors_service: true })
      await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    }
    reply.status(201).send({ message: 'Ticket créé', ticket })
  })
  fastify.put('/tickets/:id', { preHandler: pre }, async (req, reply) => {
    const updates = { ...req.body }
    if (req.body.statut === 'en_cours') updates.heure_debut = fastify.db.fn.now()
    if (req.body.statut === 'resolu') {
      updates.heure_resolution = fastify.db.fn.now()
      const ticket = await fastify.db('tickets_maintenance').where({ id: req.params.id }).first()
      if (ticket?.hors_service) {
        await fastify.db('chambres').where({ id: ticket.chambre_id }).update({ statut: 'libre_propre', hors_service: false })
        await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
      }
    }
    const [updated] = await fastify.db('tickets_maintenance')
      .where({ id: req.params.id, hotel_id: req.hotelId }).update(updates).returning('*')
    if (!updated) return reply.status(404).send({ erreur: 'Ticket introuvable' })
    reply.send({ message: 'Ticket mis à jour', ticket: updated })
  })
  fastify.get('/tickets/:id', { preHandler: pre }, async (req, reply) => {
    const ticket = await fastify.db('tickets_maintenance AS t')
      .leftJoin('chambres AS ch','ch.id','t.chambre_id')
      .where({ 't.id': req.params.id, 't.hotel_id': req.hotelId }).first()
    if (!ticket) return reply.status(404).send({ erreur: 'Ticket introuvable' })
    reply.send({ ticket })
  })
}
