'use strict'

// =============================================================================
// kpi-aggregation.job.js — VERSION LEGACY COMPATIBLE PRODUCTION
//
// Tables utilisées (toutes existantes en production) :
//   chambres, reservations, commandes_restaurant, paiements, hotels
//   lignes_folio + folios (pour total_debits et solde_du)
//
// LIMITES DOCUMENTÉES :
//   revenu_hebergement : APPROXIMATIF — SUM(tarif_nuit) réservations actives
//                        (pas d'accrual — lignes_folio.type='hebergement' jamais inséré)
//   total_debits       : PARTIEL — lignes_folio alimentée uniquement par restaurant.js
//   solde_du           : APPROXIMATIF — lignes_folio partielle - paiements valides
//   nb_annulations     : APPROXIMATIF — fallback mis_a_jour_le (annulee_le absent schema)
//
// MÉTRIQUES EXACTES :
//   chambres_occupees, occ_rate_pct, arrivees, departs, no_shows, los_moyen
//   ca_restaurant, nb_commandes (source directe commandes_restaurant)
//   cash_encaisse, mobile_money_encaisse, total_credits, nb_paiements_*
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
// HÉBERGEMENT
// Toutes les requêtes sur : chambres, reservations
// revenu_hebergement : SUM(tarif_nuit) — APPROXIMATIF (pas d'accrual)
// =============================================================================
async function _agregerHebergement(db, hotelId, dateStr) {

  // Chambres disponibles (hors_service exclues)
  const [{ disponibles }] = await db('chambres')
    .where({ hotel_id: hotelId, hors_service: false })
    .count('id AS disponibles')

  // Chambres occupées : COUNT DISTINCT chambre_id sur réservations actives
  // Statuts ENUM valides : 'arrivee', 'depart_aujourd_hui'
  const [{ occupees }] = await db('reservations')
    .where({ hotel_id: hotelId })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .where('date_arrivee', '<=', dateStr)
    .where('date_depart',  '>',  dateStr)
    .countDistinct('chambre_id AS occupees')

  // Nuitées : 1 réservation active = 1 nuitée (modèle 1 chambre / réservation)
  const [{ nuitees }] = await db('reservations')
    .where({ hotel_id: hotelId })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .where('date_arrivee', '<=', dateStr)
    .where('date_depart',  '>',  dateStr)
    .count('id AS nuitees')

  // Revenu hébergement APPROXIMATIF : SUM(tarif_nuit) réservations actives
  // Limite : ne reflète pas les ajustements manuels ni les réductions appliquées
  // Source exacte future : lignes_folio type='hebergement' (non alimentée actuellement)
  const [{ revenu }] = await db('reservations')
    .where({ hotel_id: hotelId })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .where('date_arrivee', '<=', dateStr)
    .where('date_depart',  '>',  dateStr)
    .sum('tarif_nuit AS revenu')

  // Arrivées du jour (attendues ou déjà checkées)
  const [{ arrivees }] = await db('reservations')
    .where({ hotel_id: hotelId, date_arrivee: dateStr })
    .whereNotIn('statut', ['annulee', 'no_show'])
    .count('id AS arrivees')

  // Départs du jour : date_depart = aujourd'hui, client encore présent ou en cours
  const [{ departs }] = await db('reservations')
    .where({ hotel_id: hotelId, date_depart: dateStr })
    .whereIn('statut', ['arrivee', 'depart_aujourd_hui'])
    .count('id AS departs')

  // Annulations du jour
  // Fallback : mis_a_jour_le (annulee_le absent du schema production)
  // Approximatif : mis_a_jour_le peut être modifié après l'annulation initiale
  const [{ annulations }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'annulee' })
    .where(db.raw('DATE(mis_a_jour_le) = ?', [dateStr]))
    .count('id AS annulations')
    .catch(() => [{ annulations: 0 }])

  // No-shows du jour
  const [{ no_shows }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'no_show', date_arrivee: dateStr })
    .count('id AS no_shows')

  // Revenu perdu sur no-shows (tarif_nuit × nombre_nuits — APPROXIMATIF)
  const [{ perdu }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'no_show', date_arrivee: dateStr })
    .sum(db.raw('tarif_nuit * nombre_nuits AS perdu'))

  // Durée de séjour moyenne des arrivées du jour
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
// RESTAURANT
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
// FINANCE
// Sources :
//   lignes_folio + folios  → total_debits, solde_du   (PARTIEL / APPROXIMATIF)
//   paiements              → total_credits, encaissements (EXACT)
//
// total_debits : SUM(lignes_folio.montant_total) du jour, via folios.hotel_id
//   Partiel : lignes_folio alimentée uniquement par restaurant.js (type='restaurant')
//   L'hébergement n'y est PAS encore inscrit automatiquement
//
// total_credits : SUM(paiements.montant WHERE statut='valide') — EXACT
//
// solde_du : cumulatif lignes_folio - cumulatif paiements valides
//   Approximatif tant que lignes_folio n'est pas complète
// =============================================================================
async function _agregerFinance(db, hotelId, dateStr) {

  // Débits du jour via lignes_folio (JOIN folios pour hotel_id — isolation tenant)
  const [debits] = await db('lignes_folio AS lf')
    .join('folios AS f', 'f.id', 'lf.folio_id')
    .where('f.hotel_id', hotelId)
    .where('lf.date_facturation', dateStr)
    .select(db.raw('COALESCE(SUM(lf.montant_total), 0) AS total_debits'))

  // Filtre date paiements : traite_le si présent, sinon cree_le
  // confirme_le supprimé (absent du schema paiements en production)
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

  // Solde dû cumulatif = SUM(lignes_folio jusqu'à dateStr) - SUM(paiements valides jusqu'à dateStr)
  // APPROXIMATIF : dépend du taux d'alimentation de lignes_folio
  const [soldeDebits] = await db('lignes_folio AS lf')
    .join('folios AS f', 'f.id', 'lf.folio_id')
    .where('f.hotel_id', hotelId)
    .where('lf.date_facturation', '<=', dateStr)
    .select(db.raw('COALESCE(SUM(lf.montant_total), 0) AS total'))

  const [soldeCredits] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide' })
    .where(db.raw('DATE(COALESCE(traite_le, cree_le)) <= ?', [dateStr]))
    .select(db.raw('COALESCE(SUM(montant), 0) AS total'))

  // Compteurs paiements du jour (tous statuts — pour taux échec)
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
// UPSERT atomique dans les 3 tables kpi_daily_*
// Transaction unique — si une table échoue, les 3 rollback
// =============================================================================
async function _upsert(db, hotelId, dateStr, heb, resto, fin) {
  await db.transaction(async (trx) => {
    await trx('kpi_daily_hebergement').insert(heb).onConflict(['hotel_id', 'date_jour']).merge()
    await trx('kpi_daily_restaurant').insert(resto).onConflict(['hotel_id', 'date_jour']).merge()
    await trx('kpi_daily_finance').insert(fin).onConflict(['hotel_id', 'date_jour']).merge()
  })
}

// =============================================================================
// FONCTION PRINCIPALE — exportée pour recalcul manuel via POST /kpi/recalculer
// dates : tableau 'YYYY-MM-DD'. Par défaut : J-1 + aujourd'hui
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
// JOB PLANIFIÉ — 00h30 chaque nuit
// Anti-overlap : _enCours empêche deux cycles simultanés
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
