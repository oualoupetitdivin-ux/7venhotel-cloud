'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/ia.route.js — Ouwalou IA
//
// PHASE 7 — Backend IA : 3 endpoints
//
// La clé API Claude/Anthropic est EXCLUSIVEMENT côté serveur (env var).
// Jamais exposée au frontend. Les prompts sont construits depuis les données
// KPI en DB — jamais depuis le body du client.
//
// Sécurité :
//   - hotel_id depuis request.hotelId uniquement
//   - prompts loggués sans données sensibles (pas de montants bruts dans les logs)
//   - réponses structurées JSON uniquement
//   - timeout 30s sur les appels IA
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL  = 'claude-sonnet-4-20250514'
const ANTHROPIC_API    = 'https://api.anthropic.com/v1/messages'
const TIMEOUT_MS       = 30_000

// Appel Anthropic avec timeout et gestion d'erreur
async function appelIA(prompt, systemPrompt) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY non configurée')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(ANTHROPIC_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key,
                 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model:      ANTHROPIC_MODEL,
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Anthropic API ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    return data.content?.[0]?.text ?? ''
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = async function iaRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── POST /ia/analyse — Analyse intelligente de la période ─────────────────
  fastify.post('/analyse', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { date_debut, date_fin } = req.body || {}

    if (!date_debut || !date_fin)
      return reply.status(400).send({ erreur: 'date_debut et date_fin requis' })

    // Charger les KPI depuis les tables agrégées uniquement
    const [heb, fin, resto, overview] = await Promise.all([
      fastify.db('v_kpi_hebergement')
        .where('hotel_id', req.hotelId).whereBetween('date_jour', [date_debut, date_fin])
        .orderBy('date_jour', 'desc').limit(31),
      fastify.db('v_kpi_finance')
        .where('hotel_id', req.hotelId).whereBetween('date_jour', [date_debut, date_fin])
        .orderBy('date_jour', 'desc').limit(31),
      fastify.db('v_kpi_restaurant')
        .where('hotel_id', req.hotelId).whereBetween('date_jour', [date_debut, date_fin])
        .orderBy('date_jour', 'desc').limit(31),
      fastify.db('v_kpi_overview')
        .where('hotel_id', req.hotelId).whereBetween('date_jour', [date_debut, date_fin])
        .first(),
    ])

    if (!overview) return reply.status(404).send({ erreur: 'Aucune donnée KPI pour cette période' })

    // FIX 1 : données anonymisées envoyées à l'IA — ratios et tendances uniquement
    // INTERDIT : CA bruts, cash, résultats en valeur absolue
    const saisonnalite = await fastify.db('v_predictif_saisonnalite')
      .where('hotel_id', req.hotelId)
      .whereBetween('date_jour', [date_debut, date_fin])
      .orderBy('date_jour', 'desc').limit(7)

    // FIX 1 : nb_jours calculé depuis les dates — rows n'existe pas dans ce scope
    const nbJours = Math.ceil((new Date(date_fin) - new Date(date_debut)) / 86400000) + 1

    const contexte = {
      periode:           { debut: date_debut, fin: date_fin, nb_jours: nbJours },
      hebergement: {
        occ_rate_moy_pct:   overview.occ_rate_pct,
        // FIX 4 : remplacer l'indice ADR/RevPAR (sans signification métier) par
        // l'évolution ADR vs N-1 (variation % — pertinent pour le revenue management)
        adr_evolution_vs_n1_pct: saisonnalite[0]
          ? (() => {
              const adrActuel = overview.adr
              // ADR N-1 approximé : revpar_n_moins_1 / occ_rate_n_moins_1
              const occN1 = saisonnalite[0].occ_rate_n_moins_1
              const revparN1 = saisonnalite[0].ca_heb_n_moins_1
              if (!adrActuel || !revparN1 || !occN1 || occN1 <= 0) return null
              const adrN1 = revparN1 / (occN1 / 100)
              return adrN1 > 0 ? Math.round((adrActuel - adrN1) / adrN1 * 100 * 10) / 10 : null
            })()
          : null,
        revpar_tendance_pct: saisonnalite[0]?.evolution_yoy_pct ?? null,
        occ_vs_n_moins_1_pct: saisonnalite[0]
          ? (overview.occ_rate_pct ?? 0) - (saisonnalite[0].occ_rate_n_moins_1 ?? 0)
          : null,
      },
      restaurant: {
        part_ca_resto_pct: (overview.ca_hebergement + overview.ca_restaurant) > 0
          ? Math.round(overview.ca_restaurant / (overview.ca_hebergement + overview.ca_restaurant) * 100)
          : 0,
      },
      finance: {
        taux_recouvrement_pct: overview.ca_hebergement > 0
          ? Math.round(overview.cash_encaisse / overview.ca_hebergement * 100)
          : null,
        solde_ratio_pct: overview.ca_hebergement > 0
          ? Math.round((overview.solde_du ?? 0) / overview.ca_hebergement * 100)
          : null,
      },
    }

    const systemPrompt = `Tu es Ouwalou, assistant IA expert en revenue management hôtelier en Afrique.
Tu analyses des données KPI réels d'un hôtel africain.
Tu réponds TOUJOURS en JSON structuré avec les champs :
{ "analyse": string, "points_forts": string[], "points_faibles": string[], "recommandations": string[], "alerte": string|null }
Sois concis, actionnable, adapté au contexte africain (connexion instable, mobile money, saisonnalité).`

    const prompt = `Analyse ces KPI hôteliers pour la période ${date_debut} au ${date_fin} :
${JSON.stringify(contexte, null, 2)}

Donne une analyse stratégique en JSON.`

    try {
      const reponse = await appelIA(prompt, systemPrompt)
      let parsed
      try {
        parsed = JSON.parse(reponse.replace(/```json|```/g, '').trim())
      } catch {
        parsed = { analyse: reponse, points_forts: [], points_faibles: [], recommandations: [], alerte: null }
      }

      req.log.info({ event: 'ia_analyse', hotel_id: req.hotelId,
        periode: { debut: date_debut, fin: date_fin }, result: 'ok' })

      return reply.send({ source: 'ouwalou_ia', periode: { debut: date_debut, fin: date_fin }, ...parsed })
    } catch (err) {
      req.log.error({ event: 'ia_analyse', hotel_id: req.hotelId,
        err: { message: err.message } }, 'Erreur appel IA analyse')
      return reply.status(503).send({ erreur: 'Service IA temporairement indisponible', detail: err.message })
    }
  })

  // ── POST /ia/prediction — Prédiction sur les 30 prochains jours ───────────
  fastify.post('/prediction', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { nb_jours = 30 } = req.body || {}

    if (nb_jours < 1 || nb_jours > 90)
      return reply.status(400).send({ erreur: 'nb_jours doit être entre 1 et 90' })

    // Données prédictives depuis les vues SQL
    const [projections, saisonnalite, predictif] = await Promise.all([
      fastify.db('v_predictif_projection_30j')
        .where('hotel_id', req.hotelId)
        .where('date_projection', '>=', new Date().toISOString().split('T')[0])
        .orderBy('date_projection').limit(nb_jours),
      fastify.db('v_predictif_saisonnalite')
        .where('hotel_id', req.hotelId)
        .orderBy('date_jour', 'desc').limit(7),
      fastify.db('v_predictif_revpar_7j')
        .where('hotel_id', req.hotelId)
        .orderBy('date_jour', 'desc').limit(14),
    ])

    if (!projections.length)
      return reply.status(404).send({ erreur: 'Données insuffisantes pour la prédiction (min 30 jours d\'historique)' })

    const contexte = {
      projection_occupation: projections.map(p => ({
        date: p.date_projection,
        occ_projetee_pct: p.occ_projetee_pct,
      })),
      revpar_tendance: predictif.slice(0, 3).map(p => ({
        date: p.date_jour, revpar_mm7: p.revpar_mm7, tendance_pct: p.tendance_pct
      })),
    }

    const systemPrompt = `Tu es Ouwalou, IA de revenue management hôtelier africain.
Tu prédis la performance des 30 prochains jours à partir de tendances SQL.
Réponds UNIQUEMENT en JSON :
{ "prediction_globale": string, "occupation_projetee_moy": number, "revpar_projete": number, "risques": string[], "opportunites": string[], "actions_prioritaires": string[] }`

    try {
      const reponse = await appelIA(
        `Prédis la performance sur ${nb_jours} jours avec ces données :\n${JSON.stringify(contexte, null, 2)}`,
        systemPrompt
      )
      let parsed
      try { parsed = JSON.parse(reponse.replace(/```json|```/g, '').trim()) }
      catch { parsed = { prediction_globale: reponse } }

      req.log.info({ event: 'ia_prediction', hotel_id: req.hotelId, nb_jours })

      return reply.send({
        source: 'ouwalou_ia',
        nb_jours,
        donnees_sql: { projections: projections.slice(0, 7) },
        ...parsed,
      })
    } catch (err) {
      req.log.error({ event: 'ia_prediction', hotel_id: req.hotelId, err: { message: err.message } })
      return reply.status(503).send({ erreur: 'Service IA temporairement indisponible' })
    }
  })

  // ── POST /ia/scenario — Simulation + analyse IA ───────────────────────────
  fastify.post('/scenario', {
    preHandler: [...pre, fastify.verifierPermission('analytics.lire')],
  }, async (req, reply) => {
    const { nom, taux_occupation_cible, adr_cible, nb_chambres, nb_jours = 30,
            cout_fixe_journalier = 0, cout_variable_par_nuitee = 0,
            pct_restaurant = 20, pct_services = 5 } = req.body || {}

    if (!taux_occupation_cible || !adr_cible || !nb_chambres)
      return reply.status(400).send({ erreur: 'taux_occupation_cible, adr_cible et nb_chambres requis' })

    if (taux_occupation_cible < 0 || taux_occupation_cible > 100)
      return reply.status(400).send({ erreur: 'taux_occupation_cible doit être entre 0 et 100' })

    // FIX 2 : calcul 100% SQL via v_simulation_resultats
    // INTERDIT : calculs RevPAR / GOP / marges en JS

    // Insérer le scénario temporaire dans simulateur_scenarios
    const [scenarioInsere] = await fastify.db('simulateur_scenarios').insert({
      hotel_id:                req.hotelId,
      nom:                     nom || 'Scénario personnalisé',
      est_defaut:              false,
      taux_occupation_cible:   taux_occupation_cible,
      adr_cible:               adr_cible,
      nb_chambres:             nb_chambres,
      nb_jours:                nb_jours,
      pct_restaurant:          pct_restaurant,
      pct_services:            pct_services,
      cout_fixe_journalier:    cout_fixe_journalier,
      cout_variable_par_nuitee: cout_variable_par_nuitee,
    }).returning('id')

    // Lire les résultats calculés par la vue SQL
    const resultatsSQL = await fastify.db('v_simulation_resultats')
      .where({ scenario_id: scenarioInsere.id })
      .first()

    // Nettoyer le scénario temporaire après lecture
    await fastify.db('simulateur_scenarios')
      .where({ id: scenarioInsere.id, hotel_id: req.hotelId })
      .delete()

    if (!resultatsSQL)
      return reply.status(500).send({ erreur: 'Erreur calcul simulation SQL' })

    const simulation = {
      nom:        resultatsSQL.nom,
      parametres: { taux_occupation_cible, adr_cible, nb_chambres, nb_jours },
      resultats: {
        chambres_occupees_moy: resultatsSQL.chambres_occupees_moy,
        total_nuitees:         resultatsSQL.total_nuitees,
        ca_hebergement:        resultatsSQL.ca_hebergement,
        ca_total:              resultatsSQL.ca_total,
        revpar_moyen_periode:  resultatsSQL.revpar_moyen_periode, // SQL — moyenne sur la période
        couts_totaux:          resultatsSQL.couts_totaux,
        gop_estime:            resultatsSQL.gop_estime,
        marge_gop_pct:         resultatsSQL.marge_gop_pct,
      }
    }

    // Analyse IA du scénario
    const systemPrompt = `Tu es Ouwalou, expert revenue management hôtelier africain.
Tu analyses un scénario de simulation financière.
Réponds en JSON : { "evaluation": string, "faisabilite": "haute"|"moyenne"|"faible", "conseils": string[], "benchmark": string }`

    try {
      const reponse = await appelIA(
        `Analyse ce scénario hôtelier :\n${JSON.stringify(simulation, null, 2)}\nDonne une évaluation stratégique.`,
        systemPrompt
      )
      let parsed
      try { parsed = JSON.parse(reponse.replace(/```json|```/g, '').trim()) }
      catch { parsed = { evaluation: reponse, faisabilite: 'moyenne', conseils: [], benchmark: '' } }

      req.log.info({ event: 'ia_scenario', hotel_id: req.hotelId, nom: simulation.nom })

      return reply.send({ source: 'ouwalou_ia', simulation, analyse_ia: parsed })
    } catch (err) {
      // Retourner la simulation même si l'IA est indisponible
      req.log.warn({ event: 'ia_scenario', hotel_id: req.hotelId, err: { message: err.message } })
      return reply.send({ source: 'ouwalou_ia', simulation, analyse_ia: null,
        avertissement: 'Analyse IA indisponible — résultats de simulation disponibles' })
    }
  })
}
