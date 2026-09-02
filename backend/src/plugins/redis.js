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

  // ── Store in-memory opérationnel (fallback Redis absent / échec connexion) ────
  // Remplace le no-op par un vrai store avec TTL, SADD, PIPELINE.
  // Usage : dev local sans Redis — PAS pour production.
  // Données perdues au redémarrage du processus (comportement attendu en dev).
  function createInMemoryStore() {
    const _store = new Map()   // key → { raw, expires }
    const _sets  = new Map()   // key → Set<string>

    const _expired = (k) => {
      const e = _store.get(k)
      if (!e) return true
      if (e.expires && e.expires < Date.now()) { _store.delete(k); return true }
      return false
    }

    const _setExpired = (k) => {
      const e = _sets.get(k)
      if (!e) return false
      if (e.expires && e.expires < Date.now()) { _sets.delete(k); return true }
      return false
    }

    const store = {
      async get(key) {
        if (_expired(key)) return null
        return _store.get(key).raw
      },
      async set(key, value, ttlSeconds = 300) {
        _store.set(key, { raw: value, expires: Date.now() + ttlSeconds * 1000 })
        return true
      },
      async del(key) {
        _store.delete(key); _sets.delete(key); return true
      },
      async delPattern(pattern) {
        const re = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
        let n = 0
        for (const k of [..._store.keys(), ..._sets.keys()]) {
          if (re.test(k)) { _store.delete(k); _sets.delete(k); n++ }
        }
        return n
      },
      async exists(key) {
        return !_expired(key) && _store.has(key)
      },
      // Redis-compatible ops for session management
      async sadd(key, ...members) {
        if (_setExpired(key)) _sets.delete(key)
        if (!_sets.has(key)) _sets.set(key, { members: new Set(), expires: null })
        members.forEach(m => _sets.get(key).members.add(m))
        return members.length
      },
      async srem(key, ...members) {
        if (_setExpired(key) || !_sets.has(key)) return 0
        let n = 0
        members.forEach(m => { if (_sets.get(key).members.delete(m)) n++ })
        return n
      },
      async smembers(key) {
        if (_setExpired(key) || !_sets.has(key)) return []
        return [..._sets.get(key).members]
      },
      async expire(key, ttlSeconds) {
        const e = _store.get(key)
        if (e) e.expires = Date.now() + ttlSeconds * 1000
        const s = _sets.get(key)
        if (s) s.expires = Date.now() + ttlSeconds * 1000
        return 1
      },
      async expireat(key, unixTs) {
        const ms = unixTs * 1000
        const e  = _store.get(key); if (e) e.expires = ms
        const s  = _sets.get(key);  if (s) s.expires = ms
        return 1
      },
      async incrBy(key, delta) {
        const current = _expired(key) ? 0 : (_store.get(key)?.raw || 0)
        const next    = current + delta
        _store.set(key, { raw: next, expires: _store.get(key)?.expires || null })
        return next
      },
      // Pipeline : accumule des commandes puis les exécute en batch sur exec()
      pipeline() {
        const ops = []
        const self = store
        const pipe = {
          del:    (...args) => { ops.push(['del',    args]); return pipe },
          set:    (...args) => { ops.push(['set',    args]); return pipe },
          get:    (...args) => { ops.push(['get',    args]); return pipe },
          sadd:   (...args) => { ops.push(['sadd',   args]); return pipe },
          srem:   (...args) => { ops.push(['srem',   args]); return pipe },
          expire: (...args) => { ops.push(['expire', args]); return pipe },
          exec:   ()        => Promise.all(ops.map(([method, args]) => self[method]?.(...args) || Promise.resolve(null))),
        }
        return pipe
      },
      // SCAN itératif (simplifié — retourne tout en une passe pour le store mémoire)
      async scan(cursor, _MATCH, pattern, _COUNT, _count) {
        if (cursor !== '0') return ['0', []]
        const re   = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
        const keys = [..._store.keys(), ..._sets.keys()].filter(k => re.test(k))
        return ['0', [...new Set(keys)]]
      },
      _type: 'memory',
    }
    return store
  }

  const cacheNoOp = createInMemoryStore()   // renommé : c'est maintenant opérationnel

  // ── Pas de Redis configuré → store in-memory ─────────────────────
  //
  // GUARD PRODUCTION : si ALLOW_INMEMORY_CACHE n'est pas explicitement 'true'
  // en production, le serveur refuse de démarrer sans Redis.
  // Pourquoi : le cache mémoire ne se partage pas entre instances (multi-pod Railway),
  // les sessions révocables perdent leur état au redémarrage, et les quotas ne
  // sont plus cohérents. Dangereux en production sans que personne ne s'en rende compte.
  //
  // Pour activer volontairement en production (environnements mono-instance) :
  //   ALLOW_INMEMORY_CACHE=true
  //
  if (!redisUrl && !redisHost) {
    const estProduction = process.env.NODE_ENV === 'production'
    const autoriseMemoire = process.env.ALLOW_INMEMORY_CACHE === 'true'

    if (estProduction && !autoriseMemoire) {
      console.error('\n╔══════════════════════════════════════════════════════════════════╗')
      console.error('║  ❌  Redis manquant en production — démarrage bloqué             ║')
      console.error('╚══════════════════════════════════════════════════════════════════╝')
      console.error('\n  REDIS_URL ou REDIS_HOST absent en NODE_ENV=production.')
      console.error('  Le cache mémoire en production est interdit (sessions, quotas).')
      console.error('\n  Solutions :')
      console.error('    1. Attacher Redis à Railway (plugin Redis → REDIS_URL auto-injecté)')
      console.error('    2. Ou définir ALLOW_INMEMORY_CACHE=true (mono-instance seulement)\n')
      process.exit(1)
    }

    fastify.log.warn('⚠️ Redis non configuré — store in-memory local activé (données non persistantes, dev uniquement)')
    fastify.decorate('redis', null)
    fastify.decorate('cache', cacheNoOp)
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

  // Absorber les erreurs avant le connect() pour éviter les "Unhandled error event" ioredis
  redisInstance.on('error', () => {})

  // Essayer de se connecter — si échec, passer en mode no-op
  try {
    await redisInstance.connect()
    await redisInstance.ping()
    fastify.log.info('✅ Connexion Redis établie')
  } catch (err) {
    fastify.log.warn(`⚠️  Connexion Redis échouée (${err.message}) — store in-memory local activé`)
    try { redisInstance.disconnect() } catch {}
    fastify.decorate('redis', null)
    fastify.decorate('cache', createInMemoryStore())
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
      // KEYS bloque Redis O(N) — SCAN est non-bloquant, itératif
      try {
        let cursor = '0'
        let deleted = 0
        do {
          const [next, keys] = await redisInstance.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
          cursor = next
          if (keys.length) {
            await redisInstance.del(...keys)
            deleted += keys.length
          }
        } while (cursor !== '0')
        return deleted
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
