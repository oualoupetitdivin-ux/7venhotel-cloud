'use strict'

const crypto = require('crypto')

// ─────────────────────────────────────────────────────────────────────────────
// portail.repository.js
//
// Accès DB du portail client. AUCUNE règle métier.
//
// CONTRAT D'ISOLATION TENANT (NON NÉGOCIABLE) :
//   Toute requête sur une table scopée inclut DEUX conditions :
//     1. reservation_id  (scope client)
//     2. hotel_id        (scope tenant)
//   Ni l'une ni l'autre seule ne suffit.
//
// Tables gérées :
//   sessions_chambre, reservations, messages,
//   demandes_service, evaluations_sejour
// ─────────────────────────────────────────────────────────────────────────────

// Durée de la session portail : 4 heures glissantes
const SESSION_DUREE_MS = 4 * 60 * 60 * 1000

// Statuts autorisant l'envoi de messages et demandes de service
const STATUTS_ACTIFS = ['arrivee', 'depart_aujourd_hui']

function createPortailRepository(db) {
  const conn = (trx) => trx || db

  return {

    // ── Trouver une session par token QR ──────────────────────────────────
    // Double vérification : actif=true ET expire_le > NOW().
    // L'une sans l'autre est insuffisante (cf. design review).
    async trouverSessionParToken(token, trx) {
      return conn(trx)('sessions_chambre AS s')
        .where({ 's.token': token, 's.actif': true })
        .where('s.expire_le', '>', conn(trx).fn.now())
        .select('s.id', 's.reservation_id', 's.hotel_id', 's.chambre_id',
                's.session_token', 's.session_expire', 's.expire_le')
        .first() ?? null
    },

    // ── Trouver une session par session_token (toutes requêtes API) ───────
    // Utilisé pour l'authentification de toutes les routes portail.
    // hotel_id dénormalisé sur sessions_chambre — pas besoin de JOIN.
    async trouverSessionParSessionToken(sessionToken, trx) {
      return conn(trx)('sessions_chambre AS s')
        .where({ 's.session_token': sessionToken, 's.actif': true })
        .where('s.session_expire', '>', conn(trx).fn.now())
        .select('s.id', 's.reservation_id', 's.hotel_id', 's.chambre_id',
                's.session_expire')
        .first() ?? null
    },

    // ── Créer/rafraîchir le session_token sur la session existante ────────
    // Appelé lors du premier accès via le token QR.
    // Génère un session_token distinct du token QR.
    // Retourne le session_token généré.
    async creerSessionToken(sessionId, trx) {
      const sessionToken  = crypto.randomBytes(32).toString('hex')  // 64 chars hex
      const sessionExpire = new Date(Date.now() + SESSION_DUREE_MS).toISOString()

      const c = conn(trx)
      await c('sessions_chambre')
        .where({ id: sessionId })
        .update({
          session_token:     sessionToken,
          session_expire:    sessionExpire,
          derniere_activite: c.fn.now(),
        })

      return sessionToken
    },

    // ── Rafraîchir l'expiration de la session (activité) ──────────────────
    async rafraichirSession(sessionId, trx) {
      const sessionExpire = new Date(Date.now() + SESSION_DUREE_MS).toISOString()
      const c = conn(trx)
      await c('sessions_chambre')
        .where({ id: sessionId })
        .update({ session_expire: sessionExpire, derniere_activite: c.fn.now() })
    },

    // ── Réservation complète avec contexte ────────────────────────────────
    // Scope DOUBLE : reservation_id + hotel_id — isolation tenant garantie.
    // Une seule requête retourne tout le contexte pour minimiser la latence.
    async trouverContexteReservation(reservationId, hotelId, trx) {
      return conn(trx)('reservations AS r')
        .leftJoin('clients AS c',        'c.id',  'r.client_id')
        .leftJoin('chambres AS ch',      'ch.id', 'r.chambre_id')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .leftJoin('hotels AS h',         'h.id',  'r.hotel_id')
        .where({ 'r.id': reservationId, 'r.hotel_id': hotelId })
        .select(
          'r.id', 'r.numero_reservation', 'r.statut',
          'r.date_arrivee', 'r.date_depart', 'r.nombre_nuits',
          'r.nombre_adultes', 'r.nombre_enfants',
          'r.tarif_nuit', 'r.total_hebergement', 'r.total_general', 'r.devise',
          'r.regime_repas', 'r.preferences_client',
          'r.heure_arrivee_reelle', 'r.heure_depart_reelle',
          db.raw("c.prenom || ' ' || c.nom AS nom_client"),
          'c.email AS email_client',
          'c.telephone AS telephone_client',
          'ch.numero AS numero_chambre',
          'ch.etage AS etage_chambre',
          'tc.nom AS type_chambre',
          'h.nom AS nom_hotel',
          'h.adresse AS adresse_hotel',
          'h.telephone AS telephone_hotel'
        )
        .first() ?? null
    },

    // ── Messages de la réservation ────────────────────────────────────────
    // Scope DOUBLE. Retourne tous les messages — lecture autorisée même après checkout.
    async listerMessages(reservationId, hotelId, trx) {
      return conn(trx)('messages')
        .where({ reservation_id: reservationId, hotel_id: hotelId })
        .select('id', 'expediteur_type', 'corps', 'lu', 'lu_le', 'cree_le')
        .orderBy('cree_le', 'asc')
    },

    // ── Créer un message ──────────────────────────────────────────────────
    // Scope DOUBLE dans INSERT — garantit que le message est bien lié au bon hôtel.
    async creerMessage({ reservationId, hotelId, corps }, trx) {
      const c = conn(trx)
      const [message] = await c('messages')
        .insert({
          reservation_id:  reservationId,
          hotel_id:        hotelId,
          expediteur_type: 'client',
          corps:           corps.trim(),
          cree_le:         c.fn.now(),
        })
        .returning('id', 'corps', 'expediteur_type', 'cree_le')
      return message
    },

    // ── Timestamp du dernier message du client ────────────────────────────
    // Utilisé pour le rate limiting côté service (1 message / 30s).
    async dernierMessageClient(reservationId, hotelId, trx) {
      return conn(trx)('messages')
        .where({ reservation_id: reservationId, hotel_id: hotelId, expediteur_type: 'client' })
        .orderBy('cree_le', 'desc')
        .select('cree_le')
        .first() ?? null
    },

    // ── Demandes de service ───────────────────────────────────────────────
    async listerDemandesService(reservationId, hotelId, trx) {
      return conn(trx)('demandes_service')
        .where({ reservation_id: reservationId, hotel_id: hotelId })
        .select('id', 'type_service', 'description', 'statut', 'cree_le', 'traitee_le')
        .orderBy('cree_le', 'desc')
    },

    // ── Créer une demande de service ──────────────────────────────────────
    async creerDemandeService({ reservationId, hotelId, chambreId, typeService, description }, trx) {
      const c = conn(trx)
      const [demande] = await c('demandes_service')
        .insert({
          reservation_id: reservationId,
          hotel_id:       hotelId,
          chambre_id:     chambreId || null,
          type_service:   typeService,
          description:    description || null,
          statut:         'nouvelle',
          cree_le:        c.fn.now(),
          mis_a_jour_le:  c.fn.now(),
        })
        .returning('id', 'type_service', 'description', 'statut', 'cree_le')
      return demande
    },

    // ── Évaluation existante ──────────────────────────────────────────────
    // Vérifie si une évaluation existe avant INSERT pour éviter l'erreur 23505.
    // La contrainte DB UNIQUE(reservation_id) est le filet de sécurité final.
    async evaluationExiste(reservationId, hotelId, trx) {
      const row = await conn(trx)('evaluations_sejour')
        .where({ reservation_id: reservationId, hotel_id: hotelId })
        .first()
      return !!row
    },

    // ── Créer une évaluation ──────────────────────────────────────────────
    async creerEvaluation({ reservationId, hotelId, donnees }, trx) {
      const c = conn(trx)
      const [evaluation] = await c('evaluations_sejour')
        .insert({
          reservation_id: reservationId,
          hotel_id:       hotelId,
          note_globale:   parseInt(donnees.note_globale),
          note_proprete:  donnees.note_proprete   ? parseInt(donnees.note_proprete)  : null,
          note_service:   donnees.note_service    ? parseInt(donnees.note_service)   : null,
          note_confort:   donnees.note_confort    ? parseInt(donnees.note_confort)   : null,
          commentaire:    donnees.commentaire     || null,
          recommanderait: donnees.recommanderait  ?? null,
          cree_le:        c.fn.now(),
        })
        .returning('id', 'note_globale', 'note_proprete', 'note_service',
                   'note_confort', 'commentaire', 'recommanderait', 'cree_le')
      return evaluation
    },

  }
}

module.exports = { createPortailRepository, STATUTS_ACTIFS }
