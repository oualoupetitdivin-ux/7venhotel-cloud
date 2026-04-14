'use strict'

require('dotenv').config({ path: '../../.env' })
const fs     = require('fs')
const path   = require('path')
const bcrypt = require('bcryptjs')
const { Client } = require('pg')

// FIX : Utilise DATABASE_URL en priorité (Railway)
function getClientConfig() {
  if (process.env.DATABASE_URL) {
    console.log('📦 Seed : connexion via DATABASE_URL')
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  }
  console.log('📦 Seed : connexion via variables individuelles')
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'ocs7venhotel',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  }
}

const client = new Client(getClientConfig())

async function seeder() {
  console.log('🔄 Connexion à la base de données...')
  await client.connect()
  console.log('✅ Connecté')

  const hash = async (mdp) => bcrypt.hash(mdp, 12)
  const superAdminHash = await hash(process.env.SUPER_ADMIN_PASSWORD || 'Admin@2024!')
  const demoHash       = await hash('demo123')

  // Appliquer le fichier seed SQL
  const dossierSeeds = path.join(__dirname, '../../../database/seeds')
  const fichiers = fs.readdirSync(dossierSeeds).filter(f => f.endsWith('.sql')).sort()

  for (const fichier of fichiers) {
    console.log(`🔄 Application du seed : ${fichier}`)
    const sql = fs.readFileSync(path.join(dossierSeeds, fichier), 'utf8')
    try {
      await client.query(sql)
      console.log(`✅ Seed appliqué : ${fichier}`)
    } catch (err) {
      if (err.code === '23505') {
        console.log(`⏭  Données déjà présentes : ${fichier}`)
      } else {
        console.warn(`⚠️  Avertissement seed ${fichier}: ${err.message}`)
      }
    }
  }

  // Mettre à jour les mots de passe avec les vrais hash bcrypt
  await client.query(
    `UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE email = 'superadmin@demo.com'`,
    [superAdminHash]
  )
  await client.query(
    `UPDATE utilisateurs SET mot_de_passe_hash = $1
     WHERE email IN ('manager@demo.com','reception@demo.com','housekeeping@demo.com','restaurant@demo.com','accounting@demo.com')`,
    [demoHash]
  )

  console.log('\n✅ Seed terminé !')
  console.log('\n📋 Comptes de démonstration :')
  console.log('   superadmin@demo.com   → Admin@2024!')
  console.log('   manager@demo.com      → demo123')
  console.log('   reception@demo.com    → demo123')
  console.log('   housekeeping@demo.com → demo123')
  console.log('   restaurant@demo.com   → demo123')
  console.log('   accounting@demo.com   → demo123')

  await client.end()
}

seeder().catch(err => {
  console.error('❌ Erreur seed:', err.message)
  process.exit(1)
})
