'use strict'
const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function reportingRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // GET /reporting/magazine?mois=2026-08 — Données agrégées pour le rapport
  fastify.get('/magazine', { preHandler: pre }, async (req, reply) => {
    const { mois } = req.query // format YYYY-MM, défaut = mois courant
    const hotelId = req.hotelId

    // Calculer dateDebut et dateFin à partir de mois
    const [annee, moisNum] = (mois || new Date().toISOString().slice(0, 7)).split('-').map(Number)
    const dateDebut = `${annee}-${String(moisNum).padStart(2, '0')}-01`
    const dateFin   = new Date(annee, moisNum, 0).toISOString().slice(0, 10) // dernier jour du mois

    // Agréger en parallèle
    const [
      statsOccupation,
      statsRevenu,
      statsRestaurant,
      statsMenage,
      statsClients,
      infoHotel,
    ] = await Promise.allSettled([
      // Occupation
      fastify.db('reservations')
        .where({ hotel_id: hotelId })
        .whereBetween('date_arrivee', [dateDebut, dateFin])
        .whereIn('statut', ['arrivee', 'terminee', 'depart_aujourd_hui', 'no_show'])
        .count('id as total_reservations')
        .sum('nombre_nuits as total_nuits')
        .avg('tarif_nuit as tarif_moyen')
        .first(),

      // Revenus folio
      fastify.db('folio_lignes AS fl')
        .join('folios AS f', 'f.id', 'fl.folio_id')
        .join('reservations AS r', 'r.id', 'f.reservation_id')
        .where({ 'r.hotel_id': hotelId, 'fl.sens': 'debit' })
        .whereBetween('fl.cree_le', [dateDebut + 'T00:00:00', dateFin + 'T23:59:59'])
        .groupBy('fl.type_ligne')
        .select('fl.type_ligne', fastify.db.raw('ROUND(SUM(fl.montant)) AS total'))
        .orderBy('total', 'desc'),

      // Restaurant
      fastify.db('commandes_restaurant')
        .where({ hotel_id: hotelId })
        .whereBetween('heure_commande', [dateDebut, dateFin])
        .whereNot('statut', 'annulee')
        .count('id as commandes')
        .sum('total as ca_restaurant')
        .avg('total as panier_moyen')
        .first(),

      // Ménage / services
      fastify.db('demandes_service')
        .where({ hotel_id: hotelId })
        .whereBetween('cree_le', [dateDebut, dateFin])
        .count('id as demandes_total')
        .groupBy('type_service')
        .select('type_service', fastify.db.raw('COUNT(*) AS nb'))
        .orderBy('nb', 'desc')
        .limit(5),

      // Nouveaux clients
      fastify.db('clients')
        .where({ hotel_id: hotelId })
        .whereBetween('cree_le', [dateDebut, dateFin])
        .count('id as nouveaux_clients')
        .first(),

      // Info hôtel
      fastify.db('hotels').where({ id: hotelId }).select('nom', 'ville').first(),
    ])

    const safe = (r) => r.status === 'fulfilled' ? r.value : null

    const data = {
      periode:    { mois, dateDebut, dateFin, annee, moisNum },
      hotel:      safe(infoHotel),
      occupation: safe(statsOccupation),
      revenus:    safe(statsRevenu) || [],
      restaurant: safe(statsRestaurant),
      menage:     safe(statsMenage) || [],
      clients:    safe(statsClients),
    }

    return reply.send({ data })
  })

  // POST /reporting/narratif — Génère le texte narratif via Anthropic
  fastify.post('/narratif', { preHandler: pre }, async (req, reply) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ erreur: 'Clé Anthropic non configurée' })
    }

    const { data, niveau = 'standard' } = req.body // niveau: 'executif' | 'standard' | 'detaille'

    const niveauxPrompt = {
      executif:  'Synthèse très courte (150 mots max). Style direct, 3 points clés, langage décisionnel.',
      standard:  'Synthèse narrative (400 mots max). Structure Quoi/Pourquoi/Implication. Ton analytique mais accessible.',
      detaille:  'Rapport narratif complet (800 mots). Analyse approfondie, comparaison tendances, recommandations.',
    }

    const prompt = `Tu es l'analyste de performance de l'hôtel ${data?.hotel?.nom || 'l\'hôtel'} à ${data?.hotel?.ville || ''}.

Génère un rapport de performance pour la période ${data?.periode?.mois || 'du mois'}.

Données disponibles :
- Réservations : ${JSON.stringify(data?.occupation)}
- Revenus par catégorie : ${JSON.stringify(data?.revenus)}
- Restaurant : ${JSON.stringify(data?.restaurant)}
- Demandes service : ${JSON.stringify(data?.menage)}
- Nouveaux clients : ${JSON.stringify(data?.clients)}

${niveauxPrompt[niveau] || niveauxPrompt.standard}

Format : Rédige directement le texte narratif, sans introduction méta, sans balises markdown.
Structure avec des titres courts en majuscules suivis de paragraphes.
Commence directement par les faits saillants.`

    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const response = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: niveau === 'executif' ? 300 : niveau === 'standard' ? 800 : 1500,
        messages: [{ role: 'user', content: prompt }],
      })
      const narratif = response.content[0]?.text || ''
      return reply.send({ narratif, niveau, tokens: response.usage })
    } catch (err) {
      fastify.log.error({ err }, 'Erreur narratif Anthropic')
      return reply.status(500).send({ erreur: 'Service narratif indisponible' })
    }
  })
}
