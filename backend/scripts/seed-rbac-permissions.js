'use strict'
/**
 * LOT-RBAC-01 — Seed permissions manquantes
 *
 * Exécuter : node scripts/seed-rbac-permissions.js
 *
 * Idempotent — utilise ON CONFLICT DO NOTHING.
 * Ne touche pas aux permissions existantes ni aux associations existantes.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const knex = require('knex')

const db = knex({
  client: 'pg',
  connection: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 5432,
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME     || 'ocs7venhotel',
  }
})

// ── Nouvelles permissions à créer ──────────────────────────────────────────
const NOUVELLES_PERMISSIONS = [
  // Arrhes — consommée réellement par arrhes.route.js (reservations.confirmer)
  { code: 'reservations.confirmer', description: 'Confirmer une arrhes / configurer la politique de garantie' },

  // Fidélité — complément de fidelite.lire + fidelite.modifier
  { code: 'fidelite.administrer', description: 'Administrer le programme de fidélité (niveaux, points, export)' },

  // Caisse — actuellement gardées par verifierRole ; prep pour migration future
  { code: 'caisse.lire',    description: 'Consulter la caisse et les mouvements' },
  { code: 'caisse.operer',  description: 'Encaisser, effectuer des mouvements de caisse' },
  { code: 'caisse.cloture', description: 'Clôturer la caisse en fin de journée' },

  // Charges
  { code: 'charges.lire',     description: 'Consulter les charges' },
  { code: 'charges.creer',    description: 'Saisir une charge' },
  { code: 'charges.modifier', description: 'Modifier ou valider une charge' },

  // Stock
  { code: 'stock.lire',     description: 'Consulter les niveaux de stock' },
  { code: 'stock.modifier', description: 'Effectuer un mouvement de stock' },

  // Catalogue F&B
  { code: 'catalogue.lire',     description: 'Consulter le catalogue des articles' },
  { code: 'catalogue.modifier', description: 'Créer et modifier les articles du catalogue' },

  // Achats & Fournisseurs
  { code: 'achats.lire',     description: 'Consulter les bons de commande' },
  { code: 'achats.creer',    description: 'Créer un bon de commande' },
  { code: 'achats.modifier', description: 'Modifier ou réceptionner un bon de commande' },

  // Finance OHADA — prép LOT-OHADA-01 (aucune route active)
  { code: 'finance.lire',     description: 'Consulter les écritures et états financiers' },
  { code: 'finance.ecriture', description: 'Passer des écritures comptables' },
  { code: 'finance.cloture',  description: 'Valider une période comptable' },
]

// ── Associations rôle → permissions ───────────────────────────────────────
// Format : { role, codes: [...] }
// Ne liste que les nouvelles permissions — les existantes restent en place.
const NOUVELLES_ASSOCIATIONS = [
  // manager — périmètre complet opérationnel
  {
    role: 'manager',
    codes: [
      'reservations.confirmer',
      'fidelite.administrer',
      'caisse.lire', 'caisse.operer', 'caisse.cloture',
      'charges.lire', 'charges.creer', 'charges.modifier',
      'stock.lire', 'stock.modifier',
      'catalogue.lire', 'catalogue.modifier',
      'achats.lire', 'achats.creer', 'achats.modifier',
      'finance.lire',
    ]
  },
  // super_admin — même périmètre que manager + finance complète
  {
    role: 'super_admin',
    codes: [
      'reservations.confirmer',
      'fidelite.administrer',
      'caisse.lire', 'caisse.operer', 'caisse.cloture',
      'charges.lire', 'charges.creer', 'charges.modifier',
      'stock.lire', 'stock.modifier',
      'catalogue.lire', 'catalogue.modifier',
      'achats.lire', 'achats.creer', 'achats.modifier',
      'finance.lire', 'finance.ecriture', 'finance.cloture',
    ]
  },
  // reception — caisse lecture/operer (pas cloture), arrhes lecture
  {
    role: 'reception',
    codes: [
      'reservations.confirmer',
      'caisse.lire', 'caisse.operer',
    ]
  },
  // comptabilite — caisse lecture, charges, finance lecture
  {
    role: 'comptabilite',
    codes: [
      'caisse.lire', 'caisse.cloture',
      'charges.lire', 'charges.modifier',
      'finance.lire', 'finance.ecriture',
    ]
  },
  // restaurant — catalogue, stock
  {
    role: 'restaurant',
    codes: [
      'catalogue.lire',
      'stock.lire',
    ]
  },
]

async function run() {
  console.log('=== LOT-RBAC-01 — Seed permissions ===')
  console.log()

  // 1. Insérer les nouvelles permissions (idempotent)
  console.log('1. Permissions à créer...')
  let created = 0
  let skipped = 0
  for (const perm of NOUVELLES_PERMISSIONS) {
    const existing = await db('permissions').where({ code: perm.code }).first()
    if (existing) {
      console.log('   SKIP (exists) : ' + perm.code)
      skipped++
    } else {
      const [module, action] = perm.code.split('.')
      await db('permissions').insert({ code: perm.code, description: perm.description, module, action })
      console.log('   CREATED       : ' + perm.code)
      created++
    }
  }
  console.log(`   → ${created} créées, ${skipped} ignorées`)
  console.log()

  // 2. Lire les IDs de toutes les permissions (y compris nouvelles)
  const allPerms = await db('permissions').select('id', 'code')
  const permByCode = {}
  allPerms.forEach(p => { permByCode[p.code] = p.id })

  // 3. Insérer les associations rôle→permission (idempotent)
  console.log('2. Associations rôle → permission...')
  let linked = 0
  let linkSkipped = 0
  for (const assoc of NOUVELLES_ASSOCIATIONS) {
    for (const code of assoc.codes) {
      const permId = permByCode[code]
      if (!permId) {
        console.log('   WARN: permission code inconnu : ' + code)
        continue
      }
      const existing = await db('role_permissions')
        .where({ role: assoc.role, permission_id: permId })
        .first()
      if (existing) {
        linkSkipped++
      } else {
        await db('role_permissions').insert({ role: assoc.role, permission_id: permId })
        linked++
      }
    }
  }
  console.log(`   → ${linked} associations créées, ${linkSkipped} ignorées`)
  console.log()

  // 4. Vérification finale
  const total = await db('permissions').count('id AS n').first()
  const totalRP = await db('role_permissions').count('role AS n').first()
  console.log('3. État final :')
  console.log('   permissions     :', total.n)
  console.log('   role_permissions:', totalRP.n)
  console.log()

  // 5. Résumé par rôle
  const byRole = await db('role_permissions AS rp')
    .join('permissions AS p', 'p.id', 'rp.permission_id')
    .groupBy('rp.role')
    .select('rp.role')
    .count('p.id AS cnt')
    .orderBy('rp.role')
  console.log('4. Permissions par rôle :')
  byRole.forEach(r => console.log(`   ${r.role.padEnd(16)} : ${r.cnt}`))
  console.log()

  console.log('=== DONE ===')
  await db.destroy()
}

run().catch(e => {
  console.error('ERREUR:', e.message)
  process.exit(1)
})
