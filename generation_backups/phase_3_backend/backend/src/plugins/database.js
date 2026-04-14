'use strict'

const fp = require('fastify-plugin')
const Knex = require('knex')

async function databasePlugin(fastify, options) {
  const knex = Knex({
    client: 'pg',
    connection: {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'ocs7venhotel',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    },
    pool: {
      min:            parseInt(process.env.DB_POOL_MIN) || 2,
      max:            parseInt(process.env.DB_POOL_MAX) || 20,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
    },
    acquireConnectionTimeout: 30000
  })

  // Test connexion
  try {
    await knex.raw('SELECT 1')
    fastify.log.info('✅ Connexion PostgreSQL établie')
  } catch (err) {
    fastify.log.error(err, '❌ Échec connexion PostgreSQL')
    throw err
  }

  // Décorer Fastify avec knex
  fastify.decorate('db', knex)

  // Fermeture propre
  fastify.addHook('onClose', async () => {
    await knex.destroy()
    fastify.log.info('Connexion PostgreSQL fermée')
  })
}

module.exports = fp(databasePlugin, {
  name: 'database',
  fastify: '4.x'
})
