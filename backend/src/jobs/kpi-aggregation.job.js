'use strict'

// =============================================================================
// kpi-aggregation.job.js — VERSION V2 — POST-MIGRATION REALIGNMENT
//
// CHANGEMENTS v1 → v2 (localisés dans _agregerFinance uniquement) :
//   1. Table : lignes_folio conservée (Option A — pas de rename)
//   2. Colonne montant : montant_total conservé (Option A — pas de rename)
//   3. Filtre temporel : DATE(lf.cree_le) remplace lf.date_facturation
//   4. JOIN folios supprimé → hotel_id direct sur lignes_folio (post migration_delta)
//   5. Filtre lf.sens = 'debit' sur total_debits (nouveau concept V2 — ledger double-entrée)
//   6. Filtre lf.sens = 'debit' sur solde cumulatif (cohérence)
//   7. Commentaires mis à jour
//
// INCHANGÉ :
//   _agregerHebergement, _agregerRestaurant, _upsert, scheduler, agreger
//
// Tables utilisées (toutes existantes en production post-migration) :
//   chambres, reservations, commandes_restaurant, paiements, hotels
//   lignes_folio — avec hotel_id direct V2 (post migration_delta)
//
// LIMITES DOCUMENTÉES (inchangées) :
//   revenu_hebergement : APPROXIMATIF — SUM(tarif_nuit) réservations actives
//                        (writer hébergement dans lignes_folio = Palier 1, pas encore actif)
//   solde_du           : AMÉLIORÉ mais encore partiel — lignes_folio alimentée par
//                        restaurant + paiements manuels ; hébergement = Palier 1
//   nb_annulations     : APPROXIMATIF — fallback mis_a_jour_le
//
// MÉTRIQUES EXACTES :
//   chambres_occupees, occ_rate_pct, arrivees, departs, no_shows, los_moyen
//   ca_restaurant, nb_commandes (source directe commandes_restaurant)
//   cash_encaisse, mobile_money_encaisse, total_credits, nb_paiements_*
//   total_debits (AMÉLIORÉ — filtre sens='debit' V2, fiable dès activation restaurant)
// =============================================================================

const HEURE_H   = 0
const HEURE_MIN = 30

let _timer   = null
let _enCours = false

function _msJusquaProchaineCible() {
  const now   = new Date()
  const cible = new Date(now)
  cible.setHours(HEURE_H, HEURE_MIN, 0, 0)
  if (cible <= now) cible.setDate(cible.getDate() + 1)
  return cible - now
}

// Tous les hôtels actifs (tenants actifs uniquement)
async function _listerHotels(db) {
  return db('hotels AS h')
    .join('tenants AS t', 't.id', 'h.tenant_id')
    .whereIn('t.statut', ['actif', 'essai'])
    .select('h.id AS hotel_id', 'h.nombre_chambres')
}

// =============================================================================
// HÉBERGEMENT — INCHANGÉ
// Toutes les requêtes sur : chambres, reservations
// revenu_hebergement : SUM(tarif_nuit) — APPROXIMATIF (pas d'accrual)
// =============================================================================
async function _agregerHebergement(db, hotelId, dateStr) {

  const [{ disponibles }] = await db('chambres')
    .where({ hotel_id: hotelId, hors_service: false })
    .count('id AS disponibles')

  const [{ occupees }] = await db('reservations')
    .where({ hotel_id: hotelId })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .where('date_arrivee', '<=', dateStr)
    .where('date_depart',  '>',  dateStr)
    .countDistinct('chambre_id AS occupees')

  const [{ nuitees }] = await db('reservations')
    .where({ hotel_id: hotelId })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .where('date_arrivee', '<=', dateStr)
    .where('date_depart',  '>',  dateStr)
    .count('id AS nuitees')

  const [{ revenu }] = await db('reservations')
    .where({ hotel_id: hotelId })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .where('date_arrivee', '<=', dateStr)
    .where('date_depart',  '>',  dateStr)
    .sum('tarif_nuit AS revenu')

  const [{ arrivees }] = await db('reservations')
    .where({ hotel_id: hotelId, date_arrivee: dateStr })
    .whereNotIn('statut', ['annulee', 'no_show'])
    .count('id AS arrivees')

  const [{ departs }] = await db('reservations')
    .where({ hotel_id: hotelId, date_depart: dateStr })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .count('id AS departs')

  const [{ annulations }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'annulee' })
    .where(db.raw('DATE(mis_a_jour_le) = ?', [dateStr]))
    .count('id AS annulations')
    .catch(() => [{ annulations: 0 }])

  const [{ no_shows }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'no_show', date_arrivee: dateStr })
    .count('id AS no_shows')

  const [{ perdu }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'no_show', date_arrivee: dateStr })
    .select(db.raw('COALESCE(SUM(tarif_nuit * nombre_nuits), 0) AS perdu'))
    .catch(() => [{ perdu: 0 }])

  const [{ los }] = await db('reservations')
    .where({ hotel_id: hotelId, date_arrivee: dateStr })
    .whereNotIn('statut', ['annulee', 'no_show'])
    .avg('nombre_nuits AS los')

  return {
    hotel_id:             hotelId,
    date_jour:            dateStr,
    chambres_disponibles: parseInt(disponibles)  || 0,
    chambres_occupees:    parseInt(occupees)     || 0,
    nb_nuitees:           parseInt(nuitees)      || 0,
    revenu_hebergement:   parseFloat(revenu)     || 0,
    nb_arrivees:          parseInt(arrivees)     || 0,
    nb_departs:           parseInt(departs)      || 0,
    nb_annulations:       parseInt(annulations)  || 0,
    nb_no_show:           parseInt(no_shows)     || 0,
    revenu_perdu_no_show: parseFloat(perdu)      || 0,
    los_moyen:            los ? parseFloat(parseFloat(los).toFixed(2)) : null,
    calcule_le:           db.fn.now(),
  }
}

// =============================================================================
// RESTAURANT — INCHANGÉ
// Source : commandes_restaurant — EXACTE
// =============================================================================
async function _agregerRestaurant(db, hotelId, dateStr) {
  const rows = await db('commandes_restaurant')
    .where({ hotel_id: hotelId, statut: 'servie' })
    .where(db.raw('DATE(heure_servie) = ?', [dateStr]))
    .select(
      db.raw('COUNT(*) AS nb_commandes'),
      db.raw('COALESCE(SUM(total), 0) AS ca_total'),
      db.raw("COUNT(*) FILTER (WHERE reservation_id IS NOT NULL) AS nb_hotel"),
      db.raw("COUNT(*) FILTER (WHERE reservation_id IS NULL)     AS nb_externe")
    )
    .first()

  return {
    hotel_id:           hotelId,
    date_jour:          dateStr,
    nb_commandes:       parseInt(rows.nb_commandes)  || 0,
    chiffre_affaires:   parseFloat(rows.ca_total)    || 0,
    nb_clients_hotel:   parseInt(rows.nb_hotel)      || 0,
    nb_clients_externe: parseInt(rows.nb_externe)    || 0,
    calcule_le:         db.fn.now(),
  }
}

// =============================================================================
// FINANCE — V2 — MODIFIÉ
//
// Changements par rapport à V1 :
//
//   REQUÊTE 1 (total_debits du jour) :
//     V1 : db('lignes_folio').join('folios').where(date_facturation).SUM(montant_total)
//     V2 : db('lignes_folio').where(hotel_id).where(sens='debit').where(DATE(cree_le)).SUM(montant_total)
//     → Plus de JOIN folios — hotel_id direct sur lignes_folio (post migration_delta)
//     → Filtre sens='debit' — seules les charges comptent dans les débits
//     → DATE(cree_le) pour le filtrage temporel (date_facturation non utilisé)
//
//   REQUÊTE 4 (solde cumulatif débits) :
//     V1 : db('lignes_folio').join('folios').where(date_facturation <=).SUM(montant_total)
//     V2 : db('lignes_folio').where(hotel_id).where(sens='debit').where(DATE(cree_le) <=).SUM(montant_total)
//
//   REQUÊTES 2, 3, 5, 6 (paiements) : INCHANGÉES
//
// Option A retenue :
//   - Table    : lignes_folio     (nom prod conservé — pas de rename)
//   - Colonne  : montant_total    (nom prod conservé — pas de rename)
//   Le rename montant_total → montant sera fait dans migration_v2_cleanup (post-stabilisation).
//
// Sources :
//   lignes_folio (V2 post-delta)  → total_debits, solde_du  (AMÉLIORÉ)
//   paiements                    → total_credits, encaissements (EXACT — inchangé)
// =============================================================================
async function _agregerFinance(db, hotelId, dateStr) {

  // ── REQUÊTE 1 — Débits du jour ────────────────────────────────────────────
  // lignes_folio avec hotel_id direct (post migration_delta) + filtre sens='debit'
  // DATE(cree_le) pour le filtrage temporel
  const [debits] = await db('lignes_folio AS fl')
    .where({ 'fl.hotel_id': hotelId, 'fl.sens': 'debit' })
    .where(db.raw('DATE(fl.cree_le) = ?', [dateStr]))
    .select(db.raw('COALESCE(SUM(fl.montant_total), 0) AS total_debits'))

  // ── REQUÊTES 2, 3, 5 — Paiements INCHANGÉES ──────────────────────────────
  const datePaiement = `DATE(COALESCE(traite_le, cree_le)) = ?`

  // Cash encaissé du jour (espèces + carte + virement) — EXACT
  const [cash] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide' })
    .whereIn('type_paiement', ['especes', 'carte', 'virement'])
    .where(db.raw(datePaiement, [dateStr]))
    .select(db.raw('COALESCE(SUM(montant), 0) AS montant'))

  // Mobile money du jour — EXACT
  const [mm] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide', type_paiement: 'mobile_money' })
    .where(db.raw(datePaiement, [dateStr]))
    .select(db.raw('COALESCE(SUM(montant), 0) AS montant'))

  // Total crédits = tous paiements valides du jour (toutes méthodes) — EXACT
  const [credits] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide' })
    .where(db.raw(datePaiement, [dateStr]))
    .select(db.raw('COALESCE(SUM(montant), 0) AS total_credits'))

  // ── REQUÊTE 4 — Solde dû cumulatif ───────────────────────────────────────
  // lignes_folio hotel_id direct + sens='debit' + DATE(cree_le) cumulatif
  const [soldeDebits] = await db('lignes_folio AS fl')
    .where({ 'fl.hotel_id': hotelId, 'fl.sens': 'debit' })
    .where(db.raw('DATE(fl.cree_le) <= ?', [dateStr]))
    .select(db.raw('COALESCE(SUM(fl.montant_total), 0) AS total'))

  // ── REQUÊTE 5 — Solde crédits cumulatif INCHANGÉE ────────────────────────
  const [soldeCredits] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide' })
    .where(db.raw('DATE(COALESCE(traite_le, cree_le)) <= ?', [dateStr]))
    .select(db.raw('COALESCE(SUM(montant), 0) AS total'))

  // ── REQUÊTE 6 — Compteurs paiements INCHANGÉE ────────────────────────────
  const [compteurs] = await db('paiements')
    .where({ hotel_id: hotelId })
    .where(db.raw('DATE(cree_le) = ?', [dateStr]))
    .select(
      db.raw("COUNT(*) FILTER (WHERE statut = 'valide') AS nb_valides"),
      db.raw("COUNT(*) FILTER (WHERE statut = 'echec')  AS nb_echec")
    )

  return {
    hotel_id:              hotelId,
    date_jour:             dateStr,
    total_debits:          parseFloat(debits.total_debits)   || 0,
    total_credits:         parseFloat(credits.total_credits) || 0,
    cash_encaisse:         parseFloat(cash.montant)          || 0,
    mobile_money_encaisse: parseFloat(mm.montant)            || 0,
    solde_du:              Math.max(0,
                             (parseFloat(soldeDebits.total)  || 0)
                           - (parseFloat(soldeCredits.total) || 0)),
    nb_paiements_valides:  parseInt(compteurs.nb_valides)    || 0,
    nb_paiements_echec:    parseInt(compteurs.nb_echec)      || 0,
    calcule_le:            db.fn.now(),
  }
}

// =============================================================================
// UPSERT — INCHANGÉ
// =============================================================================
async function _upsert(db, hotelId, dateStr, heb, resto, fin) {
  await db.transaction(async (trx) => {
    await trx('kpi_daily_hebergement').insert(heb).onConflict(['hotel_id', 'date_jour']).merge()
    await trx('kpi_daily_restaurant').insert(resto).onConflict(['hotel_id', 'date_jour']).merge()
    await trx('kpi_daily_finance').insert(fin).onConflict(['hotel_id', 'date_jour']).merge()
  })
}

// =============================================================================
// FONCTION PRINCIPALE — INCHANGÉE
// =============================================================================
async function agreger({ db, logger, dates }) {
  if (!dates || !dates.length) {
    const hier  = new Date()
    hier.setDate(hier.getDate() - 1)
    const aujhui = new Date()
    dates = [
      hier.toISOString().split('T')[0],
      aujhui.toISOString().split('T')[0],
    ]
  }

  const hotels = await _listerHotels(db)
  const stats  = { hotels: hotels.length, dates: dates.length, ok: 0, erreurs: 0 }

  for (const hotel of hotels) {
    for (const dateStr of dates) {
      try {
        const [heb, resto, fin] = await Promise.all([
          _agregerHebergement(db, hotel.hotel_id, dateStr),
          _agregerRestaurant(db, hotel.hotel_id, dateStr),
          _agregerFinance(db, hotel.hotel_id, dateStr),
        ])
        await _upsert(db, hotel.hotel_id, dateStr, heb, resto, fin)
        stats.ok++
      } catch (err) {
        stats.erreurs++
        logger.error({
          event:    'kpi_aggregation',
          hotel_id: hotel.hotel_id,
          date:     dateStr,
          err:      { message: err.message, code: err.code },
        }, 'Erreur agrégation KPI')
      }
    }
  }

  logger.info({ event: 'kpi_aggregation', ...stats }, 'Agrégation KPI terminée')
  return stats
}

// =============================================================================
// JOB PLANIFIÉ — INCHANGÉ
// =============================================================================
async function _executer({ db, logger }) {
  if (_enCours) {
    logger.warn({ event: 'kpi_aggregation_job', result: 'SKIP_IN_PROGRESS' },
      'Job KPI déjà en cours — cycle ignoré')
    return
  }

  _enCours = true
  const debut = Date.now()

  try {
    const stats = await agreger({ db, logger, dates: null })
    logger.info({
      event:    'kpi_aggregation_job',
      result:   'done',
      duree_ms: Date.now() - debut,
      ...stats,
    }, 'Cycle agrégation KPI terminé')
  } catch (err) {
    logger.error({
      event:    'kpi_aggregation_job',
      result:   'error',
      duree_ms: Date.now() - debut,
      err:      { message: err.message },
    }, 'Erreur critique job KPI')
  } finally {
    _enCours = false
    _timer   = setTimeout(() => _executer({ db, logger }), _msJusquaProchaineCible())
  }
}

function demarrer({ db, logger }) {
  if (_timer) {
    logger.warn({ event: 'kpi_aggregation_job' }, 'Job KPI déjà démarré — appel ignoré')
    return
  }
  const ms = _msJusquaProchaineCible()
  logger.info({
    event:            'kpi_aggregation_job',
    prochain_dans_ms: ms,
  }, `Job KPI démarré — prochain cycle dans ${Math.round(ms / 60000)} min`)
  _timer = setTimeout(() => _executer({ db, logger }), ms)
}

function arreter(logger) {
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
    if (logger) logger.info({ event: 'kpi_aggregation_job' }, 'Job KPI arrêté')
  }
}

module.exports = { demarrer, arreter, agreger }
