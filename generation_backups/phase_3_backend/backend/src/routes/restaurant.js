'use strict'
module.exports = async function restaurantRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  fastify.get('/menu', { preHandler: pre }, async (req, reply) => {
    const menu = await fastify.db('articles_menu').where({ hotel_id: req.hotelId, disponible: true }).orderBy('categorie').orderBy('ordre')
    const parCategorie = menu.reduce((acc, a) => { if (!acc[a.categorie]) acc[a.categorie] = []; acc[a.categorie].push(a); return acc }, {})
    reply.send({ menu: parCategorie, articles: menu })
  })
  fastify.get('/commandes', { preHandler: pre }, async (req, reply) => {
    const { statut } = req.query
    let q = fastify.db('commandes_restaurant').where({ hotel_id: req.hotelId })
    if (statut) q = q.whereIn('statut', Array.isArray(statut) ? statut : [statut])
    const commandes = await q.orderBy('heure_commande','desc').limit(100)
    reply.send({ commandes })
  })
  fastify.post('/commandes', { preHandler: pre }, async (req, reply) => {
    const trx = await fastify.db.transaction()
    try {
      const { lignes, ...cmdData } = req.body
      const [commande] = await trx('commandes_restaurant').insert({
        ...cmdData, hotel_id: req.hotelId, serveur_id: req.user.id
      }).returning('*')
      if (lignes?.length) {
        await trx('lignes_commande').insert(lignes.map(l => ({ ...l, commande_id: commande.id })))
      }
      if (cmdData.type_client === 'chambre' && cmdData.chambre_id) {
        const reservation = await trx('reservations').where({ chambre_id: cmdData.chambre_id, statut: 'arrivee', hotel_id: req.hotelId }).first()
        if (reservation) {
          const folio = await trx('folios').where({ reservation_id: reservation.id }).first()
          if (folio) {
            await trx('lignes_folio').insert({
              folio_id: folio.id, type_ligne: 'restaurant',
              description: `Commande restaurant ${commande.numero_commande}`,
              quantite: 1, prix_unitaire: commande.total, montant_total: commande.total
            })
          }
        }
      }
      await trx.commit()
      reply.status(201).send({ message: 'Commande créée', commande })
    } catch(err) { await trx.rollback(); throw err }
  })
  fastify.put('/commandes/:id/statut', { preHandler: pre }, async (req, reply) => {
    const { statut } = req.body
    const updates = { statut }
    if (statut === 'en_preparation') updates.heure_preparation = fastify.db.fn.now()
    if (statut === 'prete') updates.heure_prete = fastify.db.fn.now()
    if (statut === 'servie') updates.heure_servie = fastify.db.fn.now()
    const [updated] = await fastify.db('commandes_restaurant')
      .where({ id: req.params.id, hotel_id: req.hotelId }).update(updates).returning('*')
    if (!updated) return reply.status(404).send({ erreur: 'Commande introuvable' })
    reply.send({ message: 'Statut mis à jour', commande: updated })
  })
  fastify.get('/cuisine', { preHandler: pre }, async (req, reply) => {
    const commandes = await fastify.db('commandes_restaurant AS c')
      .where({ 'c.hotel_id': req.hotelId })
      .whereNotIn('c.statut', ['servie','annulee'])
      .orderBy('c.heure_commande')
      .select('c.*')
    const avecLignes = await Promise.all(commandes.map(async c => ({
      ...c,
      lignes: await fastify.db('lignes_commande').where({ commande_id: c.id })
    })))
    const parStatut = { nouvelle: [], en_preparation: [], prete: [], servie: [] }
    avecLignes.forEach(c => { if (parStatut[c.statut]) parStatut[c.statut].push(c) })
    reply.send({ cuisine: parStatut })
  })
}
