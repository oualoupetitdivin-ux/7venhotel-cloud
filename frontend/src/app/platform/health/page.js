'use client'
import { useState, useEffect, useCallback } from 'react'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError } from '@/lib/platform-api'

function StatutDot({ statut }) {
  if (statut === 'ok' || statut === 'healthy')
    return <span className="inline-flex w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10B981]" />
  if (statut === 'degraded')
    return <span className="inline-flex w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_#F59E0B]" />
  return <span className="inline-flex w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_#EF4444]" />
}

function HealthCard({ titre, statut, valeur, sub, icon }) {
  const bg = (statut === 'ok' || statut === 'healthy') ? 'border-emerald-500/25 bg-emerald-500/5'
    : statut === 'degraded' ? 'border-amber-500/25 bg-amber-500/5'
    : 'border-red-500/25 bg-red-500/5'
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatutDot statut={statut} />
          <span className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wide">{titre}</span>
        </div>
        <span className="text-lg opacity-50">{icon}</span>
      </div>
      <div className="text-xl font-black text-[var(--text-0)]">{valeur ?? '—'}</div>
      {sub && <div className="text-xs text-[var(--text-4)] mt-1">{sub}</div>}
    </div>
  )
}

export default function PlatformHealth() {
  const { init } = useAuthStore()
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [erreur,      setErreur]      = useState(null)
  const [errType,     setErrType]     = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [refreshing,  setRefreshing]  = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  const charger = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const d = await platformAPI.health()
      setData(d)
      setErreur(null)
      setErrType(null)
      setLastRefresh(new Date())
    } catch (e) {
      if (e.name === 'PlatformAuthError') return
      setErrType(e.name)
      setErreur(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Chargement initial + refresh auto 30s
  useEffect(() => {
    charger()
    const iv = setInterval(() => charger(), 30_000)
    return () => clearInterval(iv)
  }, [charger])

  const statut = data?.statut
  const headerColor = statut === 'healthy' ? 'text-emerald-400' : statut === 'degraded' ? 'text-amber-400' : 'text-red-400'

  if (loading) return (
    <PlatformLayout titre="Observabilité" sousTitre="Santé technique de la plateforme (refresh 30s)">
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-2 border-blue-500/50 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-xs text-[var(--text-4)] tracking-widest uppercase">Diagnostic infrastructure</div>
      </div>
    </PlatformLayout>
  )

  if (erreur && !data) return (
    <PlatformLayout titre="Observabilité" sousTitre="Erreur de chargement">
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">{errType === 'PlatformTimeoutError' ? '⏱' : errType === 'PlatformNetworkError' ? '📡' : '⚠'}</span>
          <div>
            <div className="text-sm font-bold text-red-300">
              {errType === 'PlatformTimeoutError' ? 'Délai dépassé' : errType === 'PlatformNetworkError' ? 'Backend inaccessible' : 'Erreur plateforme'}
            </div>
            <div className="text-xs text-red-400/70 mt-0.5">{erreur}</div>
          </div>
        </div>
        <button onClick={() => { setErreur(null); setLoading(true); charger() }}
          className="text-xs px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
          ↻ Réessayer
        </button>
      </div>
    </PlatformLayout>
  )

  return (
    <PlatformLayout titre="Observabilité" sousTitre="Santé technique de la plateforme (refresh 30s)">

      {/* Statut global */}
      <div className={`flex items-center gap-3 mb-6 p-4 rounded-xl border ${
        statut === 'healthy' ? 'border-emerald-500/30 bg-emerald-500/5'
        : statut === 'degraded' ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-red-500/30 bg-red-500/5'}`}>
        <StatutDot statut={statut} />
        <div>
          <div className={`font-black text-lg ${headerColor}`}>
            {statut === 'healthy' ? 'Plateforme opérationnelle' : statut === 'degraded' ? 'Plateforme dégradée' : 'Incident critique'}
          </div>
          <div className="text-xs text-[var(--text-3)]">
            Dernier check : {lastRefresh?.toLocaleTimeString('fr-FR') || '—'}
            {' · '}Latence totale : {data?.latence_ms ?? '—'}ms
            {' · '}v{data?.version}
          </div>
        </div>
        <button
          onClick={() => charger(true)}
          disabled={refreshing}
          className="ml-auto text-xs border border-[var(--border-1)] px-3 py-1 rounded-lg hover:border-[var(--border-2)] disabled:opacity-50 transition-colors flex items-center gap-1.5">
          <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
          Actualiser
        </button>
      </div>

      {/* Alerte erreur non bloquante (données stales) */}
      {erreur && data && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300 flex items-center gap-2">
          <span>⚠</span>
          <span>Dernière actualisation échouée — données potentiellement obsolètes · {erreur}</span>
        </div>
      )}

      {/* Composants */}
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-3)] mb-3">Composants infrastructure</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <HealthCard
          titre="PostgreSQL"
          statut={data?.postgresql?.statut}
          valeur={data?.postgresql?.latence_ms != null ? `${data.postgresql.latence_ms}ms` : 'N/A'}
          sub={data?.postgresql?.statut === 'ok' ? 'Base de données opérationnelle' : 'Erreur de connexion'}
          icon="🐘"
        />
        <HealthCard
          titre="Cache"
          statut={data?.cache?.type === 'redis' ? 'ok' : 'degraded'}
          valeur={data?.cache?.type === 'redis' ? 'Redis' : 'Mémoire'}
          sub={data?.cache?.type === 'redis' ? 'Cache Redis opérationnel' : 'Redis hors ligne — mode dégradé'}
          icon="⚡"
        />
        <HealthCard
          titre="API Fastify"
          statut="ok"
          valeur={`${data?.latence_ms || 0}ms`}
          sub="Temps réponse health check"
          icon="🚀"
        />
      </div>

      {/* Données plateforme */}
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--text-3)] mb-3">Données plateforme</h2>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Tenants', val: data?.donnees?.tenants, icon: '🏢' },
          { label: 'Hôtels',  val: data?.donnees?.hotels,  icon: '🏨' },
          { label: 'Réservations (total)', val: data?.donnees?.reservations, icon: '📋' },
        ].map(d => (
          <div key={d.label} className="rounded-xl border border-[var(--border-1)] bg-[var(--bg-2)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--text-3)]">{d.label}</span>
              <span>{d.icon}</span>
            </div>
            <div className="text-2xl font-black text-[var(--text-0)]">{d.val ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* Avertissements mode dégradé */}
      {statut === 'degraded' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="font-bold text-amber-400 text-sm mb-2">⚠ Mode dégradé actif</div>
          <ul className="text-xs text-[var(--text-2)] space-y-1">
            {data?.cache?.type !== 'redis' && (
              <li>• Redis hors ligne → cache mémoire (performances réduites, pas de partage entre instances)</li>
            )}
          </ul>
          <div className="text-xs text-[var(--text-4)] mt-3">
            SLA Starter : 99.5% uptime | Business : 99.9% | Enterprise : 99.95%
          </div>
        </div>
      )}

    </PlatformLayout>
  )
}
