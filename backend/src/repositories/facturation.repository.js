'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// facturation.repository.js
//
// Accès DB uniquement. Aucune règle métier.
// hotel_id obligatoire sur toute requête scopée.
// conn(trx) : utilise la transaction si fournie, sinon db global.
//
// Tables : folios, folio_lignes, paiements, logs_financiers
// Fonction SQL : get_solde_folio(folio_id, hotel_id)
// ─────────────────────────────────────────────────────────────────────────────

function createFacturationRepository(db) {
  const conn = (trx) => trx || db

  return {

    // ── Folio ───────────────────────────────────────────────────────────────

    // Trouver le folio actif d'une réservation (scope double)
    async trouverFolioParReservation(reservationId, hotelId, trx) {
      return conn(trx)('folios AS f')
        .leftJoin('clients AS c', 'c.id', 'f.client_id')
        .where({ 'f.reservation_id': reservationId, 'f.hotel_id': hotelId })
        .whereIn('f.statut', ['ouvert', 'en_attente'])
        .select(
          'f.id', 'f.hotel_id', 'f.reservation_id', 'f.client_id',
          'f.statut', 'f.devise', 'f.numero_folio',
          'f.ouvert_le', 'f.cloture_le', 'f.notes',
          db.raw("c.prenom || ' ' || c.nom AS nom_client"),
          'c.email AS email_client'
        )
        .first() ?? null
    },

    // Trouver un folio par id (scope double — isolation tenant)
    async trouverFolioParId(folioId, hotelId, trx) {
      return conn(trx)('folios')
        .where({ id: folioId, hotel_id: hotelId })
        .first() ?? null
    },

    // Mettre à jour le statut du folio (checkout, litige)
    async mettreAJourStatutFolio(folioId, hotelId, champs, trx) {
      const c = conn(trx)
      const [mis] = await c('folios')
        .where({ id: folioId, hotel_id: hotelId })
        .update({ ...champs, mis_a_jour_le: c.fn.now() })
        .returning('id', 'statut', 'mis_a_jour_le')
      return mis ?? null
    },

    // ── Lignes folio ────────────────────────────────────────────────────────

    // Lister les lignes d'un folio (scope double)
    async listerLignes(folioId, hotelId, trx) {
      return conn(trx)('folio_lignes AS fl')
        .leftJoin('utilisateurs AS u', 'u.id', 'fl.cree_par')
        .where({ 'fl.folio_id': folioId, 'fl.hotel_id': hotelId })
        .select(
          'fl.id', 'fl.type_ligne', 'fl.sens', 'fl.montant', 'fl.devise',
          'fl.description', 'fl.date_nuitee', 'fl.reference_id', 'fl.reference_type',
          'fl.source_module', 'fl.ligne_corrigee_id',
          'fl.cree_par_type', 'fl.cree_le', 'fl.metadata',
          db.raw("u.prenom || ' ' || u.nom AS cree_par_nom")
        )
        .orderBy('fl.cree_le', 'desc')
    },

    // Trouver une ligne par id (scope double via folio)
    async trouverLigneParId(ligneId, hotelId, trx) {
      return conn(trx)('folio_lignes AS fl')
        .join('folios AS f', function() {
          this.on('f.id', '=', 'fl.folio_id')
              .andOn('f.hotel_id', '=', conn(trx).raw('?', [hotelId]))
        })
        .where({ 'fl.id': ligneId })
        .select('fl.*', 'f.statut AS folio_statut', 'f.hotel_id AS folio_hotel_id')
        .first() ?? null
    },

    // Insérer une ligne (INSERT seul — jamais UPDATE/DELETE, enforced par trigger DB)
    async insererLigne(champs, trx) {
      const c = conn(trx)
      const [ligne] = await c('folio_lignes')
        .insert({ ...champs, cree_le: c.fn.now() })
        .returning('*')
      return ligne
    },

    // ── Solde via fonction SQL sécurisée ────────────────────────────────────
    // JAMAIS de calcul JS. Toujours via get_solde_folio(folio_id, hotel_id).
    // Les deux paramètres sont obligatoires — isolation tenant enforced en DB.
    async getSolde(folioId, hotelId, trx) {
      const result = await conn(trx).raw(
        'SELECT * FROM get_solde_folio(?, ?)',
        [folioId, hotelId]
      )
      return result.rows[0] ?? null
    },

    // ── Paiements ───────────────────────────────────────────────────────────

    // Créer un paiement
    async creerPaiement(champs, trx) {
      const c = conn(trx)
      const [paiement] = await c('paiements')
        .insert({ ...champs, cree_le: c.fn.now() })
        .returning('*')
      return paiement
    },

    // Trouver un paiement par id (scope hotel)
    async trouverPaiementParId(paiementId, hotelId, trx) {
      return conn(trx)('paiements')
        .where({ id: paiementId, hotel_id: hotelId })
        .first() ?? null
    },

    // Vérifier si une reference_externe existe déjà (anti-doublon mobile money)
    async referenceExterneExiste(referenceExterne, hotelId, trx) {
      const row = await conn(trx)('paiements')
        .where({ reference_externe: referenceExterne, hotel_id: hotelId })
        .first()
      return !!row
    },

    // Confirmer un paiement (UPDATE autorisé sur paiements — pas sur folio_lignes)
    async confirmerPaiement(paiementId, hotelId, acteurId, folioLigneId, referenceExterne, trx) {
      const c = conn(trx)
      const updateChamps = {
        statut:         'valide',   // ENUM statut_paiement : 'valide' (pas 'confirme')
        confirme_le:    c.fn.now(),
        confirme_par:   acteurId || null,
        folio_ligne_id: folioLigneId || null,
        traite_le:      c.fn.now(),
        traite_par:     acteurId || null,
      }
      // reference_externe définie uniquement pour les paiements mobile money
      if (referenceExterne) updateChamps.reference_externe = referenceExterne

      const [mis] = await c('paiements')
        .where({ id: paiementId, hotel_id: hotelId })
        .update(updateChamps)
        .returning('*')
      return mis ?? null
    },

    // ── Logs financiers ─────────────────────────────────────────────────────
    // INSERT ONLY — enforced par trigger DB (tg_logs_financiers_immutable)

    async insererLog(champs, trx) {
      const c = conn(trx)
      await c('logs_financiers')
        .insert({ ...champs, horodatage: c.fn.now() })
    },

  }
}

module.exports = { createFacturationRepository }
