// ─────────────────────────────────────────────────────────────────────────────
// platform-api.js — Client HTTP centralisé pour les routes /platform/*
//
// GARANTIES :
//   • Timeout 10s — jamais de Promise suspendue indéfiniment → jamais de loader infini
//   • 401 SESSION_REVOQUEE → logout automatique + redirect /auth/connexion
//   • 401 générique → même traitement (token expiré)
//   • 403 SCOPE_PLATEFORME_REQUIS → redirect /auth/connexion (rôle incorrect)
//   • Corrélation ID automatique sur chaque request
//   • Pas de dépendance axios — fetch natif, contrôlable
// ─────────────────────────────────────────────────────────────────────────────

const BASE = (process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3001') + '/api/v1/platform'
const TIMEOUT_MS = 10_000

let _logoutCallback = null

/**
 * Enregistrer le callback de logout (appelé par le store Zustand).
 * Évite une dépendance circulaire avec useAuthStore.
 */
export function registerPlatformLogout(fn) {
  _logoutCallback = fn
}

function doLogout(reason = 'session_expired') {
  if (typeof window === 'undefined') return
  // Nettoyer localStorage
  ;['7vh_token','7vh_refresh_token','7vh_user','7vh_hotel','7vh_hotel_id',
    '7vh_impersonation_token','7vh_impersonation_session_id',
    '7vh_impersonation_tenant','7vh_impersonation_expire',
  ].forEach(k => localStorage.removeItem(k))

  if (_logoutCallback) _logoutCallback()
  window.location.href = `/auth/connexion?reason=${reason}`
}

/**
 * Fetch vers /platform/* avec timeout, correlation ID et gestion 401/403.
 *
 * @param {string} path     — ex: 'dashboard', 'tenants?limite=6'
 * @param {object} options  — { method, body, headers }
 * @returns {Promise<any>}  — Parsed JSON response
 */
export async function platformFetch(path, options = {}) {
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('7vh_token')
    : null

  const correlationId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const controller    = new AbortController()
  const timer         = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE}/${path}`, {
      method:  options.method || 'GET',
      headers: {
        'Authorization':    `Bearer ${token}`,
        'Content-Type':     'application/json',
        'X-Correlation-ID': correlationId,
        ...options.headers,
      },
      body:   options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })

    clearTimeout(timer)

    // Session révoquée ou token invalide → logout immédiat
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}))
      const code = body?.code || 'SESSION_EXPIRED'
      doLogout(code)
      throw new PlatformAuthError(body?.erreur || 'Session expirée', code)
    }

    // Accès refusé (scope incorrect) → logout
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      if (body?.code === 'SCOPE_PLATEFORME_REQUIS') {
        doLogout('scope_incorrect')
        throw new PlatformAuthError(body?.erreur || 'Accès refusé', body.code)
      }
      throw new PlatformAPIError(body?.erreur || 'Accès refusé', res.status, body?.code)
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new PlatformAPIError(body?.erreur || `HTTP ${res.status}`, res.status, body?.code)
    }

    return res.json()

  } catch (err) {
    clearTimeout(timer)

    if (err.name === 'AbortError') {
      throw new PlatformTimeoutError(`Le serveur n'a pas répondu dans les délais (${TIMEOUT_MS / 1000}s)`)
    }

    if (err instanceof PlatformAuthError || err instanceof PlatformAPIError || err instanceof PlatformTimeoutError) {
      throw err
    }

    // Erreur réseau (backend hors ligne)
    throw new PlatformNetworkError('Backend inaccessible — vérifiez que le serveur est démarré')
  }
}

// ── Classes d'erreur typées ───────────────────────────────────────────────────

export class PlatformAuthError extends Error {
  constructor(message, code) { super(message); this.name = 'PlatformAuthError'; this.code = code }
}

export class PlatformAPIError extends Error {
  constructor(message, status, code) { super(message); this.name = 'PlatformAPIError'; this.status = status; this.code = code }
}

export class PlatformTimeoutError extends Error {
  constructor(message) { super(message); this.name = 'PlatformTimeoutError' }
}

export class PlatformNetworkError extends Error {
  constructor(message) { super(message); this.name = 'PlatformNetworkError' }
}

// ── Helpers sémantiques ────────────────────────────────────────────────────────

export const platformAPI = {
  dashboard:          () => platformFetch('dashboard'),
  tenants:            (params = '') => platformFetch(`tenants${params ? '?' + params : ''}`),
  tenantById:         (id) => platformFetch(`tenants/${id}`),
  tenantLifecycle:    (id) => platformFetch(`tenants/${id}/lifecycle`),
  tenantQuota:        (id) => platformFetch(`tenants/${id}/quota`),
  tenantCreerUtilisateur: (id, d) => platformFetch(`tenants/${id}/utilisateurs`, { method: 'POST', body: d }),
  tenantSuspend:      (id, motif) => platformFetch(`tenants/${id}/suspend`, { method: 'PATCH', body: { motif } }),
  tenantActivate:     (id) => platformFetch(`tenants/${id}/activate`, { method: 'PATCH' }),
  tenantGrace:        (id, motif) => platformFetch(`tenants/${id}/grace`,   { method: 'PATCH', body: { motif } }),
  tenantResilier:     (id, motif) => platformFetch(`tenants/${id}/resilier`,{ method: 'PATCH', body: { motif } }),
  billingMRR:         () => platformFetch('billing/mrr'),
  audit:              (params = '') => platformFetch(`audit${params ? '?' + params : ''}`),
  aiConsumption:      () => platformFetch('ai/consumption'),
  health:             () => platformFetch('health'),
  iamSessions:        (params = '') => platformFetch(`iam/sessions${params ? '?' + params : ''}`),
  iamImpersonations:  (params = '') => platformFetch(`iam/impersonation-sessions${params ? '?' + params : ''}`),
  impersonate:        (tenant_id, raison) => platformFetch(`iam/impersonate/${tenant_id}`, { method: 'POST', body: { raison } }),
  endImpersonation:   (session_id) => platformFetch(`iam/impersonate/${session_id}`, { method: 'DELETE' }),
  policyRefusals:     () => platformFetch('policy/refusals'),

  // ── Onboarding SaaS ──────────────────────────────────────────────────────
  createTenant:       (body)     => platformFetch('tenants',                          { method: 'POST', body }),
  createSubscription: (id, body) => platformFetch(`tenants/${id}/subscription`,       { method: 'POST', body }),
  provisionManager:   (id, body) => platformFetch(`tenants/${id}/provision-manager`,  { method: 'POST', body }),

  // ── Platform Config ───────────────────────────────────────────────────────
  config: {
    // Plans
    plans:            ()           => platformFetch('config/plans'),
    plan:             (code)       => platformFetch(`config/plans/${code}`),
    updatePlan:       (code, body) => platformFetch(`config/plans/${code}`,  { method: 'PUT',    body }),
    createPlan:       (body)       => platformFetch('config/plans',           { method: 'POST',   body }),
    // Modules
    modules:          ()                       => platformFetch('config/modules'),
    addPlanModule:    (planCode, moduleCode)   => platformFetch(`config/plans/${planCode}/modules/${moduleCode}`, { method: 'POST' }),
    removePlanModule: (planCode, moduleCode)   => platformFetch(`config/plans/${planCode}/modules/${moduleCode}`, { method: 'DELETE' }),
    // Providers
    providers:        ()           => platformFetch('config/providers'),
    updateProvider:   (code, body) => platformFetch(`config/providers/${code}`, { method: 'PUT',  body }),
    createProvider:   (body)       => platformFetch('config/providers',           { method: 'POST', body }),
    // Feature flags
    flags:            ()           => platformFetch('config/flags'),
    updateFlag:       (code, body) => platformFetch(`config/flags/${code}`,     { method: 'PUT',  body }),
    // Settings
    settings:         ()           => platformFetch('config/settings'),
    updateSetting:    (cle, body)  => platformFetch(`config/settings/${cle}`,   { method: 'PUT',  body }),
    // Tenant overrides
    overrides:        (tenantId)              => platformFetch(`config/overrides/${tenantId}`),
    createOverride:   (tenantId, body)        => platformFetch(`config/overrides/${tenantId}`,               { method: 'POST',   body }),
    deleteOverride:   (tenantId, moduleCode)  => platformFetch(`config/overrides/${tenantId}/${moduleCode}`, { method: 'DELETE' }),
  },
}
