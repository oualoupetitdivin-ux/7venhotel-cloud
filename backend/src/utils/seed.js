'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// 7venHotel Cloud — Seed de production
//
// Ce fichier est conçu pour être appelé de deux manières :
//   1. Comme module : require('./seed').seeder(knexInstance)
//      → Utilisé par server.js au démarrage si SEED_ON_BOOT=true
//      → La connexion BDD est fournie par le plugin database déjà initialisé
//
//   2. Comme script autonome : node backend/src/utils/seed.js
//      → Utilisé via Railway "Run Command" ou en local
//      → Crée sa propre connexion, puis la ferme proprement
//
// IDEMPOTENCE : chaque INSERT est protégé par ON CONFLICT DO NOTHING
// Le seed peut être exécuté N fois sans effet secondaire.
//
// CREDENTIALS : aucun credential hardcodé.
// Les mots de passe sont lus depuis les variables d'environnement :
//   SEED_ADMIN_PASSWORD  → mot de passe du compte superadmin@demo.com
//   SEED_DEMO_PASSWORD   → mot de passe de tous les comptes démo
// ─────────────────────────────────────────────────────────────────────────────

const path   = require('path')
const bcrypt = require('bcryptjs')
const Knex   = require('knex')

// ── Helpers ───────────────────────────────────────────────────────────────────

function masquerUrl(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//[credentials]@${u.host}${u.pathname}`
  } catch {
    return '[URL invalide]'
  }
}

function log(msg)  { console.log(`[seed] ${msg}`) }
function warn(msg) { console.warn(`[seed] ⚠️  ${msg}`) }
function err(msg)  { console.error(`[seed] ❌ ${msg}`) }

// ── Validation des variables obligatoires ─────────────────────────────────────
//
// Le seed crée des utilisateurs avec des mots de passe.
// Ces mots de passe DOIVENT venir de variables d'environnement —
// jamais hardcodés dans le code source.
//
// Si les variables sont absentes, le seed refuse de s'exécuter.
// Cela protège contre un déploiement accidentel avec des credentials par défaut.

function validerVariablesSeed() {
  const manquantes = []

  if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 8) {
    manquantes.push('SEED_ADMIN_PASSWORD (min 8 caractères) — mot de passe du superadmin@demo.com')
  }
  if (!process.env.SEED_DEMO_PASSWORD || process.env.SEED_DEMO_PASSWORD.length < 8) {
    manquantes.push('SEED_DEMO_PASSWORD (min 8 caractères) — mot de passe des comptes démo')
  }

  if (manquantes.length > 0) {
    err('Variables manquantes pour le seed :')
    manquantes.forEach(v => err(`  ✗ ${v}`))
    err('Ajoutez ces variables dans Railway → Variables avant de relancer.')
    throw new Error('Variables SEED_* manquantes — seed annulé')
  }
}

// ── Résolution connexion — même stratégie 3 niveaux que database.js ───────────
//
// Quand seed.js est appelé comme script autonome (Railway Run Command, local),
// il doit résoudre la connexion de la même façon que database.js.
// Cohérence garantie — pas de logique dupliquée divergente.

function creerConnexionAutonome() {
  let connection

  if (process.env.DATABASE_PRIVATE_URL) {
    log(`Connexion : réseau privé Railway → ${masquerUrl(process.env.DATABASE_PRIVATE_URL)}`)
    connection = {
      connectionString: process.env.DATABASE_PRIVATE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
    }
  } else if (process.env.DATABASE_URL) {
    log(`Connexion : URL publique → ${masquerUrl(process.env.DATABASE_URL)}`)
    const sslActif = process.env.DB_SSL === 'true' || !process.env.DB_SSL
    connection = {
      connectionString: process.env.DATABASE_URL,
      ssl: sslActif ? { rejectUnauthorized: false } : false
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PRODUCTION : DATABASE_PRIVATE_URL et DATABASE_URL absentes.\n' +
      'Attachez le plugin PostgreSQL Railway au service.'
    )
  } else {
    const host     = process.env.PGHOST     || process.env.DB_HOST     || 'localhost'
    const port     = parseInt(process.env.PGPORT || process.env.DB_PORT) || 5432
    const database = process.env.PGDATABASE || process.env.DB_NAME     || 'ocs7venhotel'
    const user     = process.env.PGUSER     || process.env.DB_USER     || 'postgres'
    const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || ''
    log(`Connexion : variables locales → ${host}:${port}/${database}`)
    connection = { host, port, database, user, password, ssl: false }
  }

  return Knex({
    client: 'pg',
    connection,
    pool: { min: 1, max: 2 }  // Pool minimal — seed = usage one-shot
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale — exportée ET utilisable en script autonome
//
// @param {object} knexInstance  — instance Knex existante (mode module)
//                                 Si absent, une connexion autonome est créée.
// @returns {Promise<object>}    — résumé des opérations effectuées
// ─────────────────────────────────────────────────────────────────────────────
async function seeder(knexInstance) {
  validerVariablesSeed()

  // Mode module (appelé par server.js) : réutilise la connexion existante
  // Mode script autonome : crée sa propre connexion
  const modeAutonome = !knexInstance
  const db = knexInstance || creerConnexionAutonome()

  const resume = {
    permissions:    0,
    rolePermissions: 0,
    tenant:         false,
    abonnement:     false,
    hotel:          false,
    utilisateurs:   0,
    typesChambre:   0,
    taxes:          0,
    tauxChange:     0,
    articlesMenu:   0,
  }

  try {
    log('Démarrage du seed...')

    // ── Vérification idempotence globale ─────────────────────────────────────
    //
    // Avant d'insérer quoi que ce soit, on vérifie si les données existent déjà.
    // Si le superadmin est présent et son hash est valide (pas un placeholder),
    // le seed est considéré comme déjà appliqué → sortie immédiate.
    //
    // Cette vérification est intentionnellement stricte :
    // un hash bcrypt valide commence toujours par '$2b$' ou '$2a$'.

    const [adminExistant] = await db('utilisateurs')
      .where({ email: 'superadmin@demo.com' })
      .whereNot('mot_de_passe_hash', 'like', '$2b$12$placeholder%')
      .whereNot('mot_de_passe_hash', 'like', '$2a$12$placeholder%')
      .select('id', 'email')
      .limit(1)

    if (adminExistant) {
      log('Seed déjà appliqué (superadmin@demo.com présent avec hash valide) — aucune action.')
      return resume
    }

    log('Base vide ou seed incomplet détecté — application du seed...')

    // ── Hash des mots de passe ────────────────────────────────────────────────
    // bcrypt cost factor 12 — standard production (équilibre sécurité/performance)
    log('Génération des hash bcrypt (cost 12)...')
    const [adminHash, demoHash] = await Promise.all([
      bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12),
      bcrypt.hash(process.env.SEED_DEMO_PASSWORD,  12),
    ])
    log('Hash générés.')

    // Toutes les insertions dans une transaction unique
    // → soit tout réussit, soit rien n'est inséré (atomicité)
    await db.transaction(async (trx) => {

      // ── 1. Permissions système ──────────────────────────────────────────────
      const permissions = [
        // Réservations
        { code: 'reservations.lire',      description: 'Voir les réservations',         module: 'reservations', action: 'lire' },
        { code: 'reservations.creer',     description: 'Créer une réservation',         module: 'reservations', action: 'creer' },
        { code: 'reservations.modifier',  description: 'Modifier une réservation',      module: 'reservations', action: 'modifier' },
        { code: 'reservations.supprimer', description: 'Supprimer une réservation',     module: 'reservations', action: 'supprimer' },
        { code: 'reservations.annuler',   description: 'Annuler une réservation',       module: 'reservations', action: 'administrer' },
        // Chambres
        { code: 'chambres.lire',          description: 'Voir les chambres',             module: 'chambres',      action: 'lire' },
        { code: 'chambres.modifier',      description: 'Modifier une chambre',          module: 'chambres',      action: 'modifier' },
        { code: 'chambres.administrer',   description: 'Administrer les chambres',      module: 'chambres',      action: 'administrer' },
        // Clients
        { code: 'clients.lire',           description: 'Voir les clients',              module: 'clients',       action: 'lire' },
        { code: 'clients.creer',          description: 'Créer un client',               module: 'clients',       action: 'creer' },
        { code: 'clients.modifier',       description: 'Modifier un client',            module: 'clients',       action: 'modifier' },
        // Ménage
        { code: 'menage.lire',            description: 'Voir les tâches ménage',        module: 'menage',        action: 'lire' },
        { code: 'menage.creer',           description: 'Créer une tâche ménage',        module: 'menage',        action: 'creer' },
        { code: 'menage.modifier',        description: 'Modifier une tâche ménage',     module: 'menage',        action: 'modifier' },
        { code: 'menage.valider',         description: 'Valider le ménage',             module: 'menage',        action: 'administrer' },
        // Maintenance
        { code: 'maintenance.lire',       description: 'Voir les tickets',              module: 'maintenance',   action: 'lire' },
        { code: 'maintenance.creer',      description: 'Créer un ticket',               module: 'maintenance',   action: 'creer' },
        { code: 'maintenance.modifier',   description: 'Modifier un ticket',            module: 'maintenance',   action: 'modifier' },
        // Restaurant
        { code: 'restaurant.lire',        description: 'Voir les commandes',            module: 'restaurant',    action: 'lire' },
        { code: 'restaurant.creer',       description: 'Créer une commande',            module: 'restaurant',    action: 'creer' },
        { code: 'restaurant.modifier',    description: 'Modifier une commande',         module: 'restaurant',    action: 'modifier' },
        // Facturation
        { code: 'facturation.lire',       description: 'Voir les factures',             module: 'facturation',   action: 'lire' },
        { code: 'facturation.creer',      description: 'Créer une facture',             module: 'facturation',   action: 'creer' },
        { code: 'facturation.modifier',   description: 'Modifier une facture',          module: 'facturation',   action: 'modifier' },
        // Analytics
        { code: 'analytics.lire',         description: 'Voir les statistiques',         module: 'analytics',     action: 'lire' },
        // Paramètres
        { code: 'parametres.lire',        description: 'Voir les paramètres',           module: 'parametres',    action: 'lire' },
        { code: 'parametres.modifier',    description: 'Modifier les paramètres',       module: 'parametres',    action: 'modifier' },
        // Staff
        { code: 'staff.lire',             description: 'Voir le personnel',             module: 'staff',         action: 'lire' },
        { code: 'staff.administrer',      description: 'Gérer le personnel',            module: 'staff',         action: 'administrer' },
        // Plateforme
        { code: 'plateforme.administrer', description: 'Administrer la plateforme',     module: 'plateforme',    action: 'administrer' },
      ]

      // ON CONFLICT DO NOTHING — idempotent sur la colonne unique `code`
      const insertedPerms = await trx('permissions')
        .insert(permissions)
        .onConflict('code')
        .ignore()
        .returning('id')

      resume.permissions = insertedPerms.length
      log(`Permissions : ${resume.permissions} insérées (${permissions.length - resume.permissions} déjà présentes)`)

      // ── 2. Permissions par rôle ─────────────────────────────────────────────
      // Récupération de toutes les permissions pour construire les associations
      const toutesPermissions = await trx('permissions').select('id', 'code')
      const permParCode = Object.fromEntries(toutesPermissions.map(p => [p.code, p.id]))

      const rolesPermissions = []

      // Super Admin : toutes les permissions
      toutesPermissions.forEach(p => rolesPermissions.push({ role: 'super_admin', permission_id: p.id }))

      // Manager : tout sauf plateforme.administrer
      toutesPermissions
        .filter(p => p.code !== 'plateforme.administrer')
        .forEach(p => rolesPermissions.push({ role: 'manager', permission_id: p.id }))

      // Réception
      const codesReception = [
        'reservations.lire','reservations.creer','reservations.modifier','reservations.annuler',
        'chambres.lire','clients.lire','clients.creer','clients.modifier',
        'maintenance.creer','restaurant.creer','facturation.lire','menage.lire',
      ]
      codesReception
        .filter(c => permParCode[c])
        .forEach(c => rolesPermissions.push({ role: 'reception', permission_id: permParCode[c] }))

      // Housekeeping
      const codesHousekeeping = ['menage.lire','menage.creer','menage.modifier','menage.valider','chambres.lire']
      codesHousekeeping
        .filter(c => permParCode[c])
        .forEach(c => rolesPermissions.push({ role: 'housekeeping', permission_id: permParCode[c] }))

      // Restaurant
      const codesRestaurant = ['restaurant.lire','restaurant.creer','restaurant.modifier','facturation.lire','reservations.lire']
      codesRestaurant
        .filter(c => permParCode[c])
        .forEach(c => rolesPermissions.push({ role: 'restaurant', permission_id: permParCode[c] }))

      // Comptabilité
      const codesCompta = ['facturation.lire','facturation.creer','facturation.modifier','analytics.lire','reservations.lire','clients.lire']
      codesCompta
        .filter(c => permParCode[c])
        .forEach(c => rolesPermissions.push({ role: 'comptabilite', permission_id: permParCode[c] }))

      // Technicien
      const codesTechnicien = ['maintenance.lire','maintenance.creer','maintenance.modifier','chambres.lire']
      codesTechnicien
        .filter(c => permParCode[c])
        .forEach(c => rolesPermissions.push({ role: 'technicien', permission_id: permParCode[c] }))

      const insertedRolePerms = await trx('role_permissions')
        .insert(rolesPermissions)
        .onConflict(['role', 'permission_id'])
        .ignore()
        .returning('role')

      resume.rolePermissions = insertedRolePerms.length
      log(`Rôle-permissions : ${resume.rolePermissions} insérées`)

      // ── 3. Tenant démo ──────────────────────────────────────────────────────
      const TENANT_ID = '11111111-1111-1111-1111-111111111111'
      const HOTEL_ID  = '22222222-2222-2222-2222-222222222222'
      const ADMIN_ID  = '33333333-3333-3333-3333-333333333333'

      const [tenantInsere] = await trx('tenants')
        .insert({
          id:            TENANT_ID,
          nom:           'Groupe Hôtelier Royal Cameroun',
          slug:          'royal-cameroun',
          email_contact: 'admin@royalcameroun.cm',
          telephone:     '+237 222 000 000',
          adresse:       'Rue Charles de Gaulle, Yaoundé',
          pays:          'Cameroun',
          devise_defaut: 'XAF',
        })
        .onConflict('id')
        .ignore()
        .returning('id')

      resume.tenant = !!tenantInsere
      log(`Tenant : ${resume.tenant ? 'inséré' : 'déjà présent'}`)

      // ── 4. Abonnement ───────────────────────────────────────────────────────
      const [abonnInsere] = await trx('abonnements')
        .insert({
          tenant_id:         TENANT_ID,
          plan:              'enterprise',
          statut:            'actif',
          date_debut:        new Date(),
          max_hotels:        5,
          max_chambres:      500,
          max_utilisateurs:  50,
        })
        .onConflict('tenant_id')
        .ignore()
        .returning('tenant_id')

      resume.abonnement = !!abonnInsere
      log(`Abonnement : ${resume.abonnement ? 'inséré' : 'déjà présent'}`)

      // ── 5. Hôtel démo ───────────────────────────────────────────────────────
      const [hotelInsere] = await trx('hotels')
        .insert({
          id:              HOTEL_ID,
          tenant_id:       TENANT_ID,
          nom:             'Hôtel Royal Yaoundé',
          slug:            'hotel-royal-yaounde',
          description:     "Hôtel 5 étoiles au cœur de Yaoundé offrant un cadre d'exception alliant modernité et hospitalité africaine.",
          adresse:         'Avenue Kennedy, Centre-ville',
          ville:           'Yaoundé',
          pays:            'Cameroun',
          telephone:       '+237 222 123 456',
          email:           'reception@royalyaounde.cm',
          nombre_etoiles:  5,
          nombre_chambres: 142,
          nombre_etages:   5,
        })
        .onConflict('id')
        .ignore()
        .returning('id')

      resume.hotel = !!hotelInsere
      log(`Hôtel : ${resume.hotel ? 'inséré' : 'déjà présent'}`)

      // Paramètres hôtel
      await trx('parametres_hotel')
        .insert({
          hotel_id:       HOTEL_ID,
          devise:         'XAF',
          fuseau_horaire: 'Africa/Douala',
          heure_arrivee:  '14:00:00',
          heure_depart:   '12:00:00',
          tva_numero:     'CM-TXP-2024-001',
        })
        .onConflict('hotel_id')
        .ignore()

      // ── 6. Utilisateurs ─────────────────────────────────────────────────────
      const utilisateurs = [
        {
          id:                 ADMIN_ID,
          tenant_id:          TENANT_ID,
          hotel_id:           HOTEL_ID,
          email:              'superadmin@demo.com',
          mot_de_passe_hash:  adminHash,
          prenom:             'Super',
          nom:                'Admin',
          role:               'super_admin',
        },
        {
          tenant_id:         TENANT_ID,
          hotel_id:          HOTEL_ID,
          email:             'manager@demo.com',
          mot_de_passe_hash: demoHash,
          prenom:            'Marie',
          nom:               'Laurent',
          role:              'manager',
        },
        {
          tenant_id:         TENANT_ID,
          hotel_id:          HOTEL_ID,
          email:             'reception@demo.com',
          mot_de_passe_hash: demoHash,
          prenom:            'Pierre',
          nom:               'Moreau',
          role:              'reception',
        },
        {
          tenant_id:         TENANT_ID,
          hotel_id:          HOTEL_ID,
          email:             'housekeeping@demo.com',
          mot_de_passe_hash: demoHash,
          prenom:            'Fatou',
          nom:               'Diallo',
          role:              'housekeeping',
        },
        {
          tenant_id:         TENANT_ID,
          hotel_id:          HOTEL_ID,
          email:             'restaurant@demo.com',
          mot_de_passe_hash: demoHash,
          prenom:            'Jean-Luc',
          nom:               'Baron',
          role:              'restaurant',
        },
        {
          tenant_id:         TENANT_ID,
          hotel_id:          HOTEL_ID,
          email:             'accounting@demo.com',
          mot_de_passe_hash: demoHash,
          prenom:            'Sophie',
          nom:               'Renard',
          role:              'comptabilite',
        },
      ]

      // ON CONFLICT sur email — idempotent
      // Si l'utilisateur existe avec un hash placeholder, on met à jour le hash
      for (const u of utilisateurs) {
        await trx('utilisateurs')
          .insert(u)
          .onConflict('email')
          .merge(['mot_de_passe_hash'])  // Met à jour le hash si c'était un placeholder
      }

      resume.utilisateurs = utilisateurs.length
      log(`Utilisateurs : ${utilisateurs.length} traités (insérés ou hash mis à jour)`)

      // ── 7. Types de chambre ─────────────────────────────────────────────────
      const typesChambre = [
        { hotel_id: HOTEL_ID, nom: 'Standard',           description: 'Chambre confortable et fonctionnelle', capacite_adultes: 2, superficie_m2: 18,  tarif_base: 22000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Standard Twin',      description: 'Chambre avec 2 lits simples',          capacite_adultes: 2, superficie_m2: 20,  tarif_base: 24000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Supérieure',         description: 'Chambre spacieuse avec lit king',       capacite_adultes: 2, superficie_m2: 24,  tarif_base: 28000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Deluxe',             description: 'Chambre de luxe avec balcon piscine',   capacite_adultes: 2, superficie_m2: 32,  tarif_base: 38000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Junior Suite',       description: 'Suite avec salon séparé',               capacite_adultes: 3, superficie_m2: 45,  tarif_base: 55000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Suite Royale',       description: 'Suite 2 chambres panoramique',          capacite_adultes: 4, superficie_m2: 72,  tarif_base: 98000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Suite Présidentielle', description: 'Suite 3 chambres exclusive',          capacite_adultes: 6, superficie_m2: 110, tarif_base: 150000, devise: 'XAF' },
      ]

      const insertedTypes = await trx('types_chambre')
        .insert(typesChambre)
        .onConflict(['hotel_id', 'nom'])
        .ignore()
        .returning('id')

      resume.typesChambre = insertedTypes.length
      log(`Types de chambre : ${resume.typesChambre} insérés`)

      // ── 8. Taxes ────────────────────────────────────────────────────────────
      const taxes = [
        { hotel_id: HOTEL_ID, nom: 'TVA Hôtellerie', code: 'TVA_HOTEL',    type_taxe: 'pourcentage', valeur: 19.25, s_applique_a: 'hebergement', incluse_prix: false, active: true, ordre: 1 },
        { hotel_id: HOTEL_ID, nom: 'Taxe de séjour', code: 'TAXE_SEJOUR',  type_taxe: 'fixe',        valeur: 500,   s_applique_a: 'hebergement', incluse_prix: false, active: true, ordre: 2 },
        { hotel_id: HOTEL_ID, nom: 'Service',        code: 'SERVICE',      type_taxe: 'pourcentage', valeur: 10,    s_applique_a: 'restaurant',  incluse_prix: false, active: true, ordre: 3 },
        { hotel_id: HOTEL_ID, nom: 'TVA Restaurant', code: 'TVA_RESTO',    type_taxe: 'pourcentage', valeur: 19.25, s_applique_a: 'restaurant',  incluse_prix: false, active: true, ordre: 4 },
      ]

      const insertedTaxes = await trx('taxes')
        .insert(taxes)
        .onConflict(['hotel_id', 'code'])
        .ignore()
        .returning('id')

      resume.taxes = insertedTaxes.length
      log(`Taxes : ${resume.taxes} insérées`)

      // ── 9. Taux de change ───────────────────────────────────────────────────
      const tauxChange = [
        { devise_base: 'XAF', devise_cible: 'EUR', taux: 0.001524 },
        { devise_base: 'XAF', devise_cible: 'USD', taux: 0.001657 },
        { devise_base: 'XAF', devise_cible: 'GBP', taux: 0.001302 },
        { devise_base: 'XAF', devise_cible: 'XOF', taux: 1.000000 },
        { devise_base: 'XAF', devise_cible: 'MAD', taux: 0.016654 },
        { devise_base: 'XAF', devise_cible: 'NGN', taux: 2.476300 },
        { devise_base: 'XAF', devise_cible: 'ZAR', taux: 0.031024 },
        { devise_base: 'XAF', devise_cible: 'CAD', taux: 0.002243 },
        { devise_base: 'XAF', devise_cible: 'CHF', taux: 0.001504 },
        { devise_base: 'XAF', devise_cible: 'JPY', taux: 0.251320 },
        { devise_base: 'XAF', devise_cible: 'CNY', taux: 0.012017 },
      ]

      const insertedTaux = await trx('taux_change')
        .insert(tauxChange)
        .onConflict(['devise_base', 'devise_cible'])
        .ignore()
        .returning('id')

      resume.tauxChange = insertedTaux.length
      log(`Taux de change : ${resume.tauxChange} insérés`)

      // ── 10. Articles menu restaurant démo ───────────────────────────────────
      const articlesMenu = [
        // Petit-déjeuner
        { hotel_id: HOTEL_ID, categorie: 'Petit-déjeuner', nom: 'Omelette du chef',   description: 'Herbes fraîches, tomates',          prix: 3500,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Petit-déjeuner', nom: 'Plateau complet',    description: 'Jus + œuf + viennoiserie + café',    prix: 6500,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Petit-déjeuner', nom: 'Café ou thé',        description: 'Chaud ou froid',                     prix: 800,   devise: 'XAF', ordre: 3 },
        // Entrées
        { hotel_id: HOTEL_ID, categorie: 'Entrées',        nom: 'Foie gras maison',   description: 'Brioche toastée',                    prix: 9500,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Entrées',        nom: 'Salade César',       description: 'Poulet grillé, parmesan',            prix: 7500,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Entrées',        nom: 'Tartare saumon',     description: 'Sauce citron',                       prix: 8500,  devise: 'XAF', ordre: 3 },
        // Plats
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Entrecôte grillée',  description: 'Sauce béarnaise, frites',            prix: 18500, devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Ndolé au bœuf',      description: 'Spécialité camerounaise',            prix: 13500, devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Poulet yassa',       description: 'Recette du chef',                    prix: 12000, devise: 'XAF', ordre: 3 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Tilapia braisé',     description: 'Légumes grillés',                    prix: 14000, devise: 'XAF', ordre: 4 },
        // Desserts
        { hotel_id: HOTEL_ID, categorie: 'Desserts',       nom: 'Crème brûlée',       description: 'Vanille bourbon',                    prix: 4800,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Desserts',       nom: 'Fondant chocolat',   description: 'Cœur coulant',                       prix: 4200,  devise: 'XAF', ordre: 2 },
        // Boissons
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Eau minérale',       description: '50cl × 2',                           prix: 1200,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Jus de fruits frais',description: 'Orange ou ananas',                   prix: 1800,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Vin rouge',          description: 'Bouteille 75cl',                     prix: 8500,  devise: 'XAF', ordre: 3 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Bière locale',       description: '33cl',                               prix: 2000,  devise: 'XAF', ordre: 4 },
      ]

      const insertedMenu = await trx('articles_menu')
        .insert(articlesMenu)
        .onConflict(['hotel_id', 'categorie', 'nom'])
        .ignore()
        .returning('id')

      resume.articlesMenu = insertedMenu.length
      log(`Articles menu : ${resume.articlesMenu} insérés`)

    }) // fin transaction

    // ── Récapitulatif ─────────────────────────────────────────────────────────
    log('═══════════════════════════════════════════════')
    log('✅ Seed terminé avec succès')
    log('───────────────────────────────────────────────')
    log('Comptes créés :')
    log(`  superadmin@demo.com   → [SEED_ADMIN_PASSWORD]`)
    log(`  manager@demo.com      → [SEED_DEMO_PASSWORD]`)
    log(`  reception@demo.com    → [SEED_DEMO_PASSWORD]`)
    log(`  housekeeping@demo.com → [SEED_DEMO_PASSWORD]`)
    log(`  restaurant@demo.com   → [SEED_DEMO_PASSWORD]`)
    log(`  accounting@demo.com   → [SEED_DEMO_PASSWORD]`)
    log('═══════════════════════════════════════════════')

    return resume

  } finally {
    // Fermeture de la connexion uniquement si créée ici (mode autonome)
    // En mode module, la connexion appartient à database.js — ne pas la fermer
    if (modeAutonome) {
      await db.destroy()
      log('Connexion fermée.')
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée script autonome
//
// Exécuté uniquement si appelé directement :
//   node backend/src/utils/seed.js
//
// Si importé comme module (require('./seed')), cette partie est ignorée.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  require('dotenv').config({
    path: require('path').join(__dirname, '../../../.env')
  })

  seeder()
    .then(resume => {
      log(`Résumé : ${JSON.stringify(resume, null, 2)}`)
      process.exit(0)
    })
    .catch(e => {
      err(e.message)
      process.exit(1)
    })
}

module.exports = { seeder }
