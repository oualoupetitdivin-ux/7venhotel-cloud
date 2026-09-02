'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore, fmt } from '@/lib/utils'
import { platformAPI } from '@/lib/platform-api'

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatutBadge({ statut }) {
  const map = {
    actif:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    essai:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
    suspendu: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    grace:    'bg-orange-500/20 text-orange-300 border-orange-500/30',
    résilié:  'bg-red-500/20 text-red-300 border-red-500/30',
  }
  return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${map[statut] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'}`}>{statut}</span>
}

function QuotaBar({ label, actuel, max, icon }) {
  const pct = max > 0 ? Math.min(100, Math.round((actuel / max) * 100)) : null
  const color = pct == null ? 'bg-blue-500' : pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[var(--text-3)]">{icon} {label}</span>
        <span className="text-[10px] font-bold text-[var(--text-1)]">
          {actuel} / {max === -1 ? '∞' : max ?? '—'}
          {pct != null && <span className="text-[var(--text-4)] font-normal ml-1">({pct}%)</span>}
        </span>
      </div>
      {max > 0 && (
        <div className="h-1.5 rounded-full bg-[var(--bg-3)]">
          <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

// ── Onglet : Vue d'ensemble ──────────────────────────────────────────────────
function OverviewTab({ profile, onAction, acting, actionErreur }) {
  const { tenant, abonnement, plan_config, utilisation, transitions_disponibles } = profile

  const ACTIONS = {
    activer:  { label: 'Activer',   color: 'emerald', icon: '✓', confirm: 'Activer ce tenant ?' },
    suspendre:{ label: 'Suspendre', color: 'amber',   icon: '⏸', confirm: 'Suspendre ce tenant ? Les sessions actives seront révoquées.' },
    grace:    { label: 'Grâce',     color: 'orange',  icon: '⏱', confirm: 'Placer ce tenant en période de grâce ?' },
    resilier: { label: 'Résilier',  color: 'red',     icon: '✕', confirm: 'RÉSILIER ce tenant ? Action irréversible.' },
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Identité */}
      <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-3">Identité</div>
        <div className="space-y-1.5 text-[11px]">
          {[
            ['Nom',   tenant.nom],
            ['Slug',  tenant.slug],
            ['Pays',  tenant.pays],
            ['Email', tenant.email_contact],
            ['Créé',  fmtDate(tenant.cree_le)],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-[var(--text-4)] w-14 flex-shrink-0">{k}</span>
              <span className="text-[var(--text-1)]">{v || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Abonnement */}
      <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-3">Abonnement</div>
        <div className="text-xl font-black text-[var(--text-0)] mb-1">{plan_config?.label || abonnement?.plan || '—'}</div>
        <div className="text-[10px] text-[var(--text-3)] mb-3">{fmt(plan_config?.prix_mensuel_xaf || 0)} / mois</div>
        <div className="space-y-0.5 text-[10px] text-[var(--text-4)]">
          <div>Renouvellement : {fmtDate(abonnement?.date_fin)}</div>
          <div>Période de grâce : {plan_config?.grace_period_days ?? 0} jours</div>
        </div>
      </div>

      {/* Quotas */}
      <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-3">Utilisation</div>
        <QuotaBar label="Hôtels"       icon="🏨" actuel={utilisation.hotels.actuel}       max={utilisation.hotels.max} />
        <QuotaBar label="Utilisateurs" icon="👤" actuel={utilisation.utilisateurs.actuel} max={utilisation.utilisateurs.max} />
        <div className="text-[9px] text-[var(--text-4)] mt-2">{utilisation.sessions_actives} session(s) active(s)</div>
      </div>

      {/* Actions lifecycle */}
      <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-3">
          Actions lifecycle — état actuel : <StatutBadge statut={tenant.statut} />
        </div>
        {transitions_disponibles.length === 0 ? (
          <div className="text-[10px] text-[var(--text-4)] py-2">État terminal — aucune transition possible</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {transitions_disponibles.map(action => {
              const cfg = ACTIONS[action]
              if (!cfg) return null
              const colors = { emerald: 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10', amber: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10', orange: 'border-orange-500/40 text-orange-300 hover:bg-orange-500/10', red: 'border-red-500/40 text-red-300 hover:bg-red-500/10' }
              return (
                <button key={action}
                  onClick={() => confirm(cfg.confirm) && onAction(action)}
                  disabled={acting}
                  className={`text-[10px] font-bold border px-3 py-1.5 rounded-lg transition-all ${colors[cfg.color]} disabled:opacity-40`}>
                  {cfg.icon} {cfg.label}
                </button>
              )
            })}
          </div>
        )}
        {actionErreur && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[10px] text-red-400">
            {actionErreur}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Onglet : Hôtels ──────────────────────────────────────────────────────────
function HotelsTab({ tenantId }) {
  const [hotels, setHotels] = useState([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    platformAPI.tenantById(tenantId).then(d => setHotels(d.hotels || [])).catch(() => {})
  }, [tenantId])
  return (
    <div className="space-y-2">
      {hotels.length === 0 ? <div className="text-[var(--text-4)] text-xs text-center py-8">Aucun hôtel</div> : hotels.map(h => (
        <div key={h.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-0)] bg-[var(--bg-2)]">
          <div className={`w-2 h-2 rounded-full ${h.statut === 'actif' ? 'bg-emerald-500' : 'bg-gray-500'}`} />
          <div className="flex-1"><div className="text-xs font-semibold text-[var(--text-0)]">{h.nom}</div><div className="text-[9px] text-[var(--text-4)]">Créé {fmtDate(h.cree_le)}</div></div>
          <span className="text-[9px] text-[var(--text-4)]">{h.id?.slice(0, 8)}…</span>
        </div>
      ))}
    </div>
  )
}

// ── Onglet : Utilisateurs ────────────────────────────────────────────────────
function UsersTab({ tenantId }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [erreur,  setErreur]  = useState(null)
  const [form,    setForm]    = useState(null) // null = fermé

  const ROLES = ['manager','reception','housekeeping','restaurant','comptabilite','technicien']
  const ROLE_COLORS = { super_admin:'text-purple-400', manager:'text-blue-400', reception:'text-emerald-400', housekeeping:'text-amber-400', restaurant:'text-orange-400', comptabilite:'text-cyan-400' }

  async function charger() {
    setLoading(true); setErreur(null)
    try {
      const d = await platformAPI.tenantById(tenantId)
      setUsers(d.utilisateurs || [])
    } catch (e) { setErreur(e.message || 'Erreur chargement') }
    finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger() }, [tenantId])

  async function creer(e) {
    e.preventDefault()
    try {
      await platformAPI.tenantCreerUtilisateur(tenantId, form)
      setForm(null)
      charger()
    } catch (e) { alert(e.message || 'Erreur création') }
  }

  if (loading) return <div className="text-[var(--text-4)] text-xs text-center py-8">Chargement…</div>
  if (erreur)  return <div className="text-red-400 text-xs text-center py-8">{erreur}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-[var(--text-4)]">{users.length} utilisateur(s)</span>
        <button onClick={() => setForm({ prenom:'', nom:'', email:'', role:'reception', mot_de_passe:'Demo2024!' })}
          className="text-[10px] px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
          ＋ Créer utilisateur
        </button>
      </div>

      {form && (
        <form onSubmit={creer} className="bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl p-4 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input required placeholder="Prénom" value={form.prenom} onChange={e => setForm({...form, prenom:e.target.value})}
              className="input text-xs py-1.5" />
            <input required placeholder="Nom" value={form.nom} onChange={e => setForm({...form, nom:e.target.value})}
              className="input text-xs py-1.5" />
          </div>
          <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({...form, email:e.target.value})}
            className="input text-xs py-1.5 w-full" />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.role} onChange={e => setForm({...form, role:e.target.value})} className="input text-xs py-1.5">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <input placeholder="Mot de passe" value={form.mot_de_passe} onChange={e => setForm({...form, mot_de_passe:e.target.value})}
              className="input text-xs py-1.5" />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setForm(null)} className="btn btn-ghost btn-xs">Annuler</button>
            <button type="submit" className="btn btn-primary btn-xs">Créer →</button>
          </div>
        </form>
      )}

      <div className="space-y-1">
        {users.length === 0 ? (
          <div className="text-[var(--text-4)] text-xs text-center py-8">Aucun utilisateur — créez le premier ci-dessus</div>
        ) : users.map(u => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border-0)] bg-[var(--bg-2)]">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
              {(u.prenom?.[0]||'') + (u.nom?.[0]||'')}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[var(--text-0)]">{u.prenom} {u.nom}</div>
              <div className="text-[9px] text-[var(--text-4)] truncate">{u.email}</div>
            </div>
            <span className={`text-[9px] font-bold ${ROLE_COLORS[u.role] || 'text-gray-400'}`}>{u.role}</span>
            <span className="text-[9px] text-[var(--text-4)]">{u.derniere_connexion ? fmtDate(u.derniere_connexion) : 'Jamais'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Onglet : Activité ────────────────────────────────────────────────────────
function ActivityTab({ tenantId }) {
  const [logs, setLogs] = useState([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    platformAPI.audit(`tenant_id=${tenantId}&limite=30`).then(d => setLogs(d.logs || [])).catch(() => {})
  }, [tenantId])
  return (
    <div className="space-y-1">
      {logs.length === 0 ? <div className="text-[var(--text-4)] text-xs text-center py-8">Aucun événement</div> : logs.map(l => (
        <div key={l.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border-0)] bg-[var(--bg-2)] text-[10px]">
          <span className="text-[var(--text-4)] font-mono flex-shrink-0">{new Date(l.cree_le).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</span>
          <span className="font-bold text-blue-400">{l.action}</span>
          <span className="text-[var(--text-4)] flex-shrink-0">{l.module}</span>
          <span className="text-[var(--text-3)] truncate">{l.utilisateur_email || '—'}</span>
        </div>
      ))}
    </div>
  )
}

// ── Onglet : Quota ───────────────────────────────────────────────────────────
function QuotaTab({ tenantId }) {
  const [quota, setQuota] = useState(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    platformAPI.tenantQuota(tenantId).then(setQuota).catch(() => {})
  }, [tenantId])
  if (!quota) return <div className="text-[var(--text-4)] text-xs text-center py-8">Chargement…</div>
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
          <QuotaBar label="Hôtels"       icon="🏨" actuel={quota.hotels?.actuel}       max={quota.hotels?.max} />
          <QuotaBar label="Utilisateurs" icon="👤" actuel={quota.utilisateurs?.actuel} max={quota.utilisateurs?.max} />
        </div>
        <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)] col-span-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-3">Modules activés — Plan {quota.plan}</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(quota.modules || {}).map(([k, v]) => (
              <span key={k} className={`text-[9px] px-2 py-0.5 rounded border ${v ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5' : 'text-gray-600 border-gray-700/30 bg-gray-800/20 line-through'}`}>{k}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function TenantDetailPage() {
  const { id }  = useParams()
  const { init } = useAuthStore()
  const [profile,      setProfile]      = useState(null)
  const [tab,          setTab]          = useState('overview')
  const [acting,       setActing]       = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [erreur,       setErreur]       = useState(null)
  const [actionErreur, setActionErreur] = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  const loadProfile = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await platformAPI.tenantLifecycle(id)
      setProfile(data)
      setErreur(null)
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadProfile() }, [])

  async function handleAction(action) {
    setActing(true)
    setActionErreur(null)
    try {
      const motif = ['suspendre', 'resilier', 'grace'].includes(action)
        ? prompt(`Motif pour "${action}" :`) || ''
        : ''
      const actionMap = {
        activer:  () => platformAPI.tenantActivate(id),
        suspendre: () => platformAPI.tenantSuspend(id, motif),
        grace:    () => platformAPI.tenantGrace(id, motif),
        resilier:  () => platformAPI.tenantResilier(id, motif),
      }
      await actionMap[action]?.()
      await loadProfile()
    } catch (e) {
      if (e.name !== 'PlatformAuthError') setActionErreur(e.message)
    } finally {
      setActing(false)
    }
  }

  const TABS = [
    { id: 'overview',  label: 'Vue d\'ensemble', icon: '⊞' },
    { id: 'hotels',    label: 'Hôtels',          icon: '🏨' },
    { id: 'users',     label: 'Utilisateurs',    icon: '👤' },
    { id: 'activity',  label: 'Activité',         icon: '📋' },
    { id: 'quota',     label: 'Quotas',           icon: '📊' },
  ]

  if (loading) return (
    <PlatformLayout titre="Tenant" sousTitre="Chargement…">
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    </PlatformLayout>
  )

  if (erreur) return (
    <PlatformLayout titre="Tenant" sousTitre="Erreur">
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="text-sm font-bold text-red-300 mb-3">{erreur}</div>
        <button onClick={() => { setErreur(null); setLoading(true); loadProfile() }}
          className="text-xs px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
          ↻ Réessayer
        </button>
      </div>
    </PlatformLayout>
  )

  if (!profile) return null

  return (
    <PlatformLayout
      titre={profile.tenant.nom}
      sousTitre={`Tenant · ${profile.tenant.pays || '—'} · ${profile.tenant.slug}`}
    >
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-lg flex-shrink-0">
          {profile.tenant.nom?.[0] || '?'}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-black text-[var(--text-0)]">{profile.tenant.nom}</h1>
            <StatutBadge statut={profile.tenant.statut} />
          </div>
          <div className="text-[10px] text-[var(--text-4)]">{profile.tenant.email_contact} · Plan {profile.abonnement?.plan || 'essai'}</div>
        </div>
        <Link href="/platform/tenants" className="text-[9px] text-[var(--text-4)] hover:text-[var(--text-2)]">← Tenants</Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[var(--border-0)]">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border border-transparent transition-all
              ${tab === t.id ? 'text-blue-400 border-[var(--border-0)] border-b-[var(--bg-0)] bg-[var(--bg-0)] -mb-px' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
            <span>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Contenu */}
      <div className="rounded-xl border border-[var(--border-0)] bg-[var(--bg-1)] p-5">
        {tab === 'overview' && <OverviewTab profile={profile} onAction={handleAction} acting={acting} actionErreur={actionErreur} />}
        {tab === 'hotels'   && <HotelsTab   tenantId={id} />}
        {tab === 'users'    && <UsersTab    tenantId={id} />}
        {tab === 'activity' && <ActivityTab tenantId={id} />}
        {tab === 'quota'    && <QuotaTab    tenantId={id} />}
      </div>
    </PlatformLayout>
  )
}
