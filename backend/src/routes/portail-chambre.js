'use strict'
module.exports = async function portailChambreRoutes(fastify) {
  // Authentification portail par token QR
  const authQR = async (req, reply) => {
    const { token } = req.params
    if (!token) return reply.status(401).send({ erreur: 'Token manquant' })
    const session = await fastify.db('sessions_chambre AS s')
      .leftJoin('chambres AS ch','ch.id','s.chambre_id')
      .leftJoin('reservations AS r','r.id','s.reservation_id')
      .leftJoin('clients AS c','c.id','r.client_id')
      .where({ 's.token': token, 's.actif': true })
      .where('s.expire_le', '>', fastify.db.fn.now())
      .select('s.*','ch.numero AS numero_chambre','ch.etage',fastify.db.raw("c.prenom||' '||c.nom AS nom_client"),'r.date_depart')
      .first()
    if (!session) return reply.status(401).send({ erreur: 'Session invalide ou expirée', code: 'SESSION_EXPIREE' })
    await fastify.db('sessions_chambre').where({ token }).update({ derniere_activite: fastify.db.fn.now() })
    req.session = session
  }
  fastify.get('/:token', { preHandler: authQR }, async (req, reply) => {
    reply.send({ session: { numero_chambre: req.session.numero_chambre, nom_client: req.session.nom_client, date_depart: req.session.date_depart, hotel_id: req.session.hotel_id } })
  })
  fastify.post('/:token/commander', { preHandler: authQR }, async (req, reply) => {
    const { articles, notes } = req.body
    const total = articles.reduce((s, a) => s + (a.prix * a.quantite), 0)
    const [commande] = await fastify.db('commandes_restaurant').insert({
      hotel_id: req.session.hotel_id, chambre_id: req.session.chambre_id,
      type_client: 'chambre', numero_chambre: req.session.numero_chambre,
      statut: 'nouvelle', total, notes, heure_commande: fastify.db.fn.now()
    }).returning('*')
    await fastify.db('lignes_commande').insert(articles.map(a => ({
      commande_id: commande.id, nom_article: a.nom, quantite: a.quantite,
      prix_unitaire: a.prix, montant_total: a.prix * a.quantite
    })))
    reply.status(201).send({ message: 'Commande envoyée en cuisine', commande_id: commande.id })
  })
  fastify.post('/:token/menage', { preHandler: authQR }, async (req, reply) => {
    await fastify.db('taches_menage').insert({
      hotel_id: req.session.hotel_id, chambre_id: req.session.chambre_id,
      statut: 'ouverte', priorite: 'normale', type_tache: req.body.type || 'nettoyage_express',
      description: req.body.description || 'Demande ménage via portail chambre'
    })
    reply.status(201).send({ message: 'Demande ménage envoyée' })
  })
  fastify.post('/:token/message', { preHandler: authQR }, async (req, reply) => {
    fastify.log.info({ chambre: req.session.numero_chambre, message: req.body.message }, 'Message portail chambre')
    reply.status(201).send({ message: 'Message envoyé à la réception' })
  })
}
