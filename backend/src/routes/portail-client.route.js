'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/portail-client.route.js
//
// Espace client connecté (app web mobile-first /client-portal).
// Distinct du portail QR chambre (portail.route.js).
//
// AUTHENTIFICATION (LOT-GUEST-01) :
//   Jeton signé avec la clé CLIENT (utils/jetonClient) — un jeton staff est refusé ici,
//   un jeton client est refusé par l'authentification staff.
//   hotel_id, tenant_id et client_id extraits du jeton — jamais du body.
//
// ISOLATION TENANT : hotel_id + client_id sur toutes les requêtes scopées.
//
// LOT-GUEST-01 : folio et factures lisaient une table `folio_lignes` et des colonnes
// (montant, annulee, ouvert_le) inexistantes → 500. Désormais : lignes_folio,
// solde SQL (get_solde_folio), ventilation partagée avec la facture (folio.regles).
// ─────────────────────────────────────────────────────────────────────────────

const { verifierJetonClient } = require('../utils/jetonClient')
const folioRegles = require('../services/folio.regles')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

module.exports = async function portailClientRoutes(fastify) {

  const authentifierClient = async (req, reply) => {
    const authHeader = req.headers['authorization']
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
    if (!token) {
      return reply.status(401).send({ erreur: 'Token client requis', code: 'NON_AUTHENTIFIE' })
    }
    try {
      const payload = verifierJetonClient(fastify, token)
      // Défense en profondeur : la fiche doit toujours exister dans l'hôtel/tenant du jeton
      const fiche = await fastify.db('clients')
        .where({ id: payload.id, hotel_id: payload.hotel_id, tenant_id: payload.tenant_id, actif: true })
        .select('id').first()
      if (!fiche) return reply.status(401).send({ erreur: 'Compte client inactif ou introuvable', code: 'TOKEN_INVALIDE' })
      req.clientId  = payload.id
      req.hotelId   = payload.hotel_id
      req.tenantId  = payload.tenant_id
    } catch {
      return reply.status(401).send({ erreur: 'Token expiré ou invalide', code: 'TOKEN_INVALIDE' })
    }
  }

  const pre = [authentifierClient]
  const scope = (req) => ({ id: req.clientId, hotel_id: req.hotelId, tenant_id: req.tenantId })

  // ── GET /profil ────────────────────────────────────────────────────────────
  fastify.get('/profil', { preHandler: pre }, async (req, reply) => {
    const client = await fastify.db('clients')
      .where(scope(req))
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
    await fastify.db('clients').where(scope(req)).update(champs)
    const client = await fastify.db('clients')
      .where(scope(req))
      .select('id', 'prenom', 'nom', 'email', 'telephone', 'segment', 'points_fidelite', 'niveau_fidelite', 'nombre_sejours')
      .first()
    return reply.send({ client })
  })

  // ── GET /reservations ──────────────────────────────────────────────────────
  fastify.get('/reservations', { preHandler: pre }, async (req, reply) => {
    const reservations = await fastify.db('reservations AS r')
      .leftJoin('chambres AS ch',      'ch.id',  'r.chambre_id')
      .leftJoin('types_chambre AS tc', 'tc.id',  'ch.type_chambre_id')
      .leftJoin('checkins_en_ligne AS ck', 'ck.reservation_id', 'r.id')
      .where({ 'r.client_id': req.clientId, 'r.hotel_id': req.hotelId, 'r.tenant_id': req.tenantId })
      .select(
        'r.id', 'r.numero_reservation', 'r.statut',
        'r.date_arrivee', 'r.date_depart', 'r.nombre_nuits',
        'r.total_general', 'r.devise',
        'ch.numero AS numero_chambre', 'tc.nom AS type_chambre',
        'ck.statut AS checkin_en_ligne'
      )
      .orderBy('r.date_arrivee', 'desc')
    return reply.send({ reservations })
  })

  // ── GET /reservations/:id/folio ────────────────────────────────────────────
  fastify.get('/reservations/:id/folio', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    if (!UUID.test(id)) return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })

    const reservation = await fastify.db('reservations')
      .where({ id, client_id: req.clientId, hotel_id: req.hotelId, tenant_id: req.tenantId })
      .first()
    if (!reservation) {
      return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    }

    const folio = await fastify.db('folios')
      .where({ reservation_id: id, hotel_id: req.hotelId })
      .select('id', 'statut', 'devise', 'numero_folio', 'cree_le AS ouvert_le', 'cloture_le')
      .first() ?? null
    if (!folio) return reply.send({ folio: null, lignes: [], paiements: [], solde: 0 })

    const toutes = await fastify.db('lignes_folio')
      .where({ folio_id: folio.id, hotel_id: req.hotelId })
      .orderBy('cree_le', 'asc')
    const corrigees = new Set(toutes.filter(l => l.ligne_corrigee_id).map(l => l.ligne_corrigee_id))

    // Consommations (charges et remises) ; une ligne corrigée est marquée annulee
    const lignes = toutes
      .filter(l => !['paiement', 'arrhes', 'correction'].includes(l.type_ligne))
      .map(l => ({
        id: l.id, type_ligne: l.type_ligne, description: l.description,
        montant: l.sens === 'credit' ? -Number(l.montant_total) : Number(l.montant_total),
        annulee: corrigees.has(l.id), cree_le: l.cree_le, source_module: l.source_module,
      }))

    // Règlements : paiements validés + arrhes (encaissées / restituées)
    const paiements = toutes
      .filter(l => ['paiement', 'arrhes'].includes(l.type_ligne) && !corrigees.has(l.id))
      .map(l => ({
        id: l.id, type_paiement: l.type_ligne === 'arrhes' ? 'arrhes' : (l.metadata?.type_paiement || 'paiement'),
        montant: l.sens === 'credit' ? Number(l.montant_total) : -Number(l.montant_total), cree_le: l.cree_le,
      }))

    const soldeRow = (await fastify.db.raw('SELECT solde_du FROM get_solde_folio(?, ?)', [folio.id, req.hotelId])).rows[0]
    const facture = await fastify.db('factures')
      .where({ reservation_id: id, hotel_id: req.hotelId })
      .select('id', 'numero_facture', 'date_emission', 'montant_ttc', 'montant_arrhes', 'montant_paye', 'montant_du', 'url_pdf')
      .first() ?? null

    return reply.send({
      folio, lignes, paiements,
      solde: Number(soldeRow ? soldeRow.solde_du : 0),
      ventilation: folioRegles.ventilerLignes(toutes),
      facture,
    })
  })

  // ── POST /reservations/:id/checkin-en-ligne — lien de check-in de SA réservation ──
  fastify.post('/reservations/:id/checkin-en-ligne', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    if (!UUID.test(id)) return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    const reservation = await fastify.db('reservations')
      .where({ id, client_id: req.clientId, hotel_id: req.hotelId, tenant_id: req.tenantId }).first()
    if (!reservation) return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    const { createCheckinEnLigneService } = require('../services/checkin-en-ligne.service')
    const lien = await createCheckinEnLigneService({ db: fastify.db }).genererLien({ reservationId: id, hotelId: req.hotelId, acteurId: null })
    return reply.status(201).send(lien)
  })

  // ── POST /reservations/:id/evaluation — évaluation après le séjour (LOT-GUEST-01) ──
  // La route portail /evaluation exige une session chambre ACTIVE, or le checkout la révoque
  // alors que l'évaluation n'est permise qu'après checkout (statut terminee) : elle était
  // impossible. L'espace client (authentifié au-delà du séjour) porte désormais l'évaluation,
  // via le même service et la même contrainte d'unicité.
  fastify.post('/reservations/:id/evaluation', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    if (!UUID.test(id)) return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    const reservation = await fastify.db('reservations')
      .where({ id, client_id: req.clientId, hotel_id: req.hotelId, tenant_id: req.tenantId }).first()
    if (!reservation) return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    const { validerEvaluation } = require('../validators/portail.validator')
    const validation = validerEvaluation(req.body)
    if (!validation.ok) return reply.status(400).send({ erreur: validation.erreurs[0].message, code: 'DONNEES_INVALIDES', details: validation.erreurs })
    const { createPortailService } = require('../services/portail.service')
    const evaluation = await createPortailService({ db: fastify.db, cache: fastify.cache })
      .soumettreEvaluation(id, req.hotelId, req.body)
    return reply.status(201).send({ message: 'Merci pour votre évaluation !', id: evaluation.id, note: evaluation.note_globale })
  })

  // ── GET /factures ──────────────────────────────────────────────────────────
  fastify.get('/factures', { preHandler: pre }, async (req, reply) => {
    const factures = await fastify.db('factures AS fa')
      .join('reservations AS r', 'r.id', 'fa.reservation_id')
      .where({ 'r.client_id': req.clientId, 'fa.hotel_id': req.hotelId, 'r.tenant_id': req.tenantId })
      .select(
        'fa.id', 'fa.numero_facture', 'fa.statut', 'fa.devise', 'fa.date_emission',
        'fa.montant_ht', 'fa.montant_taxes', 'fa.montant_ttc', 'fa.montant_arrhes', 'fa.montant_paye', 'fa.montant_du',
        'r.numero_reservation', 'r.date_arrivee', 'r.date_depart'
      )
      .orderBy('fa.cree_le', 'desc')
    return reply.send({ factures })
  })
}
