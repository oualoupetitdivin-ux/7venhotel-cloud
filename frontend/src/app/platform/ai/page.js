'use client'
import { useState, useEffect } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError } from '@/lib/platform-api'

function UsageBar({ label, val, max, color = 'blue' }) {
  const unlimited = max === -1
  const pct = !unlimited && max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 0
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : `bg-${color}-500`
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[var(--text-3)]">{label}</span>
        <span className="text-[var(--text-0)] font-semibold">
          {val.toLocaleString('fr-FR')} / {unlimited ? '∞' : max.toLocaleString('fr-FR')} tokens
        </span>
      </div>
      {!unlimited && (
        <div className="h-2 rounded-full bg-[var(--bg-3)]">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="text-[10px] mt-0.5">
        {unlimited
          ? <span className="text-emerald-400">Illimité — alerte au-dessus de 1M tokens</span>
          : <span className="text-[var(--text-4)]">{pct}% consommé</span>
        }
      </div>
    </div>
  )
}

function ErreurPlatform({ erreur, errType, onRetry }) {
  const isTimeout = errType === 'PlatformTimeoutError'
  const isNetwork = errType === 'PlatformNetworkError'
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{isTimeout ? '⏱' : isNetwork ? '📡' : '⚠'}</span>
        <div>
          <div className="text-sm font-bold text-red-300">
            {isTimeout ? 'Délai de connexion dépassé' : isNetwork ? 'Backend inaccessible' : 'Erreur plateforme'}
          </div>
          <div className="text-xs text-red-400/70 mt-0.5">{erreur}</div>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={onRetry}
          className="text-xs px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
          ↻ Réessayer
        </button>
        {isNetwork && (
          <span className="text-[10px] text-[var(--text-4)]">Vérifiez que le backend est démarré sur le port 3001</span>
        )}
      </div>
    </div>
  )
}

export default function PlatformAI() {
  const { init } = useAuthStore()
  const [data,    setData]    = useState(null)
  const [plans,   setPlans]   = useState([])
  const [loading, setLoading] = useState(true)
  const [erreur,  setErreur]  = useState(null)
  const [errType, setErrType] = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    setErreur(null)
    setErrType(null)
    try {
      const [conso, plansData] = await Promise.all([
        platformAPI.aiConsumption(),
        platformAPI.config.plans().catch(() => ({ plans: [] })),
      ])
      setData(conso)
      setPlans(plansData.plans || [])
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErrType(e.name)
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }

  const totalAppels    = data?.total_appels || 0
  const cout_estime_usd = totalAppels * 0.0002

  if (loading) return (
    <PlatformLayout titre="IA Gouvernance" sousTitre="Consommation Ouwalou AI · Coûts · Supervision">
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </PlatformLayout>
  )

  if (erreur) return (
    <PlatformLayout titre="IA Gouvernance" sousTitre="Erreur de chargement">
      <ErreurPlatform erreur={erreur} errType={errType}
        onRetry={() => { setErreur(null); setLoading(true); charger() }} />
    </PlatformLayout>
  )

  return (
    <PlatformLayout titre="IA Gouvernance" sousTitre="Consommation Ouwalou AI · Coûts · Supervision">

      {/* KPIs globaux */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-purple-400 mb-2">Appels IA total</div>
          <div className="text-3xl font-black text-[var(--text-0)]">{totalAppels.toLocaleString('fr-FR')}</div>
          <div className="text-xs text-[var(--text-4)] mt-1">Tous tenants confondus</div>
        </div>
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-2">Coût estimé</div>
          <div className="text-3xl font-black text-[var(--text-0)]">${cout_estime_usd.toFixed(2)}</div>
          <div className="text-xs text-[var(--text-4)] mt-1">~$0.0002 USD / appel (moyenne)</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">Modèle actif</div>
          <div className="text-lg font-black text-[var(--text-0)]">claude-sonnet-4</div>
          <div className="text-xs text-[var(--text-4)] mt-1">Anthropic · Server-side uniquement</div>
        </div>
      </div>

      {/* Quotas IA par plan — source : platform_plans (DB via /platform/config/plans) */}
      <div className="rounded-xl border border-[var(--border-1)] bg-[var(--bg-2)] p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-3)]">Quotas IA par plan</h2>
          <span className="text-[9px] text-[var(--text-4)]">Source : platform_plans · modifiable via Configuration</span>
        </div>
        <div className="space-y-4">
          {plans.length === 0 ? (
            <div className="text-[10px] text-[var(--text-4)]">Chargement des plans…</div>
          ) : plans.map(p => {
            const conso = data?.par_hotel?.filter(h => h.plan === p.code).reduce((s, h) => s + h.nb_appels, 0) || 0
            return (
              <UsageBar
                key={p.code}
                label={p.label}
                val={conso}
                max={p.quota_ia_mensuel}
              />
            )
          })}
        </div>
      </div>

      {/* Top consommateurs */}
      {data?.par_hotel?.length > 0 ? (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-3)] mb-3">Top consommateurs</h2>
          <div className="rounded-xl border border-[var(--border-0)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-0)] bg-[var(--bg-2)]">
                  {['Hôtel', 'Endpoint', 'Appels', 'Est. Coût USD'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold text-[var(--text-3)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.par_hotel.slice(0, 15).map((row, i) => (
                  <tr key={i} className="border-b border-[var(--border-0)] hover:bg-[var(--bg-2)]">
                    <td className="px-4 py-2.5">
                      <div className="text-[var(--text-0)]">{row.hotel_nom || 'Inconnu'}</div>
                      <div className="text-[var(--text-4)] text-[10px]">{row.tenant_id?.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded text-[10px] font-mono">
                        {row.type_analyse || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-0)]">{row.nb_appels}</td>
                    <td className="px-4 py-2.5 text-[var(--text-2)]">${(row.nb_appels * 0.0002).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-1)] p-8 text-center text-sm text-[var(--text-4)]">
          {data?.note || 'Aucune donnée IA disponible.'}
          <div className="text-xs mt-2 text-[var(--text-4)]">
            La table historique_ia est alimentée lors des appels aux endpoints /ia/*.
          </div>
        </div>
      )}

      {/* Politique de données IA */}
      <div className="mt-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-[var(--text-2)]">
        <div className="font-bold text-blue-400 mb-2">Politique de confidentialité IA</div>
        <ul className="space-y-1 text-[var(--text-3)]">
          <li>• Données envoyées à Claude : ratios et tendances uniquement (jamais montants bruts, jamais noms clients)</li>
          <li>• Clé API Anthropic : stockée côté serveur uniquement (jamais exposée au frontend)</li>
          <li>• Timeout 30s sur chaque appel IA pour éviter les blocages</li>
          <li>• Aucun prompt ne contient de données personnelles identifiables (RGPD-compatible)</li>
        </ul>
      </div>
    </PlatformLayout>
  )
}
