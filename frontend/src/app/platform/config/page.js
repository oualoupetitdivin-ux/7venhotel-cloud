'use client'
import { useState, useEffect, useCallback } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore, fmt } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError } from '@/lib/platform-api'

// ── Composants utilitaires ───────────────────────────────────────────────────

function ErreurPlatform({ erreur, errType, onRetry }) {
  const isTimeout = errType === 'PlatformTimeoutError'
  const isNetwork = errType === 'PlatformNetworkError'
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{isTimeout ? '⏱' : isNetwork ? '📡' : '⚠'}</span>
        <div>
          <div className="text-sm font-bold text-red-300">
            {isTimeout ? 'Délai dépassé' : isNetwork ? 'Backend inaccessible' : 'Erreur plateforme'}
          </div>
          <div className="text-xs text-red-400/70 mt-0.5">{erreur}</div>
        </div>
      </div>
      <button onClick={onRetry}
        className="text-xs px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
        ↻ Réessayer
      </button>
    </div>
  )
}

function Badge({ children, color = 'gray' }) {
  const c = {
    green: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    red:   'bg-red-500/20 text-red-300 border-red-500/30',
    blue:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
    amber: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    gray:  'bg-gray-500/20 text-gray-300 border-gray-500/30',
  }
  return <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${c[color] || c.gray}`}>{children}</span>
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-blue-500' : 'bg-gray-600'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  )
}

function SectionHeader({ title }) {
  return <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-3">{title}</div>
}

// ── Onglet Plans ─────────────────────────────────────────────────────────────
function PlansTab() {
  const [plans, setPlans]       = useState([])
  const [editPlan, setEditPlan] = useState(null)  // { code, ...fields }
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null)

  useEffect(() => {
    platformAPI.config.plans().then(d => setPlans(d.plans || [])).catch(() => {})
  }, [])

  async function sauvegarder() {
    if (!editPlan) return
    setSaving(true)
    setMsg(null)
    try {
      await platformAPI.config.updatePlan(editPlan.code, {
        label:             editPlan.label,
        prix_mensuel_xaf:  parseInt(editPlan.prix_mensuel_xaf),
        max_hotels:        parseInt(editPlan.max_hotels),
        max_chambres:      parseInt(editPlan.max_chambres),
        max_utilisateurs:  parseInt(editPlan.max_utilisateurs),
        quota_ia_mensuel:  parseInt(editPlan.quota_ia_mensuel),
        grace_period_days: parseInt(editPlan.grace_period_days),
      })
      const d = await platformAPI.config.plans()
      setPlans(d.plans || [])
      setMsg({ type: 'ok', text: `Plan ${editPlan.code} sauvegardé` })
      setEditPlan(null)
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setSaving(false) }
  }

  const PLAN_COLORS = { essai: 'blue', starter: 'blue', business: 'purple', enterprise: 'amber', 'ohada+': 'emerald' }
  const getColor = (code) => {
    const c = PLAN_COLORS[code?.toLowerCase()] || 'gray'
    const map = { blue: 'border-blue-500/30 bg-blue-500/5 text-blue-400', purple: 'border-purple-500/30 bg-purple-500/5 text-purple-400', amber: 'border-amber-500/30 bg-amber-500/5 text-amber-400', emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400', gray: 'border-gray-500/30 bg-gray-500/5 text-gray-400' }
    return map[c] || map.gray
  }

  return (
    <div>
      {msg && (
        <div className={`mb-4 text-xs px-4 py-2 rounded-lg border ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {/* Grille plans */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {plans.map(p => (
          <div key={p.code} className={`rounded-xl border p-4 cursor-pointer hover:opacity-90 transition-opacity ${getColor(p.code)}`}
            onClick={() => setEditPlan({ ...p })}>
            <div className="text-xs font-black uppercase mb-1">{p.label}</div>
            <div className="text-xl font-black text-[var(--text-0)]">{fmt(p.prix_mensuel_xaf || 0)}<span className="text-[10px] font-normal text-[var(--text-4)]">/mois</span></div>
            <div className="text-[9px] text-[var(--text-4)] mt-2 space-y-0.5">
              <div>{p.max_hotels === -1 ? '∞' : p.max_hotels} hôtels · {p.max_chambres === -1 ? '∞' : p.max_chambres} chambres</div>
              <div>{p.max_utilisateurs === -1 ? '∞' : p.max_utilisateurs} users · {p.quota_ia_mensuel === -1 ? '∞' : (p.quota_ia_mensuel || 0).toLocaleString('fr')} tokens IA</div>
              <div>Grâce : {p.grace_period_days}j</div>
            </div>
            <div className="text-[8px] mt-2 text-[var(--text-4)]">Cliquer pour modifier</div>
          </div>
        ))}
      </div>

      {/* Formulaire d'édition inline */}
      {editPlan && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-black text-blue-300">Modifier plan : {editPlan.code}</div>
            <button onClick={() => setEditPlan(null)} className="text-[10px] text-[var(--text-4)] hover:text-[var(--text-2)]">✕ Fermer</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['label',             'Libellé',         'text'],
              ['prix_mensuel_xaf',  'Prix / mois (XAF)', 'number'],
              ['max_hotels',        'Max hôtels (-1=∞)', 'number'],
              ['max_chambres',      'Max chambres',     'number'],
              ['max_utilisateurs',  'Max utilisateurs', 'number'],
              ['quota_ia_mensuel',  'Quota IA (tokens)', 'number'],
              ['grace_period_days', 'Grâce (jours)',    'number'],
            ].map(([field, label, type]) => (
              <div key={field}>
                <label className="text-[9px] text-[var(--text-4)] uppercase tracking-wider">{label}</label>
                <input
                  type={type}
                  value={editPlan[field] ?? ''}
                  onChange={e => setEditPlan(p => ({ ...p, [field]: e.target.value }))}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--bg-2)] border border-[var(--border-1)] rounded-lg text-[var(--text-0)] focus:outline-none focus:border-blue-500/50"
                />
              </div>
            ))}
          </div>
          <button
            onClick={sauvegarder}
            disabled={saving}
            className="mt-4 text-xs px-5 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-40 transition-colors font-bold">
            {saving ? '⏳ Sauvegarde…' : '✓ Sauvegarder'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Onglet Modules ───────────────────────────────────────────────────────────
function ModulesTab() {
  const [plans,   setPlans]   = useState([])
  const [modules, setModules] = useState([])
  const [toggling, setToggling] = useState(null)  // 'planCode:moduleCode'
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    Promise.all([
      platformAPI.config.plans().then(d => d.plans || []),
      platformAPI.config.modules().then(d => d.modules || []),
    ]).then(([p, m]) => { setPlans(p); setModules(m) }).catch(() => {})
  }, [])

  async function toggleModule(planCode, moduleCode, currentlyIncluded) {
    const key = `${planCode}:${moduleCode}`
    setToggling(key)
    setMsg(null)
    try {
      if (currentlyIncluded) {
        await platformAPI.config.removePlanModule(planCode, moduleCode)
      } else {
        await platformAPI.config.addPlanModule(planCode, moduleCode)
      }
      const d = await platformAPI.config.plans()
      setPlans(d.plans || [])
      setMsg({ type: 'ok', text: `${moduleCode} ${currentlyIncluded ? 'retiré de' : 'ajouté à'} ${planCode}` })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setToggling(null) }
  }

  const CATEG_COLORS = { operations: 'text-blue-400', ia: 'text-purple-400', conformite: 'text-amber-400', commercial: 'text-emerald-400' }

  return (
    <div>
      {msg && (
        <div className={`mb-4 text-xs px-4 py-2 rounded-lg border ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {msg.text}
        </div>
      )}
      <div className="text-[9px] text-[var(--text-4)] mb-4">Cocher/décocher pour inclure/exclure un module dans un plan</div>
      <div className="rounded-xl border border-[var(--border-0)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--bg-2)] border-b border-[var(--border-0)]">
              <th className="px-4 py-2.5 text-left text-[var(--text-3)] font-semibold">Module</th>
              {plans.map(p => (
                <th key={p.code} className="px-3 py-2.5 text-center text-[var(--text-3)] font-semibold text-[10px]">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map(m => (
              <tr key={m.code} className="border-b border-[var(--border-0)] hover:bg-[var(--bg-2)]">
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-[var(--text-0)]">{m.label}</div>
                  <div className={`text-[9px] ${CATEG_COLORS[m.categorie] || 'text-gray-400'}`}>{m.categorie}</div>
                </td>
                {plans.map(p => {
                  const included = p.modules?.[m.code] === true
                  const key = `${p.code}:${m.code}`
                  return (
                    <td key={p.code} className="px-3 py-2.5 text-center">
                      <Toggle
                        checked={included}
                        onChange={() => toggleModule(p.code, m.code, included)}
                        disabled={toggling === key}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Onglet Providers ─────────────────────────────────────────────────────────
function ProvidersTab() {
  const [providers, setProviders] = useState([])
  const [saving, setSaving] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    platformAPI.config.providers().then(d => setProviders(d.providers || [])).catch(() => {})
  }, [])

  async function toggleProvider(code, current) {
    setSaving(code)
    setMsg(null)
    try {
      await platformAPI.config.updateProvider(code, { actif: !current })
      const d = await platformAPI.config.providers()
      setProviders(d.providers || [])
      setMsg({ type: 'ok', text: `Provider ${code} ${!current ? 'activé' : 'désactivé'}` })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setSaving(null) }
  }

  async function updatePriority(code, priorite) {
    try {
      await platformAPI.config.updateProvider(code, { priorite: parseInt(priorite) })
      const d = await platformAPI.config.providers()
      setProviders(d.providers || [])
    } catch {}
  }

  return (
    <div>
      {msg && (
        <div className={`mb-4 text-xs px-4 py-2 rounded-lg border ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {msg.text}
        </div>
      )}
      <div className="space-y-3">
        {providers.map(p => (
          <div key={p.code} className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)]">
            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.actif ? 'bg-emerald-500' : 'bg-gray-600'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-[var(--text-0)]">{p.label}</div>
              <div className="text-[9px] text-[var(--text-4)]">
                Clé : {p.api_key_masked || '(lue depuis env vars)'}
                {p.plans_autorises?.length ? ` · Plans : ${p.plans_autorises.join(', ')}` : ' · Tous plans'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[9px] text-[var(--text-4)]">Priorité</label>
              <input
                type="number" min="1" max="99"
                value={p.priorite}
                onChange={e => updatePriority(p.code, e.target.value)}
                className="w-12 px-1 py-0.5 text-[10px] bg-[var(--bg-1)] border border-[var(--border-1)] rounded text-[var(--text-0)] text-center"
              />
            </div>
            <Toggle checked={p.actif} onChange={() => toggleProvider(p.code, p.actif)} disabled={saving === p.code} />
            <Badge color={p.actif ? 'green' : 'gray'}>{p.actif ? 'Actif' : 'Inactif'}</Badge>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-[10px] text-[var(--text-4)]">
        Les clés API sont lues depuis les variables d'environnement du backend (ANTHROPIC_API_KEY, OPENAI_API_KEY). Elles ne sont jamais stockées en base de données.
      </div>
    </div>
  )
}

// ── Onglet Feature Flags ─────────────────────────────────────────────────────
function FlagsTab() {
  const [flags, setFlags]   = useState([])
  const [saving, setSaving] = useState(null)
  const [msg, setMsg]       = useState(null)

  useEffect(() => {
    platformAPI.config.flags().then(d => setFlags(d.flags || [])).catch(() => {})
  }, [])

  async function toggleFlag(code, current) {
    setSaving(code)
    setMsg(null)
    try {
      await platformAPI.config.updateFlag(code, { enabled: !current })
      const d = await platformAPI.config.flags()
      setFlags(d.flags || [])
      setMsg({ type: 'ok', text: `Flag ${code} ${!current ? 'activé' : 'désactivé'}` })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setSaving(null) }
  }

  return (
    <div>
      {msg && (
        <div className={`mb-4 text-xs px-4 py-2 rounded-lg border ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {msg.text}
        </div>
      )}
      <div className="space-y-2">
        {flags.map(f => (
          <div key={f.code} className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)]">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-[var(--text-0)] font-mono">{f.code}</div>
                {f.expire_le && <Badge color="amber">Expire {new Date(f.expire_le).toLocaleDateString('fr-FR')}</Badge>}
              </div>
              <div className="text-[9px] text-[var(--text-4)] mt-0.5">{f.description}</div>
              {f.rollout_pct < 100 && (
                <div className="text-[9px] text-blue-400 mt-0.5">Rollout : {f.rollout_pct}%</div>
              )}
            </div>
            <Toggle checked={f.enabled} onChange={() => toggleFlag(f.code, f.enabled)} disabled={saving === f.code} />
            <Badge color={f.enabled ? 'green' : 'gray'}>{f.enabled ? 'Actif' : 'Inactif'}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Onglet Settings ──────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings, setSettings]   = useState([])
  const [editing, setEditing]     = useState(null)  // cle en cours d'édition
  const [editVal, setEditVal]     = useState('')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null)

  useEffect(() => {
    platformAPI.config.settings().then(d => setSettings(d.settings || [])).catch(() => {})
  }, [])

  async function sauvegarder(cle) {
    setSaving(true)
    setMsg(null)
    try {
      // Parser la valeur selon son type
      let parsed = editVal
      const setting = settings.find(s => s.cle === cle)
      if (setting?.type === 'number')  parsed = parseFloat(editVal)
      if (setting?.type === 'boolean') parsed = editVal === 'true' || editVal === true

      await platformAPI.config.updateSetting(cle, { valeur: parsed })
      const d = await platformAPI.config.settings()
      setSettings(d.settings || [])
      setMsg({ type: 'ok', text: `${cle} mis à jour` })
      setEditing(null)
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setSaving(false) }
  }

  // Grouper par groupe
  const groupes = settings.reduce((acc, s) => {
    if (!acc[s.groupe]) acc[s.groupe] = []
    acc[s.groupe].push(s)
    return acc
  }, {})

  const GROUPE_LABELS = { fiscal: 'Fiscalité', operationnel: 'Opérationnel', conformite: 'Conformité', securite: 'Sécurité', ia: 'IA' }

  return (
    <div>
      {msg && (
        <div className={`mb-4 text-xs px-4 py-2 rounded-lg border ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {msg.text}
        </div>
      )}
      <div className="space-y-5">
        {Object.entries(groupes).map(([groupe, items]) => (
          <div key={groupe}>
            <SectionHeader title={GROUPE_LABELS[groupe] || groupe} />
            <div className="space-y-2">
              {items.map(s => {
                const valeurAffichee = typeof s.valeur === 'string'
                  ? s.valeur.replace(/^"|"$/g, '')
                  : String(s.valeur)

                return (
                  <div key={s.cle} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-[var(--border-0)] bg-[var(--bg-2)]">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-[var(--text-0)]">{s.cle}</div>
                      <div className="text-[9px] text-[var(--text-4)]">{s.description}</div>
                    </div>
                    {editing === s.cle ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && sauvegarder(s.cle)}
                          autoFocus
                          className="w-28 px-2 py-1 text-[10px] bg-[var(--bg-1)] border border-blue-500/50 rounded text-[var(--text-0)]"
                        />
                        <button onClick={() => sauvegarder(s.cle)} disabled={saving}
                          className="text-[9px] px-2 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 disabled:opacity-40">
                          ✓
                        </button>
                        <button onClick={() => setEditing(null)} className="text-[9px] text-[var(--text-4)]">✕</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded">{valeurAffichee}</span>
                        {s.modifiable_ui && (
                          <button onClick={() => { setEditing(s.cle); setEditVal(valeurAffichee) }}
                            className="text-[9px] text-[var(--text-4)] hover:text-[var(--text-2)]">Modifier</button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Onglet Overrides ─────────────────────────────────────────────────────────
function OverridesTab() {
  const [tenantId, setTenantId]   = useState('')
  const [tenants, setTenants]     = useState([])
  const [overrides, setOverrides] = useState([])
  const [modules, setModules]     = useState([])
  const [newModule, setNewModule] = useState('')
  const [newEnabled, setNewEnabled] = useState(true)
  const [newRaison, setNewRaison] = useState('')
  const [loading, setLoading]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null)

  useEffect(() => {
    Promise.all([
      platformAPI.config.modules().then(d => d.modules || []),
      platformAPI.tenants().then(d => (d.tenants || []).slice(0, 30)),
    ]).then(([m, t]) => { setModules(m); setTenants(t) }).catch(() => {})
  }, [])

  async function chargerOverrides(tid) {
    setLoading(true)
    setMsg(null)
    try {
      const d = await platformAPI.config.overrides(tid)
      setOverrides(d.overrides || [])
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setLoading(false) }
  }

  async function creerOverride() {
    if (!tenantId || !newModule || !newRaison) return
    setSaving(true)
    setMsg(null)
    try {
      await platformAPI.config.createOverride(tenantId, {
        module_code: newModule,
        enabled:     newEnabled,
        raison:      newRaison,
      })
      await chargerOverrides(tenantId)
      setNewModule('')
      setNewRaison('')
      setMsg({ type: 'ok', text: 'Override créé' })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    } finally { setSaving(false) }
  }

  async function supprimerOverride(moduleCode) {
    try {
      await platformAPI.config.deleteOverride(tenantId, moduleCode)
      await chargerOverrides(tenantId)
      setMsg({ type: 'ok', text: `Override ${moduleCode} supprimé` })
    } catch (e) {
      setMsg({ type: 'err', text: e.message })
    }
  }

  return (
    <div>
      {msg && (
        <div className={`mb-4 text-xs px-4 py-2 rounded-lg border ${msg.type === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {/* Sélection tenant */}
      <div className="mb-5">
        <SectionHeader title="Sélectionner un tenant" />
        <div className="flex gap-2">
          <select
            value={tenantId}
            onChange={e => { setTenantId(e.target.value); if (e.target.value) chargerOverrides(e.target.value) }}
            className="flex-1 px-3 py-2 text-xs bg-[var(--bg-2)] border border-[var(--border-1)] rounded-lg text-[var(--text-0)] focus:outline-none focus:border-blue-500/50">
            <option value="">— Choisir un tenant —</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.nom} ({t.pays}) — {t.plan}</option>
            ))}
          </select>
        </div>
      </div>

      {tenantId && (
        <>
          {/* Overrides existants */}
          <div className="mb-5">
            <SectionHeader title="Overrides actifs" />
            {loading ? (
              <div className="text-[10px] text-[var(--text-4)]">Chargement…</div>
            ) : overrides.length === 0 ? (
              <div className="text-[10px] text-[var(--text-4)] py-4 text-center">Aucun override pour ce tenant</div>
            ) : (
              <div className="space-y-1">
                {overrides.map(o => (
                  <div key={o.module_code} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--border-0)] bg-[var(--bg-2)]">
                    <Badge color={o.enabled ? 'green' : 'red'}>{o.enabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'}</Badge>
                    <span className="text-xs font-mono text-[var(--text-0)]">{o.module_code}</span>
                    <span className="text-[9px] text-[var(--text-4)] truncate flex-1">{o.raison}</span>
                    {o.actif_jusqu && <span className="text-[9px] text-amber-400">→ {new Date(o.actif_jusqu).toLocaleDateString('fr-FR')}</span>}
                    <button onClick={() => supprimerOverride(o.module_code)}
                      className="text-[9px] text-red-400 hover:text-red-300">Supprimer</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Créer un override */}
          <div className="rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)] p-4">
            <SectionHeader title="Ajouter un override" />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[9px] text-[var(--text-4)] uppercase">Module</label>
                <select value={newModule} onChange={e => setNewModule(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-1)] rounded-lg text-[var(--text-0)]">
                  <option value="">— Choisir —</option>
                  {modules.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-[var(--text-4)] uppercase">État</label>
                <select value={newEnabled} onChange={e => setNewEnabled(e.target.value === 'true')}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-1)] rounded-lg text-[var(--text-0)]">
                  <option value="true">Activer (forcer ON)</option>
                  <option value="false">Désactiver (forcer OFF)</option>
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="text-[9px] text-[var(--text-4)] uppercase">Raison (min 10 caractères)</label>
              <input value={newRaison} onChange={e => setNewRaison(e.target.value)}
                placeholder="Accord commercial du 2026-06-04 — client Enterprise custom"
                className="w-full mt-1 px-2 py-1.5 text-xs bg-[var(--bg-1)] border border-[var(--border-1)] rounded-lg text-[var(--text-0)]"
              />
            </div>
            <button
              onClick={creerOverride}
              disabled={saving || !newModule || newRaison.length < 10}
              className="text-xs px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 disabled:opacity-40 transition-colors font-bold">
              {saving ? '⏳ Création…' : '+ Créer override'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PlatformConfigPage() {
  const { init } = useAuthStore()
  const [tab, setTab] = useState('plans')
  const [ready, setReady] = useState(false)
  const [erreur, setErreur] = useState(null)
  const [errType, setErrType] = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  useEffect(() => {
    // Vérifier que la page peut accéder à la config
    platformAPI.config.plans()
      .then(() => setReady(true))
      .catch(e => {
        if (e.name === 'PlatformAuthError') return
        setErrType(e.name)
        setErreur(e.message)
      })
  }, [])

  const TABS = [
    { id: 'plans',     label: 'Plans',          icon: '📦' },
    { id: 'modules',   label: 'Modules',         icon: '⚙' },
    { id: 'providers', label: 'Providers IA',    icon: '🤖' },
    { id: 'flags',     label: 'Feature Flags',   icon: '🚩' },
    { id: 'settings',  label: 'Paramètres',      icon: '🔧' },
    { id: 'overrides', label: 'Overrides Tenant', icon: '👁' },
  ]

  if (!ready && !erreur) return (
    <PlatformLayout titre="Configuration Platform" sousTitre="Control Plane · Plans · Modules · Providers · Flags · Settings">
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </PlatformLayout>
  )

  if (erreur) return (
    <PlatformLayout titre="Configuration Platform" sousTitre="Erreur de chargement">
      <ErreurPlatform erreur={erreur} errType={errType}
        onRetry={() => { setErreur(null); setErrType(null); setReady(false); init() }} />
    </PlatformLayout>
  )

  return (
    <PlatformLayout titre="Configuration Platform" sousTitre="Control Plane · Plans · Modules · Providers · Flags · Settings">

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--border-0)]">
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
        {tab === 'plans'     && <PlansTab />}
        {tab === 'modules'   && <ModulesTab />}
        {tab === 'providers' && <ProvidersTab />}
        {tab === 'flags'     && <FlagsTab />}
        {tab === 'settings'  && <SettingsTab />}
        {tab === 'overrides' && <OverridesTab />}
      </div>
    </PlatformLayout>
  )
}
