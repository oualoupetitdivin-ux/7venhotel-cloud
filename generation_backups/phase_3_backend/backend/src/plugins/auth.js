'use strict'

const fp = require('fastify-plugin')
const bcrypt = require('bcryptjs')

async function authPlugin(fastify) {

  // ── Vérification JWT ──────────────────────────────────────────────
  fastify.decorate('authentifier', async function(request, reply) {
    try {
      await request.jwtVerify()
    } catch (err) {
      return reply.status(401).send({
        erreur: 'Non authentifié',
        message: 'Token JWT invalide ou expiré',
        code: 'TOKEN_INVALIDE'
      })
    }
  })

  // ── Vérification rôle ─────────────────────────────────────────────
  fastify.decorate('verifierRole', function(rolesAutorises) {
    return async function(request, reply) {
      const user = request.user
      if (!user) {
        return reply.status(401).send({ erreur: 'Non authentifié', code: 'NON_AUTHENTIFIE' })
      }
      if (!rolesAutorises.includes(user.role)) {
        return reply.status(403).send({
          erreur: 'Accès refusé',
          message: `Rôle requis : ${rolesAutorises.join(' ou ')}`,
          code: 'ACCES_REFUSE'
        })
      }
    }
  })

  // ── Vérification permission ───────────────────────────────────────
  fastify.decorate('verifierPermission', function(permissionCode) {
    return async function(request, reply) {
      const user = request.user
      if (!user) return reply.status(401).send({ erreur: 'Non authentifié', code: 'NON_AUTHENTIFIE' })

      const cacheKey = `perms:${user.role}`
      let permissions = await fastify.cache.get(cacheKey)

      if (!permissions) {
        const rows = await fastify.db('role_permissions AS rp')
          .join('permissions AS p', 'p.id', 'rp.permission_id')
          .where('rp.role', user.role)
          .select('p.code')
        permissions = rows.map(r => r.code)
        await fastify.cache.set(cacheKey, permissions, 3600) // 1h cache
      }

      if (!permissions.includes(permissionCode) && user.role !== 'super_admin') {
        return reply.status(403).send({
          erreur: 'Permission insuffisante',
          message: `Permission requise : ${permissionCode}`,
          code: 'PERMISSION_INSUFFISANTE'
        })
      }
    }
  })

  // ── Contexte hôtel ────────────────────────────────────────────────
  fastify.decorate('contexteHotel', async function(request, reply) {
    const user = request.user
    const hotelId = request.headers['x-hotel-id'] || user?.hotel_id

    if (!hotelId) {
      return reply.status(400).send({
        erreur: 'Hôtel non spécifié',
        message: 'En-tête X-Hotel-ID requis',
        code: 'HOTEL_MANQUANT'
      })
    }

    // Vérifier que l'utilisateur appartient bien à ce tenant/hôtel
    if (user.role !== 'super_admin') {
      const hotel = await fastify.db('hotels')
        .where({ id: hotelId, tenant_id: user.tenant_id })
        .first()

      if (!hotel) {
        return reply.status(403).send({
          erreur: 'Accès refusé',
          message: 'Vous n\'avez pas accès à cet hôtel',
          code: 'HOTEL_ACCES_REFUSE'
        })
      }
    }

    request.hotelId = hotelId
    request.tenantId = user.tenant_id
  })

  // ── Utilitaires auth ──────────────────────────────────────────────
  fastify.decorate('hashMotDePasse', async (mdp) => {
    return bcrypt.hash(mdp, parseInt(process.env.BCRYPT_ROUNDS) || 12)
  })

  fastify.decorate('verifierMotDePasse', async (mdp, hash) => {
    return bcrypt.compare(mdp, hash)
  })

  fastify.decorate('genererToken', function(payload) {
    return fastify.jwt.sign({
      id:        payload.id,
      email:     payload.email,
      role:      payload.role,
      tenant_id: payload.tenant_id,
      hotel_id:  payload.hotel_id,
      prenom:    payload.prenom,
      nom:       payload.nom
    })
  })

  fastify.decorate('genererTokenRafraichissement', function(payload) {
    return fastify.jwt.sign(
      { id: payload.id, type: 'refresh' },
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d', key: process.env.JWT_REFRESH_SECRET }
    )
  })
}

module.exports = fp(authPlugin, { name: 'auth', fastify: '4.x' })
