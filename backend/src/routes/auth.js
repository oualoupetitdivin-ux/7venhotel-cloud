'use strict'

// FIX : Suppression de zod dans le schema Fastify.
// Fastify attend du JSON Schema standard pour schema.body.
// zod.object() retourne un objet zod incompatible → "data/required must be array"
// La validation manuelle dans le handler remplace la validation de schéma.

module.exports = async function authRoutes(fastify) {

  // ── POST /auth/connexion ──────────────────────────────────────────
  fastify.post('/connexion', async (request, reply) => {
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

    const token = fastify.genererToken(user)
    const tokenRefresh = fastify.genererTokenRafraichissement(user)

    await fastify.cache.set(`refresh:${user.id}`, tokenRefresh, 7 * 24 * 3600)

    const hotel = user.hotel_id ? await fastify.db('hotels')
      .where({ id: user.hotel_id })
      .select('id', 'nom')
      .first() : null

    const paramsHotel = user.hotel_id ? await fastify.db('parametres_hotel')
      .where({ hotel_id: user.hotel_id })
      .select('devise', 'fuseau_horaire', 'langue')
      .first() : null

    reply.send({
      token,
      token_rafraichissement: tokenRefresh,
      utilisateur: {
        id:        user.id,
        email:     user.email,
        prenom:    user.prenom,
        nom:       user.nom,
        role:      user.role,
        avatar_url:user.avatar_url,
        hotel_id:  user.hotel_id,
        tenant_id: user.tenant_id
      },
      hotel: hotel ? {
        id:            hotel.id,
        nom:           hotel.nom,
        devise:        paramsHotel?.devise || 'XAF',
        fuseau_horaire:paramsHotel?.fuseau_horaire || 'Africa/Douala',
        langue:        paramsHotel?.langue || 'fr'
      } : null
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
      reply.send({ token: fastify.genererToken(user) })
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
    await fastify.db('utilisateurs').where({ id: user.id }).update({ mot_de_passe_hash: hash })
    reply.send({ message: 'Mot de passe mis à jour avec succès' })
  })

  // ── POST /auth/client/connexion ───────────────────────────────────
  fastify.post('/client/connexion', async (request, reply) => {
    const { email, mot_de_passe } = request.body || {}
    if (!email || !mot_de_passe) {
      return reply.status(400).send({ erreur: 'Email et mot de passe requis' })
    }
    const client = await fastify.db('clients').where({ email }).where('actif', true).first()
    if (!client || !client.mot_de_passe_hash) {
      return reply.status(401).send({ erreur: 'Identifiants incorrects' })
    }
    const valide = await fastify.verifierMotDePasse(mot_de_passe, client.mot_de_passe_hash)
    if (!valide) return reply.status(401).send({ erreur: 'Identifiants incorrects' })
    await fastify.db('clients').where({ id: client.id }).update({ derniere_connexion: fastify.db.fn.now() })
    const token = fastify.jwt.sign({
      id: client.id, email: client.email, prenom: client.prenom, nom: client.nom,
      type: 'client', hotel_id: client.hotel_id, tenant_id: client.tenant_id
    }, { expiresIn: '30d' })
    reply.send({
      token,
      client: {
        id: client.id, prenom: client.prenom, nom: client.nom, email: client.email,
        segment: client.segment, points_fidelite: client.points_fidelite,
        niveau_fidelite: client.niveau_fidelite
      }
    })
  })
}
