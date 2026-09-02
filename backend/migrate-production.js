'use strict'
// Script one-shot : applique toutes les migrations SQL de /app/db/migrations/
// Usage depuis la Console Railway : node migrate-production.js
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

async function run() {
  const connStr = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL
  if (!connStr) { console.error('Aucune DATABASE_URL trouvée'); process.exit(1) }

  const c = new Client({ connectionString: connStr, ssl: false })
  await c.connect()
  console.log('✅ Connecté à PostgreSQL')

  const dir = path.join(__dirname, 'db', 'migrations')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  console.log(`📁 ${files.length} fichiers SQL trouvés`)

  let ok = 0, err = 0
  for (const f of files) {
    process.stdout.write(`  ${f} ... `)
    try {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'))
      console.log('✅')
      ok++
    } catch (e) {
      console.log(`⚠️  ${e.message.split('\n')[0]}`)
      err++
    }
  }

  await c.end()
  console.log(`\nTerminé : ${ok} OK, ${err} erreurs (les "already exists" sont normales)`)
}

run().catch(e => { console.error(e.message); process.exit(1) })
