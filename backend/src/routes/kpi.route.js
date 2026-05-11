'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/kpi.route.js  —  Lecture KPI depuis tables agrégées
//
// Toutes les lectures passent par les vues v_kpi_* (migration_kpi.sql).
// Aucun accès direct aux tables transactionnelles.
// hotel_id injecté exclusivement via req.hotelId (contexteHotel decorator).
//
// Si migration_kpi.sql non appliquée : .catch() → [] sans crash serveur.
// POST /kpi/recalculer : stub 501 (Phase B — job d'agrégation non déployé).
// ─────────────────────────────────────────────────────────────────────────────

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
  if (isNaN(dA) || isNaN(dF))       return 'Format de date invalide (YYYY-MM-DD)'
  if (dF < dA)                       return 'date_fin doit être >= date_debut'
  if ((dF - dA) / 86400000 > 366)   return 'Plage maximale : 366 jours'
  return null
}

module.exports = async function kpiRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /kpi/overview ──────────────────────────────────────────────────────
  fastify.get('/overview', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const err = validerDates(debut, fin)
    if (err) return reply.status(400).send({ erreur: err })

    const rows = await fastify.db('v_kpi_overview')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')
      .catch(e => {
        req.log.warn({ vue: 'v_kpi_overview', code: e.code },
          'Vue absente — appliquer migration_kpi.sql')
        return []
      })

    const totaux = rows.reduce((acc, r) => ({
      ca_hebergement: acc.ca_hebergement + Number(r.ca_hebergement || 0),
      ca_restaurant:  acc.ca_restaurant  + Number(r.ca_restaurant  || 0),
      cash_encaisse:  acc.cash_encaisse  + Number(r.cash_encaisse  || 0),
      resultat_brut:  acc.resultat_brut  + Number(r.resultat_brut  || 0),
      nb_arrivees:    acc.nb_arrivees    + Number(r.nb_arrivees    || 0),
      nb_departs:     acc.nb_departs     + Number(r.nb_departs     || 0),
    }), { ca_hebergement: 0, ca_restaurant: 0, cash_encaisse: 0,
          resultat_brut: 0, nb_arrivees: 0, nb_departs: 0 })

    const dernier = rows[0] || {}
    return reply.send({
      periode: { debut, fin, nb_jours: rows.length },
      resume: {
        occ_rate_pct: dernier.occ_rate_pct ?? null,
        adr:          dernier.adr           ?? null,
        revpar:       dernier.revpar         ?? null,
        solde_du:     dernier.solde_du       ?? null,
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
    const err = validerDates(debut, fin)
    if (err) return reply.status(400).send({ erreur: err })

    const data = await fastify.db('v_kpi_hebergement')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')
      .catch(e => {
        req.log.warn({ vue: 'v_kpi_hebergement', code: e.code },
          'Vue absente — appliquer migration_kpi.sql')
        return []
      })

    return reply.send({ periode: { debut, fin }, data })
  })

  // ── GET /kpi/restaurant ────────────────────────────────────────────────────
  fastify.get('/restaurant', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const err = validerDates(debut, fin)
    if (err) return reply.status(400).send({ erreur: err })

    const data = await fastify.db('v_kpi_restaurant')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')
      .catch(e => {
        req.log.warn({ vue: 'v_kpi_restaurant', code: e.code },
          'Vue absente — appliquer migration_kpi.sql')
        return []
      })

    return reply.send({ periode: { debut, fin }, data })
  })

  // ── GET /kpi/finance ───────────────────────────────────────────────────────
  fastify.get('/finance', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { debut, fin } = parseDates(req.query)
    const err = validerDates(debut, fin)
    if (err) return reply.status(400).send({ erreur: err })

    const data = await fastify.db('v_kpi_finance')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [debut, fin])
      .orderBy('date_jour', 'desc')
      .catch(e => {
        req.log.warn({ vue: 'v_kpi_finance', code: e.code },
          'Vue absente — appliquer migration_kpi.sql')
        return []
      })

    return reply.send({ periode: { debut, fin }, data })
  })

  // ── GET /kpi/drilldown ─────────────────────────────────────────────────────
  fastify.get('/drilldown', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const {
      code, date_debut, date_fin,
      page = 1, limite = 30, tri = 'date_jour', ordre = 'desc'
    } = req.query

    const { debut, fin } = parseDates({ date_debut, date_fin })
    const err = validerDates(debut, fin)
    if (err) return reply.status(400).send({ erreur: err })
    if (!code) return reply.status(400).send({ erreur: 'Paramètre "code" requis (ex: REVPAR)' })

    const CODES_HEB   = ['OCC_RATE', 'ADR', 'REVPAR', 'NB_NUITEES', 'CA_HEBERGEMENT']
    const CODES_RESTO = ['CA_RESTAURANT', 'PANIER_MOYEN_RESTO']
    const CODES_FIN   = ['CASH_ENCAISSE', 'SOLDE_EN_ATTENTE', 'RESULTAT_BRUT']

    let vue, colonnes
    if (CODES_HEB.includes(code)) {
      vue      = 'v_kpi_hebergement'
      colonnes = ['date_jour', 'occ_rate_pct', 'adr', 'revpar', 'revenu_hebergement',
                  'nb_nuitees', 'chambres_occupees', 'chambres_disponibles',
                  'nb_arrivees', 'nb_departs']
    } else if (CODES_RESTO.includes(code)) {
      vue      = 'v_kpi_restaurant'
      colonnes = ['date_jour', 'chiffre_affaires', 'panier_moyen',
                  'nb_commandes', 'nb_clients_hotel', 'nb_clients_externe']
    } else if (CODES_FIN.includes(code)) {
      vue      = 'v_kpi_finance'
      colonnes = ['date_jour', 'total_debits', 'total_credits', 'cash_encaisse',
                  'mobile_money_encaisse', 'solde_du', 'resultat_brut', 'taux_recouvrement_pct']
    } else {
      return reply.status(400).send({
        erreur:       `Code KPI inconnu : "${code}"`,
        codes_valides: [...CODES_HEB, ...CODES_RESTO, ...CODES_FIN],
      })
    }

    const colTri   = colonnes.includes(tri) ? tri : 'date_jour'
    const ordreSQL = ordre === 'asc' ? 'asc' : 'desc'
    const offset   = (parseInt(page) - 1) * parseInt(limite)

    const [data, compteur] = await Promise.all([
      fastify.db(vue)
        .where('hotel_id', req.hotelId)
        .whereBetween('date_jour', [debut, fin])
        .select(colonnes)
        .orderBy(colTri, ordreSQL)
        .limit(parseInt(limite))
        .offset(offset)
        .catch(e => {
          req.log.warn({ vue, code: e.code }, 'Vue KPI absente')
          return []
        }),
      fastify.db(vue)
        .where('hotel_id', req.hotelId)
        .whereBetween('date_jour', [debut, fin])
        .count('date_jour AS total')
        .catch(() => [{ total: 0 }]),
    ])

    return reply.send({
      kpi:        code,
      periode:    { debut, fin },
      pagination: {
        page:   parseInt(page),
        limite: parseInt(limite),
        total:  parseInt(compteur[0]?.total || 0),
      },
      data,
    })
  })

  // ── POST /kpi/recalculer ───────────────────────────────────────────────────
  // Stub Phase A — activé en Phase B avec le job d'agrégation nocturne
  fastify.post('/recalculer', {
    preHandler: [...pre, fastify.verifierPermission('parametres.modifier')],
  }, async (req, reply) => {
    return reply.status(501).send({
      erreur:  "Job d'agrégation KPI non encore déployé (Phase B)",
      details: 'Appliquer migration_kpi.sql puis déployer kpi-aggregation.job.js',
    })
  })
}
