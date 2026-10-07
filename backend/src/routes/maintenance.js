'use strict'
module.exports = async function maintenanceRoutes(fastify) {
  const pre      = [fastify.authentifier, fastify.contexteHotel]
  const preRead   = [...pre, fastify.verifierPermission('maintenance.lire')]
  const preCreate = [...pre, fastify.verifierPermission('maintenance.creer')]
  const preModif  = [...pre, fastify.verifierPermission('maintenance.modifier')]

  fastify.get('/tickets', { preHandler: preRead }, async (req, reply) => {
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

  // HELICONIA-READY-01 — isolation : le corps était recopié tel quel (hotel_id réécrivable)
  // et chambre_id n'était pas vérifié → mise hors service d'une chambre d'un autre tenant.
  const CHAMPS_CREATION = ['titre', 'description', 'categorie', 'priorite', 'chambre_id', 'hors_service', 'assigne_a', 'photos']
  const CHAMPS_MODIF    = ['titre', 'description', 'categorie', 'priorite', 'statut', 'assigne_a', 'diagnostic',
                           'pieces_utilisees', 'duree_intervention_minutes', 'cout_reparation', 'photos', 'notes_technicien']
  const filtrer = (body, champs) => Object.fromEntries(Object.entries(body || {}).filter(([k]) => champs.includes(k)))
  const chambreDeLHotel = (id, hotelId) => fastify.db('chambres').where({ id, hotel_id: hotelId }).first()
  const technicienDeLHotel = (id, hotelId) => fastify.db('utilisateurs').where({ id, hotel_id: hotelId }).first()

  fastify.post('/tickets', { preHandler: preCreate }, async (req, reply) => {
    const data = filtrer(req.body, CHAMPS_CREATION)
    if (data.chambre_id && !(await chambreDeLHotel(data.chambre_id, req.hotelId)))
      return reply.status(404).send({ erreur: 'Chambre introuvable', code: 'CHAMBRE_INTROUVABLE' })
    if (data.assigne_a && !(await technicienDeLHotel(data.assigne_a, req.hotelId)))
      return reply.status(404).send({ erreur: 'Technicien introuvable', code: 'UTILISATEUR_INTROUVABLE' })
    const [ticket] = await fastify.db('tickets_maintenance').insert({
      ...data, hotel_id: req.hotelId, signale_par: req.user.id
    }).returning('*')
    if (data.hors_service && data.chambre_id) {
      await fastify.db('chambres').where({ id: data.chambre_id, hotel_id: req.hotelId }).update({ statut: 'hors_service', hors_service: true })
      await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    }
    reply.status(201).send({ message: 'Ticket créé', ticket })
  })

  fastify.put('/tickets/:id', { preHandler: preModif }, async (req, reply) => {
    const ticket = await fastify.db('tickets_maintenance').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!ticket) return reply.status(404).send({ erreur: 'Ticket introuvable' })
    const updates = filtrer(req.body, CHAMPS_MODIF)
    if (updates.assigne_a && !(await technicienDeLHotel(updates.assigne_a, req.hotelId)))
      return reply.status(404).send({ erreur: 'Technicien introuvable', code: 'UTILISATEUR_INTROUVABLE' })
    if (updates.statut === 'en_cours') updates.heure_debut = fastify.db.fn.now()
    if (updates.statut === 'resolu') {
      updates.heure_resolution = fastify.db.fn.now()
      if (ticket.hors_service && ticket.chambre_id) {
        await fastify.db('chambres').where({ id: ticket.chambre_id, hotel_id: req.hotelId }).update({ statut: 'libre_propre', hors_service: false })
        await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
      }
    }
    const [updated] = await fastify.db('tickets_maintenance')
      .where({ id: req.params.id, hotel_id: req.hotelId }).update(updates).returning('*')
    reply.send({ message: 'Ticket mis à jour', ticket: updated })
  })

  fastify.get('/tickets/:id', { preHandler: preRead }, async (req, reply) => {
    const ticket = await fastify.db('tickets_maintenance AS t')
      .leftJoin('chambres AS ch','ch.id','t.chambre_id')
      .where({ 't.id': req.params.id, 't.hotel_id': req.hotelId }).first()
    if (!ticket) return reply.status(404).send({ erreur: 'Ticket introuvable' })
    reply.send({ ticket })
  })
}
