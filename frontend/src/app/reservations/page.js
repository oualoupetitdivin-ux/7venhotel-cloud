'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppLayout     from '@/components/layout/AppLayout'
import PortailModal  from '@/components/PortailModal'
import { reservationsAPI, facturationAPI } from '@/lib/api'
import { fmt, fmtDate, STATUT_RESERVATION_COULEUR, useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'

const STATUTS = ['','confirmee','arrivee','depart_aujourd_hui','tentative','annulee','no_show']
const STATUT_LABEL = { confirmee:'Confirmée', arrivee:'En séjour', depart_aujourd_hui:'Départ aujourd\'hui', tentative:'Tentative', annulee:'Annulée', no_show:'No show' }

export default function ReservationsPage() {
  const router = useRouter()
  const { hotel } = useAuthStore()
  const [data, setData]       = useState([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [statut, setStatut]   = useState('')
  const [page, setPage]       = useState(1)
  const [enCours, setEnCours]                   = useState(new Set())
  const [actionEnCours, setActionEnCours]       = useState(false)
  const [portailApresCheckin, setPortailApresCheckin] = useState(null)

  const hasHotel = !!(hotel?.id || (typeof window !== 'undefined' && localStorage.getItem('7vh_hotel_id')))

  useEffect(() => { if (hasHotel) charger() }, [statut, page, hasHotel])

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
    if (actionEnCours || enCours.has(id)) return
    const r = data.find(x => x.id === id)
    const ok = window.confirm(
      `Check-in — ${r?.nom_client || 'Client'}\n` +
      `Ch. ${r?.numero_chambre || '?'} · ${fmtDate(r?.date_arrivee)} → ${fmtDate(r?.date_depart)}\n\n` +
      `Confirmer le check-in ?`
    )
    if (!ok) return
    setActionEnCours(true)
    setEnCours(s => new Set([...s, id]))
    try {
      const { data: res } = await reservationsAPI.checkin(id)
      toast.success('Check-in effectué !')
      if (res?.token_portail) setPortailApresCheckin({ url: `${window.location.origin}/room-portal/${res.token_portail}` })
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur check-in')
    } finally {
      setEnCours(s => { const n = new Set(s); n.delete(id); return n })
      setActionEnCours(false)
    }
  }

  async function faireCheckout(id) {
    if (actionEnCours || enCours.has(id)) return

    // Vérification solde avant check-out (non bloquant si folio inaccessible)
    let soldeDuAvantCheckout = 0
    try {
      const { data: f } = await facturationAPI.folioReservation(id)
      soldeDuAvantCheckout = parseFloat(f?.solde?.solde_du ?? 0)
      const devise = f?.folio?.devise || 'XAF'
      if (soldeDuAvantCheckout > 0) {
        const ok = window.confirm(`Solde impayé : ${fmt(soldeDuAvantCheckout, devise)}. Confirmer le check-out quand même ?`)
        if (!ok) return
      }
    } catch { /* folio inaccessible → laisser passer */ }

    setActionEnCours(true)
    setEnCours(s => new Set([...s, id]))
    try {
      await reservationsAPI.checkout(id)
      if (soldeDuAvantCheckout > 0) {
        toast(t => (
          <span className="text-sm">
            Check-out effectué — solde restant dû — {' '}
            <button
              onClick={() => { toast.dismiss(t.id); router.push(`/reservations/${id}`) }}
              className="text-blue-400 underline font-semibold">
              voir la fiche
            </button>
          </span>
        ), { icon: '⚠️', duration: 8000 })
      } else {
        toast(t => (
          <span className="text-sm">
            Check-out effectué, aucun solde restant — {' '}
            <button
              onClick={() => { toast.dismiss(t.id); router.push(`/reservations/${id}`) }}
              className="text-blue-400 underline font-semibold">
              facture disponible sur la fiche
            </button>
          </span>
        ), { icon: '✅', duration: 8000 })
      }
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur check-out')
    } finally {
      setEnCours(s => { const n = new Set(s); n.delete(id); return n })
      setActionEnCours(false)
    }
  }

  async function confirmerReservation(id) {
    if (actionEnCours) return
    if (!window.confirm('Confirmer manuellement cette réservation ?')) return
    setActionEnCours(true)
    try {
      await reservationsAPI.confirmer(id)
      toast.success('Réservation confirmée')
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur confirmation')
    } finally {
      setActionEnCours(false)
    }
  }

  async function annulerReservation(id) {
    if (actionEnCours) return
    const motif = window.prompt('Motif d\'annulation (obligatoire) :')
    if (!motif?.trim()) return
    setActionEnCours(true)
    try {
      await reservationsAPI.annuler(id, { motif: motif.trim() })
      toast.success('Réservation annulée')
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur annulation')
    } finally {
      setActionEnCours(false)
    }
  }

  if (!hasHotel) return (
    <AppLayout titre="Réservations" sousTitre="Gestion des réservations">
      <div className="card p-8 text-center space-y-3">
        <div className="text-3xl">🏨</div>
        <div className="text-sm font-semibold text-[var(--text-1)]">Aucun hôtel sélectionné</div>
        <div className="text-xs text-[var(--text-3)]">
          Pour accéder aux réservations, connectez-vous avec un compte hôtel
          ou sélectionnez un hôtel depuis le tableau de bord plateforme.
        </div>
        <a href="/platform/dashboard" className="btn btn-primary btn-sm inline-flex">
          Tableau de bord plateforme
        </a>
      </div>
    </AppLayout>
  )

  return (
    <AppLayout titre="Réservations" sousTitre="Gestion des réservations">
      {portailApresCheckin && (
        <PortailModal urlPortail={portailApresCheckin.url} onClose={() => setPortailApresCheckin(null)} />
      )}
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
            <Link href="/reservations/nouvelle" className="btn btn-primary btn-sm">＋ Nouvelle réservation</Link>
          </div>
        </div>

        {/* Tableau */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <div className="card-title">Réservations <span className="text-[var(--text-3)] font-normal ml-2 text-xs">{total} au total</span></div>
          </div>
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(6)].map((_,i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
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
                      <td className="px-4 py-3 font-mono font-semibold text-blue-400">
                        <Link href={`/reservations/${r.id}`} className="hover:underline">{r.numero_reservation}</Link>
                      </td>
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
                        <div className="flex gap-1 flex-wrap">
                          {r.statut === 'tentative' && (
                            <button
                              onClick={() => confirmerReservation(r.id)}
                              disabled={actionEnCours}
                              className="btn btn-xs btn-primary disabled:opacity-50">
                              ✓ Confirmer
                            </button>
                          )}
                          {r.statut === 'confirmee' && (
                            <button
                              onClick={() => faireCheckin(r.id)}
                              disabled={actionEnCours}
                              className="btn btn-xs btn-primary disabled:opacity-50">
                              {enCours.has(r.id) ? '…' : 'Check-in'}
                            </button>
                          )}
                          {r.statut === 'arrivee' && (
                            <button
                              onClick={() => faireCheckout(r.id)}
                              disabled={actionEnCours}
                              className="btn btn-xs btn-ghost disabled:opacity-50">
                              {enCours.has(r.id) ? '…' : 'Check-out'}
                            </button>
                          )}
                          {(r.statut === 'tentative' || r.statut === 'confirmee') && (
                            <button
                              onClick={() => annulerReservation(r.id)}
                              disabled={actionEnCours}
                              className="btn btn-xs btn-danger disabled:opacity-50">
                              ✕ Annuler
                            </button>
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
