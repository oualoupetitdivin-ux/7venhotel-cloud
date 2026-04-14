'use strict'

const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function aiRoutes(fastify) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── Contexte hôtel pour l'IA ──────────────────────────────────────
  async function getContexteHotel(hotelId) {
    const cacheKey = `ai_ctx:${hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return cached

    const [hotel, analytics, alertes, tickets, tachesOuvertes, commandesActives] = await Promise.all([
      fastify.db('hotels AS h')
        .leftJoin('parametres_hotel AS p', 'p.hotel_id', 'h.id')
        .where('h.id', hotelId)
        .select('h.nom','h.nombre_chambres','p.devise','p.fuseau_horaire')
        .first(),

      fastify.db('analytics_quotidiennes')
        .where({ hotel_id: hotelId })
        .where('date', '>=', fastify.db.raw("CURRENT_DATE - INTERVAL '7 days'"))
        .orderBy('date', 'desc')
        .select('date','taux_occupation','adr','revpar','revenu_total','arrivees','departs'),

      fastify.db('alertes_ia')
        .where({ hotel_id: hotelId, lue: false })
        .orderBy('cree_le', 'desc')
        .limit(10),

      fastify.db('tickets_maintenance')
        .where({ hotel_id: hotelId })
        .whereNotIn('statut', ['resolu','ferme'])
        .orderBy('priorite', 'desc')
        .limit(10)
        .select('numero_ticket','titre','statut','priorite'),

      fastify.db('taches_menage')
        .where({ hotel_id: hotelId })
        .whereNotIn('statut', ['validee'])
        .count('id AS total')
        .first(),

      fastify.db('commandes_restaurant')
        .where({ hotel_id: hotelId })
        .whereNotIn('statut', ['servie','annulee'])
        .count('id AS total')
        .first()
    ])

    const ctx = {
      hotel,
      analytics_7j: analytics,
      alertes_non_lues: alertes.length,
      tickets_ouverts: tickets,
      taches_menage_ouvertes: parseInt(tachesOuvertes?.total || 0),
      commandes_actives: parseInt(commandesActives?.total || 0),
      horodatage: new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala' })
    }

    await fastify.cache.set(cacheKey, ctx, 120) // 2 min
    return ctx
  }

  // ── POST /ai/chat ─────────────────────────────────────────────────
  fastify.post('/chat', { preHandler: pre }, async (request, reply) => {
    const { message, historique = [] } = request.body || {}

    if (!message) return reply.status(400).send({ erreur: 'Message requis' })
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.send({
        reponse: 'Ouwalou AI n\'est pas configuré. Veuillez ajouter votre clé API Anthropic dans la configuration.',
        tokens: 0
      })
    }

    const ctx = await getContexteHotel(request.hotelId)
    const debut = Date.now()

    const systemPrompt = `Tu es Ouwalou, l'assistant IA intelligent de ${ctx.hotel?.nom || 'l\'hôtel'}.
Tu analyses les données hôtelières et fournis des recommandations actionnables en français.

DONNÉES EN TEMPS RÉEL (${ctx.horodatage}) :
- Hôtel : ${ctx.hotel?.nom} (${ctx.hotel?.nombre_chambres} chambres)
- Devise : ${ctx.hotel?.devise || 'XAF'}

ANALYTICS 7 JOURS :
${JSON.stringify(ctx.analytics_7j?.slice(0,3), null, 2)}

SITUATION ACTUELLE :
- Alertes non lues : ${ctx.alertes_non_lues}
- Tickets maintenance ouverts : ${ctx.tickets_ouverts?.length}
- Tâches ménage en attente : ${ctx.taches_menage_ouvertes}
- Commandes restaurant actives : ${ctx.commandes_actives}

TICKETS URGENTS :
${ctx.tickets_ouverts?.filter(t=>t.priorite==='urgente').map(t=>`- ${t.numero_ticket}: ${t.titre} (${t.statut})`).join('\n') || 'Aucun'}

INSTRUCTIONS :
- Réponds toujours en français
- Sois précis, concis et actionnable  
- Utilise des emojis pour la lisibilité
- Cite les données spécifiques quand tu analyses
- Propose des actions concrètes
- Format Markdown autorisé`

    const messages = [
      ...historique.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ]

    try {
      const response = await anthropic.messages.create({
        model:      process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: parseInt(process.env.AI_MAX_TOKENS) || 1000,
        system:     systemPrompt,
        messages
      })

      const reponse = response.content[0].text
      const tokens  = response.usage.input_tokens + response.usage.output_tokens
      const duree   = Date.now() - debut

      // Sauvegarder dans historique
      await fastify.db('historique_ia').insert({
        hotel_id:            request.hotelId,
        utilisateur_id:      request.user.id,
        message_utilisateur: message,
        reponse_ia:          reponse,
        tokens_utilises:     tokens,
        duree_ms:            duree
      })

      reply.send({ reponse, tokens, duree_ms: duree })
    } catch (err) {
      fastify.log.error(err, 'Erreur Anthropic API')
      return reply.status(503).send({
        erreur: 'Service IA temporairement indisponible',
        code: 'IA_INDISPONIBLE'
      })
    }
  })

  // ── POST /ai/analyser ─────────────────────────────────────────────
  fastify.post('/analyser', { preHandler: pre }, async (request, reply) => {
    const { type } = request.body || {}
    const ctx = await getContexteHotel(request.hotelId)

    const prompts = {
      occupation:   `Analyse détaillée du taux d'occupation des 7 derniers jours avec recommandations yield management.`,
      revenus:      `Analyse financière : revenus, ADR, RevPAR. Identifier tendances et optimisations.`,
      menage:       `Performance housekeeping : délais, charge de travail, optimisation planning.`,
      maintenance:  `État maintenance : tickets urgents, temps de résolution, risques opérationnels.`,
      satisfaction: `Analyse satisfaction client basée sur les données disponibles.`,
      previsions:   `Prévisions occupation et revenus 7 prochains jours avec recommandations.`,
    }

    const prompt = prompts[type] || 'Rapport complet de performance hôtelière avec alertes et recommandations prioritaires.'

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.send({ analyse: 'Clé API Anthropic non configurée.' })
    }

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `Tu es Ouwalou AI, assistant hôtelier expert. Données: ${JSON.stringify(ctx)}. Réponds en français avec format Markdown.`,
      messages: [{ role: 'user', content: prompt }]
    })

    reply.send({ analyse: response.content[0].text, contexte: ctx })
  })

  // ── GET /ai/alertes ───────────────────────────────────────────────
  fastify.get('/alertes', { preHandler: pre }, async (request, reply) => {
    const alertes = await fastify.db('alertes_ia')
      .where({ hotel_id: request.hotelId })
      .where('lue', false)
      .orderBy('cree_le', 'desc')
      .limit(20)

    reply.send({ alertes })
  })

  // ── GET /ai/recommandations ───────────────────────────────────────
  fastify.get('/recommandations', { preHandler: pre }, async (request, reply) => {
    const recs = await fastify.db('recommandations_ia')
      .where({ hotel_id: request.hotelId, implementee: false })
      .orderBy('priorite', 'desc')
      .orderBy('cree_le', 'desc')
      .limit(10)

    reply.send({ recommandations: recs })
  })

  // ── PUT /ai/alertes/:id/lire ──────────────────────────────────────
  fastify.put('/alertes/:id/lire', { preHandler: pre }, async (request, reply) => {
    await fastify.db('alertes_ia')
      .where({ id: request.params.id, hotel_id: request.hotelId })
      .update({ lue: true, lue_par: request.user.id, lue_le: fastify.db.fn.now() })

    reply.send({ message: 'Alerte marquée comme lue' })
  })

  // ── GET /ai/previsions ────────────────────────────────────────────
  fastify.get('/previsions', { preHandler: pre }, async (request, reply) => {
    const cacheKey = `previsions:${request.hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    // Calculer prévisions basées sur historique
    const historique = await fastify.db('analytics_quotidiennes')
      .where({ hotel_id: request.hotelId })
      .where('date', '>=', fastify.db.raw("CURRENT_DATE - INTERVAL '30 days'"))
      .orderBy('date', 'desc')

    const moyenneOcc = historique.reduce((s,d) => s + parseFloat(d.taux_occupation), 0) / Math.max(historique.length, 1)
    const moyenneADR = historique.reduce((s,d) => s + parseFloat(d.adr), 0) / Math.max(historique.length, 1)

    const previsions = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.now() + (i+1) * 24 * 60 * 60 * 1000)
      const jourSemaine = date.getDay()
      const estWeekend = jourSemaine === 5 || jourSemaine === 6
      const facteur = estWeekend ? 1.15 : 0.95
      return {
        date: date.toISOString().split('T')[0],
        taux_occupation_prevu: Math.min(Math.round(moyenneOcc * facteur), 99),
        adr_prevu: Math.round(moyenneADR * facteur),
        revenu_prevu: Math.round(moyenneADR * facteur * (moyenneOcc / 100) * 10)
      }
    })

    const result = { previsions, base_calcul: { moyenne_occupation: Math.round(moyenneOcc), moyenne_adr: Math.round(moyenneADR) } }
    await fastify.cache.set(cacheKey, result, 3600)
    reply.send(result)
  })
}
