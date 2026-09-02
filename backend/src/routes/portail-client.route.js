'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/portail-client.route.js
//
// Espace client connecté (app web mobile-first /client-portal).
// Distinct du portail QR chambre (portail.route.js).
//
// AUTHENTIFICATION :
//   JWT signé par /auth/client/connexion avec payload.type === 'client'.
//   hotel_id et client_id extraits du JWT — jamais du body.
//
// ISOLATION TENANT : hotel_id + client_id sur toutes les requêtes scopées.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function portailClientRoutes(fastify) {

  // ── Middleware d'authentification client ──────────────────────────────────
  const authentifierClient = async (req, reply) => {
    const authHeader = req.headers['authorization']
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
    if (!token) {
      return reply.status(401).send({ erreur: 'Token client requis', code: 'NON_AUTHENTIFIE' })
    }
    try {
      const payload = fastify.jwt.verify(token)
      if (payload.type !== 'client') {
        return reply.status(403).send({ erreur: 'Token client invalide', code: 'TOKEN_INVALIDE' })
      }
      req.clientId  = payload.id
      req.hotelId   = payload.hotel_id
      req.tenantId  = payload.tenant_id
    } catch {
      return reply.status(401).send({ erreur: 'Token expiré ou invalide', code: 'TOKEN_INVALIDE' })
    }
  }

  const pre = [authentifierClient]

  // ── GET /profil ────────────────────────────────────────────────────────────
  fastify.get('/profil', { preHandler: pre }, async (req, reply) => {
    const client = await fastify.db('clients')
      .where({ id: req.clientId })
      .select(
        'id', 'prenom', 'nom', 'email', 'telephone',
        'segment', 'points_fidelite', 'niveau_fidelite',
        'date_naissance', 'nationalite', 'nombre_sejours'
      )
      .first()
    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })
    return reply.send({ client })
  })

  // ── PUT /profil ────────────────────────────────────────────────────────────
  fastify.put('/profil', { preHandler: pre }, async (req, reply) => {
    const { prenom, nom, telephone } = req.body || {}
    const champs = {}
    if (prenom?.trim())    champs.prenom    = prenom.trim()
    if (nom?.trim())       champs.nom       = nom.trim()
    if (telephone?.trim()) champs.telephone = telephone.trim()
    if (Object.keys(champs).length === 0) {
      return reply.status(400).send({ erreur: 'Aucun champ à modifier' })
    }
    await fastify.db('clients').where({ id: req.clientId }).update(champs)
    const client = await fastify.db('clients')
      .where({ id: req.clientId })
      .select('id', 'prenom', 'nom', 'email', 'telephone', 'segment', 'points_fidelite', 'niveau_fidelite', 'nombre_sejours')
      .first()
    return reply.send({ client })
  })

  // ── GET /reservations ──────────────────────────────────────────────────────
  fastify.get('/reservations', { preHandler: pre }, async (req, reply) => {
    const reservations = await fastify.db('reservations AS r')
      .leftJoin('chambres AS ch',      'ch.id',  'r.chambre_id')
      .leftJoin('types_chambre AS tc', 'tc.id',  'ch.type_chambre_id')
      .where({ 'r.client_id': req.clientId, 'r.hotel_id': req.hotelId })
      .select(
        'r.id', 'r.numero_reservation', 'r.statut',
        'r.date_arrivee', 'r.date_depart', 'r.nombre_nuits',
        'r.total_general', 'r.devise',
        'ch.numero AS numero_chambre', 'tc.nom AS type_chambre'
      )
      .orderBy('r.date_arrivee', 'desc')
    return reply.send({ reservations })
  })

  // ── GET /reservations/:id/folio ────────────────────────────────────────────
  // Retourne le folio d'une réservation appartenant au client connecté.
  // Vérifie : reservation.client_id === clientId ET reservation.hotel_id === hotelId.
  fastify.get('/reservations/:id/folio', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params

    // Isolation double : client + hotel
    const reservation = await fastify.db('reservations')
      .where({ id, client_id: req.clientId, hotel_id: req.hotelId })
      .first()
    if (!reservation) {
      return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    }

    // Folio lié (ouvert ou en attente)
    const folio = await fastify.db('folios AS f')
      .where({ 'f.reservation_id': id, 'f.hotel_id': req.hotelId })
      .select('f.id', 'f.statut', 'f.devise', 'f.numero_folio', 'f.ouvert_le', 'f.cloture_le')
      .first() ?? null

    if (!folio) {
      return reply.send({ folio: null, lignes: [], paiements: [], solde: 0 })
    }

    // Lignes du folio (charges)
    const lignes = await fastify.db('folio_lignes AS fl')
      .where({ 'fl.folio_id': folio.id, 'fl.hotel_id': req.hotelId })
      .select('fl.id', 'fl.type_ligne', 'fl.description', 'fl.montant', 'fl.annulee', 'fl.cree_le', 'fl.source_module')
      .orderBy('fl.cree_le', 'asc')

    // Paiements validés
    const paiements = await fastify.db('paiements')
      .where({ folio_id: folio.id, hotel_id: req.hotelId, statut: 'valide' })
      .select('id', 'type_paiement', 'montant', 'cree_le')

    const totalCharges   = lignes
      .filter(l => !l.annulee)
      .reduce((s, l) => s + parseFloat(l.montant || 0), 0)
    const totalPaiements = paiements
      .reduce((s, p) => s + parseFloat(p.montant || 0), 0)
    const solde          = Math.max(0, totalCharges - totalPaiements)

    return reply.send({ folio, lignes, paiements, solde })
  })

  // ── GET /factures ──────────────────────────────────────────────────────────
  fastify.get('/factures', { preHandler: pre }, async (req, reply) => {
    const factures = await fastify.db('folios AS f')
      .join('reservations AS r', 'r.id', 'f.reservation_id')
      .where({ 'f.client_id': req.clientId, 'f.hotel_id': req.hotelId })
      .select(
        'f.id', 'f.numero_folio', 'f.statut', 'f.devise',
        'f.ouvert_le', 'f.cloture_le',
        'r.numero_reservation', 'r.date_arrivee', 'r.date_depart'
      )
      .orderBy('f.ouvert_le', 'desc')
    return reply.send({ factures })
  })
}
