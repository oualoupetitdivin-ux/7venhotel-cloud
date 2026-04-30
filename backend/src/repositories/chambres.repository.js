'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// chambres.repository.js
//
// Seule couche qui connaît Knex et la structure SQL du module chambres.
// Aucune règle métier. hotel_id obligatoire sur toute requête scopée.
// conn(trx) : utilise la transaction active si fournie, sinon db global.
// ─────────────────────────────────────────────────────────────────────────────

// Colonnes chambre retournées dans les listes et détails
const COLS_CHAMBRE = [
  'ch.id', 'ch.hotel_id', 'ch.type_chambre_id', 'ch.numero', 'ch.etage',
  'ch.description', 'ch.statut', 'ch.statut_menage', 'ch.vue', 'ch.lits',
  'ch.superficie_m2', 'ch.caracteristiques', 'ch.tarif_specifique',
  'ch.hors_service', 'ch.hors_service_raison', 'ch.notes_internes',
  'ch.cree_le', 'ch.mis_a_jour_le',
]

const COLS_TYPE = [
  'tc.nom AS type_nom',
  'tc.tarif_base',
  'tc.capacite_adultes',
  'tc.capacite_enfants',
  'tc.devise AS type_devise',
]

// Statuts de réservation actifs (chambre considérée occupée)
const STATUTS_RESERVATION_ACTIFS = ['arrivee', 'depart_aujourd_hui']

// Statuts de réservation terminaux (ignorés pour réservations futures)
const STATUTS_RESERVATION_TERMINAUX = ['annulee', 'no_show']

function createChambresRepository(db) {
  const conn = (trx) => trx || db

  return {

    // ── Trouver par id + hotelId ───────────────────────────────────────────
    async trouverParId(id, hotelId, trx) {
      return conn(trx)('chambres AS ch')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .where({ 'ch.id': id, 'ch.hotel_id': hotelId })
        .select(...COLS_CHAMBRE, ...COLS_TYPE)
        .first() ?? null
    },

    // ── Lister avec filtres dynamiques ────────────────────────────────────
    // Retourne { donnees, total } — cohérent avec base.repository
    async lister({ hotelId, statut, etage, typeId, horsService }, trx) {
      let q = conn(trx)('chambres AS ch')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .where('ch.hotel_id', hotelId)
        .select(...COLS_CHAMBRE, ...COLS_TYPE)
        .orderBy('ch.etage', 'asc')
        .orderBy('ch.numero', 'asc')

      if (statut      !== undefined) q = q.where('ch.statut', statut)
      if (etage       !== undefined) q = q.where('ch.etage', parseInt(etage))
      if (typeId      !== undefined) q = q.where('ch.type_chambre_id', typeId)
      if (horsService !== undefined) q = q.where('ch.hors_service', horsService === true || horsService === 'true')

      const [donnees, [{ total }]] = await Promise.all([
        q.clone(),
        q.clone().clearSelect().clearOrder().count('ch.id AS total'),
      ])

      return { donnees, total: parseInt(total) }
    },

    // ── Images d'une chambre ──────────────────────────────────────────────
    // hotelId obligatoire : la table images_chambres n'a pas de hotel_id direct.
    // Le JOIN chambres enforce l'isolation tenant — la méthode est autonome.
    async trouverImages(chambreId, hotelId, trx) {
      return conn(trx)('images_chambres AS img')
        .join('chambres AS ch', 'ch.id', 'img.chambre_id')
        .where({ 'img.chambre_id': chambreId, 'ch.hotel_id': hotelId })
        .select('img.*')
        .orderBy('img.ordre', 'asc')
    },

    // ── Réservation en cours (statuts actifs uniquement) ──────────────────
    async trouverReservationEnCours(chambreId, hotelId, trx) {
      return conn(trx)('reservations AS r')
        .leftJoin('clients AS c', 'c.id', 'r.client_id')
        .where({ 'r.chambre_id': chambreId, 'r.hotel_id': hotelId })
        .whereIn('r.statut', STATUTS_RESERVATION_ACTIFS)
        .select(
          'r.id', 'r.numero_reservation', 'r.statut',
          'r.date_arrivee', 'r.date_depart', 'r.nombre_nuits',
          db.raw("c.prenom || ' ' || c.nom AS nom_client"),
          'c.telephone AS telephone_client'
        )
        .first() ?? null
    },

    // ── IDs des chambres occupées sur une période (conflit de dates) ───────
    // Règle : chevauchement si date_arrivee_existante < date_depart_requete
    //                          AND date_depart_existante > date_arrivee_requete
    // whereNotNull : chambre_id peut être NULL (ON DELETE SET NULL) — exclure
    // ces lignes évite un NULL dans le tableau qui provoquerait un
    // WHERE ... NOT IN (NULL, ...) côté SQL (retourne zéro ligne).
    async listerIdsOccupees(hotelId, dateArrivee, dateDepart, trx) {
      return conn(trx)('reservations')
        .where({ hotel_id: hotelId })
        .whereNotNull('chambre_id')
        .whereNotIn('statut', STATUTS_RESERVATION_TERMINAUX)
        .where('date_arrivee', '<', dateDepart)
        .where('date_depart',  '>', dateArrivee)
        .pluck('chambre_id')
    },

    // ── Vérifier unicité du numéro dans l'hôtel ───────────────────────────
    async numeroExiste(hotelId, numero, excluireId, trx) {
      let q = conn(trx)('chambres')
        .where({ hotel_id: hotelId, numero: numero.toString().trim() })
      if (excluireId) q = q.whereNot({ id: excluireId })
      return !!(await q.first())
    },

    // ── Vérifier qu'un type appartient à cet hôtel ────────────────────────
    async typeAppartientHotel(typeId, hotelId, trx) {
      const row = await conn(trx)('types_chambre')
        .where({ id: typeId, hotel_id: hotelId, actif: true })
        .first()
      return !!row
    },

    // ── Compter réservations futures non terminales ────────────────────────
    async compterReservationsFutures(chambreId, hotelId, trx) {
      const [{ total }] = await conn(trx)('reservations')
        .where({ chambre_id: chambreId, hotel_id: hotelId })
        .whereNotIn('statut', STATUTS_RESERVATION_TERMINAUX)
        .where('date_arrivee', '>=', db.raw('CURRENT_DATE'))
        .count('id AS total')
      return parseInt(total)
    },

    // ── Lister les chambres disponibles sur une période ───────────────────
    // Filtrage 100% SQL — pas de chargement en mémoire pour filtrage JS.
    // Exclut : hors_service, statuts bloquants, chambres occupées sur la période.
    // Tarif calculé en SQL : COALESCE(tarif_specifique, tarif_base, 0).
    // Filtres capacité et type optionnels appliqués en SQL si fournis.
    async listerDisponibles({ hotelId, dateArrivee, dateDepart, adultes, enfants, typeId }, trx) {
      // Sous-requête : IDs occupés sur la période (réutilise la même règle de chevauchement)
      const sousRequeteOccupees = conn(trx)('reservations')
        .where({ hotel_id: hotelId })
        .whereNotNull('chambre_id')
        .whereNotIn('statut', STATUTS_RESERVATION_TERMINAUX)
        .where('date_arrivee', '<', dateDepart)
        .where('date_depart',  '>', dateArrivee)
        .select('chambre_id')

      let q = conn(trx)('chambres AS ch')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .where('ch.hotel_id', hotelId)
        .where('ch.hors_service', false)
        .whereNotIn('ch.statut', ['hors_service', 'maintenance'])
        .whereNotIn('ch.id', sousRequeteOccupees)
        .select(
          ...COLS_CHAMBRE,
          ...COLS_TYPE,
          // Règle tarifaire : tarif_specifique prioritaire sur tarif_base
          db.raw('COALESCE(ch.tarif_specifique, tc.tarif_base, 0) AS tarif_nuit')
        )
        .orderBy('ch.etage', 'asc')
        .orderBy('ch.numero', 'asc')

      if (typeId  !== undefined) q = q.where('ch.type_chambre_id', typeId)
      if (adultes !== undefined) q = q.where('tc.capacite_adultes', '>=', parseInt(adultes))
      if (enfants !== undefined) q = q.where('tc.capacite_enfants', '>=', parseInt(enfants))

      return q
    },

    // ── Créer ─────────────────────────────────────────────────────────────
    async creer(champs, trx) {
      const c = conn(trx)
      const [cree] = await c('chambres')
        .insert({ ...champs, cree_le: c.fn.now(), mis_a_jour_le: c.fn.now() })
        .returning('*')
      return cree
    },

    // ── Mettre à jour ─────────────────────────────────────────────────────
    async mettreAJour(id, hotelId, champs, trx) {
      const c = conn(trx)
      const [mis] = await c('chambres')
        .where({ id, hotel_id: hotelId })
        .update({ ...champs, mis_a_jour_le: c.fn.now() })
        .returning('*')
      return mis ?? null
    },

  }
}

module.exports = { createChambresRepository }
