'use client'
import { useState, useEffect, useCallback } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore } from '@/lib/utils'
import { platformAPI } from '@/lib/platform-api'

const ACTIONS_CRITIQUES = ['TENANT_SUSPENDU', 'UTILISATEUR_DESACTIVE', 'HOTEL_PARAMETRES_MODIFIES', 'TENANT_MODIFIE', 'SESSIONS_MASS_REVOKE', 'IMPERSONATION_DEMARREE']
const COULEUR_ACTION = {
  TENANT_SUSPENDU:            'text-amber-400 bg-amber-500/10',
  TENANT_ACTIVE:              'text-emerald-400 bg-emerald-500/10',
  TENANT_MODIFIE:             'text-blue-400 bg-blue-500/10',
  TENANT_RESILIE:             'text-red-400 bg-red-500/10',
  UTILISATEUR_CREE:           'text-emerald-400 bg-emerald-500/10',
  UTILISATEUR_MODIFIE:        'text-blue-400 bg-blue-500/10',
  UTILISATEUR_DESACTIVE:      'text-red-400 bg-red-500/10',
  HOTEL_PARAMETRES_MODIFIES:  'text-purple-400 bg-purple-500/10',
  SESSION_REVOQUEE:           'text-amber-400 bg-amber-500/10',
  SESSIONS_MASS_REVOKE:       'text-red-400 bg-red-500/10',
  IMPERSONATION_DEMARREE:     'text-purple-400 bg-purple-500/10',
  IMPERSONATION_REVOQUEE:     'text-gray-400 bg-gray-500/10',
}

const COULEUR_REFUS = {
  QUOTA_HOTELS:           'text-amber-400 bg-amber-500/10',
  QUOTA_CHAMBRES:         'text-amber-400 bg-amber-500/10',
  QUOTA_UTILISATEURS:     'text-amber-400 bg-amber-500/10',
  QUOTA_IA_DEPASSE:       'text-red-400 bg-red-500/10',
  FEATURE_NON_DISPONIBLE: 'text-purple-400 bg-purple-500/10',
  POLICY_INCONNUE:        'text-gray-400 bg-gray-500/10',
}

function fmtDt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function safeJson(str) {
  try { return JSON.parse(str || '{}') } catch { return {} }
}

// ── Panel violations de quota ─────────────────────────────────────────────────
function PolicyRefusalsPanel() {
  const [refusals, setRefusals] = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [erreur,   setErreur]   = useState(null)

  const charger = useCallback(async () => {
    setLoading(true)
    setErreur(null)
    try {
      const data = await platformAPI.policyRefusals()
      setRefusals(data.refusals || [])
      setTotal(data.pagination?.total || 0)
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { charger() }, [charger])

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (erreur) return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-center gap-3">
      <span className="text-xl">⚠</span>
      <div className="flex-1">
        <div className="text-sm font-bold text-red-300">Erreur de chargement</div>
        <div className="text-xs text-red-400/70">{erreur}</div>
      </div>
      <button onClick={charger}
        className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
        ↻ Réessayer
      </button>
    </div>
  )

  if (refusals.length === 0) return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <div className="text-2xl mb-3">✅</div>
      <div className="text-sm font-bold text-emerald-400 mb-1">Aucune violation de quota</div>
      <div className="text-xs text-[var(--text-4)]">
        Tous les tenants respectent leurs limites de plan. Aucun refus de politique enregistré.
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--text-4)]">{total} violation(s) enregistrée(s)</span>
        <button onClick={charger} className="text-[9px] text-blue-400 hover:text-blue-300">↻ Actualiser</button>
      </div>
      <div className="rounded-xl border border-[var(--border-0)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border-0)] bg-[var(--bg-2)]">
              {['Horodatage', 'Violation', 'Tenant', 'Détail'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-semibold text-[var(--text-3)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {refusals.map(r => {
              const detail = safeJson(r.nouvelles_valeurs)
              return (
                <tr key={r.id} className="border-b border-[var(--border-0)] hover:bg-[var(--bg-2)] transition-colors">
                  <td className="px-3 py-2.5 text-[var(--text-3)] whitespace-nowrap">{fmtDt(r.cree_le)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${COULEUR_REFUS[r.action] || 'text-gray-400 bg-gray-500/10'}`}>
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-2)]">{r.tenant_nom || '—'}</td>
                  <td className="px-3 py-2.5 text-[var(--text-4)] text-[10px] max-w-xs truncate font-mono">
                    {detail.message || detail.code || JSON.stringify(detail).slice(0, 100)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function PlatformAudit() {
  const { init } = useAuthStore()
  const [tab,     setTab]     = useState('audit')
  const [logs,    setLogs]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [erreur,  setErreur]  = useState(null)
  const [errType, setErrType] = useState(null)
  const [filtre,  setFiltre]  = useState({ action: '', module: '' })
  const [detail,  setDetail]  = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  const charger = useCallback(async () => {
    setLoading(true)
    setErreur(null)
    setErrType(null)
    try {
      const params = new URLSearchParams({
        page,
        limite: 30,
        ...Object.fromEntries(Object.entries(filtre).filter(([, v]) => v)),
      }).toString()
      const data = await platformAPI.audit(params)
      setLogs(data.logs || [])
      setTotal(data.pagination?.total || 0)
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErrType(e.name)
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }, [page, filtre])

  useEffect(() => { if (tab === 'audit') charger() }, [charger, tab])

  const totalPages = Math.ceil(total / 30)

  const TABS = [
    { id: 'audit',    label: 'Journal d\'audit',     icon: '🛡' },
    { id: 'refusals', label: 'Violations de quota',  icon: '⛔' },
  ]

  return (
    <PlatformLayout
      titre="Audit & Logs"
      sousTitre={tab === 'audit' ? `${total} événements enregistrés` : 'Refus de politique · Dépassements de quota'}>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[var(--border-0)]">
        {TABS.map(t => (
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

      {/* ── Onglet Journal d'audit ─────────────────────────────────────────── */}
      {tab === 'audit' && (
        <>
          {/* Erreur chargement */}
          {erreur && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 flex items-center gap-3">
              <span className="text-xl">{errType === 'PlatformTimeoutError' ? '⏱' : errType === 'PlatformNetworkError' ? '📡' : '⚠'}</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-red-300">
                  {errType === 'PlatformTimeoutError' ? 'Délai de connexion dépassé' : errType === 'PlatformNetworkError' ? 'Backend inaccessible' : 'Erreur de chargement'}
                </div>
                <div className="text-xs text-red-400/70">{erreur}</div>
              </div>
              <button onClick={charger}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors flex-shrink-0">
                ↻ Réessayer
              </button>
            </div>
          )}

          {/* Filtres */}
          <div className="flex flex-wrap gap-3 mb-4">
            <select value={filtre.action}
              onChange={e => { setFiltre(f => ({ ...f, action: e.target.value })); setPage(1) }}
              className="rounded-lg border border-[var(--border-1)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] focus:outline-none focus:border-blue-500">
              <option value="">Toutes les actions</option>
              {Object.keys(COULEUR_ACTION).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={filtre.module}
              onChange={e => { setFiltre(f => ({ ...f, module: e.target.value })); setPage(1) }}
              className="rounded-lg border border-[var(--border-1)] bg-[var(--bg-2)] px-3 py-1.5 text-xs text-[var(--text-0)] focus:outline-none focus:border-blue-500">
              <option value="">Tous les modules</option>
              {['platform', 'iam', 'utilisateurs', 'hotels', 'reservations', 'facturation', 'billing'].map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button
              onClick={() => { setFiltre({ action: '', module: '' }); setPage(1) }}
              className="px-3 py-1.5 rounded-lg border border-[var(--border-1)] text-xs text-[var(--text-3)] hover:border-[var(--border-2)]">
              Réinitialiser
            </button>
            <span className="ml-auto text-xs text-[var(--text-4)] self-center">{total} événements</span>
          </div>

          {/* Alerte actions critiques */}
          {logs.some(l => ACTIONS_CRITIQUES.includes(l.action)) && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-xs text-red-300 flex items-center gap-2">
              <span>🛡</span>
              <span>Actions critiques détectées dans cette page — vérifier la légitimité</span>
            </div>
          )}

          {/* Table logs */}
          <div className="rounded-xl border border-[var(--border-0)] overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-0)] bg-[var(--bg-2)]">
                  {['Horodatage', 'Action', 'Module', 'Opérateur', 'Tenant', 'IP', ''].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left font-semibold text-[var(--text-3)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-10 text-[var(--text-4)]">
                    <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </td></tr>
                ) : logs.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-[var(--text-4)]">
                    {erreur ? '' : 'Aucun événement'}
                  </td></tr>
                ) : logs.map(log => (
                  <tr key={log.id}
                    className={`border-b border-[var(--border-0)] hover:bg-[var(--bg-2)] transition-colors cursor-pointer ${ACTIONS_CRITIQUES.includes(log.action) ? 'border-l-2 border-l-amber-500/50' : ''}`}
                    onClick={() => setDetail(log)}>
                    <td className="px-3 py-2.5 text-[var(--text-3)] whitespace-nowrap">{fmtDt(log.cree_le)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${COULEUR_ACTION[log.action] || 'text-gray-400 bg-gray-500/10'}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-3)]">{log.module || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-[var(--text-0)]">{log.utilisateur_email || '—'}</div>
                      <div className="text-[var(--text-4)] text-[10px]">{log.utilisateur_role || ''}</div>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-3)] max-w-24 truncate">{log.tenant_nom || '—'}</td>
                    <td className="px-3 py-2.5 text-[var(--text-4)] font-mono">{log.ip_address || '—'}</td>
                    <td className="px-3 py-2.5 text-blue-400 text-[10px]">Détail →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mb-6">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded border border-[var(--border-1)] text-xs disabled:opacity-40">← Préc.</button>
              <span className="text-xs text-[var(--text-3)]">Page {page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1 rounded border border-[var(--border-1)] text-xs disabled:opacity-40">Suiv. →</button>
            </div>
          )}

          {/* Modal détail événement */}
          {detail && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
              onClick={() => setDetail(null)}>
              <div className="bg-[var(--bg-1)] border border-[var(--border-1)] rounded-2xl p-6 w-full max-w-2xl shadow-2xl"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${COULEUR_ACTION[detail.action] || 'text-gray-400 bg-gray-500/10'}`}>
                      {detail.action}
                    </span>
                    <div className="text-xs text-[var(--text-3)] mt-1">{fmtDt(detail.cree_le)}</div>
                  </div>
                  <button onClick={() => setDetail(null)} className="text-[var(--text-3)] hover:text-[var(--text-0)] text-xl leading-none">✕</button>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
                  <div>
                    <span className="text-[var(--text-4)]">Opérateur</span>
                    <div className="text-[var(--text-0)] mt-0.5">{detail.utilisateur_email} ({detail.utilisateur_role})</div>
                  </div>
                  <div>
                    <span className="text-[var(--text-4)]">IP</span>
                    <div className="text-[var(--text-0)] font-mono mt-0.5">{detail.ip_address || '—'}</div>
                  </div>
                  <div>
                    <span className="text-[var(--text-4)]">Tenant</span>
                    <div className="text-[var(--text-0)] mt-0.5">{detail.tenant_nom || '—'}</div>
                  </div>
                  <div>
                    <span className="text-[var(--text-4)]">Module</span>
                    <div className="text-[var(--text-0)] mt-0.5">{detail.module}</div>
                  </div>
                </div>
                {detail.anciennes_valeurs && (
                  <div className="mb-3">
                    <div className="text-[10px] font-bold text-[var(--text-4)] mb-1 uppercase">Avant</div>
                    <pre className="bg-[var(--bg-3)] rounded-lg p-3 text-[10px] text-red-300 overflow-auto max-h-32">
                      {JSON.stringify(safeJson(detail.anciennes_valeurs), null, 2)}
                    </pre>
                  </div>
                )}
                {detail.nouvelles_valeurs && (
                  <div>
                    <div className="text-[10px] font-bold text-[var(--text-4)] mb-1 uppercase">Après</div>
                    <pre className="bg-[var(--bg-3)] rounded-lg p-3 text-[10px] text-emerald-300 overflow-auto max-h-32">
                      {JSON.stringify(safeJson(detail.nouvelles_valeurs), null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Onglet Violations de quota ─────────────────────────────────────── */}
      {tab === 'refusals' && <PolicyRefusalsPanel />}

    </PlatformLayout>
  )
}
