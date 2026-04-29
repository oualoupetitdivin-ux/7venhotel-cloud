'use strict'

const fp   = require('fastify-plugin')
const Knex = require('knex')

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internes — masquage des credentials dans les logs
//
// Afficher une URL de connexion dans les logs est une erreur classique :
// le mot de passe apparaît en clair dans Railway, Datadog, Sentry, etc.
// Cette fonction tronque l'URL pour ne montrer que l'hôte et le port.
//
// Exemple :
//   postgresql://postgres:secret@containers.railway.app:6543/railway
//   → postgresql://[credentials]@containers.railway.app:6543/railway
// ─────────────────────────────────────────────────────────────────────────────
function masquerUrl(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//[credentials]@${u.host}${u.pathname}`
  } catch {
    return '[URL invalide]'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Résolution de la configuration de connexion — stratégie à 3 niveaux
//
// NIVEAU 1 — DATABASE_PRIVATE_URL (Railway réseau interne) ← PRIORITÉ ABSOLUE
//   Railway injecte cette variable quand le plugin PostgreSQL est attaché
//   au même projet. La communication reste sur le réseau privé Railway :
//   → Pas de latence internet
//   → Pas de bande passante facturée
//   → SSL inutile sur réseau privé (désactivé explicitement)
//   → Port interne : 5432 (différent du port public 6543)
//
// NIVEAU 2 — DATABASE_URL (Railway URL publique)
//   Présente en même temps que DATABASE_PRIVATE_URL sur Railway.
//   Utilisée comme fallback si PRIVATE_URL est absente (cas rare :
//   connexion cross-projet, ou Railway legacy sans PRIVATE_URL).
//   → SSL obligatoire : certificat Railway auto-signé → rejectUnauthorized: false
//   → Port public : typiquement 6543 (encodé dans l'URL, pas de hardcoding)
//
// NIVEAU 3 — Variables individuelles PGHOST / DB_HOST (développement local)
//   Jamais autorisé en production (NODE_ENV=production).
//   Supporte les deux conventions de nommage :
//   → PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD (convention PostgreSQL standard)
//   → DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (convention projet)
//   PGHOST est prioritaire pour compatibilité avec pg, psql, et les outils standards.
// ─────────────────────────────────────────────────────────────────────────────
function resoudreConnexion(log) {
  const estProduction = process.env.NODE_ENV === 'production'

  // ── Niveau 1 : DATABASE_PRIVATE_URL ──────────────────────────────────────
  if (process.env.DATABASE_PRIVATE_URL) {
    log.info(
      `📦 PostgreSQL : réseau privé Railway → ${masquerUrl(process.env.DATABASE_PRIVATE_URL)}`
    )
    return {
      mode: 'private_url',
      connection: {
        connectionString: process.env.DATABASE_PRIVATE_URL,
        // Réseau privé Railway : SSL désactivé par défaut (réseau interne)
        // Forçable via DB_SSL=true si l'environnement l'exige
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      }
    }
  }

  // ── Niveau 2 : DATABASE_URL ───────────────────────────────────────────────
  if (process.env.DATABASE_URL) {
    // SSL configurable via DB_SSL, mais Railway public exige SSL par défaut
    // DB_SSL=false permet de désactiver pour des environnements de test
    const sslActif = process.env.DB_SSL === 'true' || !process.env.DB_SSL
    log.info(
      `📦 PostgreSQL : URL publique → ${masquerUrl(process.env.DATABASE_URL)}` +
      ` | SSL : ${sslActif ? 'activé' : 'désactivé'}`
    )
    return {
      mode: 'public_url',
      connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: sslActif ? { rejectUnauthorized: false } : false
      }
    }
  }

  // ── Niveau 3 : Variables individuelles ───────────────────────────────────
  // Bloqué en production : sans URL configurée, c'est une erreur de déploiement
  if (estProduction) {
    // Ce point ne devrait jamais être atteint si server.js a correctement
    // exécuté validerEnvironnement() — mais on défend en profondeur.
    throw new Error(
      'PRODUCTION : DATABASE_PRIVATE_URL et DATABASE_URL sont absentes.\n' +
      'Attachez le plugin PostgreSQL Railway au service backend.\n' +
      'Railway injecte DATABASE_PRIVATE_URL et DATABASE_URL automatiquement.'
    )
  }

  // Développement local uniquement
  // Priorité PGHOST (convention pg standard) sur DB_HOST (convention projet)
  const host     = process.env.PGHOST     || process.env.DB_HOST     || 'localhost'
  const port     = parseInt(process.env.PGPORT     || process.env.DB_PORT)     || 5432
  const database = process.env.PGDATABASE || process.env.DB_NAME     || 'ocs7venhotel'
  const user     = process.env.PGUSER     || process.env.DB_USER     || 'postgres'
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || ''
  const sslLocal = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false

  // Log hôte/port uniquement — jamais user/password
  log.warn(
    `📦 PostgreSQL : variables locales → ${host}:${port}/${database}` +
    ` | SSL : ${sslLocal ? 'activé' : 'désactivé'}` +
    ' | ⚠️  JAMAIS en production'
  )

  return {
    mode: 'local_vars',
    connection: { host, port, database, user, password, ssl: sslLocal }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin principal
// ─────────────────────────────────────────────────────────────────────────────
async function databasePlugin(fastify) {

  // Résolution de la connexion — fail-fast si production sans URL
  const { mode, connection } = resoudreConnexion(fastify.log)

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration du pool — adaptée Railway
  //
  // AVANT : min=2, max=10
  //   → min=2 force 2 connexions permanentes même au repos.
  //     Sur Railway PostgreSQL (plan hobby : 25 connexions max), avec
  //     plusieurs services connectés, la limite est atteinte rapidement.
  //   → max=10 est trop généreux pour une instance Railway single-service.
  //
  // APRÈS : min=1, max=5
  //   → min=1 : une connexion maintenue en permanence — suffisant pour
  //     les health checks et le trafic faible (contexte africain : nuits calmes)
  //   → max=5 : plafond raisonnable pour Railway hobby/pro, laisse de la
  //     marge pour d'autres services ou connexions admin
  //   → Les valeurs sont surchargeables via DB_POOL_MIN / DB_POOL_MAX
  //     pour les environnements avec plus de ressources (VPS dédié)
  //
  // idleTimeoutMillis — 600000ms (10 min)
  //   Railway ferme les connexions idle côté serveur après un certain temps.
  //   10 minutes évite les "connexion terminée par le serveur" inattendus
  //   sur des hôtels africains avec peu de trafic nocturne.
  //
  // propagateCreateError — false
  //   Évite qu'une erreur de création de connexion en pool ne cascade
  //   sur toutes les requêtes en attente simultanément. Chaque requête
  //   gère son propre échec de connexion.
  // ─────────────────────────────────────────────────────────────────────────
  const knex = Knex({
    client: 'pg',
    connection,
    pool: {
      min:                  parseInt(process.env.DB_POOL_MIN) || 1,
      max:                  parseInt(process.env.DB_POOL_MAX) || 5,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis:  30000,
      idleTimeoutMillis:    600000,
      reapIntervalMillis:   1000,
      propagateCreateError: false
    },
    acquireConnectionTimeout: 30000
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test de connexion au démarrage
  //
  // SELECT 1 valide que Knex peut ouvrir une connexion physique vers PostgreSQL.
  // En cas d'échec : re-throw avec message explicite → server.js catch → exit(1)
  // → Railway affiche l'erreur, stoppe le container, marque le déploiement échoué.
  //
  // Le message d'erreur inclut le mode de connexion utilisé (private_url,
  // public_url, ou local_vars) pour faciliter le diagnostic sans exposer
  // les credentials.
  // ─────────────────────────────────────────────────────────────────────────
  try {
    await Promise.race([
      knex.raw('SELECT 1'),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Timeout DB (3000ms)')), 3000)
      )
    ])
    fastify.log.info({ mode, ssl: !!connection.ssl }, '✅ PostgreSQL connecté')
  } catch (err) {
    fastify.log.error(
      { mode, erreur: err.message },
      '❌ Connexion PostgreSQL échouée'
    )
    // Destruction propre du pool avant de crasher
    // (évite des connexions zombies si le pool a partiellement initialisé)
    try { await knex.destroy() } catch { /* ignoré */ }

    throw new Error(
      `Connexion PostgreSQL impossible [mode: ${mode}] : ${err.message}`
    )
  }

  // Décorer l'instance Fastify avec knex — accessible via fastify.db / server.db
  fastify.decorate('db', knex)

  // Fermeture propre sur SIGTERM / SIGINT
  fastify.addHook('onClose', async () => {
    await knex.destroy()
    fastify.log.info('🔌 Connexion PostgreSQL fermée proprement')
  })
}

module.exports = fp(databasePlugin, {
  name:    'database',
  fastify: '4.x'
})
