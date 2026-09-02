'use strict'

const { agreger } = require('../jobs/kpi-aggregation.job')

// ─────────────────────────────────────────────────────────────────────────────
// routes/kpi.route.js
//
// API KPI — lecture depuis tables agrégées uniquement.
// Aucun accès direct aux tables sources (folio_lignes, reservations...).
// Aucune formule kpi_catalog exposée.
// hotel_id depuis request.hotelId uniquement — jamais depuis le body.
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDates(query) {
  const aujourd_hui = new Date().toISOString().split('T')[0]
  const il_y_a_30j  = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
  return {
    debut: query.date_debut || il_y_a_30j,
    fin:   query.date_fin   || aujourd_hui,
  }
}

function validerDates(debut, fin) {
  const dA = new Date(debut), dF = new Date(fin)
  if (isNaN(dA) || isNaN(dF)) return 'Format de date invalide (YYYY-MM-DD)'
  if (dF < dA) return 'date_fin doit être >= date_debut'
  const diffJours = (dF - dA) / 86400000
  if (diffJours > 366) return 'Plage maximale : 366 jours'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function kpiRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /kpi/overview ──────────────────────────────────────────────────────
  // Vue combinée hebergement + restaurant + finance sur une plage de dates
  fastify.get('/overview', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const errDate = validerDates(debut, fin)
    if (errDate) return reply.status(400).send({ erreur: errDate })

    const rows = await fastify.db('v_kpi_overview')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')

    // Agrégats période
    const totaux = rows.reduce((acc, r) => ({
      ca_hebergement:   acc.ca_hebergement   + Number(r.ca_hebergement),
      ca_restaurant:    acc.ca_restaurant    + Number(r.ca_restaurant),
      cash_encaisse:    acc.cash_encaisse    + Number(r.cash_encaisse),
      resultat_brut:    acc.resultat_brut    + Number(r.resultat_brut),
      nb_arrivees:      acc.nb_arrivees      + Number(r.nb_arrivees),
      nb_departs:       acc.nb_departs       + Number(r.nb_departs),
    }), { ca_hebergement: 0, ca_restaurant: 0, cash_encaisse: 0,
          resultat_brut: 0, nb_arrivees: 0, nb_departs: 0 })

    const dernierJour = rows[0] || {}

    return reply.send({
      periode: { debut, fin, nb_jours: rows.length },
      resume: {
        occ_rate_pct:   dernierJour.occ_rate_pct ?? null,
        adr:            dernierJour.adr           ?? null,
        revpar:         dernierJour.revpar         ?? null,
        solde_du:       dernierJour.solde_du       ?? null,
        ...totaux,
      },
      serie: rows,
    })
  })

  // ── GET /kpi/hebergement ───────────────────────────────────────────────────
  fastify.get('/hebergement', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const errDate = validerDates(debut, fin)
    if (errDate) return reply.status(400).send({ erreur: errDate })

    const rows = await fastify.db('v_kpi_hebergement')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')

    return reply.send({ periode: { debut, fin }, data: rows })
  })

  // ── GET /kpi/restaurant ────────────────────────────────────────────────────
  fastify.get('/restaurant', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const errDate = validerDates(debut, fin)
    if (errDate) return reply.status(400).send({ erreur: errDate })

    const rows = await fastify.db('v_kpi_restaurant')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')

    return reply.send({ periode: { debut, fin }, data: rows })
  })

  // ── GET /kpi/finance ───────────────────────────────────────────────────────
  fastify.get('/finance', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const errDate = validerDates(debut, fin)
    if (errDate) return reply.status(400).send({ erreur: errDate })

    const rows = await fastify.db('v_kpi_finance')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')

    return reply.send({ periode: { debut, fin }, data: rows })
  })

  // ── GET /kpi/drilldown ─────────────────────────────────────────────────────
  // Détail d'un KPI spécifique avec tri et pagination
  fastify.get('/drilldown', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { code, date_debut, date_fin, page = 1, limite = 30, tri = 'date_jour', ordre = 'desc' } = req.query
    const { debut, fin } = parseDates({ date_debut, date_fin })
    const errDate = validerDates(debut, fin)
    if (errDate) return reply.status(400).send({ erreur: errDate })

    if (!code) return reply.status(400).send({ erreur: 'Paramètre "code" requis (ex: REVPAR)' })

    // Validation code pour éviter injection SQL sur le nom de vue
    const CODES_HEBERGEMENT = ['OCC_RATE','ADR','REVPAR','NB_NUITEES','CA_HEBERGEMENT']
    const CODES_RESTAURANT  = ['CA_RESTAURANT','PANIER_MOYEN_RESTO']
    const CODES_FINANCE     = ['CASH_ENCAISSE','SOLDE_EN_ATTENTE','RESULTAT_BRUT']

    let vue, colonnes
    if (CODES_HEBERGEMENT.includes(code)) {
      vue = 'v_kpi_hebergement'
      colonnes = ['date_jour','occ_rate_pct','adr','revpar','revenu_hebergement','nb_nuitees','chambres_occupees','chambres_disponibles','nb_arrivees','nb_departs']
    } else if (CODES_RESTAURANT.includes(code)) {
      vue = 'v_kpi_restaurant'
      colonnes = ['date_jour','chiffre_affaires','panier_moyen','nb_commandes','nb_clients_hotel','nb_clients_externe']
    } else if (CODES_FINANCE.includes(code)) {
      vue = 'v_kpi_finance'
      colonnes = ['date_jour','total_debits','total_credits','cash_encaisse','mobile_money_encaisse','solde_du','resultat_brut','taux_recouvrement_pct']
    } else {
      return reply.status(400).send({ erreur: `Code KPI inconnu : "${code}"`, codes_valides: [...CODES_HEBERGEMENT, ...CODES_RESTAURANT, ...CODES_FINANCE] })
    }

    const colTri = colonnes.includes(tri) ? tri : 'date_jour'
    const ordreSQL = ordre === 'asc' ? 'asc' : 'desc'
    const offset = (parseInt(page) - 1) * parseInt(limite)

    const [data, [{ total }]] = await Promise.all([
      fastify.db(vue)
        .where('hotel_id', req.hotelId)
        .whereBetween('date_jour', [debut, fin])
        .select(colonnes)
        .orderBy(colTri, ordreSQL)
        .limit(parseInt(limite))
        .offset(offset),

      fastify.db(vue)
        .where('hotel_id', req.hotelId)
        .whereBetween('date_jour', [debut, fin])
        .count('date_jour AS total'),
    ])

    return reply.send({
      kpi:        code,
      periode:    { debut, fin },
      pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) },
      data,
    })
  })

  // ── POST /kpi/recalculer (admin uniquement) ────────────────────────────────
  // Recalcul manuel sur une ou plusieurs dates — pour corriger un ledger amendé
  fastify.post('/recalculer', {
    preHandler: [...pre, fastify.verifierPermission('parametres.modifier')],
  }, async (req, reply) => {
    const { dates } = req.body || {}

    if (!dates || !Array.isArray(dates) || dates.length === 0)
      return reply.status(400).send({ erreur: 'Fournir un tableau "dates" (YYYY-MM-DD)' })

    if (dates.length > 30)
      return reply.status(400).send({ erreur: 'Maximum 30 dates par recalcul manuel' })

    const invalides = dates.filter(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))
    if (invalides.length)
      return reply.status(400).send({ erreur: `Dates invalides : ${invalides.join(', ')}` })

    // Lancer en arrière-plan — ne pas bloquer la réponse HTTP
    agreger({ db: fastify.db, logger: req.log, dates })
      .catch(err => req.log.error({ event: 'kpi_recalcul_manuel', err: { message: err.message } },
        'Erreur recalcul KPI manuel'))

    return reply.status(202).send({
      message: `Recalcul KPI lancé pour ${dates.length} date(s)`,
      dates,
    })
  })
}
