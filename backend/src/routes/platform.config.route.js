'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// platform.config.route.js — Platform Configuration Control Plane Routes
//
// Toutes les routes requièrent scope='platform'.
// Préfixe : /platform/config
//
// Plans      : GET/PUT /plans, GET/PUT /plans/:code, POST /plans
// Modules    : GET /modules, POST/DELETE /plans/:code/modules/:module
// Providers  : GET /providers, PUT /providers/:code
// Flags      : GET /flags, PUT /flags/:code
// Settings   : GET /settings, PUT /settings/:cle
// Overrides  : GET/POST/DELETE /overrides/:tenant_id[/:module_code]
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function platformConfigRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.scopePlateforme]

  // ── Helpers ───────────────────────────────────────────────────────────────

  function auditConfig(req, event, target, data = {}) {
    return fastify.audit.platform(req, event, target, null, data).catch(() => {})
  }

  // ==========================================================================
  // PLANS
  // ==========================================================================

  // GET /platform/config/plans
  fastify.get('/plans', { preHandler: pre }, async (req, reply) => {
    const plans = await fastify.platformConfig.getAllPlans()

    // Enrichir chaque plan avec ses modules
    const enriched = await Promise.all(plans.map(async p => {
      const modules = await fastify.platformConfig.getPlanModules(p.code)
      return { ...p, modules }
    }))

    return reply.send({ plans: enriched, total: enriched.length })
  })

  // GET /platform/config/plans/:code
  fastify.get('/plans/:code', { preHandler: pre }, async (req, reply) => {
    const plan = await fastify.platformConfig.getPlanWithModules(req.params.code)
    if (!plan) return reply.status(404).send({ erreur: 'Plan introuvable', code: 'PLAN_INTROUVABLE' })
    return reply.send(plan)
  })

  // PUT /platform/config/plans/:code — modifier un plan existant
  fastify.put('/plans/:code', { preHandler: pre }, async (req, reply) => {
    const { code } = req.params
    const {
      label, prix_mensuel_xaf, max_hotels, max_chambres,
      max_utilisateurs, quota_ia_mensuel, grace_period_days,
      ordre_affichage, actif,
    } = req.body || {}

    const existing = await fastify.platformConfig.getPlan(code)
    if (!existing) return reply.status(404).send({ erreur: 'Plan introuvable', code: 'PLAN_INTROUVABLE' })

    const updates = { mis_a_jour_le: fastify.db.fn.now() }
    if (label              !== undefined) updates.label              = label
    if (prix_mensuel_xaf   !== undefined) updates.prix_mensuel_xaf   = prix_mensuel_xaf
    if (max_hotels         !== undefined) updates.max_hotels         = max_hotels
    if (max_chambres       !== undefined) updates.max_chambres       = max_chambres
    if (max_utilisateurs   !== undefined) updates.max_utilisateurs   = max_utilisateurs
    if (quota_ia_mensuel   !== undefined) updates.quota_ia_mensuel   = quota_ia_mensuel
    if (grace_period_days  !== undefined) updates.grace_period_days  = grace_period_days
    if (ordre_affichage    !== undefined) updates.ordre_affichage    = ordre_affichage
    if (actif              !== undefined) updates.actif              = actif

    await fastify.db('platform_plans').where({ code }).update(updates)
    await fastify.platformConfig.invalidatePlans(code)
    await auditConfig(req, 'PLAN_MODIFIE', { type: 'plan', code }, req.body || {})

    const updated = await fastify.platformConfig.getPlanWithModules(code)
    return reply.send({ message: 'Plan mis à jour', plan: updated })
  })

  // POST /platform/config/plans — créer un nouveau plan
  fastify.post('/plans', { preHandler: pre }, async (req, reply) => {
    const {
      code, label, prix_mensuel_xaf = 0,
      max_hotels = 1, max_chambres = 20, max_utilisateurs = 3,
      quota_ia_mensuel = 0, grace_period_days = 0, ordre_affichage = 99,
    } = req.body || {}

    if (!code || !label) {
      return reply.status(400).send({ erreur: 'code et label obligatoires', code: 'DONNEES_INVALIDES' })
    }

    const existing = await fastify.db('platform_plans').where({ code }).first().catch(() => null)
    if (existing) return reply.status(409).send({ erreur: 'Code plan déjà utilisé', code: 'PLAN_EXISTE' })

    await fastify.db('platform_plans').insert({
      code, label, prix_mensuel_xaf, max_hotels, max_chambres,
      max_utilisateurs, quota_ia_mensuel, grace_period_days, ordre_affichage,
      actif: true,
    })

    await fastify.platformConfig.invalidatePlans()
    await auditConfig(req, 'PLAN_CREE', { type: 'plan', code }, { label, prix_mensuel_xaf })

    return reply.status(201).send({ message: 'Plan créé', code })
  })

  // ==========================================================================
  // MODULES
  // ==========================================================================

  // GET /platform/config/modules
  fastify.get('/modules', { preHandler: pre }, async (req, reply) => {
    const modules = await fastify.platformConfig.getAllModules()
    return reply.send({ modules, total: modules.length })
  })

  // POST /platform/config/plans/:code/modules/:module_code — inclure un module
  fastify.post('/plans/:code/modules/:module_code', { preHandler: pre }, async (req, reply) => {
    const { code, module_code } = req.params

    await fastify.db('plan_modules')
      .insert({ plan_code: code, module_code, inclus: true, mis_a_jour_le: fastify.db.fn.now() })
      .onConflict(['plan_code', 'module_code'])
      .merge({ inclus: true, mis_a_jour_le: fastify.db.fn.now() })

    await fastify.platformConfig.invalidatePlans(code)
    await auditConfig(req, 'PLAN_MODULE_INCLUS', { type: 'plan_module', plan: code, module: module_code })

    return reply.send({ message: 'Module inclus dans le plan', plan: code, module: module_code, inclus: true })
  })

  // DELETE /platform/config/plans/:code/modules/:module_code — exclure un module
  fastify.delete('/plans/:code/modules/:module_code', { preHandler: pre }, async (req, reply) => {
    const { code, module_code } = req.params

    await fastify.db('plan_modules')
      .where({ plan_code: code, module_code })
      .update({ inclus: false, mis_a_jour_le: fastify.db.fn.now() })

    await fastify.platformConfig.invalidatePlans(code)
    await auditConfig(req, 'PLAN_MODULE_EXCLU', { type: 'plan_module', plan: code, module: module_code })

    return reply.send({ message: 'Module exclu du plan', plan: code, module: module_code, inclus: false })
  })

  // ==========================================================================
  // PROVIDERS
  // ==========================================================================

  // GET /platform/config/providers
  fastify.get('/providers', { preHandler: pre }, async (req, reply) => {
    const providers = await fastify.platformConfig.getProviders()
    return reply.send({ providers })
  })

  // PUT /platform/config/providers/:code — modifier un provider
  fastify.put('/providers/:code', { preHandler: pre }, async (req, reply) => {
    const { code } = req.params
    const { actif, priorite, label, plans_autorises } = req.body || {}

    const existing = await fastify.db('platform_providers').where({ code }).first().catch(() => null)
    if (!existing) return reply.status(404).send({ erreur: 'Provider introuvable', code: 'PROVIDER_INTROUVABLE' })

    const updates = { mis_a_jour_le: fastify.db.fn.now() }
    if (actif           !== undefined) updates.actif           = actif
    if (priorite        !== undefined) updates.priorite        = priorite
    if (label           !== undefined) updates.label           = label
    if (plans_autorises !== undefined) updates.plans_autorises = plans_autorises

    await fastify.db('platform_providers').where({ code }).update(updates)
    await fastify.platformConfig.invalidateProviders()
    await auditConfig(req, 'PROVIDER_MODIFIE', { type: 'provider', code }, req.body || {})

    const updated = await fastify.db('platform_providers').where({ code }).first()
    return reply.send({ message: 'Provider mis à jour', provider: updated })
  })

  // POST /platform/config/providers — créer un provider
  fastify.post('/providers', { preHandler: pre }, async (req, reply) => {
    const { code, label, priorite = 99, plans_autorises = null } = req.body || {}
    if (!code || !label) return reply.status(400).send({ erreur: 'code et label obligatoires', code: 'DONNEES_INVALIDES' })

    const existing = await fastify.db('platform_providers').where({ code }).first().catch(() => null)
    if (existing) return reply.status(409).send({ erreur: 'Provider déjà existant', code: 'PROVIDER_EXISTE' })

    await fastify.db('platform_providers').insert({ code, label, actif: false, priorite, plans_autorises })
    await fastify.platformConfig.invalidateProviders()
    await auditConfig(req, 'PROVIDER_CREE', { type: 'provider', code })

    return reply.status(201).send({ message: 'Provider créé', code })
  })

  // ==========================================================================
  // FEATURE FLAGS
  // ==========================================================================

  // GET /platform/config/flags
  fastify.get('/flags', { preHandler: pre }, async (req, reply) => {
    const flags = await fastify.platformConfig.getFeatureFlags()
    return reply.send({ flags })
  })

  // PUT /platform/config/flags/:code — créer ou modifier un flag
  fastify.put('/flags/:code', { preHandler: pre }, async (req, reply) => {
    const { code } = req.params
    const { enabled, description, rollout_pct, target_plans, expire_le } = req.body || {}

    const existing = await fastify.db('platform_feature_flags').where({ code }).first().catch(() => null)

    if (existing) {
      const updates = { mis_a_jour_le: fastify.db.fn.now() }
      if (enabled      !== undefined) updates.enabled      = enabled
      if (description  !== undefined) updates.description  = description
      if (rollout_pct  !== undefined) updates.rollout_pct  = rollout_pct
      if (target_plans !== undefined) updates.target_plans = target_plans
      if (expire_le    !== undefined) updates.expire_le    = expire_le || null
      await fastify.db('platform_feature_flags').where({ code }).update(updates)
    } else {
      await fastify.db('platform_feature_flags').insert({
        code, enabled: enabled ?? false, description, rollout_pct: rollout_pct ?? 100,
        target_plans, expire_le: expire_le || null,
      })
    }

    await fastify.platformConfig.invalidateFlags()
    await auditConfig(req, 'FLAG_MODIFIE', { type: 'feature_flag', code }, { enabled })

    const updated = await fastify.db('platform_feature_flags').where({ code }).first()
    return reply.send({ message: existing ? 'Flag mis à jour' : 'Flag créé', flag: updated })
  })

  // ==========================================================================
  // SETTINGS
  // ==========================================================================

  // GET /platform/config/settings
  fastify.get('/settings', { preHandler: pre }, async (req, reply) => {
    const settings = await fastify.platformConfig.getSettings()
    return reply.send({ settings })
  })

  // PUT /platform/config/settings/:cle — modifier une valeur
  fastify.put('/settings/:cle', { preHandler: pre }, async (req, reply) => {
    const { cle } = req.params
    const { valeur, description } = req.body || {}
    if (valeur === undefined) return reply.status(400).send({ erreur: 'valeur obligatoire', code: 'DONNEES_INVALIDES' })

    // Sérialiser la valeur en JSONB
    const valeurJson = typeof valeur === 'string' ? JSON.stringify(valeur) : JSON.stringify(valeur)

    const existing = await fastify.db('platform_settings').where({ cle }).first().catch(() => null)
    if (!existing) return reply.status(404).send({ erreur: 'Setting introuvable', code: 'SETTING_INTROUVABLE' })
    if (!existing.modifiable_ui) return reply.status(403).send({ erreur: 'Ce paramètre ne peut pas être modifié via l\'UI', code: 'SETTING_PROTEGE' })

    const updates = { valeur: valeurJson, mis_a_jour_le: fastify.db.fn.now() }
    if (description !== undefined) updates.description = description
    await fastify.db('platform_settings').where({ cle }).update(updates)
    await fastify.platformConfig.invalidateSettings()
    await auditConfig(req, 'SETTING_MODIFIE', { type: 'setting', cle }, { valeur })

    const updated = await fastify.db('platform_settings').where({ cle }).first()
    return reply.send({ message: 'Paramètre mis à jour', setting: updated })
  })

  // ==========================================================================
  // TENANT OVERRIDES
  // ==========================================================================

  // GET /platform/config/overrides/:tenant_id — liste des overrides d'un tenant
  fastify.get('/overrides/:tenant_id', { preHandler: pre }, async (req, reply) => {
    const { tenant_id } = req.params
    const overrides = await fastify.platformConfig.getAllTenantOverrides(tenant_id)
    return reply.send({ overrides, tenant_id })
  })

  // POST /platform/config/overrides/:tenant_id — créer/modifier un override
  fastify.post('/overrides/:tenant_id', { preHandler: pre }, async (req, reply) => {
    const { tenant_id } = req.params
    const { module_code, enabled, raison, actif_jusqu } = req.body || {}

    if (!module_code || enabled === undefined || !raison) {
      return reply.status(400).send({
        erreur: 'module_code, enabled et raison obligatoires',
        code:   'DONNEES_INVALIDES',
      })
    }
    if (raison.length < 10) {
      return reply.status(400).send({ erreur: 'raison doit faire au moins 10 caractères', code: 'DONNEES_INVALIDES' })
    }

    const tenant = await fastify.db('tenants').where({ id: tenant_id }).first().catch(() => null)
    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })

    await fastify.db('tenant_module_overrides')
      .insert({
        tenant_id, module_code, enabled, raison,
        actif_depuis: new Date().toISOString().split('T')[0],
        actif_jusqu:  actif_jusqu || null,
        cree_par:     req.user.id,
      })
      .onConflict(['tenant_id', 'module_code'])
      .merge({ enabled, raison, actif_jusqu: actif_jusqu || null, cree_par: req.user.id })

    await fastify.platformConfig.invalidateTenant(tenant_id)
    await auditConfig(req, 'TENANT_MODULE_OVERRIDE_CREE', { type: 'override', tenant_id, module_code }, { enabled, raison })

    return reply.status(201).send({
      message: `Override ${enabled ? 'activé' : 'désactivé'} pour ${module_code} sur tenant ${tenant_id}`,
      tenant_id, module_code, enabled,
    })
  })

  // DELETE /platform/config/overrides/:tenant_id/:module_code — supprimer un override
  fastify.delete('/overrides/:tenant_id/:module_code', { preHandler: pre }, async (req, reply) => {
    const { tenant_id, module_code } = req.params

    const deleted = await fastify.db('tenant_module_overrides')
      .where({ tenant_id, module_code })
      .delete()

    if (!deleted) return reply.status(404).send({ erreur: 'Override introuvable', code: 'OVERRIDE_INTROUVABLE' })

    await fastify.platformConfig.invalidateTenant(tenant_id)
    await auditConfig(req, 'TENANT_MODULE_OVERRIDE_SUPPRIME', { type: 'override', tenant_id, module_code })

    return reply.send({ message: 'Override supprimé', tenant_id, module_code })
  })
}
