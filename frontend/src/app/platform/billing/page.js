'use client'
import { useState, useEffect } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore, fmt } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError } from '@/lib/platform-api'

const PLAN_COLORS = { starter: 'blue', business: 'purple', enterprise: 'amber', 'ohada+': 'emerald' }
const PLAN_ICONS  = { starter: '🌱', business: '⚡', enterprise: '🏆', 'ohada+': '🌍' }

function PlanCard({ plan, mrr_xaf, nb_tenants }) {
  const c = PLAN_COLORS[plan?.toLowerCase()] || 'gray'
  const colorMap = {
    blue:    'border-blue-500/30 bg-blue-500/5 text-blue-400',
    purple:  'border-purple-500/30 bg-purple-500/5 text-purple-400',
    amber:   'border-amber-500/30 bg-amber-500/5 text-amber-400',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
    gray:    'border-gray-500/30 bg-gray-500/5 text-gray-400',
  }
  return (
    <div className={`rounded-xl border p-5 ${colorMap[c]}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{PLAN_ICONS[plan?.toLowerCase()] || '📦'}</span>
        <span className="text-sm font-black uppercase">{plan}</span>
      </div>
      <div className="text-2xl font-black text-[var(--text-0)]">{fmt(mrr_xaf || 0)}</div>
      <div className="text-xs text-[var(--text-3)] mt-1">MRR · {nb_tenants} client{nb_tenants > 1 ? 's' : ''}</div>
      <div className="text-xs text-[var(--text-4)] mt-0.5">ARR : {fmt((mrr_xaf || 0) * 12)}</div>
    </div>
  )
}

// ── Composant erreur unifié ────────────────────────────────────────────────────
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

export default function PlatformBilling() {
  const { init } = useAuthStore()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [erreur,  setErreur]  = useState(null)
  const [errType, setErrType] = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  // PlatformLayout garantit l'authentification avant le montage de ce composant
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger() }, [])

  async function charger() {
    setLoading(true)
    setErreur(null)
    setErrType(null)
    try {
      const d = await platformAPI.billingMRR()
      setData(d)
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErrType(e.name)
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <PlatformLayout titre="Facturation SaaS" sousTitre="Chargement…">
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-2 border-blue-500/50 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-xs text-[var(--text-4)] tracking-widest uppercase">Chargement facturation</div>
      </div>
    </PlatformLayout>
  )

  if (erreur) return (
    <PlatformLayout titre="Facturation SaaS" sousTitre="Erreur de chargement">
      <ErreurPlatform erreur={erreur} errType={errType}
        onRetry={() => { setErreur(null); setLoading(true); charger() }} />
    </PlatformLayout>
  )

  return (
    <PlatformLayout titre="Facturation SaaS" sousTitre="MRR · ARR · Abonnements plateforme">

      {/* KPIs globaux */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">MRR Total</div>
          <div className="text-3xl font-black text-[var(--text-0)]">{fmt(data?.mrr_total_xaf || 0)}</div>
          <div className="text-xs text-[var(--text-4)] mt-1">Revenus mensuels récurrents</div>
        </div>
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-2">ARR Projeté</div>
          <div className="text-3xl font-black text-[var(--text-0)]">{fmt(data?.arr_projete_xaf || 0)}</div>
          <div className="text-xs text-[var(--text-4)] mt-1">MRR × 12 mois</div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-2">Essais en cours</div>
          <div className="text-3xl font-black text-[var(--text-0)]">{data?.tenants_essai || 0}</div>
          <div className="text-xs text-[var(--text-4)] mt-1">Clients potentiels à convertir</div>
        </div>
      </div>

      {/* Plans */}
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-3)] mb-4">Répartition par plan</h2>
      {data?.par_plan?.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {data.par_plan.map(p => <PlanCard key={p.plan} {...p} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-1)] p-8 text-center text-[var(--text-4)] text-sm mb-8">
          Aucun abonnement payant actif — tous les tenants sont en essai gratuit.
        </div>
      )}

      {/* Note SYSCOHADA */}
      <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 text-xs text-purple-300">
        <div className="font-bold mb-1">📋 Conformité SYSCOHADA</div>
        <div className="text-[var(--text-3)]">
          Les factures SaaS doivent inclure le numéro de contribuable, la TVA applicable selon le pays du tenant
          (Cameroun 19.25%, Sénégal 18%, Côte d'Ivoire 18%), et être conservées 10 ans (droit OHADA art. 16).
          Export comptable disponible via le module Conformité.
        </div>
      </div>

    </PlatformLayout>
  )
}
