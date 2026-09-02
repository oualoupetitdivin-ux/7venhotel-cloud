'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// platform.config.engine.js — Platform Configuration Control Plane
//
// Fournit : fastify.platformConfig
//
// Responsabilité :
//   • Lecture de toutes les tables platform_config avec cache Redis (60s)
//   • Fallback transparent vers plans.config.js si migration non appliquée
//   • Invalidation de cache ciblée sur mutation
//
// Consommateurs :
//   • PolicyEngine.loadSubscriptionContext (remplace plans.config.js)
//   • Routes /platform/config/* (CRUD)
//
// INVARIANTS :
//   • Jamais de crash si migration non encore appliquée (fallback statique)
//   • Cache Redis ou mémoire — toujours opérationnel
//   • Toute mutation invalide le cache pertinent IMMÉDIATEMENT
// ─────────────────────────────────────────────────────────────────────────────

const fp = require('fastify-plugin')
const {
  getPlan: staticGetPlan,
  getAllPlans: staticGetAllPlans,
} = require('./plans.config')

const CACHE_TTL = 60  // secondes

async function platformConfigPlugin(fastify) {

  // ── Helpers internes ─────────────────────────────────────────────────────

  async function _dbGet(cacheKey, queryFn, fallbackFn) {
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return cached
    try {
      const result = await queryFn()
      await fastify.cache.set(cacheKey, result, CACHE_TTL)
      return result
    } catch (err) {
      fastify.log.warn({ err: err.message, cacheKey }, 'platformConfig: DB indisponible — fallback statique')
      return fallbackFn ? fallbackFn() : null
    }
  }

  // ── Plans ────────────────────────────────────────────────────────────────

  async function _getAllPlans() {
    return _dbGet(
      'platform:config:plans',
      () => fastify.db('platform_plans').where({ actif: true }).orderBy('ordre_affichage', 'asc'),
      () => staticGetAllPlans()
    )
  }

  async function _getPlanModules(planCode) {
    return _dbGet(
      `platform:config:plan:${planCode}:modules`,
      async () => {
        const rows = await fastify.db('plan_modules')
          .where({ plan_code: planCode })
          .select('module_code', 'inclus')
        const map = {}
        rows.forEach(r => { map[r.module_code] = r.inclus })
        return map
      },
      () => staticGetPlan(planCode)?.modules || {}
    )
  }

  // ── Tenant overrides ─────────────────────────────────────────────────────

  async function _getTenantModuleOverrides(tenant_id) {
    return _dbGet(
      `tenant:${tenant_id}:module_overrides`,
      async () => {
        const today = new Date().toISOString().split('T')[0]
        return fastify.db('tenant_module_overrides')
          .where({ tenant_id })
          .where(q => q.whereNull('actif_jusqu').orWhere('actif_jusqu', '>=', today))
          .select('module_code', 'enabled')
      },
      () => []
    )
  }

  // ── API publique ─────────────────────────────────────────────────────────

  const config = {

    // ── Plans ──────────────────────────────────────────────────────────────

    async getAllPlans() {
      return _getAllPlans()
    },

    async getPlan(code) {
      const plans = await _getAllPlans()
      return plans.find(p => p.code === code) || null
    },

    async getPlanWithModules(code) {
      const [plan, modules] = await Promise.all([
        this.getPlan(code),
        _getPlanModules(code),
      ])
      if (!plan) return null
      return { ...plan, modules }
    },

    // ── Modules ────────────────────────────────────────────────────────────

    async getAllModules() {
      return _dbGet(
        'platform:config:modules',
        () => fastify.db('platform_modules').where({ actif: true }).orderBy('categorie').orderBy('code'),
        () => [
          { code: 'portail_qr',         label: 'Portail QR Client',    categorie: 'operations' },
          { code: 'ia_cockpit',          label: 'IA Cockpit',           categorie: 'ia' },
          { code: 'restaurant_kds',      label: 'Restaurant KDS',       categorie: 'operations' },
          { code: 'facturation_mobile',  label: 'Facturation Mobile',   categorie: 'commercial' },
          { code: 'multi_hotel',         label: 'Multi-Hôtel',          categorie: 'operations' },
          { code: 'export_syscohada',    label: 'Export SYSCOHADA',     categorie: 'conformite' },
          { code: 'analytics_avances',   label: 'Analytics Avancés',    categorie: 'commercial' },
        ]
      )
    },

    async getPlanModules(planCode) {
      return _getPlanModules(planCode)
    },

    // ── Tenant overrides ───────────────────────────────────────────────────

    async getTenantModuleOverrides(tenant_id) {
      return _getTenantModuleOverrides(tenant_id)
    },

    async getAllTenantOverrides(tenant_id) {
      try {
        return fastify.db('tenant_module_overrides')
          .where({ tenant_id })
          .orderBy('cree_le', 'desc')
      } catch {
        return []
      }
    },

    // ── Providers ──────────────────────────────────────────────────────────

    async getProviders() {
      return _dbGet(
        'platform:config:providers',
        () => fastify.db('platform_providers').orderBy('priorite', 'asc'),
        () => [{ code: 'anthropic', label: 'Anthropic (Claude)', actif: true, priorite: 1 }]
      )
    },

    async getActiveProvider() {
      const providers = await this.getProviders()
      return providers.find(p => p.actif) || null
    },

    // ── Feature flags ──────────────────────────────────────────────────────

    async getFeatureFlags() {
      return _dbGet(
        'platform:config:flags',
        () => fastify.db('platform_feature_flags').orderBy('code'),
        () => []
      )
    },

    async isFlagEnabled(code) {
      const flags = await this.getFeatureFlags()
      const flag = flags.find(f => f.code === code)
      return flag?.enabled === true
    },

    // ── Settings ───────────────────────────────────────────────────────────

    async getSettings() {
      return _dbGet(
        'platform:config:settings',
        () => fastify.db('platform_settings').orderBy('groupe').orderBy('cle'),
        () => []
      )
    },

    async getSetting(cle) {
      const settings = await this.getSettings()
      const s = settings.find(s => s.cle === cle)
      if (!s) return null
      // Dé-sérialiser la valeur JSONB
      try { return JSON.parse(s.valeur) } catch { return s.valeur }
    },

    // ── Cache invalidation ─────────────────────────────────────────────────

    async invalidatePlans(planCode = null) {
      await fastify.cache.del('platform:config:plans')
      if (planCode) {
        await fastify.cache.del(`platform:config:plan:${planCode}:modules`)
      }
      await fastify.cache.delPattern('tenant:*:subscription')
    },

    async invalidateModules() {
      await fastify.cache.del('platform:config:modules')
    },

    async invalidateTenant(tenant_id) {
      await fastify.cache.del(`tenant:${tenant_id}:subscription`)
      await fastify.cache.del(`tenant:${tenant_id}:module_overrides`)
    },

    async invalidateFlags() {
      await fastify.cache.del('platform:config:flags')
    },

    async invalidateProviders() {
      await fastify.cache.del('platform:config:providers')
    },

    async invalidateSettings() {
      await fastify.cache.del('platform:config:settings')
    },
  }

  fastify.decorate('platformConfig', config)
  fastify.log.info('Platform Config Engine initialisé')
}

module.exports = fp(platformConfigPlugin, {
  name:         'platform-config',
  fastify:      '4.x',
  dependencies: ['database', 'redis'],
})
