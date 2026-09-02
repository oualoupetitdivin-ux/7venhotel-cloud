'use strict'

const fp             = require('fastify-plugin')
const bcrypt         = require('bcryptjs')
const { randomUUID } = require('crypto')

async function authPlugin(fastify) {

  // ── Vérification JWT + session révocable ─────────────────────────
  fastify.decorate('authentifier', async function(request, reply) {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({
        erreur: 'Non authentifié',
        message: 'Token JWT invalide ou expiré',
        code:    'TOKEN_INVALIDE',
      })
    }

    // Enrichir le logger de la request avec le contexte utilisateur.
    // Tous les request.log.info() suivants incluent automatiquement ces champs.
    request.log = request.log.child({
      user_id:   request.user.id,
      tenant_id: request.user.tenant_id || 'platform',
      scope:     request.user.scope,
      role:      request.user.role,
    })

    // Vérification session révocable.
    // S'applique si le token a un jti (tous les tokens émis après Layer 1).
    // Le store cache est toujours disponible (Redis ou in-memory — jamais no-op).
    // Les tokens legacy sans jti passent sans vérification (backward compat).
    const jti = request.user.jti
    if (jti) {
      let sessionData = await fastify.cache.get(`session:${jti}`)

      if (sessionData === null) {
        // Cache miss : peut être un redémarrage serveur (cache in-memory vidé).
        // Fallback DB : vérifier si la session existe et n'est pas révoquée.
        try {
          const dbSession = await fastify.db('sessions_actives')
            .where({ jti })
            .whereNull('revoque_le')
            .where('expire_le', '>', fastify.db.fn.now())
            .first()

          if (!dbSession) {
            request.log.warn({ jti }, 'SESSION_REVOQUEE — absente du cache et de la DB')
            return reply.status(401).send({
              erreur: 'Session révoquée ou expirée',
              code:   'SESSION_REVOQUEE',
            })
          }

          // Session valide en DB → reconstruire le cache pour les prochaines requêtes
          sessionData = { user_id: dbSession.utilisateur_id, tenant_id: dbSession.tenant_id, scope: dbSession.scope, role: dbSession.role }
          const ttl = Math.max(1, Math.floor((new Date(dbSession.expire_le).getTime() - Date.now()) / 1000))
          await fastify.cache.set(`session:${jti}`, sessionData, ttl).catch(() => {})
          request.log.info({ jti }, 'SESSION_RESTAUREE — cache reconstruit depuis DB')
        } catch (err) {
          // Erreur DB inattendue : refuser par sécurité
          request.log.error({ err: err.message, jti }, 'Erreur vérification session DB')
          return reply.status(401).send({ erreur: 'Session révoquée ou expirée', code: 'SESSION_REVOQUEE' })
        }
      }
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

  // ── Contexte tenant (routes gestion sans hotel fixé — utilisateurs, etc.) ──
  // Pour super_admin : lit X-Tenant-ID header (drill-down). Obligatoire.
  // Pour autres rôles : utilise req.user.tenant_id du JWT.
  fastify.decorate('resolveTenantContext', async function(request, reply) {
    const user = request.user
    if (user.scope === 'platform') {
      const tenantId = request.headers['x-tenant-id']
      if (!tenantId) {
        return reply.status(400).send({
          erreur: 'En-tête X-Tenant-ID requis pour l\'opérateur plateforme',
          code: 'TENANT_MANQUANT',
        })
      }
      const tenant = await fastify.db('tenants').where({ id: tenantId }).first()
      if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })
      request.tenantId = tenantId
    } else {
      request.tenantId = user.tenant_id
    }
  })

  // ── Garde plateforme (routes /platform/* — super_admin uniquement) ──
  fastify.decorate('scopePlateforme', async function(request, reply) {
    const user = request.user
    if (!user || user.scope !== 'platform') {
      return reply.status(403).send({
        erreur: 'Accès réservé à l\'opérateur plateforme',
        code: 'SCOPE_PLATEFORME_REQUIS'
      })
    }
    // Drill-down optionnel : tenant/hôtel passés en header pour inspection
    request.drillTenantId = request.headers['x-tenant-id'] || null
    request.drillHotelId  = request.headers['x-hotel-id']  || null
  })

  // ── Contexte hôtel (routes exploitation — tous rôles sauf platform) ─
  fastify.decorate('contexteHotel', async function(request, reply) {
    const user = request.user

    // super_admin en mode plateforme n'a pas de hotel_id dans son JWT.
    // Pour qu'il puisse tester les routes exploitation, il doit passer X-Hotel-ID.
    // Les routes /platform/* utilisent scopePlateforme, pas contexteHotel.
    const hotelId = request.headers['x-hotel-id'] || user?.hotel_id

    if (!hotelId) {
      return reply.status(400).send({
        erreur: 'Hôtel non spécifié',
        message: 'En-tête X-Hotel-ID requis',
        code: 'HOTEL_MANQUANT'
      })
    }

    if (user.scope === 'platform') {
      // super_admin en drill-down : vérifie que l'hôtel existe (sans contrainte tenant)
      const hotel = await fastify.db('hotels').where({ id: hotelId }).first()
      if (!hotel) {
        return reply.status(404).send({ erreur: 'Hôtel introuvable', code: 'HOTEL_INTROUVABLE' })
      }
      request.hotelId  = hotelId
      request.tenantId = hotel.tenant_id
    } else {
      // Rôles exploitation : l'hôtel doit appartenir au tenant de l'utilisateur
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
      request.hotelId  = hotelId
      request.tenantId = user.tenant_id
    }
  })

  // ── Utilitaires auth ──────────────────────────────────────────────
  fastify.decorate('hashMotDePasse', async (mdp) => {
    return bcrypt.hash(mdp, parseInt(process.env.BCRYPT_ROUNDS) || 12)
  })

  fastify.decorate('verifierMotDePasse', async (mdp, hash) => {
    return bcrypt.compare(mdp, hash)
  })

  fastify.decorate('genererToken', function(user) {
    const isPlatform = user.role === 'super_admin'
    const jti        = randomUUID()   // identifiant unique de session — permet la révocation
    return fastify.jwt.sign({
      id:        user.id,
      email:     user.email,
      role:      user.role,
      scope:     isPlatform ? 'platform' : 'hotel',
      tenant_id: isPlatform ? null : user.tenant_id,
      hotel_id:  isPlatform ? null : user.hotel_id,
      prenom:    user.prenom,
      nom:       user.nom,
      jti,                            // JWT ID — clé de corrélation Redis
    })
  })

  fastify.decorate('genererTokenRafraichissement', function(payload) {
    return fastify.jwt.sign(
      { id: payload.id, type: 'refresh' },
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d', key: process.env.JWT_REFRESH_SECRET }
    )
  })

  // ── Helpers de gestion des sessions révocables ────────────────────

  /**
   * Crée une session dans Redis + DB après un login réussi.
   * Ne jamais faire échouer le login si cette opération échoue.
   */
  fastify.decorate('creerSession', async function(user, token, ip, userAgent) {
    try {
      const decoded = fastify.jwt.decode(token)
      if (!decoded?.jti || !decoded?.exp) return

      const { jti, exp, scope, role } = decoded
      const ttl = Math.max(1, Math.floor(exp - Date.now() / 1000))

      // Redis : fast-path pour vérification à chaque request
      await fastify.cache.set(`session:${jti}`, {
        user_id:   user.id,
        tenant_id: user.tenant_id || null,
        scope,
        role,
      }, ttl)

      // Index tenant → sessions pour invalidation en masse lors de suspension.
      // IMPORTANT: utiliser le tenant_id du JWT (decoded.tenant_id), PAS user.tenant_id (DB).
      // Pour scope='platform', decoded.tenant_id est null → session non indexée par tenant.
      // Cela empêche la révocation accidentelle de la session SA lors d'une suspension tenant.
      const sessionTenantId = decoded.tenant_id || null
      if (sessionTenantId) {
        await fastify.cache.sadd(`tenant:${sessionTenantId}:sessions`, jti)
        await fastify.cache.expire(`tenant:${sessionTenantId}:sessions`, ttl + 3600)
      }

      // DB : source de vérité + audit trail
      await fastify.db('sessions_actives').insert({
        jti,
        utilisateur_id: user.id,
        tenant_id:      user.tenant_id || null,
        scope,
        role,
        ip_address:     ip   || null,
        user_agent:     (userAgent || '').slice(0, 255) || null,
        expire_le:      new Date(exp * 1000).toISOString(),
      }).onConflict('jti').ignore()  // idempotent si appelé deux fois

    } catch (err) {
      // Jamais bloquer le login pour une erreur de session tracking
      fastify.log.warn({ err: err.message }, 'creerSession: échec non-critique — login continue')
    }
  })

  /**
   * Révoque une session individuelle (logout).
   */
  fastify.decorate('revoquerSession', async function(jti, tenantId) {
    if (!jti) return
    try {
      await fastify.cache.del(`session:${jti}`)
      if (tenantId && fastify.redis) {
        await fastify.redis.srem(`tenant:${tenantId}:sessions`, jti)
      }
      await fastify.db('sessions_actives')
        .where({ jti })
        .update({ revoque_le: fastify.db.fn.now() })
        .catch(() => {})
    } catch (err) {
      fastify.log.warn({ err: err.message, jti }, 'revoquerSession: erreur non-critique')
    }
  })

  /**
   * Révoque toutes les sessions d'un tenant (suspension, résiliation).
   * Invariant: appel synchrone — les sessions doivent être coupées avant le return.
   */
  fastify.decorate('revoquerSessionsTenant', async function(tenantId) {
    if (!tenantId) return 0
    let revoked = 0
    try {
      // Récupérer tous les jti actifs pour ce tenant via le cache (Redis ou in-memory)
      const jtis = await fastify.cache.smembers(`tenant:${tenantId}:sessions`)
      if (jtis?.length) {
        // Supprimer chaque session en pipeline
        const pipeline = fastify.cache.pipeline()
        for (const jti of jtis) pipeline.del(`session:${jti}`)
        pipeline.del(`tenant:${tenantId}:sessions`)
        await pipeline.exec()
        revoked = jtis.length
      }

      // Marquer comme révoquées en DB (audit trail)
      await fastify.db('sessions_actives')
        .where({ tenant_id: tenantId })
        .whereNull('revoque_le')
        .update({ revoque_le: fastify.db.fn.now() })
        .catch(() => {})

    } catch (err) {
      fastify.log.error({ err: err.message, tenantId }, 'revoquerSessionsTenant: erreur critique')
    }
    return revoked
  })
}

module.exports = fp(authPlugin, { name: 'auth', fastify: '4.x' })
