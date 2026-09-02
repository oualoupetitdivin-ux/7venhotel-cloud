'use client'
import { useState, useEffect, useCallback } from 'react'
import { restaurantAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

function duree(min) {
  if (!min && min !== 0) return '—'
  const m = Math.round(min)
  return m >= 60 ? `${Math.floor(m/60)}h${String(m%60).padStart(2,'0')}` : `${m}min`
}

function alerteMin(min, seuil) {
  if (min === null || min === undefined) return 'text-[#8892A4]'
  if (min > seuil * 1.5) return 'text-red-400 font-bold'
  if (min > seuil)       return 'text-amber-400 font-bold'
  return 'text-emerald-400'
}

function TimerBadge({ minutes, seuil, label }) {
  if (minutes === null || minutes === undefined) return null
  const cls = alerteMin(minutes, seuil)
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded bg-black/30 ${cls}`}>
      ⏱ {duree(minutes)} {label}
    </span>
  )
}

const COLS = [
  { key: 'nouvelle',       label: 'Nouvelles commandes', icon: '🔔',
    head: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    seuil: 5, next: 'en_preparation', nextL: '▶ Préparer' },
  { key: 'en_preparation', label: 'En préparation',      icon: '🔥',
    head: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
    seuil: 20, next: 'prete', nextL: '✅ Prête' },
  { key: 'prete',          label: 'Prêtes à servir',     icon: '🍽',
    head: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    seuil: 5, next: 'servie', nextL: '→ Servie' },
]

export default function CuisineKDS() {
  const [cuisine,  setCuisine]  = useState({ nouvelle: [], en_preparation: [], prete: [] })
  const [loading,  setLoading]  = useState(true)
  const [lastSync, setLastSync] = useState(null)
  const [now,      setNow]      = useState(new Date())

  const charger = useCallback(async () => {
    try {
      const { data } = await restaurantAPI.cuisine()
      setCuisine(data.cuisine || { nouvelle: [], en_preparation: [], prete: [] })
      setLastSync(new Date())
    } catch { /* silencieux — retry automatique */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    charger()
    const refresh = setInterval(charger, 20000)
    const tick    = setInterval(() => setNow(new Date()), 60000)
    return () => { clearInterval(refresh); clearInterval(tick) }
  }, [charger])

  async function avancer(id, statut) {
    try {
      await restaurantAPI.changerStatut(id, { statut })
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
  }

  const totalActif = (cuisine.nouvelle?.length || 0) + (cuisine.en_preparation?.length || 0)
  const syncLabel  = lastSync
    ? lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div className="min-h-screen bg-[#060810] text-white flex flex-col">

      {/* Header KDS */}
      <div className="flex items-center gap-4 px-5 py-3 border-b border-white/10 bg-[#0B0F1A] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔥</span>
          <div>
            <div className="font-black text-sm text-white">Cuisine KDS</div>
            <div className="text-[9px] text-gray-500 font-mono">Suivi en temps réel · actualisation 20s</div>
          </div>
        </div>

        {totalActif > 0 && (
          <div className="px-3 py-1 bg-amber-500/20 border border-amber-500/30 rounded-full text-xs font-bold text-amber-400">
            {totalActif} commande{totalActif > 1 ? 's' : ''} en cours
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <div className="text-[9px] font-mono text-gray-600">
            Sync {syncLabel}
            <span className={`ml-2 inline-block w-1.5 h-1.5 rounded-full ${lastSync ? 'bg-emerald-500' : 'bg-gray-600'} animate-pulse`}/>
          </div>
          <button onClick={charger} className="text-gray-500 hover:text-white transition-colors text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10">
            ↻
          </button>
          <a href="/restaurant" className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors">
            → Vue complète
          </a>
        </div>
      </div>

      {/* Colonnes KDS */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 flex gap-0 overflow-hidden">
          {COLS.map((col, ci) => (
            <div key={col.key} className={`flex-1 flex flex-col border-r border-white/5 last:border-r-0 min-w-0`}>

              {/* En-tête colonne */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b border-white/10 ${col.head.replace('bg-','bg-').replace('/10','/5')}`}>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{col.icon}</span>
                  <span className="text-xs font-bold">{col.label}</span>
                </div>
                <span className={`text-lg font-black font-mono ${col.head.split(' ').find(c => c.startsWith('text-'))}`}>
                  {cuisine[col.key]?.length || 0}
                </span>
              </div>

              {/* Tickets */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {(cuisine[col.key] || []).map(c => {
                  const minCom  = c.minutes_depuis_commande
                  const minPrep = c.minutes_en_preparation
                  return (
                    <div key={c.id}
                      className="bg-[#111827] border border-white/10 rounded-xl p-3 hover:border-white/20 transition-colors">

                      {/* Ticket header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="font-black text-base leading-tight">
                            Table {c.numero_table || c.numero_chambre || '—'}
                          </div>
                          <div className="text-[9px] text-gray-600 font-mono mt-0.5">{c.numero_commande}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-[9px] text-gray-500 font-mono">
                            {new Date(c.heure_commande).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-xs font-bold text-gray-300 mt-0.5">{fmt(c.total, c.devise || 'XAF')}</div>
                        </div>
                      </div>

                      {/* Timer */}
                      <div className="flex gap-1 flex-wrap mb-2">
                        {col.key === 'nouvelle'       && <TimerBadge minutes={minCom}  seuil={col.seuil} label="d'attente" />}
                        {col.key === 'en_preparation' && <TimerBadge minutes={minPrep} seuil={col.seuil} label="en prép." />}
                        {col.key === 'prete'          && <TimerBadge minutes={minCom}  seuil={30}        label="total" />}
                      </div>

                      {/* Lignes commande */}
                      {c.lignes?.length > 0 && (
                        <div className="space-y-0.5 mb-3 bg-black/20 rounded-lg px-2 py-1.5">
                          {c.lignes.map((l, i) => (
                            <div key={i} className="flex justify-between text-[10px]">
                              <span className="text-gray-200 font-medium">{l.quantite}× {l.nom_article || l.designation || '—'}</span>
                              <span className="text-gray-500 flex-shrink-0 ml-2">{fmt(l.montant_total, c.devise || 'XAF')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {c.notes && (
                        <div className="text-[9px] text-amber-400 bg-amber-500/10 rounded px-2 py-1 mb-2">
                          ⚠ {c.notes}
                        </div>
                      )}

                      {/* Action */}
                      <button
                        onClick={() => avancer(c.id, col.next)}
                        className={`w-full text-xs font-bold py-2 rounded-lg transition-colors
                          ${col.key === 'nouvelle'
                            ? 'bg-amber-500/20 hover:bg-amber-500/40 text-amber-300'
                            : col.key === 'en_preparation'
                              ? 'bg-blue-500/20 hover:bg-blue-500/40 text-blue-300'
                              : 'bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300'
                          }`}>
                        {col.nextL}
                      </button>
                    </div>
                  )
                })}

                {(!cuisine[col.key] || cuisine[col.key].length === 0) && (
                  <div className="text-center text-[10px] text-gray-700 py-10 border border-dashed border-white/5 rounded-xl mt-1">
                    {col.key === 'nouvelle' ? 'Aucune nouvelle commande' :
                     col.key === 'en_preparation' ? 'Cuisine libre' : 'Aucun plat prêt'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
