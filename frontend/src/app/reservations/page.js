'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { reservationsAPI } from '@/lib/api'
import { fmt, fmtDate, STATUT_RESERVATION_COULEUR } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUTS = ['','confirmee','arrivee','depart_aujourd_hui','tentative','annulee','no_show']
const STATUT_LABEL = { confirmee:'Confirmée', arrivee:'En séjour', depart_aujourd_hui:'Départ aujourd\'hui', tentative:'Tentative', annulee:'Annulée', no_show:'No show' }

export default function ReservationsPage() {
  const [data, setData]       = useState([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [statut, setStatut]   = useState('')
  const [page, setPage]       = useState(1)

  useEffect(() => { charger() }, [statut, page])

  async function charger() {
    try {
      setLoading(true)
      const res = await reservationsAPI.lister({ statut: statut || undefined, page, limite: 20 })
      setData(res.data.data || [])
      setTotal(res.data.pagination?.total || 0)
    } catch (err) {
      toast.error('Erreur chargement réservations')
    } finally { setLoading(false) }
  }

  async function faireCheckin(id) {
    try {
      await reservationsAPI.checkin(id)
      toast.success('Check-in effectué !')
      charger()
    } catch { toast.error('Erreur check-in') }
  }

  async function faireCheckout(id) {
    try {
      await reservationsAPI.checkout(id)
      toast.success('Check-out effectué !')
      charger()
    } catch { toast.error('Erreur check-out') }
  }

  return (
    <AppLayout titre="Réservations" sousTitre="Gestion des réservations">
      <div className="space-y-5">
        {/* En-tête */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            {STATUTS.map(s => (
              <button key={s} onClick={() => { setStatut(s); setPage(1) }}
                className={`btn btn-sm ${statut === s ? 'btn-primary' : 'btn-ghost'}`}>
                {s ? STATUT_LABEL[s] : 'Toutes'} {s === statut && total > 0 ? `(${total})` : ''}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻ Actualiser</button>
            <a href="/reservations/nouvelle" className="btn btn-primary btn-sm">＋ Nouvelle réservation</a>
          </div>
        </div>

        {/* Tableau */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <div className="card-title">Réservations <span className="text-[var(--text-3)] font-normal ml-2 text-xs">{total} au total</span></div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : data.length === 0 ? (
            <div className="p-10 text-center text-xs text-[var(--text-3)]">
              <div className="text-4xl mb-3">📋</div>
              <div className="font-semibold mb-1">Aucune réservation</div>
              <div>Créez votre première réservation avec le bouton ci-dessus</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-1)]">
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">N° Réservation</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Client</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Chambre</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Arrivée</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Départ</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Montant</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(r => (
                    <tr key={r.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)] transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-blue-400">{r.numero_reservation}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[var(--text-1)]">{r.nom_client || '—'}</div>
                        <div className="text-[var(--text-3)]">{r.email_client}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold">Ch. {r.numero_chambre}</span>
                        <span className="text-[var(--text-3)] ml-1">{r.type_chambre}</span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{fmtDate(r.date_arrivee)}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{fmtDate(r.date_depart)}</td>
                      <td className="px-4 py-3 font-semibold">{fmt(r.total_general, r.devise)}</td>
                      <td className="px-4 py-3">
                        <span className={`badge ${STATUT_RESERVATION_COULEUR[r.statut] || 'badge-gray'}`}>
                          {STATUT_LABEL[r.statut] || r.statut}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {r.statut === 'confirmee' && (
                            <button onClick={() => faireCheckin(r.id)} className="btn btn-xs btn-primary">Check-in</button>
                          )}
                          {r.statut === 'arrivee' && (
                            <button onClick={() => faireCheckout(r.id)} className="btn btn-xs btn-ghost">Check-out</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination */}
          {total > 20 && (
            <div className="px-4 py-3 border-t border-[var(--border-1)] flex items-center justify-between text-xs">
              <span className="text-[var(--text-3)]">Page {page} sur {Math.ceil(total/20)}</span>
              <div className="flex gap-2">
                <button disabled={page===1} onClick={() => setPage(p=>p-1)} className="btn btn-ghost btn-xs">← Précédent</button>
                <button disabled={page>=Math.ceil(total/20)} onClick={() => setPage(p=>p+1)} className="btn btn-ghost btn-xs">Suivant →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
