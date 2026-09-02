'use client'
import { useState, useEffect, useCallback } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore, fmt } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError } from '@/lib/platform-api'

function StatutBadge({ statut }) {
  const map = {
    actif:    'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    essai:    'bg-blue-500/20 text-blue-400 border-blue-500/30',
    suspendu: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    résilié:  'bg-red-500/20 text-red-400 border-red-500/30',
  }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${map[statut] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
      {statut}
    </span>
  )
}

function HealthBar({ nb, max }) {
  if (!max || max <= 0) return <span className="text-xs text-[var(--text-4)]">{nb}/∞</span>
  const pct = Math.min(100, Math.round((nb / max) * 100))
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-3)]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-[var(--text-3)] w-12 text-right">{nb}/{max}</span>
    </div>
  )
}

// ── Composant erreur unifié ────────────────────────────────────────────────────
function ErreurPlatform({ erreur, errType, onRetry }) {
  const isTimeout = errType === 'PlatformTimeoutError'
  const isNetwork = errType === 'PlatformNetworkError'
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{isTimeout ? '⏱' : isNetwork ? '📡' : '⚠'}</span>
        <div>
          <div className="text-sm font-bold text-red-300">
            {isTimeout ? 'Délai de connexion dépassé' : isNetwork ? 'Backend inaccessible' : 'Erreur plateforme'}
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

export default function PlatformTenants() {
  const { init } = useAuthStore()
  const [tenants,  setTenants]  = useState([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [filtre,   setFiltre]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [erreur,   setErreur]   = useState(null)
  const [errType,  setErrType]  = useState(null)
  const [action,   setAction]   = useState(null) // { type, tenant }
  const [motif,    setMotif]    = useState('')
  const [working,  setWorking]  = useState(false)
  const [actionErr,setActionErr]= useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  const charger = useCallback(async () => {
    setLoading(true)
    setErreur(null)
    setErrType(null)
    try {
      const params = `page=${page}&limite=15${filtre ? `&statut=${filtre}` : ''}`
      const res = await platformAPI.tenants(params)
      setTenants(res.tenants || [])
      setTotal(res.pagination?.total || 0)
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErrType(e.name)
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }, [page, filtre])

  useEffect(() => { charger() }, [charger])

  async function executerAction() {
    if (!action) return
    setWorking(true)
    setActionErr(null)
    try {
      const { type, tenant } = action
      if (type === 'suspend') {
        await platformAPI.tenantSuspend(tenant.id, motif)
      } else if (type === 'activate') {
        await platformAPI.tenantActivate(tenant.id)
      }
      setAction(null)
      setMotif('')
      await charger()
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setActionErr(e.message)
    } finally {
      setWorking(false)
    }
  }

  const totalPages = Math.ceil(total / 15)

  return (
    <PlatformLayout titre="Tenants" sousTitre={`${total} tenant(s) sur la plateforme`}>

      {/* Erreur chargement */}
      {erreur && (
        <ErreurPlatform erreur={erreur} errType={errType}
          onRetry={() => { setErreur(null); charger() }} />
      )}

      {/* Filtres + bouton onboarding */}
      <div className="flex items-center gap-3 mb-4">
        {['', 'actif', 'essai', 'suspendu'].map(s => (
          <button key={s}
            onClick={() => { setFiltre(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              filtre === s
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'border-[var(--border-1)] text-[var(--text-2)] hover:border-[var(--border-2)]'
            }`}>
            {s === '' ? 'Tous' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="text-xs text-[var(--text-4)]">{total} résultat(s)</span>
        <a href="/platform/onboarding"
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors">
          ＋ Nouveau tenant
        </a>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border-0)] overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-0)] bg-[var(--bg-2)]">
              {['Tenant / Contact', 'Pays', 'Plan', 'Hôtels', 'Chambres', 'Users', 'MRR', 'Statut', 'Actions'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-3)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-10 text-[var(--text-4)]">
                <div className="inline-block w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </td></tr>
            ) : tenants.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-10 text-[var(--text-4)]">
                {erreur ? '' : 'Aucun tenant'}
              </td></tr>
            ) : tenants.map(t => (
              <tr key={t.id} className="border-b border-[var(--border-0)] hover:bg-[var(--bg-2)] transition-colors">
                <td className="px-3 py-3">
                  <div className="font-semibold text-[var(--text-0)] text-xs">{t.nom}</div>
                  <div className="text-[10px] text-[var(--text-4)]">{t.email_contact}</div>
                </td>
                <td className="px-3 py-3 text-xs text-[var(--text-2)]">{t.pays || '—'}</td>
                <td className="px-3 py-3">
                  <span className="text-[10px] font-bold bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                    {t.plan || 'essai'}
                  </span>
                </td>
                <td className="px-3 py-3 w-28"><HealthBar nb={t.nb_hotels ?? 0} max={t.max_hotels} /></td>
                <td className="px-3 py-3 text-xs text-[var(--text-2)] text-right">{t.max_chambres ?? '∞'}</td>
                <td className="px-3 py-3 w-28"><HealthBar nb={t.nb_utilisateurs ?? 0} max={t.max_utilisateurs} /></td>
                <td className="px-3 py-3 text-xs text-[var(--text-2)] whitespace-nowrap">
                  {t.montant_mensuel ? fmt(parseFloat(t.montant_mensuel)) : <span className="text-[var(--text-4)]">—</span>}
                </td>
                <td className="px-3 py-3"><StatutBadge statut={t.statut} /></td>
                <td className="px-3 py-3">
                  <div className="flex gap-1">
                    {t.statut !== 'résilié' && (
                      t.statut === 'actif' || t.statut === 'essai' ? (
                        <button
                          onClick={() => setAction({ type: 'suspend', tenant: t })}
                          className="text-[10px] px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">
                          Suspendre
                        </button>
                      ) : (
                        <button
                          onClick={() => setAction({ type: 'activate', tenant: t })}
                          className="text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                          Activer
                        </button>
                      )
                    )}
                    <a href={`/platform/tenants/${t.id}`}
                      className="text-[10px] px-2 py-0.5 rounded border border-[var(--border-1)] text-[var(--text-2)] hover:border-[var(--border-2)] transition-colors">
                      Détail
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1 rounded border border-[var(--border-1)] text-xs disabled:opacity-40">
            ← Préc.
          </button>
          <span className="text-xs text-[var(--text-3)]">Page {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1 rounded border border-[var(--border-1)] text-xs disabled:opacity-40">
            Suiv. →
          </button>
        </div>
      )}

      {/* Modal confirmation action */}
      {action && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-1)] border border-[var(--border-1)] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="font-black text-[var(--text-0)] mb-1">
              {action.type === 'suspend' ? '⚠ Suspendre le tenant' : '✅ Activer le tenant'}
            </h3>
            <p className="text-sm text-[var(--text-2)] mb-4">
              Tenant : <strong className="text-[var(--text-0)]">{action.tenant.nom}</strong>
            </p>
            {action.type === 'suspend' && (
              <div className="mb-4">
                <label className="text-xs font-semibold text-[var(--text-3)] block mb-1">
                  Motif de suspension <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={motif}
                  onChange={e => setMotif(e.target.value)}
                  placeholder="Ex : Impayé 30 jours, violation CGU…"
                  rows={3}
                  className="w-full rounded-lg border border-[var(--border-1)] bg-[var(--bg-2)] px-3 py-2 text-sm text-[var(--text-0)] resize-none focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
            {actionErr && (
              <div className="mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">
                {actionErr}
              </div>
            )}
            <p className="text-xs text-[var(--text-4)] mb-4">
              ⚠ Cette action est enregistrée dans le journal d'audit.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAction(null); setMotif(''); setActionErr(null) }}
                className="px-4 py-2 rounded-lg border border-[var(--border-1)] text-sm text-[var(--text-2)] hover:border-[var(--border-2)]">
                Annuler
              </button>
              <button
                onClick={executerAction}
                disabled={working || (action.type === 'suspend' && !motif.trim())}
                className={`px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-40 transition-colors ${
                  action.type === 'suspend'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}>
                {working ? 'En cours…' : action.type === 'suspend' ? 'Confirmer suspension' : 'Confirmer activation'}
              </button>
            </div>
          </div>
        </div>
      )}

    </PlatformLayout>
  )
}
