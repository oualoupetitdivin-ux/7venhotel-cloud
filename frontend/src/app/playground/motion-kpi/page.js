'use client'
import { useState, useEffect } from 'react'
import AnimatedKpiCard from '@/components/ui/AnimatedKpiCard'
import { useAuthStore } from '@/lib/utils'

const DEMO_CARDS = [
  { label: 'Occupation',      valeur: '78%', sous: '42 chambres occupées', couleur: 'border-blue-500',    icone: '🏨' },
  { label: 'Recettes du jour',valeur: '1 240 000 XAF', sous: 'Depuis le ledger', couleur: 'border-emerald-500', icone: '💳' },
  { label: 'Arrivées',        valeur: '11', sous: 'Attendues ce jour',  couleur: 'border-purple-500',  icone: '🛬' },
  { label: 'Départs',         valeur: '7',  sous: 'À traiter ce jour',  couleur: 'border-amber-500',   icone: '🛫' },
  { label: 'Ménage',          valeur: '4',  sous: 'Tâches en attente',  couleur: 'border-amber-400',   icone: '🧹' },
  { label: 'Urgences',        valeur: '1',  sous: 'Tickets critiques',  couleur: 'border-red-500',     icone: '⚠' },
]

export default function MotionKpiPlayground() {
  const { user } = useAuthStore()
  const [replayKey, setReplayKey] = useState(0)

  useEffect(() => {
    if (!user) window.location.href = '/auth/connexion'
  }, [user])

  if (!user) return null
  const [light, setLight] = useState(false)

  return (
    <div className={`min-h-screen bg-[var(--bg-0)] p-8 ${light ? 'light' : ''}`}>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-lg font-bold text-[var(--text-0)]">Prototype — KPI Card animée (Framer Motion)</h1>
          <span className="badge badge-purple px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide">non intégré</span>
        </div>
        <p className="text-xs text-[var(--text-3)] mb-5">
          Isolé du dashboard réel — entrée en cascade + lift au survol. Aucune donnée API, aucun lien de nav.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setReplayKey(k => k + 1)} className="btn btn-ghost btn-xs">
            ↻ Rejouer l&apos;entrée
          </button>
          <button onClick={() => setLight(v => !v)} className="btn btn-ghost btn-xs">
            {light ? '🌙 Fond sombre' : '☀️ Fond clair'}
          </button>
        </div>

        <div key={replayKey} className="grid grid-cols-6 gap-3">
          {DEMO_CARDS.map((c, i) => (
            <AnimatedKpiCard key={c.label} index={i} {...c} />
          ))}
        </div>
      </div>
    </div>
  )
}
