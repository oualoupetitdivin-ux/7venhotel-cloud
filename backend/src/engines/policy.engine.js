'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// policy.engine.js — Moteur de politiques centralisé 7venHotel Cloud
//
// INVARIANT :
//   Toute vérification de quota ou de droit de feature passe par ce moteur.
//   Aucune route ne doit contenir de logique if(plan === 'starter') directement.
//
// INTERFACE :
//   const result = await fastify.policy.evaluate('hotel.create', context)
//   if (!result.allowed) return reply.status(403).send(result)
//
// RÉPONSE :
//   { allowed: true }
//   { allowed: false, code: 'QUOTA_HOTELS', current: 2, limit: 1, upgrade_hint: 'business' }
//
// AJOUT D'UNE POLITIQUE :
//   Ajouter une entrée dans POLICIES ci-dessous.
//   Le moteur reste stateless — il lit les données depuis le contexte passé.
//   Ne pas mettre de logique quota dans les routes.
// ─────────────────────────────────────────────────────────────────────────────

const fp             = require('fastify-plugin')
const { getPlan, getUpgradePlan, hasModule } = require('./plans.config')

function ALLOW() {
  return { allowed: true }
}

function DENY(code, extra = {}) {
  return { allowed: false, code, ...extra }
}

// ── Helper : feature policy générique (piloté par plans.config) ──────────────
function _featurePolicy(moduleCode, ctx) {
  const { plan } = ctx
  if (hasModule(plan, moduleCode)) return ALLOW()
  const planDef = getPlan(plan)
  return DENY('FEATURE_NON_DISPONIBLE', {
    feature:      moduleCode,
    upgrade_hint: getUpgradePlan(plan),
    message:      `Le module "${moduleCode}" n'est pas inclus dans le plan ${planDef?.label || plan}`,
  })
}

// ── Catalogue de politiques ───────────────────────────────────────────────────
const POLICIES = {

  // ── Création d'hôtel ─────────────────────────────────────────────────────
  'hotel.create': async (ctx) => {
    const { nb_hotels = 0, max_hotels = null } = ctx
    if (max_hotels === null || max_hotels === -1) return ALLOW()  // illimité
    if (nb_hotels >= max_hotels) {
      return DENY('QUOTA_HOTELS', {
        current:      nb_hotels,
        limit:        max_hotels,
        upgrade_hint: PLAN_UPGRADE_PATH[ctx.plan] || 'business',
        message:      `Limite d'hôtels atteinte (${nb_hotels}/${max_hotels})`,
      })
    }
    return ALLOW()
  },

  // ── Création de chambre ─────────────────────────────────────────────────
  'chambre.create': async (ctx) => {
    const { nb_chambres = 0, max_chambres = null } = ctx
    if (max_chambres === null || max_chambres === -1) return ALLOW()
    if (nb_chambres >= max_chambres) {
      return DENY('QUOTA_CHAMBRES', {
        current:      nb_chambres,
        limit:        max_chambres,
        upgrade_hint: PLAN_UPGRADE_PATH[ctx.plan] || 'business',
        message:      `Limite de chambres atteinte (${nb_chambres}/${max_chambres})`,
      })
    }
    return ALLOW()
  },

  // ── Création d'utilisateur ──────────────────────────────────────────────
  'utilisateur.create': async (ctx) => {
    const { nb_utilisateurs = 0, max_utilisateurs = null } = ctx
    if (max_utilisateurs === null || max_utilisateurs === -1) return ALLOW()
    if (nb_utilisateurs >= max_utilisateurs) {
      return DENY('QUOTA_UTILISATEURS', {
        current:      nb_utilisateurs,
        limit:        max_utilisateurs,
        upgrade_hint: PLAN_UPGRADE_PATH[ctx.plan] || 'business',
        message:      `Limite d'utilisateurs atteinte (${nb_utilisateurs}/${max_utilisateurs})`,
      })
    }
    return ALLOW()
  },

  // ── Appel IA ─────────────────────────────────────────────────────────────
  'ia.call': async (ctx) => {
    const { tokens_utilises = 0, quota_ia = null } = ctx
    if (quota_ia === null || quota_ia === -1) return ALLOW()       // illimité
    if (tokens_utilises >= quota_ia) {
      return DENY('QUOTA_IA_DEPASSE', {
        current:      tokens_utilises,
        limit:        quota_ia,
        upgrade_hint: PLAN_UPGRADE_PATH[ctx.plan] || 'business',
        message:      `Quota IA mensuel épuisé (${tokens_utilises}/${quota_ia} tokens)`,
      })
    }
    // Warning à 90% — ne bloque pas, mais le caller peut publier un événement
    if (tokens_utilises >= quota_ia * 0.9) {
      return { ...ALLOW(), warning: 'QUOTA_IA_90PCT', pct_used: Math.round((tokens_utilises / quota_ia) * 100) }
    }
    return ALLOW()
  },

  // ── Accès feature par plan (piloté par plans.config) ────────────────────
  // Un seul handler générique — évite de dupliquer pour chaque module
  'feature.ia_cockpit':       async (ctx) => _featurePolicy('ia_cockpit', ctx),
  'feature.multi_hotel':      async (ctx) => _featurePolicy('multi_hotel', ctx),
  'feature.export_syscohada': async (ctx) => _featurePolicy('export_syscohada', ctx),
  'feature.restaurant_kds':   async (ctx) => _featurePolicy('restaurant_kds', ctx),
  'feature.portail_qr':       async (ctx) => _featurePolicy('portail_qr', ctx),
  'feature.analytics_avances':async (ctx) => _featurePolicy('analytics_avances', ctx),

  // ── Impersonation (sécurité) ─────────────────────────────────────────────
  'iam.impersonate': async (ctx) => {
    const { sessions_today = 0, max_sessions_per_day = 5 } = ctx
    if (sessions_today >= max_sessions_per_day) {
      return DENY('IMPERSONATION_LIMITE_QUOTIDIENNE', {
        current:      sessions_today,
        limit:        max_sessions_per_day,
        message:      `Limite d'impersonation atteinte (${sessions_today}/${max_sessions_per_day} sessions/jour)`,
      })
    }
    return ALLOW()
  },
}

// ─────────────────────────────────────────────────────────────────────────────

async function policyEnginePlugin(fastify) {

  const engine = {
    /**
     * Évalue une politique pour un contexte donné.
     *
     * MODES :
     *   strict: false (défaut) — politique inconnue → fail-open (ALLOW + warning)
     *   strict: true           — politique inconnue → fail-closed (DENY)
     *
     * ROADMAP strict mode global :
     *   Phase 1 (actuel)   : fail-open pour politiques inconnues, fail-closed explicite
     *   Phase 2 (50 tenants): activer STRICT_REGISTRY_MODE — toute politique non enregistrée
     *                         retourne DENY automatiquement (zero-trust policy evaluation)
     *   Phase 3 (enterprise): policy registry validé au démarrage — crash si politique
     *                         référencée dans les routes n'existe pas dans POLICIES
     *
     * @param {string} policy_code  — ex: 'hotel.create'
     * @param {object} context      — données nécessaires à l'évaluation
     * @param {object} opts         — { strict: boolean }
     * @returns {{ allowed: boolean, code?, message?, upgrade_hint? }}
     */
    async evaluate(policy_code, context = {}, { strict = false } = {}) {
      const policy = POLICIES[policy_code]
      if (!policy) {
        if (strict) {
          fastify.log.error({ policy_code }, 'PolicyEngine: politique inconnue en strict mode — DENY')
          return DENY('POLICY_INCONNUE', { policy_code })
        }
        fastify.log.warn({ policy_code }, 'PolicyEngine: politique inconnue — fail-open')
        return ALLOW()
      }
      try {
        return await policy(context, fastify.db, fastify.cache)
      } catch (err) {
        fastify.log.error({ policy_code, err: err.message }, 'PolicyEngine: erreur évaluation — fail-open')
        return ALLOW()
      }
    },

    /**
     * Helper pour charger le contexte d'abonnement + capacités d'un tenant.
     *
     * Hiérarchie de résolution (Layer 6+) :
     *   Quotas : abonnements.max_* (custom deal) > platform_plans (catalogue)
     *   Modules: tenant_module_overrides (admin override) > plan_modules (défaut plan)
     *   Fallback: plans.config.js si platform_config non disponible (cold start)
     */
    async loadSubscriptionContext(tenant_id) {
      const cacheKey = `tenant:${tenant_id}:subscription`
      const cached   = await fastify.cache.get(cacheKey)
      if (cached) return cached

      const sub = await fastify.db('abonnements')
        .where({ tenant_id })
        .select('plan', 'statut', 'max_hotels', 'max_chambres', 'max_utilisateurs', 'max_ia_mensuel', 'montant_mensuel')
        .first()

      const planCode = sub?.plan || 'starter'

      // ── Source de vérité : platformConfig (DB) avec fallback plans.config.js ──
      let planData  = null
      let moduleMap = {}

      if (fastify.platformConfig) {
        try {
          planData = await fastify.platformConfig.getPlanWithModules(planCode)
          if (planData) moduleMap = planData.modules || {}
        } catch (err) {
          fastify.log.warn({ err: err.message }, 'PolicyEngine: platformConfig unavailable — fallback statique')
        }
      }

      if (!planData) {
        const staticPlan = getPlan(planCode) || getPlan('starter')
        planData  = staticPlan
        moduleMap = staticPlan?.modules || {}
      }

      // ── Appliquer les overrides module par tenant ──────────────────────────
      if (fastify.platformConfig) {
        try {
          const overrides = await fastify.platformConfig.getTenantModuleOverrides(tenant_id)
          overrides.forEach(o => { moduleMap = { ...moduleMap, [o.module_code]: o.enabled } })
        } catch {}
      }

      const ctx = {
        plan:             planCode,
        statut:           sub?.statut || 'actif',
        max_hotels:       sub?.max_hotels       ?? planData.max_hotels,
        max_chambres:     sub?.max_chambres     ?? planData.max_chambres,
        max_utilisateurs: sub?.max_utilisateurs ?? planData.max_utilisateurs,
        quota_ia:         sub?.max_ia_mensuel   ?? planData.quota_ia_mensuel,
        modules:          moduleMap,
      }

      await fastify.cache.set(cacheKey, ctx, 60)
      return ctx
    },
  }

  fastify.decorate('policy', engine)
}

module.exports = fp(policyEnginePlugin, {
  name:         'policy-engine',
  fastify:      '4.x',
  dependencies: ['database', 'redis'],
})
