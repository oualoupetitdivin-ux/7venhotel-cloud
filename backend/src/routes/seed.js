'use strict'

const fs     = require('fs')
const path   = require('path')
const bcrypt = require('bcryptjs')
const { Client } = require('pg')

module.exports = async function seedRoute(fastify) {

  // Route temporaire pour initialiser la base de données
  // À SUPPRIMER après le premier seed réussi
  fastify.post('/seed-init', async (request, reply) => {
    const { secret } = request.body || {}

    // Protection basique
    if (secret !== 'seed-7venhotel-2026') {
      return reply.status(403).send({ erreur: 'Secret invalide' })
    }

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })

    const logs = []

    try {
      await client.connect()
      logs.push('✅ Connecté à PostgreSQL')

      // Migrations
      const dossierMigrations = path.join(__dirname, '../../../database/migrations')
      const migrations = fs.readdirSync(dossierMigrations).filter(f => f.endsWith('.sql')).sort()

      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id SERIAL PRIMARY KEY,
          nom VARCHAR(255) UNIQUE NOT NULL,
          execute_le TIMESTAMPTZ DEFAULT NOW()
        )
      `)

      for (const fichier of migrations) {
        const { rows } = await client.query('SELECT id FROM _migrations WHERE nom = $1', [fichier])
        if (rows.length > 0) {
          logs.push(`⏭  Migration déjà appliquée : ${fichier}`)
          continue
        }
        const sql = fs.readFileSync(path.join(dossierMigrations, fichier), 'utf8')
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO _migrations (nom) VALUES ($1)', [fichier])
        await client.query('COMMIT')
        logs.push(`✅ Migration appliquée : ${fichier}`)
      }

      // Seeds
      const dossierSeeds = path.join(__dirname, '../../../database/seeds')
      const seeds = fs.readdirSync(dossierSeeds).filter(f => f.endsWith('.sql')).sort()

      for (const fichier of seeds) {
        const sql = fs.readFileSync(path.join(dossierSeeds, fichier), 'utf8')
        try {
          await client.query(sql)
          logs.push(`✅ Seed appliqué : ${fichier}`)
        } catch (err) {
          if (err.code === '23505') {
            logs.push(`⏭  Données déjà présentes : ${fichier}`)
          } else {
            logs.push(`⚠️  ${fichier}: ${err.message}`)
          }
        }
      }

      // Hash mots de passe
      const demoHash  = await bcrypt.hash('demo123', 12)
      const adminHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || 'Admin@2024!', 12)

      await client.query(
        `UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE email = 'superadmin@demo.com'`,
        [adminHash]
      )
      const { rowCount } = await client.query(
        `UPDATE utilisateurs SET mot_de_passe_hash = $1
         WHERE email IN ('manager@demo.com','reception@demo.com','housekeeping@demo.com','restaurant@demo.com','accounting@demo.com')`,
        [demoHash]
      )
      logs.push(`✅ Mots de passe mis à jour : ${rowCount} utilisateurs`)

      await client.end()
      logs.push('✅ Seed terminé !')

      reply.send({ succes: true, logs })

    } catch (err) {
      logs.push(`❌ Erreur : ${err.message}`)
      try { await client.end() } catch {}
      reply.status(500).send({ succes: false, erreur: err.message, logs })
    }
  })
}
