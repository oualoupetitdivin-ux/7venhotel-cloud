'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// plans.config.js — Catalogue des plans d'abonnement 7venHotel Cloud
//
// Source de vérité UNIQUE pour les capacités de chaque plan.
// PolicyEngine l'utilise. Les routes ne doivent JAMAIS hardcoder ces valeurs.
//
// ÉVOLUTION :
//   Phase 1 (actuel)   : configuration statique (ce fichier)
//   Phase 2 (50 tenants): table `platform_plans` en DB, chargée au démarrage
//   Phase 3 (enterprise): éditable via /platform/config/plans par le super_admin
//
// AJOUT D'UN PLAN :
//   1. Ajouter une entrée dans PLANS ci-dessous
//   2. PolicyEngine l'utilisera automatiquement via loadSubscriptionContext()
// ─────────────────────────────────────────────────────────────────────────────

// -1 = illimité
const PLANS = {
  essai: {
    label:             'Essai gratuit',
    prix_mensuel_xaf:  0,
    max_hotels:        1,
    max_chambres:      20,
    max_utilisateurs:  3,
    quota_ia_mensuel:  5_000,      // tokens
    grace_period_days: 0,
    modules: {
      portail_qr:          true,
      ia_cockpit:          false,
      restaurant_kds:      false,
      facturation_mobile:  true,
      multi_hotel:         false,
      export_syscohada:    false,
      analytics_avances:   false,
    },
  },

  starter: {
    label:             'Starter',
    prix_mensuel_xaf:  25_000,
    max_hotels:        1,
    max_chambres:      30,
    max_utilisateurs:  5,
    quota_ia_mensuel:  10_000,
    grace_period_days: 7,
    modules: {
      portail_qr:          true,
      ia_cockpit:          false,
      restaurant_kds:      false,
      facturation_mobile:  true,
      multi_hotel:         false,
      export_syscohada:    false,
      analytics_avances:   false,
    },
  },

  business: {
    label:             'Business',
    prix_mensuel_xaf:  75_000,
    max_hotels:        3,
    max_chambres:      100,
    max_utilisateurs:  20,
    quota_ia_mensuel:  100_000,
    grace_period_days: 14,
    modules: {
      portail_qr:          true,
      ia_cockpit:          true,
      restaurant_kds:      true,
      facturation_mobile:  true,
      multi_hotel:         true,
      export_syscohada:    false,
      analytics_avances:   true,
    },
  },

  enterprise: {
    label:             'Enterprise',
    prix_mensuel_xaf:  200_000,
    max_hotels:        -1,
    max_chambres:      -1,
    max_utilisateurs:  -1,
    quota_ia_mensuel:  -1,           // illimité (avec alerte > 1M)
    grace_period_days: 30,
    modules: {
      portail_qr:          true,
      ia_cockpit:          true,
      restaurant_kds:      true,
      facturation_mobile:  true,
      multi_hotel:         true,
      export_syscohada:    true,
      analytics_avances:   true,
    },
  },

  'ohada+': {
    label:             'OHADA+',
    prix_mensuel_xaf:  120_000,
    max_hotels:        5,
    max_chambres:      200,
    max_utilisateurs:  30,
    quota_ia_mensuel:  150_000,
    grace_period_days: 21,
    modules: {
      portail_qr:          true,
      ia_cockpit:          true,
      restaurant_kds:      true,
      facturation_mobile:  true,
      multi_hotel:         true,
      export_syscohada:    true,    // fonctionnalité clé du plan
      analytics_avances:   true,
    },
  },
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Retourne les capacités d'un plan. Null si plan inconnu.
 */
function getPlan(planCode) {
  return PLANS[planCode?.toLowerCase()] || null
}

/**
 * Retourne tous les plans (pour le catalogue frontend).
 */
function getAllPlans() {
  return Object.entries(PLANS).map(([code, p]) => ({ code, ...p }))
}

/**
 * Vérifie si un module est activé pour un plan donné.
 */
function hasModule(planCode, moduleCode) {
  const plan = getPlan(planCode)
  if (!plan) return false
  return plan.modules[moduleCode] === true
}

/**
 * Retourne le plan suivant pour les suggestions d'upgrade.
 */
const UPGRADE_PATH = {
  essai:      'starter',
  starter:    'business',
  business:   'enterprise',
  enterprise: 'enterprise',
  'ohada+':   'enterprise',
}

function getUpgradePlan(planCode) {
  return UPGRADE_PATH[planCode?.toLowerCase()] || 'business'
}

module.exports = { getPlan, getAllPlans, hasModule, getUpgradePlan, PLANS }
