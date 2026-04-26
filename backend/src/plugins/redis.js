'use strict'

const fp = require('fastify-plugin')
const Redis = require('ioredis')

async function redisPlugin(fastify) {
  //
  // FIX #3 — Redis optionnel sur Railway
  //
  // L'ancien code utilisait lazyConnect: false → connexion immédiate au démarrage.
  // Si Redis n'est pas configuré sur Railway (REDIS_HOST absent → localhost),
  // ioredis tente indéfiniment de se connecter et peut bloquer ou crash.
  //
  // Solution :
  //   1. Si REDIS_URL ou REDIS_HOST absent → mode dégradé avec cache en mémoire.
  //   2. Si Redis configuré → lazyConnect: true + ping de validation avant de continuer.
  //   3. Échec Redis ≠ crash : le serveur démarre, le cache est juste désactivé.
  //

  const redisUrl  = process.env.REDIS_URL
  const redisHost = process.env.REDIS_HOST

  // ── Cache no-op (fallback si Redis absent ou en échec) ────────────
const cacheNoOp = {
  async get(key)               { return null  },
  async set(key, value, ttl)   { return true  },
  async del(key)               { return true  },
  async delPattern(pattern)    { return 0     },
  async exists(key)            { return false }
}

// ── Pas de Redis configuré → mode no-op ──────────────────────────
if (!redisUrl && !redisHost) {
  fastify.log.warn('⚠️ Redis non configuré — cache désactivé (mode no-op)')
  fastify.decorate('redis', null)
  fastify.decorate('cache', cacheNoOp)
  return
}

  // ── Pas de Redis configuré → mode mémoire ────────────────────────
  if (!redisUrl && !redisHost) {
    fastify.log.warn('⚠️  Redis non configuré — cache en mémoire activé (non persistant)')
    fastify.decorate('redis', null)
    fastify.decorate('cache', cacheMemoire)
    return
  }

  // ── Redis configuré → connexion avec validation ───────────────────
  let redisConfig

  if (redisUrl) {
    // REDIS_URL = redis://[:password@]host[:port][/db-number]
    redisConfig = {
      lazyConnect: true, // Ne pas se connecter immédiatement
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 3) return null // Abandonner après 3 essais
        return Math.min(times * 200, 1000)
      },
      tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    }
    fastify.log.info('📦 Redis : connexion via REDIS_URL')
  } else {
    redisConfig = {
      host:     redisHost,
      port:     parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db:       parseInt(process.env.REDIS_DB) || 0,
      tls:      process.env.REDIS_TLS === 'true' ? {} : undefined,
      lazyConnect: true,
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 3) return null
        return Math.min(times * 200, 1000)
      },
    }
    fastify.log.info(`📦 Redis : connexion via REDIS_HOST (${redisHost})`)
  }

  const redisInstance = redisUrl
    ? new Redis(redisUrl, redisConfig)
    : new Redis(redisConfig)

  // Essayer de se connecter — si échec, passer en mode mémoire
  try {
    await redisInstance.connect()
    await redisInstance.ping()
    fastify.log.info('✅ Connexion Redis établie')
  } catch (err) {
    fastify.log.warn(`⚠️  Connexion Redis échouée (${err.message}) — cache en mémoire activé`)
    try { redisInstance.disconnect() } catch {}
    fastify.decorate('redis', null)
    fastify.decorate('cache', cacheMemoire)
    return
  }

  redisInstance.on('error', (err) => fastify.log.warn({ err }, '⚠️  Erreur Redis'))
  redisInstance.on('reconnecting', () => fastify.log.info('🔄 Reconnexion Redis...'))

  // ── Helpers cache Redis ───────────────────────────────────────────
  const cacheRedis = {
    async get(key) {
      try {
        const val = await redisInstance.get(key)
        return val ? JSON.parse(val) : null
      } catch { return null }
    },
    async set(key, value, ttlSeconds = 300) {
      try {
        await redisInstance.setex(key, ttlSeconds, JSON.stringify(value))
        return true
      } catch { return false }
    },
    async del(key) {
      try { await redisInstance.del(key); return true } catch { return false }
    },
    async delPattern(pattern) {
      try {
        const keys = await redisInstance.keys(pattern)
        if (keys.length) await redisInstance.del(...keys)
        return keys.length
      } catch { return 0 }
    },
    async exists(key) {
      try { return await redisInstance.exists(key) > 0 } catch { return false }
    }
  }

  fastify.decorate('redis', redisInstance)
  fastify.decorate('cache', cacheRedis)

  fastify.addHook('onClose', async () => {
    try { await redisInstance.quit() } catch {}
    fastify.log.info('Connexion Redis fermée')
  })
}

module.exports = fp(redisPlugin, { name: 'redis', fastify: '4.x' })
