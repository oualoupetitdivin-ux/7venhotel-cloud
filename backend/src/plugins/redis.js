'use strict'

const fp = require('fastify-plugin')
const Redis = require('ioredis')

async function redisPlugin(fastify) {
  const redis = new Redis({
    host:     process.env.REDIS_HOST     || 'localhost',
    port:     parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db:       parseInt(process.env.REDIS_DB) || 0,
    tls:      process.env.REDIS_TLS === 'true' ? {} : undefined,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000)
      return delay
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false
  })

  redis.on('connect',   () => fastify.log.info('✅ Connexion Redis établie'))
  redis.on('error',     (err) => fastify.log.warn({ err }, '⚠️ Erreur Redis'))
  redis.on('reconnecting', () => fastify.log.info('🔄 Reconnexion Redis...'))

  // Helpers cache
  const cache = {
    async get(key) {
      try {
        const val = await redis.get(key)
        return val ? JSON.parse(val) : null
      } catch { return null }
    },
    async set(key, value, ttlSeconds = 300) {
      try {
        await redis.setex(key, ttlSeconds, JSON.stringify(value))
        return true
      } catch { return false }
    },
    async del(key) {
      try { await redis.del(key); return true } catch { return false }
    },
    async delPattern(pattern) {
      try {
        const keys = await redis.keys(pattern)
        if (keys.length) await redis.del(...keys)
        return keys.length
      } catch { return 0 }
    },
    async exists(key) {
      try { return await redis.exists(key) > 0 } catch { return false }
    }
  }

  fastify.decorate('redis', redis)
  fastify.decorate('cache', cache)

  fastify.addHook('onClose', async () => {
    await redis.quit()
    fastify.log.info('Connexion Redis fermée')
  })
}

module.exports = fp(redisPlugin, { name: 'redis', fastify: '4.x' })
