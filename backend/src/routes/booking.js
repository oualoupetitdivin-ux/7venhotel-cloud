'use strict'
module.exports = async function bookingRoutes(fastify) {
  // Routes publiques moteur de réservation
  fastify.get('/disponibilite/:hotel_slug', async (req, reply) => {
    const { date_arrivee, date_depart } = req.query
    if (!date_arrivee || !date_depart) return reply.status(400).send({ erreur: 'Dates requises' })
    const hotel = await fastify.db('hotels').where({ slug: req.params.hotel_slug, actif: true }).first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })
    const reservees = await fastify.db('reservations')
      .where({ hotel_id: hotel.id }).whereNotIn('statut',['annulee','no_show'])
      .where('date_arrivee','<',date_depart).where('date_depart','>',date_arrivee).pluck('chambre_id')
    const chambres = await fastify.db('chambres AS ch')
      .leftJoin('types_chambre AS tc','tc.id','ch.type_chambre_id')
      .where({ 'ch.hotel_id': hotel.id, 'ch.hors_service': false })
      .whereNotIn('ch.id', reservees)
      .select('ch.id','tc.nom AS type','tc.tarif_base','tc.description','tc.capacite_adultes','tc.superficie_m2','tc.amenagements')
    reply.send({ hotel: { nom: hotel.nom, ville: hotel.ville }, chambres })
  })
  fastify.post('/reserver', async (req, reply) => {
    const trx = await fastify.db.transaction()
    try {
      const { hotel_slug, client, chambre_id, date_arrivee, date_depart, tarif_nuit, total, paiement } = req.body
      const hotel = await trx('hotels').where({ slug: hotel_slug }).first()
      if (!hotel) { await trx.rollback(); return reply.status(404).send({ erreur: 'Hôtel introuvable' }) }
      let clientRec = await trx('clients').where({ email: client.email, hotel_id: hotel.id }).first()
      if (!clientRec) {
        const mdpHash = await fastify.hashMotDePasse(client.mot_de_passe || Math.random().toString(36).slice(2))
        const [c] = await trx('clients').insert({
          hotel_id: hotel.id, tenant_id: hotel.tenant_id,
          prenom: client.prenom, nom: client.nom, email: client.email,
          telephone: client.telephone, mot_de_passe_hash: mdpHash,
          source_acquisition: 'booking_engine'
        }).returning('*')
        clientRec = c
      }
      const [reservation] = await trx('reservations').insert({
        hotel_id: hotel.id, tenant_id: hotel.tenant_id,
        client_id: clientRec.id, chambre_id,
        statut: 'confirmee', date_arrivee, date_depart,
        tarif_nuit, total_general: total, source: 'online', devise: 'XAF'
      }).returning('*')
      await trx.commit()
      const jwtClient = fastify.jwt.sign({ id: clientRec.id, email: clientRec.email, type: 'client' }, { expiresIn: '30d' })
      reply.status(201).send({ message: 'Réservation confirmée', numero: reservation.numero_reservation, token_client: jwtClient })
    } catch(err) { await trx.rollback(); throw err }
  })
}
