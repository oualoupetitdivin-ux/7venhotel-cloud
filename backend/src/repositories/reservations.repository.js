'use strict'

const crypto = require('crypto')

// ─────────────────────────────────────────────────────────────────────────────
// reservations.repository.js
//
// Seule couche qui connaît Knex et la structure SQL du module réservations.
// Aucune règle métier. hotel_id obligatoire sur toute requête scopée.
// conn(trx) : utilise la transaction active si fournie, sinon db global.
//
// Tables gérées :
//   reservations, sessions_chambre, taches_menage,
//   chambres (statut uniquement), taxes, parametres_hotel
// ─────────────────────────────────────────────────────────────────────────────

// Statuts terminaux — non pris en compte dans le calcul de disponibilité
const STATUTS_TERMINAUX = ['annulee', 'no_show']

// Statuts actifs pour le check-in
const STATUTS_CHECKIN_VALIDES = ['confirmee']

// Statuts actifs pour le checkout
const STATUTS_CHECKOUT_VALIDES = ['arrivee', 'depart_aujourd_hui']

function createReservationsRepository(db) {
  const conn = (trx) => trx || db

  return {

    // ── Trouver une réservation par id + hotelId ───────────────────────────
    // Enrichie avec client + chambre + type_chambre
    async trouverParId(id, hotelId, trx) {
      return conn(trx)('reservations AS r')
        .leftJoin('clients AS c',        'c.id',  'r.client_id')
        .leftJoin('chambres AS ch',      'ch.id', 'r.chambre_id')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .where({ 'r.id': id, 'r.hotel_id': hotelId })
        .select(
          'r.*',
          db.raw("c.prenom || ' ' || c.nom AS nom_client"),
          'c.email AS email_client',
          'c.telephone AS telephone_client',
          'ch.numero AS numero_chambre',
          'ch.etage AS etage_chambre',
          'ch.statut AS statut_chambre',
          'ch.hors_service AS chambre_hors_service',
          'tc.nom AS type_chambre_nom',
          'tc.tarif_base AS tarif_base_type'
        )
        .first() ?? null
    },

    // ── Vérifier disponibilité chambre sur une période ────────────────────
    // Règle de chevauchement : date_arrivee_existante < date_depart_requete
    //                     AND date_depart_existante  > date_arrivee_requete
    // Exclut les statuts terminaux. Exclut la réservation courante (pour modif).
    async verifierDisponibilite({ chambreId, hotelId, dateArrivee, dateDepart, excluireReservationId }, trx) {
      let q = conn(trx)('reservations')
        .where({ chambre_id: chambreId, hotel_id: hotelId })
        .whereNotIn('statut', STATUTS_TERMINAUX)
        .where('date_arrivee', '<', dateDepart)
        .where('date_depart',  '>', dateArrivee)

      if (excluireReservationId) q = q.whereNot({ id: excluireReservationId })

      return q.first() ?? null  // null = disponible, non-null = conflit
    },

    // ── Récupérer les taxes d'hébergement de l'hôtel ──────────────────────
    async trouverTaxesHebergement(hotelId, trx) {
      return conn(trx)('taxes')
        .where({ hotel_id: hotelId, active: true })
        .where(function() {
          this.where('s_applique_a', 'hebergement').orWhere('s_applique_a', 'tout')
        })
        .where('incluse_prix', false)
        .orderBy('ordre', 'asc')
    },

    // ── Récupérer les paramètres de l'hôtel ───────────────────────────────
    async trouverParametres(hotelId, trx) {
      return conn(trx)('parametres_hotel')
        .where({ hotel_id: hotelId })
        .first() ?? null
    },

    // ── Vérifier qu'un client appartient à cet hôtel ──────────────────────
    async clientAppartientHotel(clientId, hotelId, trx) {
      const row = await conn(trx)('clients')
        .where({ id: clientId, hotel_id: hotelId })
        .first()
      return !!row
    },

    // ── Vérifier qu'une chambre est disponible pour check-in ──────────────
    // Retourne la chambre ou null — le service décide de la ConflictError
    async trouverChambreDispoCheckin(chambreId, hotelId, trx) {
      return conn(trx)('chambres')
        .where({ id: chambreId, hotel_id: hotelId, hors_service: false })
        .where('statut', 'libre_propre')
        .first() ?? null
    },

    // ── Créer une réservation ─────────────────────────────────────────────
    // numero_reservation généré par trigger PostgreSQL — ne pas l'inclure.
    async creer(champs, trx) {
      const c = conn(trx)
      const [cree] = await c('reservations')
        .insert({ ...champs, cree_le: c.fn.now(), mis_a_jour_le: c.fn.now() })
        .returning('*')
      return cree
    },

    // ── Mettre à jour le statut d'une réservation ─────────────────────────
    // hotel_id dans WHERE — isolation tenant garantie
    async mettreAJourStatut(id, hotelId, champs, trx) {
      const c = conn(trx)
      const [mis] = await c('reservations')
        .where({ id, hotel_id: hotelId })
        .update({ ...champs, mis_a_jour_le: c.fn.now() })
        .returning('*')
      return mis ?? null
    },

    // ── Mettre à jour le statut de la chambre ─────────────────────────────
    // Uniquement depuis ce repository — jamais de requête directe depuis le service
    async mettreAJourStatutChambre(chambreId, hotelId, champs, trx) {
      const c = conn(trx)
      await c('chambres')
        .where({ id: chambreId, hotel_id: hotelId })
        .update({ ...champs, mis_a_jour_le: c.fn.now() })
    },

    // ── Créer un token de session portail chambre ─────────────────────────
    // 1 token actif par réservation. Créé inactif, activé au check-in.
    async creerSessionChambre({ hotelId, chambreId, reservationId, expireLe, ipCreation }, trx) {
      const c = conn(trx)
      const token = crypto.randomBytes(48).toString('hex') // 96 chars hex

      const [session] = await c('sessions_chambre')
        .insert({
          hotel_id:       hotelId,
          chambre_id:     chambreId,
          reservation_id: reservationId,
          token,
          actif:          false,  // activée explicitement au check-in
          expire_le:      expireLe,
          ip_creation:    ipCreation || null,
          cree_le:        c.fn.now(),
        })
        .returning('*')
      return session
    },

    // ── Activer la session portail (check-in) ─────────────────────────────
    async activerSessionChambre(reservationId, trx) {
      const c = conn(trx)
      const [session] = await c('sessions_chambre')
        .where({ reservation_id: reservationId })
        .update({ actif: true, derniere_activite: c.fn.now() })
        .returning('token')
      return session?.token ?? null
    },

    // ── Révoquer la session portail (checkout) ────────────────────────────
    async revoquerSessionChambre(reservationId, trx) {
      const c = conn(trx)
      await c('sessions_chambre')
        .where({ reservation_id: reservationId })
        .update({ actif: false, derniere_activite: c.fn.now() })

      // Synchroniser le token sur la réservation elle-même
      await c('reservations')
        .where({ id: reservationId })
        .update({ qr_token_actif: false, mis_a_jour_le: c.fn.now() })
    },

    // ── Vérifier si une session active existe (anti-doublon) ──────────────
    async sessionActiveExiste(reservationId, trx) {
      const row = await conn(trx)('sessions_chambre')
        .where({ reservation_id: reservationId, actif: true })
        .first()
      return !!row
    },

    // ── Créer une tâche de ménage automatique ─────────────────────────────
    // Appelée au checkout. La priorité est déterminée par le service.
    async creerTacheMenage(champs, trx) {
      const c = conn(trx)
      const [tache] = await c('taches_menage')
        .insert({ ...champs, cree_le: c.fn.now(), mis_a_jour_le: c.fn.now() })
        .returning('*')
      return tache
    },

    // ── Vérifier si un check-in imminent existe sur cette chambre ─────────
    // Utilisé pour déterminer la priorité de la tâche ménage (urgente si < 3h)
    async prochainCheckinDansDuree(chambreId, hotelId, heures, trx) {
      const limite = new Date(Date.now() + heures * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]

      return conn(trx)('reservations')
        .where({ chambre_id: chambreId, hotel_id: hotelId })
        .whereNotIn('statut', STATUTS_TERMINAUX)
        .where('date_arrivee', '<=', limite)
        .where('date_arrivee', '>=', db.raw('CURRENT_DATE'))
        .first() ?? null
    },

    // ── Écrire un log d'audit ─────────────────────────────────────────────
    // INSERT ONLY — jamais de UPDATE/DELETE sur cette table
    async insererLogAudit(champs, trx) {
      const c = conn(trx)
      await c('logs_audit_reservations')
        .insert({ ...champs, horodatage: c.fn.now() })
    },

  }
}

module.exports = { createReservationsRepository, STATUTS_CHECKIN_VALIDES, STATUTS_CHECKOUT_VALIDES }
