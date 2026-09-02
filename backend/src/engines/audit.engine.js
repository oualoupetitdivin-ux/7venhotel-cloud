'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// audit.engine.js — Moteur d'audit centralisé 7venHotel Cloud
//
// INVARIANT ABSOLU :
//   Toute mutation métier significative est tracée dans logs_audit
//   de manière SYNCHRONE et AVANT le retour de la réponse HTTP.
//   Un audit non écrit = une mutation invisible = violation de conformité.
//
// CONTRAT D'APPEL :
//   await fastify.audit.log({
//     event:          'TENANT_SUSPENDU',         // obligatoire
//     actor:          { id, role, ip? },         // obligatoire
//     target:         { type, id },              // obligatoire
//     old_state:      { ... } | null,            // optionnel
//     new_state:      { ... } | null,            // optionnel
//     tenant_id:      uuid | null,               // context
//     hotel_id:       uuid | null,               // context
//     correlation_id: string | null,             // lié à la request
//   })
//
// OWNERSHIP : ce moteur est le SEUL autorisé à écrire dans logs_audit.
// Les routes ne doivent JAMAIS faire db('logs_audit').insert() directement.
//
// GARANTIE IMMUABILITÉ : le trigger prevent_audit_modification (migration SQL)
// garantit qu'aucun UPDATE ni DELETE n'est possible sur cette table.
// ─────────────────────────────────────────────────────────────────────────────

const fp = require('fastify-plugin')

// Mapping événement → module (détermine le champ `module` dans logs_audit)
const EVENT_MODULE_MAP = {
  // Plateforme (control plane)
  TENANT_CREE:             'platform',
  ABONNEMENT_ASSIGNE:      'platform',
  MANAGER_PROVISIONNE:     'utilisateurs',
  TENANT_ACTIVE:           'platform',
  TENANT_SUSPENDU:         'platform',
  TENANT_REACTIV:          'platform',
  TENANT_RESILIE:          'platform',
  TENANT_MODIFIE:          'platform',
  PLAN_UPGRADE:            'platform',
  PLAN_DOWNGRADE:          'platform',
  FEATURE_FLAG_MODIFIE:    'platform',
  // IAM
  IMPERSONATION_DEMARREE:  'iam',
  IMPERSONATION_REVOQUEE:  'iam',
  SESSION_REVOQUEE:        'iam',
  SESSIONS_MASS_REVOKE:    'iam',
  // Utilisateurs
  UTILISATEUR_CREE:        'utilisateurs',
  UTILISATEUR_MODIFIE:     'utilisateurs',
  UTILISATEUR_DESACTIVE:   'utilisateurs',
  MDP_RESET:               'utilisateurs',
  // Auth
  CONNEXION:               'auth',
  DECONNEXION:             'auth',
  CONNEXION_ECHEC:         'auth',
  // Billing
  FACTURE_GENEREE:         'billing',
  FACTURE_PAYEE:           'billing',
  FACTURE_RELANCE:         'billing',
  // Hôtel / exploitation
  HOTEL_CREE:              'hotels',
  HOTEL_MODIFIE:           'hotels',
  HOTEL_PARAMETRES_MODIFIES: 'hotels',
  MANAGER_HOTEL_ASSIGNE:   'utilisateurs',
  RESERVATION_CREEE:       'reservations',
  RESERVATION_ANNULEE:     'reservations',
  PAIEMENT_VALIDE:         'facturation',
  PAIEMENT_ANNULE:         'facturation',
}

function resolveModule(event) {
  return EVENT_MODULE_MAP[event] || 'system'
}

// Événements qui nécessitent strict mode par défaut (fail-closed si audit échoue)
// Ces événements concernent la sécurité et la conformité réglementaire
const STRICT_EVENTS = new Set([
  'TENANT_CREE',
  'MANAGER_PROVISIONNE',
  'TENANT_SUSPENDU',
  'TENANT_RESILIE',
  'IMPERSONATION_DEMARREE',
  'IMPERSONATION_REVOQUEE',
  'SESSIONS_MASS_REVOKE',
  'SESSION_REVOQUEE',
  'UTILISATEUR_DESACTIVE',
  'MDP_RESET',
  'PLAN_DOWNGRADE',
  'FACTURE_PAYEE',
  'HOTEL_CREE',
  'MANAGER_HOTEL_ASSIGNE',
])

// Tronquer les valeurs JSON pour éviter des lignes d'audit trop volumineuses
function safeJson(value, maxLength = 4096) {
  if (value == null) return null
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value)
    return str.length > maxLength ? str.slice(0, maxLength) + '…[tronqué]' : str
  } catch {
    return '[non-sérialisable]'
  }
}

async function auditEnginePlugin(fastify) {

  const engine = {
    /**
     * Écriture d'un événement d'audit.
     *
     * MODE NORMAL (strict: false, défaut) :
     *   Fail-open — l'opération métier continue même si l'audit échoue.
     *   Adapté : login, analytics, modifications non-critiques.
     *
     * MODE STRICT (strict: true, auto-détecté pour STRICT_EVENTS) :
     *   Fail-closed — relève une exception si l'audit échoue.
     *   L'appelant DOIT gérer l'exception et rollback si nécessaire.
     *   Adapté : suspension tenant, impersonation, révocation sessions, billing.
     *
     * Détection automatique : si event est dans STRICT_EVENTS et strict n'est
     * pas explicitement false, le mode strict est activé automatiquement.
     */
    async log({
      event,
      actor          = {},
      target         = {},
      old_state      = null,
      new_state      = null,
      tenant_id      = null,
      hotel_id       = null,
      correlation_id = null,
      strict,         // true | false | undefined (undefined = auto-détection)
    }) {
      if (!event) {
        fastify.log.warn({ correlation_id }, 'AuditEngine.log() appelé sans event — ignoré')
        return
      }

      // Auto-détection strict mode : événements critiques par défaut en fail-closed
      const isStrict = strict === true || (strict !== false && STRICT_EVENTS.has(event))

      try {
        await fastify.db('logs_audit').insert({
          tenant_id:         tenant_id   || null,
          hotel_id:          hotel_id    || null,
          utilisateur_id:    actor.id    || null,
          action:            event,
          module:            resolveModule(event),
          ressource_type:    target.type || null,
          ressource_id:      target.id   || null,
          anciennes_valeurs: safeJson(old_state),
          nouvelles_valeurs: safeJson({ ...new_state, _correlation_id: correlation_id }),
          ip_address:        actor.ip    || null,
        })
      } catch (err) {
        fastify.log.error({
          correlation_id,
          event,
          err:      err.message,
          actor_id: actor.id,
          tenant_id,
          strict:   isStrict,
        }, 'AUDIT_ENGINE_WRITE_FAILURE')

        if (isStrict) {
          // Fail-closed : propager l'erreur pour bloquer l'opération ou déclencher un rollback
          const auditErr = new Error(`Audit obligatoire échoué pour ${event}: ${err.message}`)
          auditErr.code = 'AUDIT_WRITE_FAILURE'
          auditErr.event = event
          throw auditErr
        }
        // Fail-open : log seul, l'opération continue
      }
    },

    /**
     * Raccourci pour les actions plateforme (super_admin sur /platform/*)
     * Injecte automatiquement le contexte de la request Fastify.
     */
    async platform(request, event, target, old_state, new_state) {
      return engine.log({
        event,
        actor:          { id: request.user?.id, role: request.user?.role, ip: request.ip },
        target,
        old_state,
        new_state,
        tenant_id:      target?.tenant_id || request.drillTenantId || null,
        hotel_id:       request.drillHotelId || null,
        correlation_id: request.correlationId || null,
      })
    },
  }

  fastify.decorate('audit', engine)
}

module.exports = fp(auditEnginePlugin, { name: 'audit-engine', fastify: '4.x', dependencies: ['database'] })
