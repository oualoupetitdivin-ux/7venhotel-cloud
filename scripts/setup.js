#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 * 7venHotel Cloud — Script de configuration automatique
 * Usage: node scripts/setup.js
 * ═══════════════════════════════════════════════════════════
 */

'use strict'

const fs      = require('fs')
const path    = require('path')
const crypto  = require('crypto')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')

// ── Couleurs console ──────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', blue: '\x1b[34m', yellow: '\x1b[33m',
  red: '\x1b[31m', cyan: '\x1b[36m', white: '\x1b[37m',
}

const ok  = (msg) => console.log(`${c.green}✅${c.reset} ${msg}`)
const err = (msg) => console.log(`${c.red}❌${c.reset} ${msg}`)
const inf = (msg) => console.log(`${c.blue}ℹ️${c.reset}  ${msg}`)
const sep = ()    => console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`)

console.log(`\n${c.bold}${c.blue}╔══════════════════════════════════════════╗${c.reset}`)
console.log(`${c.bold}${c.blue}║   7venHotel Cloud — Installation Setup   ║${c.reset}`)
console.log(`${c.bold}${c.blue}║          Langue : Français (défaut)       ║${c.reset}`)
console.log(`${c.bold}${c.blue}╚══════════════════════════════════════════╝${c.reset}\n`)

// ── ÉTAPE 1 : Créer .env si absent ───────────────────────────────────
sep()
console.log(`${c.bold}Étape 1/5 — Configuration environnement${c.reset}\n`)

const envPath     = path.join(ROOT, '.env')
const envExample  = path.join(ROOT, '.env.example')

if (!fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envExample, 'utf8')

  // Génération de secrets sécurisés automatiques
  const jwtSecret  = crypto.randomBytes(64).toString('hex')
  const jwtRefresh = crypto.randomBytes(64).toString('hex')
  const sessionSec = crypto.randomBytes(32).toString('hex')

  envContent = envContent
    .replace('CHANGE_ME_VERY_LONG_RANDOM_STRING_AT_LEAST_64_CHARS', jwtSecret)
    .replace('CHANGE_ME_ANOTHER_VERY_LONG_RANDOM_STRING', jwtRefresh)
    .replace('CHANGE_ME_SESSION_SECRET', sessionSec)

  fs.writeFileSync(envPath, envContent)
  ok('Fichier .env créé avec secrets générés automatiquement')
  inf(`JWT Secret généré : ${jwtSecret.slice(0,20)}…`)
} else {
  ok('Fichier .env déjà présent')
}

// ── ÉTAPE 2 : Créer répertoires requis ───────────────────────────────
sep()
console.log(`${c.bold}Étape 2/5 — Création des répertoires${c.reset}\n`)

const dirs = [
  'uploads/rooms', 'uploads/avatars', 'uploads/documents', 'uploads/temp',
  'logs/api', 'logs/error', 'logs/access',
  'database/backups',
]

dirs.forEach(dir => {
  const fullPath = path.join(ROOT, dir)
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true })
    ok(`Répertoire créé : ${dir}`)
  } else {
    inf(`Répertoire existant : ${dir}`)
  }
})

// Fichier .gitkeep pour les répertoires vides
dirs.forEach(dir => {
  const keepFile = path.join(ROOT, dir, '.gitkeep')
  if (!fs.existsSync(keepFile)) fs.writeFileSync(keepFile, '')
})

// ── ÉTAPE 3 : Installer les dépendances ──────────────────────────────
sep()
console.log(`${c.bold}Étape 3/5 — Installation des dépendances${c.reset}\n`)

try {
  inf('Installation backend (Node.js/Fastify)…')
  execSync('npm install', { cwd: path.join(ROOT, 'backend'), stdio: 'inherit' })
  ok('Dépendances backend installées')
} catch (e) {
  err('Erreur installation backend : ' + e.message)
  err('Essayez manuellement : cd backend && npm install')
}

try {
  inf('Installation frontend (Next.js)…')
  execSync('npm install', { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit' })
  ok('Dépendances frontend installées')
} catch (e) {
  err('Erreur installation frontend : ' + e.message)
  err('Essayez manuellement : cd frontend && npm install')
}

// ── ÉTAPE 4 : Vérification configuration ─────────────────────────────
sep()
console.log(`${c.bold}Étape 4/5 — Vérification configuration${c.reset}\n`)

require('dotenv').config({ path: envPath })

const checks = [
  { name: 'Base de données PostgreSQL', key: 'DB_HOST',   val: process.env.DB_HOST },
  { name: 'Redis Cache',                key: 'REDIS_HOST', val: process.env.REDIS_HOST },
  { name: 'JWT Secret',                 key: 'JWT_SECRET', val: process.env.JWT_SECRET?.length > 30 },
  { name: 'Anthropic API (Ouwalou)',    key: 'ANTHROPIC_API_KEY', val: process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('CHANGE_ME') },
  { name: 'URL Application',           key: 'APP_URL',    val: process.env.APP_URL },
  { name: 'SMTP Email',                 key: 'SMTP_HOST',  val: process.env.SMTP_HOST },
]

checks.forEach(check => {
  if (check.val) {
    ok(`${check.name} configuré (${check.key})`)
  } else {
    const isOptional = ['ANTHROPIC_API_KEY','SMTP_HOST'].includes(check.key)
    if (isOptional) {
      console.log(`${c.yellow}⚠️${c.reset}  ${check.name} — à configurer dans .env (optionnel pour le démarrage)`)
    } else {
      err(`${check.name} non configuré — Modifiez ${check.key} dans .env`)
    }
  }
})

// ── ÉTAPE 5 : Instructions finales ───────────────────────────────────
sep()
console.log(`${c.bold}Étape 5/5 — Instructions finales${c.reset}\n`)

console.log(`${c.green}${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`)
console.log(`${c.green}${c.bold}  Configuration terminée !${c.reset}`)
console.log(`${c.green}${c.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}\n`)

console.log(`${c.bold}📋 Étapes suivantes :${c.reset}\n`)
console.log(`  ${c.cyan}1.${c.reset} Configurez votre base de données PostgreSQL :`)
console.log(`     ${c.dim}createdb ocs7venhotel${c.reset}\n`)
console.log(`  ${c.cyan}2.${c.reset} Exécutez les migrations :`)
console.log(`     ${c.dim}npm run db:migrate${c.reset}\n`)
console.log(`  ${c.cyan}3.${c.reset} Chargez les données initiales :`)
console.log(`     ${c.dim}npm run db:seed${c.reset}\n`)
console.log(`  ${c.cyan}4.${c.reset} Démarrez en développement :`)
console.log(`     ${c.dim}npm run dev${c.reset}\n`)
console.log(`  ${c.cyan}5.${c.reset} Accédez à l'application :`)
console.log(`     ${c.dim}Frontend : http://localhost:3000${c.reset}`)
console.log(`     ${c.dim}API      : http://localhost:3001${c.reset}\n`)

console.log(`${c.bold}🔐 Comptes de démonstration :${c.reset}`)
console.log(`   ${c.dim}superadmin@demo.com / demo123${c.reset}`)
console.log(`   ${c.dim}manager@demo.com    / demo123${c.reset}`)
console.log(`   ${c.dim}reception@demo.com  / demo123${c.reset}\n`)

console.log(`${c.bold}📖 Documentation complète : README.md${c.reset}\n`)
