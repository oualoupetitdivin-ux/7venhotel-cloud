'use strict'
// Script one-shot : applique toutes les migrations SQL
// Usage : node migrate-production.js
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

async function run() {
  const connStr = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL
  if (!connStr) { console.error('Aucune DATABASE_URL trouvée'); process.exit(1) }

  const ssl = connStr.includes('.railway.internal') ? false : { rejectUnauthorized: false }
  const c = new Client({ connectionString: connStr, ssl })
  await c.connect()
  console.log('✅ Connecté à PostgreSQL')

  // Activer les extensions nécessaires
  await c.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
  await c.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
  console.log('✅ Extensions activées (uuid-ossp, pgcrypto)')

  // 1. Schéma de base (database/migrations à la racine du projet)
  const baseDir = path.join(__dirname, '..', 'database', 'migrations')
  if (fs.existsSync(baseDir)) {
    const baseFiles = fs.readdirSync(baseDir).filter(f => f.endsWith('.sql')).sort()
    console.log(`\n📁 database/migrations : ${baseFiles.length} fichier(s) — schéma de base`)
    for (const f of baseFiles) {
      process.stdout.write(`  ${f} ... `)
      try {
        await c.query(fs.readFileSync(path.join(baseDir, f), 'utf8'))
        console.log('✅')
      } catch (e) {
        console.log(`⚠️  ${e.message.split('\n')[0]}`)
        try { await c.query('ROLLBACK') } catch {}
      }
    }
  }

  // 2. Migrations src/db/migrations
  const srcDir = path.join(__dirname, 'src', 'db', 'migrations')
  if (fs.existsSync(srcDir)) {
    const srcFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.sql')).sort()
    if (srcFiles.length > 0) {
      console.log(`\n📁 src/db/migrations : ${srcFiles.length} fichier(s)`)
      for (const f of srcFiles) {
        process.stdout.write(`  ${f} ... `)
        try {
          await c.query(fs.readFileSync(path.join(srcDir, f), 'utf8'))
          console.log('✅')
        } catch (e) {
          console.log(`⚠️  ${e.message.split('\n')[0]}`)
          // Reset transaction state après erreur
          try { await c.query('ROLLBACK') } catch {}
        }
      }
    }
  }

  // Appliquer les migrations db/migrations
  const dir = path.join(__dirname, 'db', 'migrations')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  console.log(`\n📁 db/migrations : ${files.length} fichiers SQL`)

  let ok = 0, err = 0
  for (const f of files) {
    process.stdout.write(`  ${f} ... `)
    try {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'))
      console.log('✅')
      ok++
    } catch (e) {
      const msg = e.message.split('\n')[0]
      console.log(`⚠️  ${msg}`)
      err++
      // Reset transaction state pour que la prochaine migration parte proprement
      try { await c.query('ROLLBACK') } catch {}
    }
  }

  await c.end()
  console.log(`\nTerminé : ${ok} OK, ${err} erreurs`)
}

run().catch(e => { console.error(e.message); process.exit(1) })
