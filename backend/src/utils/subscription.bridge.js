'use strict'

// A2 — Subscription Bridge
//
// Résout le catalogue Billing (A1) et crée/met à jour le snapshot billing.
//
// MODÈLE D'ÉVÉNEMENT — deux cas distincts :
//
//   1. RETRY (même événement)
//      Le guard PLAN_INCHANGE → 409 intercepte les retries au niveau de la route
//      avant que la transaction ne démarre. createSnapshot n'est jamais appelé
//      deux fois avec le même plan sur le même abonnement sans changement de plan.
//
//   2. NOUVEAU CHANGEMENT LÉGITIME LE MÊME JOUR
//      UNIQUE(subscription_id, actif_depuis) garantit exactement UN snapshot par
//      jour de facturation. Si deux changements de plan surviennent le même jour,
//      le snapshot doit refléter le DERNIER plan actif sur ce jour (la dernière
//      configuration facturable). ON CONFLICT DO UPDATE met à jour les champs
//      billing uniquement (plan_code, version, prix, entitlements, modules) sans
//      modifier cree_le (horodatage de création du snapshot).
//
// IMMUTABILITÉ :
//   "Jamais réécrire rétroactivement" signifie : ne jamais modifier un snapshot
//   d'un jour passé (actif_depuis < aujourd'hui). Le DO UPDATE ne s'applique
//   qu'au snapshot du JOUR COURANT, par définition de actif_depuis = today().
//
// SOURCES DE CHANGEMENT DE SNAPSHOT (les seules) :
//   A. Création d'abonnement (POST /subscription) — atomique
//   B. Changement de plan (PATCH /plan) — atomique, dans la même transaction B2
//
// Le lifecycle (transitions tenants.statut) ne crée PAS de snapshot : il modifie
// l'état opérationnel du tenant, pas la configuration billing de l'abonnement.
// Voir documentation Point 3 ci-dessous.

async function resolveBillingCatalog(db, planCode) {
  const billingPlan = await db('platform_billing_plans')
    .where({ code: planCode, actif: true }).first()
  if (!billingPlan) return null

  const version = await db('platform_plan_versions')
    .where({ plan_id: billingPlan.id, statut: 'published' })
    .orderBy('version_number', 'desc').first()
  if (!version) return null

  const price = await db('platform_plan_prices')
    .where({ plan_version_id: version.id, periodicite: 'mensuel', actif: true }).first()
  if (!price) return null

  const entitlements = await db('platform_entitlements')
    .where({ plan_version_id: version.id })
  const entitlements_json = Object.fromEntries(entitlements.map(e => [e.code, e.valeur]))

  const modulesRows = await db('plan_version_modules AS pvm')
    .join('platform_billing_modules AS pbm', 'pbm.id', 'pvm.module_id')
    .where('pvm.plan_version_id', version.id)
    .select('pbm.code', 'pvm.inclus')
  const modules_json = Object.fromEntries(modulesRows.map(r => [r.code, r.inclus]))

  return {
    plan_version_id:  version.id,
    plan_price_id:    price.id,
    plan_code:        planCode,
    periodicite:      price.periodicite,
    devise:           price.devise,
    montant_centimes: price.montant_centimes,
    entitlements_json,
    modules_json,
  }
}

// Champs billing mis à jour sur conflit same-day (ON CONFLICT DO UPDATE)
const MERGE_COLS = [
  'plan_version_id',
  'plan_price_id',
  'plan_code',
  'periodicite',
  'devise',
  'montant_centimes',
  'entitlements_json',
  'modules_json',
]

/**
 * Crée (ou met à jour same-day) un snapshot dans subscription_snapshots.
 *
 * Comportement sur conflit UNIQUE(subscription_id, actif_depuis) :
 *   - même plan_code : DO UPDATE set same values (idempotent)
 *   - plan_code différent : DO UPDATE met à jour les champs billing (dernier plan du jour)
 *   - cree_le n'est jamais modifié (timestamp de création de la ligne conservé)
 *
 * @param {object} db            — Knex instance ou transaction Knex
 * @param {string} tenant_id
 * @param {string} abonnement_id — subscription_id (UUID abonnements.id)
 * @param {string} plan_code     — code plan catalogue
 * @returns {object|null} — snapshot (inséré ou mis à jour), null si plan absent du catalogue
 */
async function createSnapshot(db, { tenant_id, abonnement_id, plan_code }) {
  const catalog = await resolveBillingCatalog(db, plan_code)
  if (!catalog) return null

  const actif_depuis = new Date().toISOString().split('T')[0]

  const [snapshot] = await db('subscription_snapshots')
    .insert({
      tenant_id,
      subscription_id:   abonnement_id,
      plan_version_id:   catalog.plan_version_id,
      plan_price_id:     catalog.plan_price_id,
      plan_code:         catalog.plan_code,
      periodicite:       catalog.periodicite,
      devise:            catalog.devise,
      montant_centimes:  catalog.montant_centimes,
      entitlements_json: catalog.entitlements_json,
      modules_json:      catalog.modules_json,
      actif_depuis,
    })
    .onConflict(['subscription_id', 'actif_depuis'])
    .merge(MERGE_COLS)
    .returning('*')

  return snapshot || null
}

module.exports = { createSnapshot, resolveBillingCatalog }
