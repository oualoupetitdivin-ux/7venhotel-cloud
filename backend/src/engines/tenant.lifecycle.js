'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// tenant.lifecycle.js — Machine à états du cycle de vie tenant
//
// ÉTATS : lead → essai → actif → suspendu → grace → résilié
// INVARIANTS :
//   • Toute transition est loguée (AuditEngine strict)
//   • Toute suspension invalide les sessions (IAM)
//   • Toute transition invalide le cache tenant
//   • Transitions invalides sont rejetées (état interdit → erreur explicite)
//
// USAGE :
//   const lc = fastify.tenantLifecycle
//   await lc.transition(tenant_id, 'suspendre', { motif, actor })
//   await lc.transition(tenant_id, 'activer',   { actor })
//   await lc.transition(tenant_id, 'resilier',  { motif, actor })
// ─────────────────────────────────────────────────────────────────────────────

const fp = require('fastify-plugin')
const { getPlan } = require('./plans.config')

// ── Machine à états ──────────────────────────────────────────────────────────
//
// Chaque état définit les transitions autorisées et l'action à déclencher.
// Format : TRANSITIONS[etat_actuel][action] = etat_cible
//
const TRANSITIONS = {
  lead:      { activer: 'essai',     resilier: 'resilié'   },
  essai:     { activer: 'actif',     suspendre: 'suspendu', resilier: 'resilié' },
  actif:     { suspendre: 'suspendu', resilier: 'resilié',  grace: 'grace'      },
  suspendu:  { activer: 'actif',     resilier: 'resilié',  grace: 'grace'      },
  grace:     { activer: 'actif',     resilier: 'resilié',  suspendre: 'suspendu' },
  résilié:   {},   // état terminal — aucune transition
}

// Événements d'audit associés à chaque action
const AUDIT_EVENTS = {
  activer:   'TENANT_ACTIVE',
  suspendre: 'TENANT_SUSPENDU',
  grace:     'TENANT_GRACE',
  resilier:  'TENANT_RESILIE',
}

// Actions nécessitant une révocation de sessions (tout ce qui retire l'accès)
const REVOKE_SESSIONS_ON = new Set(['suspendre', 'grace', 'resilier'])

// ─────────────────────────────────────────────────────────────────────────────

async function tenantLifecyclePlugin(fastify) {

  const lifecycle = {

    /**
     * Exécute une transition de cycle de vie.
     * @param {string} tenant_id
     * @param {string} action    — 'activer' | 'suspendre' | 'grace' | 'resilier'
     * @param {object} opts      — { motif?, actor: { id, ip, role } }
     * @returns {{ tenant, transition, sessions_revoked }}
     */
    async transition(tenant_id, action, { motif = '', actor = {} } = {}) {
      // 1. Charger le tenant
      const tenant = await fastify.db('tenants').where({ id: tenant_id }).first()
      if (!tenant) {
        const err = new Error(`Tenant ${tenant_id} introuvable`)
        err.code = 'TENANT_INTROUVABLE'; err.statusCode = 404
        throw err
      }

      const etat_actuel = tenant.statut
      const transitions_autorisees = TRANSITIONS[etat_actuel] || {}

      // 2. Vérifier que la transition est autorisée
      if (!(action in transitions_autorisees)) {
        const autorisees = Object.keys(transitions_autorisees)
        const err = new Error(
          `Transition "${action}" interdite depuis l'état "${etat_actuel}". ` +
          `Transitions autorisées : ${autorisees.length ? autorisees.join(', ') : '(aucune — état terminal)'}`
        )
        err.code = 'TRANSITION_INTERDITE'; err.statusCode = 409
        throw err
      }

      const nouvel_etat = transitions_autorisees[action]
      const audit_event = AUDIT_EVENTS[action] || `TENANT_${action.toUpperCase()}`

      // 3. Audit STRICT avant toute modification (OHADA : traçabilité préalable)
      await fastify.audit.log({
        event:          audit_event,
        actor:          { id: actor.id, role: actor.role, ip: actor.ip },
        target:         { type: 'tenant', id: tenant_id },
        old_state:      { statut: etat_actuel },
        new_state:      { statut: nouvel_etat, motif },
        tenant_id,
        correlation_id: actor.correlation_id || null,
        strict:         true,   // fail-closed — si audit échoue, transition annulée
      })

      // 4. Mise à jour de l'état
      await fastify.db('tenants').where({ id: tenant_id }).update({
        statut:       nouvel_etat,
        mis_a_jour_le: fastify.db.fn.now(),
      })

      // 5. Révocation sessions si l'état retire l'accès
      let sessions_revoked = 0
      if (REVOKE_SESSIONS_ON.has(action)) {
        sessions_revoked = await fastify.revoquerSessionsTenant(tenant_id)
      }

      // 6. Invalider le cache tenant
      await fastify.cache.delPattern(`tenant:${tenant_id}:*`)

      fastify.log.info({
        event:            'LIFECYCLE_TRANSITION',
        tenant_id,
        tenant_nom:       tenant.nom,
        etat_avant:       etat_actuel,
        etat_apres:       nouvel_etat,
        action,
        motif,
        sessions_revoked,
        actor_id:         actor.id,
      }, `Tenant lifecycle: ${etat_actuel} → ${nouvel_etat}`)

      return {
        tenant:           { ...tenant, statut: nouvel_etat },
        transition:       { etat_avant: etat_actuel, etat_apres: nouvel_etat, action },
        sessions_revoked,
      }
    },

    /**
     * Retourne les transitions disponibles depuis l'état actuel d'un tenant.
     */
    async getAvailableTransitions(tenant_id) {
      const tenant = await fastify.db('tenants').where({ id: tenant_id }).select('statut').first()
      if (!tenant) return []
      return Object.keys(TRANSITIONS[tenant.statut] || {})
    },

    /**
     * Charge le profil lifecycle complet d'un tenant.
     * Inclut : état actuel, transitions autorisées, plan, abonnement, santé.
     */
    async getLifecycleProfile(tenant_id) {
      const [tenant, abonnement, nbHotels, nbUsers, nbSessions] = await Promise.all([
        fastify.db('tenants').where({ id: tenant_id }).first(),
        fastify.db('abonnements').where({ tenant_id }).first(),
        fastify.db('hotels').where({ tenant_id }).count('id AS nb').first(),
        fastify.db('utilisateurs').where({ tenant_id, actif: true }).count('id AS nb').first(),
        fastify.db('sessions_actives').where({ tenant_id }).where('expire_le', '>', fastify.db.fn.now()).whereNull('revoque_le').count('jti AS nb').first(),
      ])

      if (!tenant) return null

      // Charger planConfig depuis DB (platform_plans) si disponible, fallback statique
      let planConfig = null
      if (fastify.platformConfig) {
        try { planConfig = await fastify.platformConfig.getPlan(abonnement?.plan || 'starter') } catch {}
      }
      if (!planConfig) planConfig = getPlan(abonnement?.plan || 'starter')

      const transitions      = Object.keys(TRANSITIONS[tenant.statut] || {})

      return {
        tenant,
        abonnement,
        plan_config: planConfig,
        utilisation: {
          hotels:     { actuel: parseInt(nbHotels?.nb || 0), max: abonnement?.max_hotels ?? planConfig?.max_hotels },
          utilisateurs: { actuel: parseInt(nbUsers?.nb || 0), max: abonnement?.max_utilisateurs ?? planConfig?.max_utilisateurs },
          sessions_actives: parseInt(nbSessions?.nb || 0),
        },
        transitions_disponibles: transitions,
        est_terminal: transitions.length === 0,
      }
    },
  }

  fastify.decorate('tenantLifecycle', lifecycle)
}

module.exports = fp(tenantLifecyclePlugin, {
  name:         'tenant-lifecycle',
  fastify:      '4.x',
  dependencies: ['database', 'redis', 'audit-engine'],
})
