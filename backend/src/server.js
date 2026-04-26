'use strict'

require('dotenv').config({ path: '../.env' })

const Fastify = require('fastify')
const path = require('path')

// ── Configuration du serveur ─────────────────────────────────────────
//
// FIX #1 — "sonic boom is not ready yet"
// Cause : logger.file pointait vers ../../logs/api/app.log
// Ce répertoire n'existe pas sur Railway (filesystem éphémère, .gitignored).
// sonic-boom (stream d'écriture de pino) crash à l'ouverture du fichier.
// Solution : supprimer complètement logger.file — Railway capture stdout/stderr
// nativement. Le logging fichier n'est utile que sur un VPS persistant (PM2).
//
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    // Transport pino-pretty uniquement en développement local
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
    // ❌ SUPPRIMÉ : file: path.join(__dirname, '../../logs/api/app.log')
    // Cette ligne causait le crash "sonic boom is not ready yet" sur Railway.
    // Railway collecte les logs via stdout — aucun fichier nécessaire.
  },
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB
})

// ── Plugins ───────────────────────────────────────────────────────────
async function registerPlugins() {
  // Sécurité
  await server.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"]
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
    max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
    timeWindow: `${process.env.RATE_LIMIT_WINDOW || 15} minutes`
  })

  // JWT
  await server.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET || 'fallback-dev-secret-change-in-production',
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
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
  // Sur Railway : le dossier uploads/ doit exister dans le repo OU être un volume monté
  const uploadsPath = path.join(__dirname, '../../uploads')
  try {
    const fs = require('fs')
    if (!fs.existsSync(uploadsPath)) fs.mkdirSync(uploadsPath, { recursive: true })
    await server.register(require('@fastify/static'), {
      root: uploadsPath,
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

  // Swagger docs (dev uniquement)
  if (process.env.NODE_ENV !== 'production') {
    await server.register(require('@fastify/swagger'), {
      swagger: {
        info: {
          title: '7venHotel Cloud API',
          description: 'API Backend - Plateforme SaaS Hôtelière',
          version: '1.0.0'
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
  // Health check (toujours disponible, sans auth)
  server.get('/health', async () => ({
    statut: 'ok',
    version: process.env.APP_VERSION || '1.0.0',
    horodatage: new Date().toISOString(),
    environnement: process.env.NODE_ENV
  }))

  // API Routes v1
  await server.register(async function(app) {
  await app.register(require('./routes/auth'),             { prefix: '/auth' })
  await app.register(require('./routes/tenants'),          { prefix: '/tenants' })
  await app.register(require('./routes/hotels'),           { prefix: '/hotels' })
  await app.register(require('./routes/utilisateurs'),     { prefix: '/utilisateurs' })
  await app.register(require('./routes/chambres'),         { prefix: '/chambres' })
  await app.register(require('./routes/clients'),          { prefix: '/clients' })
  await app.register(require('./routes/reservations'),     { prefix: '/reservations' })
  await app.register(require('./routes/menage'),           { prefix: '/menage' })
  await app.register(require('./routes/maintenance'),      { prefix: '/maintenance' })
  await app.register(require('./routes/restaurant'),       { prefix: '/restaurant' })
  await app.register(require('./routes/facturation'),      { prefix: '/facturation' })
  await app.register(require('./routes/analytics'),        { prefix: '/analytics' })
  await app.register(require('./routes/ai'),               { prefix: '/ai' })
  await app.register(require('./routes/uploads'),          { prefix: '/uploads' })
  await app.register(require('./routes/portail-chambre'),  { prefix: '/portail' })
  await app.register(require('./routes/booking'),          { prefix: '/booking' })
  await app.register(require('./routes/portail-client'),   { prefix: '/client' })

  if (process.env.ENABLE_SEED_ROUTE === 'true') {
    await app.register(require('./routes/seed'), { prefix: '/seed' })
  }

}, { prefix: '/api/v1' })

}

// ── Gestionnaire d'erreurs global ─────────────────────────────────────
server.setErrorHandler(async (error, request, reply) => {
  server.log.error({ err: error, url: request.url, method: request.method }, 'Erreur API')

  if (error.statusCode === 429) {
    return reply.status(429).send({
      erreur: 'Trop de requêtes',
      message: 'Veuillez réessayer dans quelques instants',
      code: 'TROP_DE_REQUETES'
    })
  }

  if (error.validation) {
    return reply.status(400).send({
      erreur: 'Données invalides',
      message: 'Vérifiez les données envoyées',
      details: error.validation,
      code: 'DONNEES_INVALIDES'
    })
  }

  const statusCode = error.statusCode || 500
  return reply.status(statusCode).send({
    erreur: statusCode === 500 ? 'Erreur serveur interne' : error.message,
    code: error.code || 'ERREUR_INTERNE',
    ...(process.env.NODE_ENV !== 'production' && { details: error.stack })
  })
})

// ── Démarrage ─────────────────────────────────────────────────────────
async function demarrer() {
  try {
    await registerPlugins()
    await registerRoutes()

    const port = parseInt(process.env.PORT) || 3001
    const host = '0.0.0.0'

    await server.listen({ port, host })
    server.log.info(`🚀 7venHotel Cloud API démarré sur http://${host}:${port}`)
    server.log.info(`📊 Environnement: ${process.env.NODE_ENV}`)
    server.log.info(`💰 Devise: ${process.env.DEFAULT_CURRENCY || 'XAF'}`)
    server.log.info(`🌍 Fuseau: ${process.env.DEFAULT_TIMEZONE || 'Africa/Douala'}`)
  } catch (err) {
    // Log vers stderr (capturé par Railway même sans pino)
    console.error('ERREUR DEMARRAGE:', err.message)
    console.error(err.stack)
    process.exit(1)
  }
}

// Gestion arrêt propre
const arreterGracieusement = async (signal) => {
  server.log.info(`Signal ${signal} reçu, arrêt en cours...`)
  await server.close()
  process.exit(0)
}

process.on('SIGTERM', () => arreterGracieusement('SIGTERM'))
process.on('SIGINT',  () => arreterGracieusement('SIGINT'))

demarrer()
