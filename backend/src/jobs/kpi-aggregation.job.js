'use strict'

const HEURE_H   = 0
const HEURE_MIN = 30
let _timer   = null
let _enCours = false

function _msJusquaProchaineCible() {
  const now = new Date(), cible = new Date(now)
  cible.setHours(HEURE_H, HEURE_MIN, 0, 0)
  if (cible <= now) cible.setDate(cible.getDate() + 1)
  return cible - now
}

async function _listerHotels(db) {
  return db('hotels').select('id AS hotel_id', 'nombre_chambres')
}

async function _agregerHebergement(db, hotelId, dateStr) {
  const [{ disponibles }] = await db('chambres')
    .where({ hotel_id: hotelId, hors_service: false }).count('id AS disponibles')

  // FIX v2: 1 chambre = 1 nuitée (pas SUM(nombre_nuits))
  const [{ occupees }] = await db('reservations')
    .where({ hotel_id: hotelId }).whereIn('statut', ['arrivee','depart_aujourd_hui','terminee'])
    .where('date_arrivee', '<=', dateStr).where('date_depart', '>', dateStr)
    .countDistinct('chambre_id AS occupees')

  const [{ nuitees }] = await db('reservations')
    .where({ hotel_id: hotelId }).whereIn('statut', ['arrivee','depart_aujourd_hui','terminee'])
    .where('date_arrivee', '<=', dateStr).where('date_depart', '>', dateStr)
    .count('id AS nuitees')

  const [{ revenu }] = await db('folio_lignes')
    .where({ hotel_id: hotelId, type_ligne: 'nuitee', sens: 'debit', date_nuitee: dateStr })
    .sum('montant AS revenu')

  const [{ arrivees }] = await db('reservations')
    .where({ hotel_id: hotelId, date_arrivee: dateStr })
    .whereNotIn('statut', ['annulee','no_show']).count('id AS arrivees')

  const [{ departs }] = await db('reservations')
    .where({ hotel_id: hotelId, date_depart: dateStr, statut: 'terminee' }).count('id AS departs')

  // FIX v2: annulee_le (pas annulee_par UUID)
  const [{ annulations }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'annulee' })
    .where(db.raw('DATE(annulee_le) = ?', [dateStr]))
    .count('id AS annulations').catch(() => [{ annulations: 0 }])

  const [{ no_shows }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'no_show', date_arrivee: dateStr })
    .count('id AS no_shows')

  const [{ perdu }] = await db('reservations')
    .where({ hotel_id: hotelId, statut: 'no_show', date_arrivee: dateStr })
    .sum(db.raw('tarif_nuit * nombre_nuits AS perdu'))

  const [{ los }] = await db('reservations')
    .where({ hotel_id: hotelId, date_arrivee: dateStr })
    .whereNotIn('statut', ['annulee','no_show']).avg('nombre_nuits AS los')

  return {
    hotel_id: hotelId, date_jour: dateStr,
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

async function _agregerRestaurant(db, hotelId, dateStr) {
  const rows = await db('commandes_restaurant')
    .where({ hotel_id: hotelId, statut: 'servie' })
    .where(db.raw('DATE(heure_servie) = ?', [dateStr]))
    .select(
      db.raw('COUNT(*) AS nb_commandes'),
      db.raw('COALESCE(SUM(total), 0) AS ca_total'),
      db.raw("COUNT(*) FILTER (WHERE reservation_id IS NOT NULL) AS nb_hotel"),
      db.raw("COUNT(*) FILTER (WHERE reservation_id IS NULL)     AS nb_externe")
    ).first()
  return {
    hotel_id: hotelId, date_jour: dateStr,
    nb_commandes:       parseInt(rows.nb_commandes)  || 0,
    chiffre_affaires:   parseFloat(rows.ca_total)    || 0,
    nb_clients_hotel:   parseInt(rows.nb_hotel)      || 0,
    nb_clients_externe: parseInt(rows.nb_externe)    || 0,
    calcule_le:         db.fn.now(),
  }
}

async function _agregerFinance(db, hotelId, dateStr) {
  const [ledger] = await db('folio_lignes').where({ hotel_id: hotelId })
    .where(db.raw('DATE(cree_le) = ?', [dateStr]))
    .select(
      db.raw("COALESCE(SUM(CASE WHEN sens='debit'  THEN montant ELSE 0 END),0) AS total_debits"),
      db.raw("COALESCE(SUM(CASE WHEN sens='credit' THEN montant ELSE 0 END),0) AS total_credits")
    )

  const datePaiement = `DATE(COALESCE(traite_le, confirme_le, cree_le)) = ?`
  const [cash] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide' })
    .whereIn('type_paiement', ['especes','carte','virement'])
    .where(db.raw(datePaiement, [dateStr])).select(db.raw('COALESCE(SUM(montant),0) AS montant'))

  const [mm] = await db('paiements')
    .where({ hotel_id: hotelId, statut: 'valide', type_paiement: 'mobile_money' })
    .where(db.raw(datePaiement, [dateStr])).select(db.raw('COALESCE(SUM(montant),0) AS montant'))

  // FIX v2: solde cumulatif jusqu'à dateStr (snapshot clôture)
  const soldeResult = await db.raw(`
    SELECT COALESCE(SUM(
      CASE WHEN fl.sens='debit' THEN fl.montant WHEN fl.sens='credit' THEN -fl.montant ELSE 0 END
    ),0) AS solde_total
    FROM folio_lignes fl
    WHERE fl.hotel_id = ? AND DATE(fl.cree_le) <= ?
  `, [hotelId, dateStr])

  const [compteurs] = await db('paiements').where({ hotel_id: hotelId })
    .where(db.raw('DATE(cree_le) = ?', [dateStr]))
    .select(
      db.raw("COUNT(*) FILTER (WHERE statut='valide') AS nb_valides"),
      db.raw("COUNT(*) FILTER (WHERE statut='echec')  AS nb_echec")
    )

  return {
    hotel_id: hotelId, date_jour: dateStr,
    total_debits:          parseFloat(ledger.total_debits)    || 0,
    total_credits:         parseFloat(ledger.total_credits)   || 0,
    cash_encaisse:         parseFloat(cash.montant)           || 0,
    mobile_money_encaisse: parseFloat(mm.montant)             || 0,
    solde_du:              parseFloat(soldeResult.rows[0].solde_total) || 0,
    nb_paiements_valides:  parseInt(compteurs.nb_valides)     || 0,
    nb_paiements_echec:    parseInt(compteurs.nb_echec)       || 0,
    calcule_le:            db.fn.now(),
  }
}

async function _agregerAnalytics(db, hotelId, dateStr) {
  // Revenue comptable = TOUS les débits folio (nuitées + restaurant + services)
  // FIX 2 : revenue_hebergement = nuitées UNIQUEMENT (type_ligne = 'nuitee')
  // Deux requêtes séparées pour la précision métier
  const revenueHebergement = await db('folio_lignes AS fl')
    .join('folios AS f',       'f.id', 'fl.folio_id')
    .join('reservations AS r', 'r.id', 'f.reservation_id')
    .where({ 'fl.hotel_id': hotelId, 'fl.sens': 'debit', 'fl.type_ligne': 'nuitee' })
    .where(db.raw('DATE(fl.cree_le) = ?', [dateStr]))
    .select(
      db.raw("COALESCE(r.segment,'standard') AS segment"),
      db.raw("COALESCE(r.source,'direct')    AS canal"),
      db.raw("COALESCE(SUM(fl.montant),0)    AS revenu_hebergement"),
    )
    .groupBy('segment', 'canal')

  const revenueComptable = await db('folio_lignes AS fl')
    .join('folios AS f',        'f.id',  'fl.folio_id')
    .join('reservations AS r',  'r.id',  'f.reservation_id')
    .where({ 'fl.hotel_id': hotelId, 'fl.sens': 'debit' })
    .whereIn('fl.type_ligne', ['nuitee', 'restaurant', 'service', 'minibar'])
    .where(db.raw('DATE(fl.cree_le) = ?', [dateStr]))
    .select(
      db.raw("COALESCE(r.segment,'standard')  AS segment"),
      db.raw("COALESCE(r.source,'direct')     AS canal"),
      db.raw("COALESCE(SUM(fl.montant),0)     AS revenue_comptable"),
    )
    .groupBy('segment', 'canal')

  // Cash réel = paiements validés du jour — segment × canal
  // FIX 4 : alimenter cash_reel depuis paiements
  const cashReel = await db('paiements AS p')
    .join('folios AS f',       'f.id',  'p.folio_id')
    .join('reservations AS r', 'r.id',  'f.reservation_id')
    .where({ 'p.hotel_id': hotelId, 'p.statut': 'valide' })
    .where(db.raw('DATE(COALESCE(p.traite_le, p.confirme_le, p.cree_le)) = ?', [dateStr]))
    .select(
      db.raw("COALESCE(r.segment,'standard')  AS segment"),
      db.raw("COALESCE(r.source,'direct')     AS canal"),
      db.raw("p.type_paiement"),
      db.raw("COALESCE(SUM(p.montant),0)      AS cash_reel"),
    )
    .groupBy('segment', 'canal', 'type_paiement')

  // Nb réservations actives par segment × canal (pour compteurs)
  const hebRows = await db('reservations AS r')
    .where({ 'r.hotel_id': hotelId })
    .whereIn('r.statut', ['arrivee','depart_aujourd_hui','terminee'])
    .where('r.date_arrivee', '<=', dateStr).where('r.date_depart', '>', dateStr)
    .select(
      db.raw("COALESCE(r.segment,'standard') AS segment"),
      db.raw("COALESCE(r.source,'direct')    AS canal"),
      db.raw("COUNT(r.id)                    AS nb_reservations"),
    ).groupBy('segment', 'canal')

  // Construire la map des lignes à insérer
  const map = new Map()
  const key = (s, c, t) => `${s}|${c}|${t}`
  const base = (s, c, t) => ({
    hotel_id: hotelId, date_jour: dateStr,
    segment: s, canal: c, type_paiement: t,
    nb_reservations: 0, nb_nuitees: 0, revenu_hebergement: 0,
    nb_no_show: 0, revenu_perdu_no_show: 0, los_moyen: null,
    nb_commandes_resto: 0, ca_restaurant: 0,
    cash_encaisse: 0, revenue_comptable: 0, cash_reel: 0,
    calcule_le: db.fn.now(),
  })

  for (const h of hebRows) {
    const k = key(h.segment, h.canal, 'tous')
    if (!map.has(k)) map.set(k, base(h.segment, h.canal, 'tous'))
    map.get(k).nb_reservations = parseInt(h.nb_reservations) || 0
    // nb_nuitees = nombre de réservations actives sur le jour J
    // (1 réservation active = 1 chambre occupée = 1 nuitée consommée ce jour)
    // Sémantique : "chambres-nuits vendues ce jour par segment/canal"
    map.get(k).nb_nuitees      = parseInt(h.nb_reservations) || 0
  }

  for (const rc of revenueComptable) {
    const k = key(rc.segment, rc.canal, 'tous')
    if (!map.has(k)) map.set(k, base(rc.segment, rc.canal, 'tous'))
    // revenue_comptable = total débits folio (hébergement + restaurant + services)
    map.get(k).revenue_comptable  = parseFloat(rc.revenue_comptable) || 0
  }

  for (const rh of revenueHebergement) {
    const k = key(rh.segment, rh.canal, 'tous')
    if (!map.has(k)) map.set(k, base(rh.segment, rh.canal, 'tous'))
    // revenu_hebergement = nuitées uniquement (type_ligne='nuitee')
    map.get(k).revenu_hebergement = parseFloat(rh.revenu_hebergement) || 0
  }

  for (const p of cashReel) {
    // Ligne par type_paiement
    const k = key(p.segment, p.canal, p.type_paiement)
    if (!map.has(k)) map.set(k, base(p.segment, p.canal, p.type_paiement))
    const entry = map.get(k)
    entry.cash_reel     = parseFloat(p.cash_reel) || 0
    entry.cash_encaisse = parseFloat(p.cash_reel) || 0

    // Aussi agréger dans la ligne 'tous'
    const kTous = key(p.segment, p.canal, 'tous')
    if (map.has(kTous)) {
      map.get(kTous).cash_reel     += parseFloat(p.cash_reel) || 0
      map.get(kTous).cash_encaisse += parseFloat(p.cash_reel) || 0
    }
  }

  return [...map.values()]
}

// FIX 5 : UPSERT dans transaction atomique
async function _upsertAnalyticsTransaction(db, hotelId, dateStr, rows) {
  if (!rows.length) return
  await db.transaction(async (trx) => {
    // Supprimer les lignes existantes pour cette date/hotel avant UPSERT
    await trx('kpi_analytics_daily')
      .where({ hotel_id: hotelId, date_jour: dateStr }).delete()
    // Insérer les nouvelles lignes
    await trx('kpi_analytics_daily').insert(rows)
  })
}

async function agreger({ db, logger, dates }) {
  if (!dates || !dates.length) {
    const h = new Date(); h.setDate(h.getDate() - 1)
    const a = new Date()
    dates = [h.toISOString().split('T')[0], a.toISOString().split('T')[0]]
  }
  const hotels = await _listerHotels(db)
  const stats  = { hotels: hotels.length, dates: dates.length, ok: 0, erreurs: 0 }

  for (const hotel of hotels) {
    for (const dateStr of dates) {
      try {
        const [heb, resto, fin, analytics] = await Promise.all([
          _agregerHebergement(db, hotel.hotel_id, dateStr),
          _agregerRestaurant(db, hotel.hotel_id, dateStr),
          _agregerFinance(db, hotel.hotel_id, dateStr),
          _agregerAnalytics(db, hotel.hotel_id, dateStr),
        ])

        // FIX 5 : transaction atomique sur les 3 tables principales
        await db.transaction(async (trx) => {
          await trx('kpi_daily_hebergement').insert(heb).onConflict().merge()
          await trx('kpi_daily_restaurant').insert(resto).onConflict().merge()
          await trx('kpi_daily_finance').insert(fin).onConflict().merge()
        })

        // Analytics : transaction séparée (DELETE + INSERT idempotent)
        await _upsertAnalyticsTransaction(db, hotel.hotel_id, dateStr, analytics)

        stats.ok++
      } catch (err) {
        stats.erreurs++
        logger.error({ event: 'kpi_aggregation', hotel_id: hotel.hotel_id,
          date: dateStr, err: { message: err.message } })
      }
    }
  }
  logger.info({ event: 'kpi_aggregation', ...stats }, 'Agrégation KPI v2 terminée')
  return stats
}

async function _executer({ db, logger }) {
  if (_enCours) { logger.warn({ event: 'kpi_aggregation_job', result: 'SKIP_IN_PROGRESS' }); return }
  _enCours = true
  const debut = Date.now()
  try {
    const stats = await agreger({ db, logger, dates: null })
    logger.info({ event: 'kpi_aggregation_job', result: 'done', duree_ms: Date.now() - debut, ...stats })
  } catch (err) {
    logger.error({ event: 'kpi_aggregation_job', result: 'error', err: { message: err.message } })
  } finally {
    _enCours = false
    _timer   = setTimeout(() => _executer({ db, logger }), _msJusquaProchaineCible())
  }
}

function demarrer({ db, logger }) {
  if (_timer) return
  const ms = _msJusquaProchaineCible()
  logger.info({ event: 'kpi_aggregation_job', prochain_dans_ms: ms })
  _timer = setTimeout(() => _executer({ db, logger }), ms)
}

function arreter(logger) {
  if (_timer) { clearTimeout(_timer); _timer = null }
  if (logger) logger.info({ event: 'kpi_aggregation_job' }, 'Job KPI arrêté')
}

module.exports = { demarrer, arreter, agreger }
