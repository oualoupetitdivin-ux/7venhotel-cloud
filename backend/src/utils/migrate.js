'use strict'

require('dotenv').config({ path: '../../.env' })
const fs   = require('fs')
const path = require('path')
const { Client } = require('pg')

// FIX : Utilise DATABASE_URL en priorité (Railway)
// Fallback sur variables individuelles (développement local)
function getClientConfig() {
  if (process.env.DATABASE_URL) {
    console.log('📦 Migration : connexion via DATABASE_URL')
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  }
  console.log('📦 Migration : connexion via variables individuelles')
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'ocs7venhotel',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  }
}

const client = new Client(getClientConfig())

async function migrer() {
  console.log('🔄 Connexion à PostgreSQL...')
  await client.connect()
  console.log('✅ Connecté')

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      nom VARCHAR(255) UNIQUE NOT NULL,
      execute_le TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const dossierMigrations = path.join(__dirname, '../../database/migrations')
  const fichiers = fs.readdirSync(dossierMigrations)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const fichier of fichiers) {
    const { rows } = await client.query('SELECT id FROM _migrations WHERE nom = $1', [fichier])
    if (rows.length > 0) {
      console.log(`⏭  Migration déjà appliquée : ${fichier}`)
      continue
    }

    console.log(`🔄 Application de la migration : ${fichier}`)
    const sql = fs.readFileSync(path.join(dossierMigrations, fichier), 'utf8')

    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO _migrations (nom) VALUES ($1)', [fichier])
      await client.query('COMMIT')
      console.log(`✅ Migration appliquée : ${fichier}`)
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`❌ Erreur migration ${fichier}:`, err.message)
      throw err
    }
  }

  await client.end()
  console.log('✅ Toutes les migrations appliquées !')
}

migrer().catch(err => {
  console.error('❌ Erreur migration:', err.message)
  process.exit(1)
})
