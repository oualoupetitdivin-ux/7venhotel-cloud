'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { reservationsAPI } from '@/lib/api'
import { fmtDate, STATUT_RESERVATION_COULEUR } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = { confirmee:'Confirmée', arrivee:'En séjour', depart_aujourd_hui:'Départ', tentative:'Tentative', annulee:'Annulée' }
const STATUT_BG = { confirmee:'bg-blue-500/20 border-blue-500/40', arrivee:'bg-emerald-500/20 border-emerald-500/40', depart_aujourd_hui:'bg-amber-500/20 border-amber-500/40', tentative:'bg-purple-500/20 border-purple-500/40', annulee:'bg-red-500/20 border-red-500/40' }

export default function TimelinePage() {
  const [data, setData]     = useState({ reservations:[], chambres:[] })
  const [loading, setLoading] = useState(true)
  const [debut, setDebut]   = useState(new Date().toISOString().split('T')[0])

  useEffect(() => { charger() }, [debut])

  async function charger() {
    try {
      setLoading(true)
      const fin = new Date(debut)
      fin.setDate(fin.getDate() + 13)
      const res = await reservationsAPI.timeline({ debut, fin: fin.toISOString().split('T')[0] })
      setData(res.data)
    } catch { toast.error('Erreur chargement planning') }
    finally { setLoading(false) }
  }

  // Générer les 14 jours
  const jours = Array.from({length:14}, (_,i) => {
    const d = new Date(debut)
    d.setDate(d.getDate() + i)
    return d
  })

  // Trouver les réservations pour une chambre + jour
  function getReservation(chambreId, jour) {
    const j = jour.toISOString().split('T')[0]
    return data.reservations.find(r =>
      r.chambre_id === chambreId &&
      r.date_arrivee <= j && r.date_depart > j
    )
  }

  function isArrivee(r, jour) { return r?.date_arrivee === jour.toISOString().split('T')[0] }
  function isDepart(r, jour) {
    const d = new Date(jour); d.setDate(d.getDate()+1)
    return r?.date_depart === d.toISOString().split('T')[0]
  }

  const aujourdhui = new Date().toISOString().split('T')[0]

  return (
    <AppLayout titre="Planning" sousTitre="Vue timeline des réservations">
      <div className="space-y-4">
        {/* Navigation */}
        <div className="flex items-center gap-3">
          <button onClick={() => { const d=new Date(debut); d.setDate(d.getDate()-7); setDebut(d.toISOString().split('T')[0]) }}
            className="btn btn-ghost btn-sm">← 7 jours</button>
          <input type="date" value={debut} onChange={e => setDebut(e.target.value)} className="input w-40" />
          <button onClick={() => { const d=new Date(debut); d.setDate(d.getDate()+7); setDebut(d.toISOString().split('T')[0]) }}
            className="btn btn-ghost btn-sm">7 jours →</button>
          <button onClick={() => setDebut(new Date().toISOString().split('T')[0])} className="btn btn-ghost btn-sm">Aujourd'hui</button>
          <button onClick={charger} className="btn btn-ghost btn-sm ml-auto">↻</button>
        </div>

        {/* Légende */}
        <div className="flex gap-3 flex-wrap text-xs">
          {Object.entries(STATUT_LABEL).slice(0,4).map(([k,v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded border ${STATUT_BG[k]}`} />
              <span className="text-[var(--text-3)]">{v}</span>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="card overflow-auto">
            <table className="text-[10px] w-full min-w-max">
              <thead>
                <tr className="border-b border-[var(--border-1)]">
                  <th className="text-left px-3 py-2 text-[var(--text-3)] font-medium w-20 sticky left-0 bg-[var(--bg-1)] z-10">Chambre</th>
                  {jours.map((j,i) => {
                    const isToday = j.toISOString().split('T')[0] === aujourdhui
                    return (
                      <th key={i} className={`px-2 py-2 font-medium text-center w-16 ${isToday ? 'text-blue-400 bg-blue-500/5' : 'text-[var(--text-3)]'}`}>
                        <div>{j.toLocaleDateString('fr-FR',{weekday:'short'})}</div>
                        <div className={`text-[11px] font-bold ${isToday ? 'text-blue-400' : 'text-[var(--text-2)]'}`}>{j.getDate()}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {data.chambres.map(ch => (
                  <tr key={ch.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                    <td className="px-3 py-1.5 sticky left-0 bg-[var(--bg-1)] z-10 border-r border-[var(--border-1)]">
                      <div className="font-bold text-[var(--text-1)]">{ch.numero}</div>
                      <div className="text-[var(--text-3)] text-[9px]">{ch.type_chambre}</div>
                    </td>
                    {jours.map((j,i) => {
                      const r = getReservation(ch.id, j)
                      const isToday = j.toISOString().split('T')[0] === aujourdhui
                      return (
                        <td key={i} className={`px-0.5 py-1 text-center ${isToday ? 'bg-blue-500/5' : ''}`}>
                          {r ? (
                            <div className={`rounded border px-1 py-0.5 text-[9px] truncate ${STATUT_BG[r.statut] || 'bg-gray-500/20 border-gray-500/40'}`}
                              title={`${r.nom_client} — ${STATUT_LABEL[r.statut]}`}>
                              {isArrivee(r,j) ? '→ ' : ''}{r.nom_client?.split(' ')[0] || '?'}{isDepart(r,j) ? ' ←' : ''}
                            </div>
                          ) : (
                            <div className="text-[var(--text-4)] text-center">—</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
