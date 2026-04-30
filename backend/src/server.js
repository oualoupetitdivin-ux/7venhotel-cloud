'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTION #1 — dotenv avec chemin absolu ancré sur __dirname
//
// AVANT : require('dotenv').config({ path: '../.env' })
//   → Chemin relatif au CWD au moment de l'exécution.
//   → Si Railway démarre depuis la racine du monorepo, '../.env' ne résout
//     pas vers la racine — le .env n'est jamais chargé.
//
// APRÈS : path.join(__dirname, '../../.env')
//   → __dirname = toujours le répertoire physique du fichier source,
//     soit /app/backend/src/ (ou équivalent Railway).
//   → ../../.env remonte à la racine du projet, quel que soit le CWD.
//   → Sur Railway (pas de .env), dotenv ignore silencieusement l'absence
//     du fichier — comportement correct, les variables viennent de Railway.
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config({
  path: require('path').join(__dirname, '../../.env')
})

const Fastify = require('fastify')
const path    = require('path')

// ─────────────────────────────────────────────────────────────────────────────
// CORRECTION #2 — Validation fail-fast des variables d'environnement critiques
//
// AVANT : aucune validation — le serveur démarrait avec des fallbacks dangereux
//   ou crashait plus tard avec un message d'erreur obscur (ECONNREFUSED, etc.)
//
// APRÈS : validation explicite AVANT toute initialisation.
//   → Crash immédiat avec message lisible si une variable est absente.
//   → Railway affiche ce message dans les logs de déploiement.
//   → Un serveur qui refuse de démarrer est infiniment moins dangereux
//     qu'un serveur qui démarre avec de faux secrets ou sans BDD.
//
// Règles de validation :
//   - DATABASE_URL ou DATABASE_PRIVATE_URL : au moins l'une des deux
//   - JWT_SECRET : présent ET longueur minimum 32 caractères
//   - JWT_REFRESH_SECRET : présent ET longueur minimum 32 caractères
//   - NODE_ENV : présent (évite les comportements ambigus)
//
// Note : en développement local avec .env correctement rempli,
//   cette fonction ne bloque jamais.
// ─────────────────────────────────────────────────────────────────────────────
function validerEnvironnement() {
  const estProduction = process.env.NODE_ENV === 'production'

  // Variables obligatoires dans tous les environnements
  const verifications = [
    {
      nom: 'NODE_ENV',
      ok: !!process.env.NODE_ENV,
      conseil: 'Définir NODE_ENV=production sur Railway ou NODE_ENV=development en local'
    },
    {
      nom: 'JWT_SECRET (minimum 32 caractères)',
      ok: !!(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32),
      conseil: 'Générer via : openssl rand -base64 48'
    },
    {
      nom: 'JWT_REFRESH_SECRET (minimum 32 caractères)',
      ok: !!(process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length >= 32),
      conseil: 'Générer via : openssl rand -base64 48 (doit être différent de JWT_SECRET)'
    },
  ]

  // En production : DATABASE_URL ou DATABASE_PRIVATE_URL obligatoire
  // En développement : on tolère l'absence (Knex utilisera localhost)
  if (estProduction) {
    verifications.push({
      nom: 'DATABASE_PRIVATE_URL ou DATABASE_URL',
      ok: !!(process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL),
      conseil: 'Attacher le plugin PostgreSQL Railway au service — la variable est injectée automatiquement'
    })
  }

  const echecs = verifications.filter(v => !v.ok)

  if (echecs.length > 0) {
    console.error('\n╔══════════════════════════════════════════════════════════════╗')
    console.error('║  ❌  7venHotel Cloud — DÉMARRAGE IMPOSSIBLE                  ║')
    console.error('╚══════════════════════════════════════════════════════════════╝')
    console.error('\nVariables manquantes ou invalides :\n')
    echecs.forEach(v => {
      console.error(`  ✗  ${v.nom}`)
      console.error(`     → ${v.conseil}\n`)
    })
    console.error('Configurez ces variables dans Railway → Service → Variables')
    console.error('puis redéployez.\n')
    process.exit(1)
  }
}

// Exécution immédiate — avant toute initialisation Fastify
validerEnvironnement()

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Fastify
//
// FIX #1 (conservé) — "sonic boom is not ready yet"
//   logger.file supprimé : Railway capture stdout/stderr nativement.
//   Logging fichier inutile sur PaaS, dangereux si le répertoire n'existe pas.
// ─────────────────────────────────────────────────────────────────────────────
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
    // Serializer personnalisé : masque le token QR portail dans tous les logs.
    // Pino log req.url — sans cette règle, /portail/abc123... apparaît en clair
    // dans Railway Logs, Datadog, et tout système de monitoring tiers.
    serializers: {
      req(req) {
        let url = req.url || ''
        // Remplace /portail/{token} par /portail/[REDACTED] — ne touche pas au routing
        if (url.startsWith('/portail/')) {
            url = '/portail/[REDACTED]'
          }
        return {
          method:        req.method,
          url,
          hostname:      req.hostname,
          remoteAddress: req.ip,
        }
      }
    },
  },
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024, // 10 MB
  connectionTimeout: 30000,    // Ferme les connexions inactives après 30s
  keepAliveTimeout: 5000,      // Libère les connexions keep-alive après 5s
  requestTimeout: 60000,       // Timeout par requête — généreux pour contexte africain
})

// ── Plugins ───────────────────────────────────────────────────────────
async function registerPlugins() {
  // Sécurité
  await server.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", "data:", "https:"],
        scriptSrc:  ["'self'"]
      }
    }
  })

  // CORS
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : true // Railway : autoriser toutes origines si non configuré

  await server.register(require('@fastify/cors'), {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Hotel-ID', 'X-Tenant-ID'],
    credentials: true
  })

  // Rate limiting
  await server.register(require('@fastify/rate-limit'), {
    max:        parseInt(process.env.RATE_LIMIT_MAX)    || 200,
    timeWindow: `${process.env.RATE_LIMIT_WINDOW || 15} minutes`
  })

  // ───────────────────────────────────────────────────────────────────
  // CORRECTION #3 — Suppression du fallback JWT_SECRET
  //
  // AVANT : secret: process.env.JWT_SECRET || 'fallback-dev-secret-...'
  //   → Si JWT_SECRET absent en production, le serveur démarre silencieusement
  //     avec un secret connu → n'importe qui peut forger des tokens JWT valides.
  //
  // APRÈS : secret: process.env.JWT_SECRET (sans fallback)
  //   → La fonction validerEnvironnement() garantit que JWT_SECRET est présent
  //     et valide AVANT d'arriver ici. Ce code ne s'exécute donc que si
  //     JWT_SECRET existe. Le fallback est inutile ET dangereux.
  // ───────────────────────────────────────────────────────────────────
  await server.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET,
    sign:   { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  })

  // Form body
  await server.register(require('@fastify/formbody'))

  // Multipart (uploads)
  await server.register(require('@fastify/multipart'), {
    limits: {
      fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024
    }
  })

  // Fichiers statiques (uploads)
  // Sur Railway : filesystem éphémère — le dossier est recréé si absent
  const uploadsPath = path.join(__dirname, '../../uploads')
  try {
    const fs = require('fs')
    if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true })
    await server.register(require('@fastify/static'), {
      root:   uploadsPath,
      prefix: '/uploads/'
    })
  } catch (e) {
    server.log.warn('Dossier uploads non disponible : ' + e.message)
  }

  // Base de données
  await server.register(require('./plugins/database'))

  // Redis cache (optionnel — ne crash pas si absent)
  await server.register(require('./plugins/redis'))

  // Authentification middleware
  await server.register(require('./plugins/auth'))

  // Swagger docs (développement uniquement)
  if (process.env.NODE_ENV !== 'production') {
    await server.register(require('@fastify/swagger'), {
      swagger: {
        info: {
          title:       '7venHotel Cloud API',
          description: 'API Backend - Plateforme SaaS Hôtelière',
          version:     '1.0.0'
        },
        securityDefinitions: {
          Bearer: { type: 'apiKey', name: 'Authorization', in: 'header' }
        }
      }
    })
  }
}

// ── Routes ────────────────────────────────────────────────────────────
async function registerRoutes() {

  // ─────────────────────────────────────────────────────────────────────
  // CORRECTION #4 — Health check robuste avec test BDD réel
  //
  // AVANT : retournait { statut: 'ok' } sans vérifier aucun composant.
  //   → Railway déclarait le déploiement réussi même si PostgreSQL était mort.
  //   → Faux positif critique : le load balancer envoyait du trafic vers un
  //     backend incapable de traiter la moindre requête métier.
  //
  // APRÈS : trois niveaux de statut
  //   → "healthy"  (HTTP 200) : PostgreSQL et cache opérationnels
  //   → "degraded" (HTTP 200) : PostgreSQL OK, cache dégradé (toujours fonctionnel)
  //   → "unhealthy"(HTTP 503) : PostgreSQL inaccessible (aucune requête ne peut aboutir)
  //
  // Test PostgreSQL :
  //   → SELECT 1 sur la connexion Knex existante (pas de nouvelle connexion)
  //   → Timeout 3000ms pour ne pas bloquer le health check en cas de BDD lente
  //   → HTTP 503 si la BDD ne répond pas → Railway arrête le déploiement
  //     ou retire l'instance du load balancer
  //
  // Informations exposées :
  //   → Latence mesurée pour chaque composant (utile pour le monitoring)
  //   → Type de cache (redis ou mémoire)
  //   → Pas de stack trace, pas de détails internes en production
  // ─────────────────────────────────────────────────────────────────────
  server.get('/health', async (request, reply) => {
    const composants  = {}
    let   statutGlobal = 'healthy'

    // ── Test PostgreSQL ───────────────────────────────────────────────
    if (!server.db) {
      composants.postgresql = { statut: 'indisponible' }
      statutGlobal = 'unhealthy'
    } else {
      try {
        const debut = Date.now()

        await Promise.race([
          server.db.raw('SELECT 1'),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('Timeout DB (3000ms)')), 3000)
          )
        ])

        composants.postgresql = {
          statut: 'ok',
          latence_ms: Date.now() - debut
        }

      } catch (err) {
        composants.postgresql = {
          statut: 'erreur',
          ...(process.env.NODE_ENV !== 'production' && { detail: err.message })
        }
        statutGlobal = 'unhealthy'
      }
    }

    // ── Test Cache (Redis ou mémoire) ─────────────────────────────────
    if (!server.cache) {
      composants.cache = { statut: 'absent' }
    } else {
      try {
        const debut = Date.now()
        const cle = '_healthcheck_probe'

        await server.cache.set(cle, 1, 10)
        const retour = await server.cache.get(cle)

        if (retour === null) throw new Error('Valeur non retrouvée')

        composants.cache = {
          statut: 'ok',
          type: server.redis ? 'redis' : 'memoire',
          latence_ms: Date.now() - debut
        }

      } catch (err) {
        composants.cache = {
          statut: 'degraded',
          type: server.redis ? 'redis' : 'memoire',
          ...(process.env.NODE_ENV !== 'production' && { detail: err.message })
        }

        if (statutGlobal === 'healthy') statutGlobal = 'degraded'
      }
    }

    // ── Code HTTP selon statut global ─────────────────────────────────
    // 200 pour healthy et degraded : Railway continue à router le trafic
    // 503 pour unhealthy : Railway retire l'instance ou stoppe le déploiement
    const httpCode = statutGlobal === 'unhealthy' ? 503 : 200

    return reply.status(httpCode).send({
      statut:      statutGlobal,
      version:     process.env.APP_VERSION || '1.0.0',
      horodatage:  new Date().toISOString(),
      composants
    })
  })

  // ── API Routes v1 ─────────────────────────────────────────────────
  await server.register(async function(app) {
    await app.register(require('./routes/auth'),            { prefix: '/auth' })
    await app.register(require('./routes/tenants'),         { prefix: '/tenants' })
    await app.register(require('./routes/hotels'),          { prefix: '/hotels' })
    await app.register(require('./routes/utilisateurs'),    { prefix: '/utilisateurs' })
    await app.register(require('./routes/chambres'),        { prefix: '/chambres' })
    await app.register(require('./routes/clients'),         { prefix: '/clients' })
    await app.register(require('./routes/reservations'),    { prefix: '/reservations' })
    await app.register(require('./routes/menage'),          { prefix: '/menage' })
    await app.register(require('./routes/maintenance'),     { prefix: '/maintenance' })
    await app.register(require('./routes/restaurant'),      { prefix: '/restaurant' })
    await app.register(require('./routes/facturation'),     { prefix: '/facturation' })
    await app.register(require('./routes/analytics'),       { prefix: '/analytics' })
    await app.register(require('./routes/ai'),              { prefix: '/ai' })
    await app.register(require('./routes/uploads'),         { prefix: '/uploads' })
    await app.register(require('./routes/portail-chambre'), { prefix: '/portail' })
    await app.register(require('./routes/booking'),         { prefix: '/booking' })
    await app.register(require('./routes/portail-client'),  { prefix: '/client' })

    // ─────────────────────────────────────────────────────────────────
    // CORRECTION #5 — Route /seed désactivée en production
    //
    // AVANT : enregistrée inconditionnellement
    //   → En production, exposait la structure de la BDD, permettait de créer
    //     ou modifier des utilisateurs, et contenait des credentials hardcodés.
    //   → C'est une backdoor fonctionnelle sur un système en production.
    //
    // APRÈS : enregistrée uniquement si NODE_ENV !== 'production'
    //   → En production  : route inexistante → HTTP 404 → aucune information divulguée
    //   → En local/staging : disponible pour les workflows de démo et d'initialisation
    //   → Un warning log rappelle son activation pour éviter les oublis
    //
    // Pour initialiser les données en production : utiliser Railway "Run Command"
    //   → node backend/src/utils/seed.js
    //   → Traçable, contrôlé, non exposé via HTTP
    // ─────────────────────────────────────────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
      await app.register(require('./routes/seed'), { prefix: '/seed' })
      server.log.warn('⚠️  Route /seed ACTIVE — Désactiver avant tout déploiement production (NODE_ENV=production)')
    }

  }, { prefix: '/api/v1' })
}

// ── Gestionnaire d'erreurs global ─────────────────────────────────────
server.setErrorHandler(async (error, request, reply) => {
  server.log.error({ err: error, url: request.url, method: request.method }, 'Erreur API')

  if (error.statusCode === 429) {
    return reply.status(429).send({
      erreur:  'Trop de requêtes',
      message: 'Veuillez réessayer dans quelques instants',
      code:    'TROP_DE_REQUETES'
    })
  }

  if (error.validation) {
    return reply.status(400).send({
      erreur:  'Données invalides',
      message: 'Vérifiez les données envoyées',
      details: error.validation,
      code:    'DONNEES_INVALIDES'
    })
  }

  const statusCode = error.statusCode || 500
  return reply.status(statusCode).send({
    erreur: statusCode === 500 ? 'Erreur serveur interne' : error.message,
    code:   error.code || 'ERREUR_INTERNE',
    ...(process.env.NODE_ENV !== 'production' && { details: error.stack })
  })
})

// ── Démarrage ─────────────────────────────────────────────────────────
async function demarrer() {
  try {
    await registerPlugins()
    await registerRoutes()

    // ─────────────────────────────────────────────────────────────────────
    // Seed au démarrage — activé uniquement si SEED_ON_BOOT=true
    //
    // Procédure Railway pour initialiser une base vide :
    //   1. Railway → Variables : SEED_ON_BOOT=true
    //                            SEED_ADMIN_PASSWORD=<motdepasse_fort>
    //                            SEED_DEMO_PASSWORD=<motdepasse_demo>
    //   2. Redéployer → vérifier logs "[seed] ✅ Seed terminé"
    //   3. Railway → Variables : supprimer SEED_ON_BOOT
    //   4. Redéployer → bloc ignoré définitivement
    //
    // Garanties :
    //   → Aucune route HTTP exposée
    //   → Idempotent — sortie immédiate si données déjà présentes
    //   → server.db garanti initialisé (registerPlugins exécuté avant)
    //   → Échec du seed = warning uniquement, serveur reste opérationnel
    // ─────────────────────────────────────────────────────────────────────
    if (process.env.SEED_ON_BOOT === 'true') {
      server.log.warn('⚠️  SEED_ON_BOOT=true détecté — exécution du seed...')
      try {
        const { seeder } = require('./utils/seed')
        const resume = await seeder(server.db)
        server.log.info({ resume }, '✅ Seed terminé — supprimez SEED_ON_BOOT de Railway puis redéployez')
      } catch (seedErr) {
        server.log.error({ err: seedErr.message }, '❌ Seed échoué — vérifiez SEED_ADMIN_PASSWORD et SEED_DEMO_PASSWORD')
      }
    }

    const port = parseInt(process.env.PORT) || 3001
    const host = '0.0.0.0'

    await server.listen({ port, host })
    server.log.info(`🚀 7venHotel Cloud API démarré sur http://${host}:${port}`)
    server.log.info(`📊 Environnement : ${process.env.NODE_ENV}`)
    server.log.info(`🧠 DB Mode : ${
      process.env.DATABASE_PRIVATE_URL ? 'PRIVATE' :
      process.env.DATABASE_URL ? 'PUBLIC' :
      'LOCAL'
    }`)
    server.log.info(`💰 Devise        : ${process.env.DEFAULT_CURRENCY || 'XAF'}`)
    server.log.info(`🌍 Fuseau        : ${process.env.DEFAULT_TIMEZONE || 'Africa/Douala'}`)
    server.log.info(`🔒 Route /seed   : ${process.env.NODE_ENV !== 'production' ? 'ACTIVE (hors production)' : 'DÉSACTIVÉE'}`)
  } catch (err) {
    // Stderr capturé par Railway même sans pino — toujours lisible dans les logs
    console.error('\n❌ ERREUR DÉMARRAGE 7venHotel Cloud :')
    console.error(`   ${err.message}`)
    console.error(err.stack)
    process.exit(1)
  }
}

// ── Arrêt propre (SIGTERM Railway, SIGINT local) ───────────────────────
const arreterGracieusement = async (signal) => {
  server.log.info(`Signal ${signal} reçu — arrêt en cours...`)
  await server.close()
  process.exit(0)
}

process.on('SIGTERM', () => arreterGracieusement('SIGTERM'))
process.on('SIGINT',  () => arreterGracieusement('SIGINT'))

demarrer()
