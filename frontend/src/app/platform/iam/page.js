'use client'

import { useState, useEffect, useCallback } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore } from '@/lib/utils'
import { platformFetch, platformAPI } from '@/lib/platform-api'

// Wrapper platformFetch pour les routes IAM — hérite timeout 10s + gestion 401/403
async function apiCall(method, path, _token, body) {
  return platformFetch(`iam/${path}`, { method, body: body || undefined })
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtRemaining(iso) {
  if (!iso) return '—'
  const ms = new Date(iso) - Date.now()
  if (ms <= 0) return 'expiré'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Badge scope ──────────────────────────────────────────────────────────────
function ScopeBadge({ scope }) {
  const map = {
    platform:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
    hotel:         'bg-blue-500/20 text-blue-300 border-blue-500/30',
    impersonation: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  }
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${map[scope] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'}`}>
      {scope}
    </span>
  )
}

// ── Sessions actives ─────────────────────────────────────────────────────────
function SessionsPanel({ token, onRevoke }) {
  const [sessions, setSessions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiCall('GET', 'sessions?limite=50', token)
      setSessions(data.sessions || [])
      setTotal(data.pagination?.total || 0)
    } catch {}
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  async function handleRevoke(jti) {
    if (!confirm('Révoquer cette session immédiatement ?')) return
    setRevoking(jti)
    try {
      await apiCall('DELETE', `sessions/${jti}`, token)
      onRevoke?.()
      await load()
    } catch (e) { alert(e.message) }
    finally { setRevoking(null) }
  }

  if (loading) return <div className="text-[var(--text-4)] text-xs text-center py-8">Chargement…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-[var(--text-4)]">{total} session{total > 1 ? 's' : ''} active{total > 1 ? 's' : ''} sur toute la plateforme</span>
        <button onClick={load} className="text-[9px] text-blue-400 hover:text-blue-300">Actualiser</button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-8 text-[var(--text-4)] text-xs">Aucune session active</div>
      ) : (
        <div className="space-y-1">
          {sessions.map(s => (
            <div key={s.jti} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border-0)] bg-[var(--bg-2)] hover:border-[var(--border-1)] transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-semibold text-[var(--text-0)] truncate">
                    {s.prenom} {s.nom}
                  </span>
                  <ScopeBadge scope={s.scope} />
                  <span className="text-[9px] text-[var(--text-4)]">{s.role}</span>
                </div>
                <div className="flex items-center gap-3 text-[9px] text-[var(--text-4)]">
                  <span className="truncate">{s.user_email}</span>
                  {s.tenant_nom && <span>· {s.tenant_nom} ({s.tenant_pays || '—'})</span>}
                  <span>· {s.ip_address || '—'}</span>
                  <span>· expire dans {fmtRemaining(s.expire_le)}</span>
                </div>
              </div>
              <button
                onClick={() => handleRevoke(s.jti)}
                disabled={revoking === s.jti}
                className="text-[9px] text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-2 py-1 rounded transition-colors disabled:opacity-40 flex-shrink-0"
              >
                {revoking === s.jti ? '…' : 'Révoquer'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Impersonation ────────────────────────────────────────────────────────────
function ImpersonationPanel({ token }) {
  const [tenants, setTenants] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ tenant_id: '', raison: '' })
  const [result, setResult] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [terminating, setTerminating] = useState(null)

  useEffect(() => {
    Promise.all([
      platformAPI.tenants('limite=100'),
      apiCall('GET', 'impersonation-sessions?statut=active&limite=20', token),
    ]).then(([t, s]) => {
      setTenants(t.tenants || [])
      setSessions(s.sessions || [])
    }).catch(() => {})
  }, [token])

  async function handleStart(e) {
    e.preventDefault()
    if (!form.tenant_id) return setErreur('Sélectionnez un tenant')
    if (form.raison.trim().length < 10) return setErreur('Raison trop courte (min 10 caractères)')
    setLoading(true); setErreur(null); setResult(null)
    try {
      const data = await apiCall('POST', `impersonate/${form.tenant_id}`, token, { raison: form.raison })
      setResult(data)
      // Stocker le token d'impersonation dans localStorage (pour la bannière)
      localStorage.setItem('7vh_impersonation_token', data.impersonation_token)
      localStorage.setItem('7vh_impersonation_session_id', data.session_id)
      localStorage.setItem('7vh_impersonation_tenant', data.tenant_nom)
      localStorage.setItem('7vh_impersonation_expire', data.expire_le)
      // Rafraîchir la liste des sessions
      const s = await apiCall('GET', 'impersonation-sessions?statut=active&limite=20', token)
      setSessions(s.sessions || [])
    } catch (e) { setErreur(e.message) }
    finally { setLoading(false) }
  }

  async function handleTerminate(sessionId) {
    if (!confirm('Terminer cette session d\'impersonation ?')) return
    setTerminating(sessionId)
    try {
      await apiCall('DELETE', `impersonate/${sessionId}`, token)
      // Nettoyer localStorage si c'est la session courante
      if (localStorage.getItem('7vh_impersonation_session_id') === sessionId) {
        localStorage.removeItem('7vh_impersonation_token')
        localStorage.removeItem('7vh_impersonation_session_id')
        localStorage.removeItem('7vh_impersonation_tenant')
        localStorage.removeItem('7vh_impersonation_expire')
      }
      const s = await apiCall('GET', 'impersonation-sessions?statut=active&limite=20', token)
      setSessions(s.sessions || [])
      setResult(null)
    } catch (e) { alert(e.message) }
    finally { setTerminating(null) }
  }

  return (
    <div className="space-y-5">
      {/* Formulaire démarrage */}
      <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-amber-400 mb-3">
          Démarrer une session d'impersonation
        </div>
        <form onSubmit={handleStart} className="space-y-3">
          <div>
            <label className="text-[10px] text-[var(--text-3)] block mb-1">Tenant cible</label>
            <select
              value={form.tenant_id}
              onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))}
              className="w-full text-xs bg-[var(--bg-3)] border border-[var(--border-1)] rounded-lg px-3 py-2 text-[var(--text-0)]"
            >
              <option value="">Sélectionner un tenant…</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.nom} ({t.pays || 'N/A'}) — {t.statut}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-3)] block mb-1">
              Raison <span className="text-amber-400">*</span> (obligatoire, min 10 chars)
            </label>
            <textarea
              value={form.raison}
              onChange={e => setForm(f => ({ ...f, raison: e.target.value }))}
              placeholder="Ex: Investigation ticket support #1234 — client signale erreur de facturation"
              rows={2}
              className="w-full text-xs bg-[var(--bg-3)] border border-[var(--border-1)] rounded-lg px-3 py-2 text-[var(--text-0)] resize-none"
            />
            <div className="text-[9px] text-[var(--text-4)] mt-0.5">{form.raison.length}/10 min</div>
          </div>

          {erreur && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{erreur}</div>}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={loading}
              className="text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:border-amber-500/60 px-4 py-2 rounded-lg transition-colors disabled:opacity-40">
              {loading ? 'Démarrage…' : 'Démarrer l\'impersonation (2h max)'}
            </button>
            <span className="text-[9px] text-[var(--text-4)]">Session expirée automatiquement après 2h</span>
          </div>
        </form>

        {result && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-[10px] font-bold text-amber-300 mb-1">
              Session active — {result.tenant_nom}
            </div>
            <div className="text-[9px] text-[var(--text-3)]">
              Expire : {fmtDate(result.expire_le)} · Session ID : {result.session_id?.slice(0, 8)}…
            </div>
            <div className="text-[9px] text-amber-400 mt-1">
              Le token d'impersonation est stocké. La bannière est visible sur toutes les pages.
            </div>
          </div>
        )}
      </div>

      {/* Sessions actives */}
      {sessions.length > 0 && (
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-2">
            Sessions actives ({sessions.length})
          </div>
          <div className="space-y-1">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5">
                <div className="flex-1">
                  <div className="text-[11px] font-semibold text-amber-300">{s.tenant_nom}</div>
                  <div className="text-[9px] text-[var(--text-4)]">
                    par {s.admin_prenom} {s.admin_nom} · {fmtDate(s.cree_le)} · expire {fmtRemaining(s.expire_le)}
                  </div>
                  <div className="text-[9px] text-[var(--text-4)] truncate max-w-xs mt-0.5">Raison : {s.raison}</div>
                </div>
                <button
                  onClick={() => handleTerminate(s.id)}
                  disabled={terminating === s.id}
                  className="text-[9px] text-red-400 border border-red-500/30 px-2 py-1 rounded hover:border-red-500/60 transition-colors disabled:opacity-40"
                >
                  {terminating === s.id ? '…' : 'Terminer'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Historique sécurité ──────────────────────────────────────────────────────
function SecurityPanel({ token }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiCall('GET', 'impersonation-sessions?limite=30', token)
      .then(d => setHistory(d.sessions || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <div className="text-[var(--text-4)] text-xs text-center py-8">Chargement…</div>

  return (
    <div className="space-y-1">
      {history.length === 0 ? (
        <div className="text-center py-8 text-[var(--text-4)] text-xs">Aucune impersonation enregistrée</div>
      ) : history.map(s => (
        <div key={s.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${s.active ? 'border-amber-500/30 bg-amber-500/5' : 'border-[var(--border-0)] bg-[var(--bg-2)]'}`}>
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.active ? 'bg-amber-400' : 'bg-gray-600'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[var(--text-0)]">{s.tenant_nom}</span>
              {s.active && <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1 rounded">ACTIVE</span>}
            </div>
            <div className="text-[9px] text-[var(--text-4)]">
              {s.admin_prenom} {s.admin_nom} · {fmtDate(s.cree_le)}
              {s.revoque_le && ` · révoquée ${fmtDate(s.revoque_le)}`}
            </div>
            <div className="text-[9px] text-[var(--text-4)] truncate">Raison : {s.raison}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PlatformIAM() {
  const token    = useAuthStore(s => s.token)
  const [tab, setTab] = useState('sessions')
  const [revocations, setRevocations] = useState(0)

  const tabs = [
    { id: 'sessions',       label: 'Sessions actives',   icon: '🔑' },
    { id: 'impersonation',  label: 'Impersonation',      icon: '🎭' },
    { id: 'historique',     label: 'Historique sécurité',icon: '🛡' },
  ]

  return (
    <PlatformLayout titre="IAM — Identity & Access" sousTitre="Gouvernance des identités et sessions plateforme">

      {/* En-tête invariants */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        {[
          { label: 'Sessions révocables',     value: '✓', sub: 'Redis + DB', accent: 'emerald' },
          { label: 'Impersonation auditée',   value: '✓', sub: 'Raison + IP + durée', accent: 'emerald' },
          { label: 'Isolation cross-tenant',  value: '✓', sub: 'scopePlateforme', accent: 'emerald' },
        ].map(c => {
          const a = { emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' }[c.accent]
          return (
            <div key={c.label} className={`rounded-xl border ${a} p-3`}>
              <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-1">{c.label}</div>
              <div className="text-xl font-black text-emerald-400">{c.value}</div>
              <div className="text-[9px] text-[var(--text-4)]">{c.sub}</div>
            </div>
          )
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[var(--border-0)] pb-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border border-transparent transition-all
              ${tab === t.id
                ? 'text-blue-400 border-[var(--border-0)] border-b-[var(--bg-0)] bg-[var(--bg-0)] -mb-px'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Contenu des tabs */}
      <div className="rounded-xl border border-[var(--border-0)] bg-[var(--bg-1)] p-5">
        {tab === 'sessions'      && <SessionsPanel token={token} onRevoke={() => setRevocations(r => r + 1)} />}
        {tab === 'impersonation' && <ImpersonationPanel token={token} />}
        {tab === 'historique'    && <SecurityPanel token={token} />}
      </div>

    </PlatformLayout>
  )
}
