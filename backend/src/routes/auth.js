'use strict'

// FIX : Suppression de zod dans le schema Fastify.
// Fastify attend du JSON Schema standard pour schema.body.
// zod.object() retourne un objet zod incompatible → "data/required must be array"
// La validation manuelle dans le handler remplace la validation de schéma.

module.exports = async function authRoutes(fastify) {
  const cleConnexion = (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase().trim()}`

  // ── POST /auth/connexion ──────────────────────────────────────────
  // Rate limit strict : 10 tentatives / 15 min par IP (anti brute-force)
  fastify.post('/connexion', {
    config: {
      rateLimit: { max: 10, timeWindow: '15 minutes', hook: 'preHandler', keyGenerator: cleConnexion }
    }
  }, async (request, reply) => {
    const { email, mot_de_passe } = request.body || {}

    if (!email || !mot_de_passe) {
      return reply.status(400).send({ erreur: 'Email et mot de passe requis', code: 'DONNEES_MANQUANTES' })
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return reply.status(400).send({ erreur: 'Email invalide', code: 'EMAIL_INVALIDE' })
    }
    if (mot_de_passe.length < 6) {
      return reply.status(400).send({ erreur: 'Mot de passe trop court', code: 'MDP_TROP_COURT' })
    }

    const user = await fastify.db('utilisateurs')
      .where({ email: email.toLowerCase().trim() })
      .where('actif', true)
      .first()

    if (!user) {
      return reply.status(401).send({ erreur: 'Identifiants incorrects', code: 'IDENTIFIANTS_INVALIDES' })
    }

    const mdpValide = await fastify.verifierMotDePasse(mot_de_passe, user.mot_de_passe_hash)
    if (!mdpValide) {
      return reply.status(401).send({ erreur: 'Identifiants incorrects', code: 'IDENTIFIANTS_INVALIDES' })
    }

    await fastify.db('utilisateurs').where({ id: user.id }).update({
      derniere_connexion: fastify.db.fn.now()
    })

    const token        = fastify.genererToken(user)
    const tokenRefresh = fastify.genererTokenRafraichissement(user)

    await fastify.cache.set(`refresh:${user.id}`, tokenRefresh, 7 * 24 * 3600)

    // Créer la session révocable (Redis + DB) — non-bloquant si échoue
    await fastify.creerSession(user, token, request.ip, request.headers['user-agent'])

    const hotel = user.hotel_id ? await fastify.db('hotels')
      .where({ id: user.hotel_id })
      .select('id', 'nom')
      .first() : null

    const paramsHotel = user.hotel_id ? await fastify.db('parametres_hotel')
      .where({ hotel_id: user.hotel_id })
      .select('devise', 'fuseau_horaire', 'langue')
      .first() : null

    request.log.info({ user_id: user.id, role: user.role }, 'CONNEXION réussie')

    reply.send({
      token,
      token_rafraichissement: tokenRefresh,
      utilisateur: {
        id:               user.id,
        email:            user.email,
        prenom:           user.prenom,
        nom:              user.nom,
        role:             user.role,
        avatar_url:       user.avatar_url,
        hotel_id:         user.hotel_id,
        tenant_id:        user.tenant_id,
        doit_changer_mdp: user.doit_changer_mdp === true,
      },
      hotel: hotel ? {
        id:            hotel.id,
        nom:           hotel.nom,
        devise:        paramsHotel?.devise || 'XAF',
        fuseau_horaire:paramsHotel?.fuseau_horaire || 'Africa/Douala',
        langue:        paramsHotel?.langue || 'fr',
      } : null,
    })
  })

  // ── POST /auth/rafraichir ─────────────────────────────────────────
  fastify.post('/rafraichir', async (request, reply) => {
    const { token_rafraichissement } = request.body || {}
    if (!token_rafraichissement) {
      return reply.status(400).send({ erreur: 'Token de rafraîchissement manquant' })
    }
    try {
      const payload = fastify.jwt.verify(token_rafraichissement, { key: process.env.JWT_REFRESH_SECRET })
      const user = await fastify.db('utilisateurs').where({ id: payload.id, actif: true }).first()
      if (!user) return reply.status(401).send({ erreur: 'Utilisateur introuvable' })
      const newToken = fastify.genererToken(user)
      // Créer la session révocable pour le nouveau token (même logique que le login)
      await fastify.creerSession(user, newToken, request.ip, request.headers['user-agent'])
      reply.send({ token: newToken })
    } catch {
      return reply.status(401).send({ erreur: 'Token de rafraîchissement invalide' })
    }
  })

  // ── GET /auth/moi ─────────────────────────────────────────────────
  fastify.get('/moi', { preHandler: [fastify.authentifier] }, async (request, reply) => {
    const user = await fastify.db('utilisateurs')
      .where({ id: request.user.id })
      .select('id','email','prenom','nom','role','avatar_url','hotel_id','tenant_id','langue_preferee')
      .first()
    if (!user) return reply.status(404).send({ erreur: 'Utilisateur introuvable' })
    reply.send({ utilisateur: user })
  })

  // ── POST /auth/deconnexion ────────────────────────────────────────
  fastify.post('/deconnexion', { preHandler: [fastify.authentifier] }, async (request, reply) => {
    await fastify.cache.del(`refresh:${request.user.id}`)

    // Révoquer la session individuelle (Redis + DB)
    if (request.user.jti) {
      await fastify.revoquerSession(request.user.jti, request.user.tenant_id)
    }

    request.log.info({ user_id: request.user.id }, 'DECONNEXION')
    reply.send({ message: 'Déconnecté avec succès' })
  })

  // ── POST /auth/changer-mot-de-passe ──────────────────────────────
  fastify.post('/changer-mot-de-passe', { preHandler: [fastify.authentifier] }, async (request, reply) => {
    const { ancien_mdp, nouveau_mdp } = request.body || {}
    if (!ancien_mdp || !nouveau_mdp) {
      return reply.status(400).send({ erreur: 'Données manquantes' })
    }
    if (nouveau_mdp.length < 8) {
      return reply.status(400).send({ erreur: 'Le nouveau mot de passe doit faire au moins 8 caractères' })
    }
    const user = await fastify.db('utilisateurs').where({ id: request.user.id }).first()
    const valide = await fastify.verifierMotDePasse(ancien_mdp, user.mot_de_passe_hash)
    if (!valide) return reply.status(401).send({ erreur: 'Ancien mot de passe incorrect' })
    const hash = await fastify.hashMotDePasse(nouveau_mdp)
    await fastify.db('utilisateurs').where({ id: user.id }).update({
      mot_de_passe_hash: hash,
      doit_changer_mdp:  false,
    })
    reply.send({ message: 'Mot de passe mis à jour avec succès' })
  })

  // ── POST /auth/client/connexion ───────────────────────────────────
  // LOT-GUEST-01 :
  //   • un fiche client existe PAR HÔTEL (même email possible dans plusieurs tenants) :
  //     l'ancien .first() prenait une fiche arbitraire. On vérifie le mot de passe sur
  //     chaque fiche candidate ; plusieurs correspondances → hotel_slug requis.
  //   • jeton signé avec la clé CLIENT (utils/jetonClient) — refusé par l'auth staff.
  //   • rate-limit identique à la connexion staff.
  fastify.post('/client/connexion', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes', hook: 'preHandler', keyGenerator: cleConnexion } },
  }, async (request, reply) => {
    const { email, mot_de_passe, hotel_slug } = request.body || {}
    if (!email || !mot_de_passe) {
      return reply.status(400).send({ erreur: 'Email et mot de passe requis' })
    }
    const q = fastify.db('clients AS c')
      .join('hotels AS h', 'h.id', 'c.hotel_id')
      .whereRaw('LOWER(c.email) = LOWER(?)', [String(email).trim()])
      .where('c.actif', true)
      .whereNotNull('c.mot_de_passe_hash')
      .select('c.*', 'h.slug AS hotel_slug', 'h.tenant_id AS hotel_tenant_id')
    if (hotel_slug) q.where('h.slug', hotel_slug)
    const candidats = await q

    const valides = []
    for (const c of candidats) {
      if (await fastify.verifierMotDePasse(mot_de_passe, c.mot_de_passe_hash)) valides.push(c)
    }
    if (valides.length === 0) return reply.status(401).send({ erreur: 'Identifiants incorrects' })
    if (valides.length > 1) {
      return reply.status(409).send({
        erreur: 'Ce compte existe dans plusieurs hôtels — précisez l\'hôtel',
        code:   'HOTEL_REQUIS',
        hotels: valides.map(c => c.hotel_slug),
      })
    }
    const client = valides[0]
    await fastify.db('clients').where({ id: client.id, hotel_id: client.hotel_id }).update({ derniere_connexion: fastify.db.fn.now() })
    const token = require('../utils/jetonClient').signerJetonClient(fastify, client, { id: client.hotel_id, tenant_id: client.hotel_tenant_id })
    reply.send({
      token,
      client: {
        id: client.id, prenom: client.prenom, nom: client.nom, email: client.email,
        segment: client.segment, points_fidelite: client.points_fidelite,
        niveau_fidelite: client.niveau_fidelite,
        hotel_slug: client.hotel_slug
      }
    })
  })
}
