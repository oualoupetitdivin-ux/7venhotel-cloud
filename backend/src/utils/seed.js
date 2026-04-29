'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// 7venHotel Cloud — Seed de production — VERSION FINALE
//
// PRINCIPE D'IDEMPOTENCE :
//   Chaque entité est vérifiée par SELECT avant INSERT.
//   Aucun onConflict n'est utilisé sans contrainte UNIQUE réelle dans le schéma.
//
// CARTOGRAPHIE DES CONTRAINTES UNIQUES (schéma SQL source de vérité) :
//   tenants          → PRIMARY KEY(id), UNIQUE(slug)
//   abonnements      → PRIMARY KEY(id) — PAS de UNIQUE(tenant_id)
//   hotels           → PRIMARY KEY(id), UNIQUE(tenant_id, slug)
//   parametres_hotel → PRIMARY KEY(id), UNIQUE(hotel_id)
//   utilisateurs     → PRIMARY KEY(id), UNIQUE(tenant_id, email)
//   permissions      → PRIMARY KEY(id), UNIQUE(code)
//   role_permissions → PRIMARY KEY(role, permission_id)
//   types_chambre    → PRIMARY KEY(id) — PAS de UNIQUE(hotel_id, nom)
//   taxes            → PRIMARY KEY(id) — PAS de UNIQUE(hotel_id, code)
//   taux_change      → PRIMARY KEY(id) — PAS de UNIQUE(devise_base, devise_cible)
//   articles_menu    → PRIMARY KEY(id) — PAS de UNIQUE(hotel_id, categorie, nom)
//
// STRATÉGIE PAR TABLE :
//   UNIQUE réelle disponible → .onConflict().ignore() Knex
//   Pas de UNIQUE            → SELECT préalable + INSERT conditionnel
//
// USAGE :
//   Module : const { seeder } = require('./seed') ; await seeder(knexInstance)
//   Script : node backend/src/utils/seed.js
// ─────────────────────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs')
const Knex   = require('knex')
const path   = require('path')

// ── Helpers ───────────────────────────────────────────────────────────────────

function masquerUrl(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//[credentials]@${u.host}${u.pathname}`
  } catch { return '[URL invalide]' }
}

function log(msg) { console.log(`[seed] ${msg}`) }
function err(msg) { console.error(`[seed] ❌ ${msg}`) }

// ── Validation des variables obligatoires ─────────────────────────────────────

function validerVariablesSeed() {
  const manquantes = []
  if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 8)
    manquantes.push('SEED_ADMIN_PASSWORD (min 8 caractères)')
  if (!process.env.SEED_DEMO_PASSWORD || process.env.SEED_DEMO_PASSWORD.length < 8)
    manquantes.push('SEED_DEMO_PASSWORD (min 8 caractères)')
  if (manquantes.length > 0) {
    manquantes.forEach(v => err(`Variable manquante : ${v}`))
    throw new Error('Variables SEED_* manquantes — seed annulé')
  }
}

// ── Connexion autonome (mode script) ──────────────────────────────────────────

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
    connection = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('PRODUCTION : DATABASE_PRIVATE_URL et DATABASE_URL absentes.')
  } else {
    const host     = process.env.PGHOST     || process.env.DB_HOST     || 'localhost'
    const port     = parseInt(process.env.PGPORT || process.env.DB_PORT) || 5432
    const database = process.env.PGDATABASE || process.env.DB_NAME     || 'ocs7venhotel'
    const user     = process.env.PGUSER     || process.env.DB_USER     || 'postgres'
    const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || ''
    log(`Connexion : locale → ${host}:${port}/${database}`)
    connection = { host, port, database, user, password, ssl: false }
  }

  return Knex({ client: 'pg', connection, pool: { min: 1, max: 2 } })
}

// ── UUIDs fixes pour les données de démo ──────────────────────────────────────
const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const HOTEL_ID  = '22222222-2222-2222-2222-222222222222'

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────────────────────────
async function seeder(knexInstance) {
  validerVariablesSeed()

  const modeAutonome = !knexInstance
  const db = knexInstance || creerConnexionAutonome()

  const resume = {
    permissions: 0, rolePermissions: 0,
    tenant: false, abonnement: false, hotel: false, parametresHotel: false,
    utilisateurs: { inseres: 0, misAJour: 0 },
    typesChambre: 0, taxes: 0, tauxChange: 0, articlesMenu: 0,
  }

  try {
    log('Démarrage du seed...')

    // ── Vérification idempotence globale ──────────────────────────────────────
    const adminExistant = await db('utilisateurs')
      .where({ tenant_id: TENANT_ID, email: 'superadmin@demo.com' })
      .whereNot(db.raw("mot_de_passe_hash LIKE '$2b$12$placeholder%'"))
      .whereNot(db.raw("mot_de_passe_hash LIKE '$2a$12$placeholder%'"))
      .first()

    if (adminExistant) {
      log('Seed déjà appliqué — aucune action.')
      return resume
    }

    log('Application du seed en cours...')

    // Hash bcrypt hors transaction (CPU intensive)
    log('Génération des hash bcrypt...')
    const [adminHash, demoHash] = await Promise.all([
      bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12),
      bcrypt.hash(process.env.SEED_DEMO_PASSWORD,  12),
    ])
    log('Hash générés.')

    await db.transaction(async (trx) => {

      // ────────────────────────────────────────────────────────────────────────
      // 1. PERMISSIONS — UNIQUE(code) → onConflict valide
      // ────────────────────────────────────────────────────────────────────────
      const permissions = [
        { code: 'reservations.lire',      description: 'Voir les réservations',     module: 'reservations', action: 'lire'        },
        { code: 'reservations.creer',     description: 'Créer une réservation',     module: 'reservations', action: 'creer'       },
        { code: 'reservations.modifier',  description: 'Modifier une réservation',  module: 'reservations', action: 'modifier'    },
        { code: 'reservations.supprimer', description: 'Supprimer une réservation', module: 'reservations', action: 'supprimer'   },
        { code: 'reservations.annuler',   description: 'Annuler une réservation',   module: 'reservations', action: 'administrer' },
        { code: 'chambres.lire',          description: 'Voir les chambres',         module: 'chambres',     action: 'lire'        },
        { code: 'chambres.modifier',      description: 'Modifier une chambre',      module: 'chambres',     action: 'modifier'    },
        { code: 'chambres.administrer',   description: 'Administrer les chambres',  module: 'chambres',     action: 'administrer' },
        { code: 'clients.lire',           description: 'Voir les clients',          module: 'clients',      action: 'lire'        },
        { code: 'clients.creer',          description: 'Créer un client',           module: 'clients',      action: 'creer'       },
        { code: 'clients.modifier',       description: 'Modifier un client',        module: 'clients',      action: 'modifier'    },
        { code: 'menage.lire',            description: 'Voir les tâches ménage',    module: 'menage',       action: 'lire'        },
        { code: 'menage.creer',           description: 'Créer une tâche ménage',    module: 'menage',       action: 'creer'       },
        { code: 'menage.modifier',        description: 'Modifier une tâche ménage', module: 'menage',       action: 'modifier'    },
        { code: 'menage.valider',         description: 'Valider le ménage',         module: 'menage',       action: 'administrer' },
        { code: 'maintenance.lire',       description: 'Voir les tickets',          module: 'maintenance',  action: 'lire'        },
        { code: 'maintenance.creer',      description: 'Créer un ticket',           module: 'maintenance',  action: 'creer'       },
        { code: 'maintenance.modifier',   description: 'Modifier un ticket',        module: 'maintenance',  action: 'modifier'    },
        { code: 'restaurant.lire',        description: 'Voir les commandes',        module: 'restaurant',   action: 'lire'        },
        { code: 'restaurant.creer',       description: 'Créer une commande',        module: 'restaurant',   action: 'creer'       },
        { code: 'restaurant.modifier',    description: 'Modifier une commande',     module: 'restaurant',   action: 'modifier'    },
        { code: 'facturation.lire',       description: 'Voir les factures',         module: 'facturation',  action: 'lire'        },
        { code: 'facturation.creer',      description: 'Créer une facture',         module: 'facturation',  action: 'creer'       },
        { code: 'facturation.modifier',   description: 'Modifier une facture',      module: 'facturation',  action: 'modifier'    },
        { code: 'analytics.lire',         description: 'Voir les statistiques',     module: 'analytics',    action: 'lire'        },
        { code: 'parametres.lire',        description: 'Voir les paramètres',       module: 'parametres',   action: 'lire'        },
        { code: 'parametres.modifier',    description: 'Modifier les paramètres',   module: 'parametres',   action: 'modifier'    },
        { code: 'staff.lire',             description: 'Voir le personnel',         module: 'staff',        action: 'lire'        },
        { code: 'staff.administrer',      description: 'Gérer le personnel',        module: 'staff',        action: 'administrer' },
        { code: 'plateforme.administrer', description: 'Administrer la plateforme', module: 'plateforme',   action: 'administrer' },
      ]

      const insertedPerms = await trx('permissions')
        .insert(permissions)
        .onConflict('code')  // ✅ UNIQUE(code)
        .ignore()
        .returning('id')

      resume.permissions = insertedPerms.length
      log(`Permissions : ${resume.permissions} insérées`)

      // ────────────────────────────────────────────────────────────────────────
      // 2. RÔLE-PERMISSIONS — PRIMARY KEY(role, permission_id) → onConflict valide
      // ────────────────────────────────────────────────────────────────────────
      const toutesPerms = await trx('permissions').select('id', 'code')
      const permParCode = Object.fromEntries(toutesPerms.map(p => [p.code, p.id]))
      const rolesPermissions = []

      toutesPerms.forEach(p => rolesPermissions.push({ role: 'super_admin', permission_id: p.id }))
      toutesPerms.filter(p => p.code !== 'plateforme.administrer')
        .forEach(p => rolesPermissions.push({ role: 'manager', permission_id: p.id }))

      const codesParRole = {
        reception:    ['reservations.lire','reservations.creer','reservations.modifier','reservations.annuler','chambres.lire','clients.lire','clients.creer','clients.modifier','maintenance.creer','restaurant.creer','facturation.lire','menage.lire'],
        housekeeping: ['menage.lire','menage.creer','menage.modifier','menage.valider','chambres.lire'],
        restaurant:   ['restaurant.lire','restaurant.creer','restaurant.modifier','facturation.lire','reservations.lire'],
        comptabilite: ['facturation.lire','facturation.creer','facturation.modifier','analytics.lire','reservations.lire','clients.lire'],
        technicien:   ['maintenance.lire','maintenance.creer','maintenance.modifier','chambres.lire'],
      }

      for (const [role, codes] of Object.entries(codesParRole)) {
        codes.filter(c => permParCode[c])
          .forEach(c => rolesPermissions.push({ role, permission_id: permParCode[c] }))
      }

      const insertedRolePerms = await trx('role_permissions')
        .insert(rolesPermissions)
        .onConflict(['role', 'permission_id'])  // ✅ PRIMARY KEY(role, permission_id)
        .ignore()
        .returning('role')

      resume.rolePermissions = insertedRolePerms.length
      log(`Rôle-permissions : ${resume.rolePermissions} insérées`)

      // ────────────────────────────────────────────────────────────────────────
      // 3. TENANT — PRIMARY KEY(id) → onConflict('id') valide
      // ────────────────────────────────────────────────────────────────────────
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
        .onConflict('id')  // ✅ PRIMARY KEY
        .ignore()
        .returning('id')

      resume.tenant = !!tenantInsere
      log(`Tenant : ${resume.tenant ? 'inséré' : 'déjà présent'}`)

      // ────────────────────────────────────────────────────────────────────────
      // 4. ABONNEMENT — PAS de UNIQUE(tenant_id) → SELECT + INSERT conditionnel
      //    date_debut : type DATE PostgreSQL → 'YYYY-MM-DD' obligatoire
      // ────────────────────────────────────────────────────────────────────────
      const abonnExistant = await trx('abonnements')
        .where({ tenant_id: TENANT_ID })
        .first()

      if (!abonnExistant) {
        await trx('abonnements').insert({
          tenant_id:        TENANT_ID,
          plan:             'enterprise',
          statut:           'actif',
          date_debut:       new Date().toISOString().split('T')[0],
          max_hotels:       5,
          max_chambres:     500,
          max_utilisateurs: 50,
        })
        resume.abonnement = true
      }
      log(`Abonnement : ${resume.abonnement ? 'inséré' : 'déjà présent'}`)

      // ────────────────────────────────────────────────────────────────────────
      // 5. HÔTEL — PRIMARY KEY(id) → onConflict('id') valide
      // ────────────────────────────────────────────────────────────────────────
      const [hotelInsere] = await trx('hotels')
        .insert({
          id:              HOTEL_ID,
          tenant_id:       TENANT_ID,
          nom:             'Hôtel Royal Yaoundé',
          slug:            'hotel-royal-yaounde',
          description:     "Hôtel 5 étoiles au cœur de Yaoundé — modernité et hospitalité africaine.",
          adresse:         'Avenue Kennedy, Centre-ville',
          ville:           'Yaoundé',
          pays:            'Cameroun',
          telephone:       '+237 222 123 456',
          email:           'reception@royalyaounde.cm',
          nombre_etoiles:  5,
          nombre_chambres: 142,
          nombre_etages:   5,
        })
        .onConflict('id')  // ✅ PRIMARY KEY
        .ignore()
        .returning('id')

      resume.hotel = !!hotelInsere
      log(`Hôtel : ${resume.hotel ? 'inséré' : 'déjà présent'}`)

      // ────────────────────────────────────────────────────────────────────────
      // 6. PARAMÈTRES HÔTEL — UNIQUE(hotel_id) → onConflict('hotel_id') valide
      // ────────────────────────────────────────────────────────────────────────
      await trx('parametres_hotel')
        .insert({
          hotel_id:       HOTEL_ID,
          devise:         'XAF',
          fuseau_horaire: 'Africa/Douala',
          heure_arrivee:  '14:00:00',
          heure_depart:   '12:00:00',
          tva_numero:     'CM-TXP-2024-001',
        })
        .onConflict('hotel_id')  // ✅ UNIQUE(hotel_id)
        .ignore()

      resume.parametresHotel = true
      log('Paramètres hôtel : traités')

      // ────────────────────────────────────────────────────────────────────────
      // 7. UTILISATEURS — UNIQUE(tenant_id, email)
      //    id omis → uuid_generate_v4() automatique
      //    SELECT + INSERT/UPDATE par (tenant_id, email)
      // ────────────────────────────────────────────────────────────────────────
      const utilisateurs = [
        { tenant_id: TENANT_ID, hotel_id: HOTEL_ID, email: 'superadmin@demo.com',   mot_de_passe_hash: adminHash, prenom: 'Super',    nom: 'Admin',   role: 'super_admin'  },
        { tenant_id: TENANT_ID, hotel_id: HOTEL_ID, email: 'manager@demo.com',      mot_de_passe_hash: demoHash,  prenom: 'Marie',    nom: 'Laurent', role: 'manager'      },
        { tenant_id: TENANT_ID, hotel_id: HOTEL_ID, email: 'reception@demo.com',    mot_de_passe_hash: demoHash,  prenom: 'Pierre',   nom: 'Moreau',  role: 'reception'    },
        { tenant_id: TENANT_ID, hotel_id: HOTEL_ID, email: 'housekeeping@demo.com', mot_de_passe_hash: demoHash,  prenom: 'Fatou',    nom: 'Diallo',  role: 'housekeeping' },
        { tenant_id: TENANT_ID, hotel_id: HOTEL_ID, email: 'restaurant@demo.com',   mot_de_passe_hash: demoHash,  prenom: 'Jean-Luc', nom: 'Baron',   role: 'restaurant'   },
        { tenant_id: TENANT_ID, hotel_id: HOTEL_ID, email: 'accounting@demo.com',   mot_de_passe_hash: demoHash,  prenom: 'Sophie',   nom: 'Renard',  role: 'comptabilite' },
      ]

      for (const u of utilisateurs) {
        const existant = await trx('utilisateurs')
          .where({ tenant_id: u.tenant_id, email: u.email })
          .first()

        if (!existant) {
          await trx('utilisateurs').insert(u)
          resume.utilisateurs.inseres++
        } else if (
          existant.mot_de_passe_hash.startsWith('$2b$12$placeholder') ||
          existant.mot_de_passe_hash.startsWith('$2a$12$placeholder') ||
          existant.mot_de_passe_hash === '$2b$12$placeholder'
        ) {
          await trx('utilisateurs')
            .where({ tenant_id: u.tenant_id, email: u.email })
            .update({ mot_de_passe_hash: u.mot_de_passe_hash, actif: true })
          resume.utilisateurs.misAJour++
        }
        // Hash bcrypt valide déjà présent → aucune action
      }
      log(`Utilisateurs : ${resume.utilisateurs.inseres} insérés, ${resume.utilisateurs.misAJour} mis à jour`)

      // ────────────────────────────────────────────────────────────────────────
      // 8. TYPES DE CHAMBRE — PAS de UNIQUE(hotel_id, nom)
      //    SELECT + INSERT conditionnel par (hotel_id, nom)
      // ────────────────────────────────────────────────────────────────────────
      const typesChambre = [
        { hotel_id: HOTEL_ID, nom: 'Standard',             description: 'Chambre confortable et fonctionnelle', capacite_adultes: 2, capacite_enfants: 1, superficie_m2: 18,  tarif_base: 22000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Standard Twin',        description: 'Chambre avec 2 lits simples',          capacite_adultes: 2, capacite_enfants: 1, superficie_m2: 20,  tarif_base: 24000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Supérieure',           description: 'Chambre spacieuse avec lit king',       capacite_adultes: 2, capacite_enfants: 1, superficie_m2: 24,  tarif_base: 28000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Deluxe',               description: 'Chambre de luxe avec balcon',           capacite_adultes: 2, capacite_enfants: 1, superficie_m2: 32,  tarif_base: 38000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Junior Suite',         description: 'Suite avec salon séparé',               capacite_adultes: 3, capacite_enfants: 2, superficie_m2: 45,  tarif_base: 55000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Suite Royale',         description: 'Suite 2 chambres panoramique',          capacite_adultes: 4, capacite_enfants: 2, superficie_m2: 72,  tarif_base: 98000,  devise: 'XAF' },
        { hotel_id: HOTEL_ID, nom: 'Suite Présidentielle', description: 'Suite 3 chambres exclusive',            capacite_adultes: 6, capacite_enfants: 3, superficie_m2: 110, tarif_base: 150000, devise: 'XAF' },
      ]

      for (const tc of typesChambre) {
        const existant = await trx('types_chambre')
          .where({ hotel_id: tc.hotel_id, nom: tc.nom })
          .first()
        if (!existant) {
          await trx('types_chambre').insert(tc)
          resume.typesChambre++
        }
      }
      log(`Types de chambre : ${resume.typesChambre} insérés`)

      // ────────────────────────────────────────────────────────────────────────
      // 9. TAXES — PAS de UNIQUE(hotel_id, code)
      //    SELECT + INSERT conditionnel par (hotel_id, code)
      // ────────────────────────────────────────────────────────────────────────
      const taxes = [
        { hotel_id: HOTEL_ID, nom: 'TVA Hôtellerie', code: 'TVA_HOTEL',   type_taxe: 'pourcentage', valeur: 19.25, s_applique_a: 'hebergement', incluse_prix: false, active: true, ordre: 1 },
        { hotel_id: HOTEL_ID, nom: 'Taxe de séjour', code: 'TAXE_SEJOUR', type_taxe: 'fixe',        valeur: 500,   s_applique_a: 'hebergement', incluse_prix: false, active: true, ordre: 2 },
        { hotel_id: HOTEL_ID, nom: 'Service',        code: 'SERVICE',     type_taxe: 'pourcentage', valeur: 10,    s_applique_a: 'restaurant',  incluse_prix: false, active: true, ordre: 3 },
        { hotel_id: HOTEL_ID, nom: 'TVA Restaurant', code: 'TVA_RESTO',   type_taxe: 'pourcentage', valeur: 19.25, s_applique_a: 'restaurant',  incluse_prix: false, active: true, ordre: 4 },
      ]

      for (const tx of taxes) {
        const existant = await trx('taxes')
          .where({ hotel_id: tx.hotel_id, code: tx.code })
          .first()
        if (!existant) {
          await trx('taxes').insert(tx)
          resume.taxes++
        }
      }
      log(`Taxes : ${resume.taxes} insérées`)

      // ────────────────────────────────────────────────────────────────────────
      // 10. TAUX DE CHANGE — PAS de UNIQUE(devise_base, devise_cible)
      //     SELECT + INSERT conditionnel par (devise_base, devise_cible)
      // ────────────────────────────────────────────────────────────────────────
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

      for (const tx of tauxChange) {
        const existant = await trx('taux_change')
          .where({ devise_base: tx.devise_base, devise_cible: tx.devise_cible })
          .first()
        if (!existant) {
          await trx('taux_change').insert(tx)
          resume.tauxChange++
        }
      }
      log(`Taux de change : ${resume.tauxChange} insérés`)

      // ────────────────────────────────────────────────────────────────────────
      // 11. ARTICLES MENU — PAS de UNIQUE(hotel_id, categorie, nom)
      //     SELECT + INSERT conditionnel par (hotel_id, categorie, nom)
      // ────────────────────────────────────────────────────────────────────────
      const articlesMenu = [
        { hotel_id: HOTEL_ID, categorie: 'Petit-déjeuner', nom: 'Omelette du chef',    description: 'Herbes fraîches, tomates',        prix: 3500,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Petit-déjeuner', nom: 'Plateau complet',     description: 'Jus + œuf + viennoiserie + café', prix: 6500,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Petit-déjeuner', nom: 'Café ou thé',         description: 'Chaud ou froid',                  prix: 800,   devise: 'XAF', ordre: 3 },
        { hotel_id: HOTEL_ID, categorie: 'Entrées',        nom: 'Foie gras maison',    description: 'Brioche toastée',                 prix: 9500,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Entrées',        nom: 'Salade César',        description: 'Poulet grillé, parmesan',         prix: 7500,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Entrées',        nom: 'Tartare saumon',      description: 'Sauce citron',                    prix: 8500,  devise: 'XAF', ordre: 3 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Entrecôte grillée',   description: 'Sauce béarnaise, frites',         prix: 18500, devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Ndolé au bœuf',       description: 'Spécialité camerounaise',         prix: 13500, devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Poulet yassa',        description: 'Recette du chef',                 prix: 12000, devise: 'XAF', ordre: 3 },
        { hotel_id: HOTEL_ID, categorie: 'Plats',          nom: 'Tilapia braisé',      description: 'Légumes grillés',                 prix: 14000, devise: 'XAF', ordre: 4 },
        { hotel_id: HOTEL_ID, categorie: 'Desserts',       nom: 'Crème brûlée',        description: 'Vanille bourbon',                 prix: 4800,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Desserts',       nom: 'Fondant chocolat',    description: 'Cœur coulant',                    prix: 4200,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Eau minérale',        description: '50cl × 2',                        prix: 1200,  devise: 'XAF', ordre: 1 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Jus de fruits frais', description: 'Orange ou ananas',                prix: 1800,  devise: 'XAF', ordre: 2 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Vin rouge',           description: 'Bouteille 75cl',                  prix: 8500,  devise: 'XAF', ordre: 3 },
        { hotel_id: HOTEL_ID, categorie: 'Boissons',       nom: 'Bière locale',        description: '33cl',                            prix: 2000,  devise: 'XAF', ordre: 4 },
      ]

      for (const am of articlesMenu) {
        const existant = await trx('articles_menu')
          .where({ hotel_id: am.hotel_id, categorie: am.categorie, nom: am.nom })
          .first()
        if (!existant) {
          await trx('articles_menu').insert(am)
          resume.articlesMenu++
        }
      }
      log(`Articles menu : ${resume.articlesMenu} insérés`)

    }) // ── fin transaction — COMMIT PostgreSQL ──────────────────────────────

    // Récapitulatif affiché POST-COMMIT uniquement
    log('═══════════════════════════════════════════════════════')
    log('✅ Seed terminé avec succès — données commitées en base')
    log('───────────────────────────────────────────────────────')
    log(`  Permissions      : ${resume.permissions}`)
    log(`  Rôle-permissions : ${resume.rolePermissions}`)
    log(`  Utilisateurs     : ${resume.utilisateurs.inseres} insérés, ${resume.utilisateurs.misAJour} mis à jour`)
    log(`  Types de chambre : ${resume.typesChambre}`)
    log(`  Taxes            : ${resume.taxes}`)
    log(`  Taux de change   : ${resume.tauxChange}`)
    log(`  Articles menu    : ${resume.articlesMenu}`)
    log('───────────────────────────────────────────────────────')
    log('Comptes disponibles :')
    log('  superadmin@demo.com   → [SEED_ADMIN_PASSWORD]')
    log('  manager@demo.com      → [SEED_DEMO_PASSWORD]')
    log('  reception@demo.com    → [SEED_DEMO_PASSWORD]')
    log('  housekeeping@demo.com → [SEED_DEMO_PASSWORD]')
    log('  restaurant@demo.com   → [SEED_DEMO_PASSWORD]')
    log('  accounting@demo.com   → [SEED_DEMO_PASSWORD]')
    log('═══════════════════════════════════════════════════════')

    return resume

  } finally {
    if (modeAutonome) {
      await db.destroy()
      log('Connexion fermée.')
    }
  }
}

// ── Point d'entrée script autonome ────────────────────────────────────────────
if (require.main === module) {
  require('dotenv').config({
    path: require('path').join(__dirname, '../../../.env')
  })

  seeder()
    .then(resume => {
      console.log('[seed] Résumé :', JSON.stringify(resume, null, 2))
      process.exit(0)
    })
    .catch(e => {
      err(e.message)
      process.exit(1)
    })
}

module.exports = { seeder }
