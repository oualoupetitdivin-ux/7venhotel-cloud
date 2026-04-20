'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'
import { reservationsAPI, chambresAPI, clientsAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function NouvelleReservationPage() {
  const router = useRouter()
  const [chambres, setChambres]   = useState([])
  const [clients, setClients]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [searchClient, setSearchClient] = useState('')

  const [form, setForm] = useState({
    client_id:'', chambre_id:'', date_arrivee:'', date_depart:'',
    nombre_adultes:2, nombre_enfants:0, source:'direct',
    regime_repas:'chambre_seule', notes_internes:''
  })
  const [chambreSelectionnee, setChambreSelectionnee] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      const [cRes, clRes] = await Promise.allSettled([
        chambresAPI.lister({ statut:'libre_propre' }),
        clientsAPI.lister({ limite:100 })
      ])
      if (cRes.status==='fulfilled') setChambres(cRes.value.data.chambres || [])
      if (clRes.status==='fulfilled') setClients(clRes.value.data.data || [])
    } catch { toast.error('Erreur chargement') }
    finally { setLoading(false) }
  }

  function selectionnerChambre(ch) {
    setChambreSelectionnee(ch)
    setForm(f => ({...f, chambre_id: ch.id, tarif_nuit: ch.tarif_base}))
  }

  const nuits = form.date_arrivee && form.date_depart
    ? Math.max(0, Math.round((new Date(form.date_depart) - new Date(form.date_arrivee)) / 86400000))
    : 0

  const totalHeberg = nuits * (chambreSelectionnee?.tarif_base || 0)

  async function creerReservation(e) {
    e.preventDefault()
    if (!form.client_id) return toast.error('Sélectionnez un client')
    if (!form.chambre_id) return toast.error('Sélectionnez une chambre')
    if (nuits <= 0) return toast.error('Dates invalides')
    try {
      setSaving(true)
      await reservationsAPI.creer({
        ...form,
        tarif_nuit: chambreSelectionnee?.tarif_base || 0,
        total_hebergement: totalHeberg,
        total_general: totalHeberg,
        devise: 'XAF'
      })
      toast.success('Réservation créée !')
      router.push('/reservations')
    } catch { toast.error('Erreur création réservation') }
    finally { setSaving(false) }
  }

  const clientsFiltres = searchClient
    ? clients.filter(c => `${c.prenom} ${c.nom} ${c.email}`.toLowerCase().includes(searchClient.toLowerCase()))
    : clients

  if (loading) return (
    <AppLayout titre="Nouvelle réservation" sousTitre="Créer une réservation">
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
      </div>
    </AppLayout>
  )

  return (
    <AppLayout titre="Nouvelle réservation" sousTitre="Créer une réservation">
      <form onSubmit={creerReservation} className="space-y-5">
        <div className="grid grid-cols-3 gap-5">
          {/* Colonne gauche */}
          <div className="col-span-2 space-y-5">
            {/* Dates */}
            <div className="card p-5">
              <div className="card-title mb-4">📅 Séjour</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Arrivée *</label>
                  <input type="date" className="input" required value={form.date_arrivee}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => setForm({...form, date_arrivee:e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Départ *</label>
                  <input type="date" className="input" required value={form.date_depart}
                    min={form.date_arrivee || new Date().toISOString().split('T')[0]}
                    onChange={e => setForm({...form, date_depart:e.target.value})} />
                </div>
                <div>
                  <label className="form-label">Adultes</label>
                  <input type="number" className="input" min="1" max="10" value={form.nombre_adultes}
                    onChange={e => setForm({...form, nombre_adultes:parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="form-label">Enfants</label>
                  <input type="number" className="input" min="0" max="10" value={form.nombre_enfants}
                    onChange={e => setForm({...form, nombre_enfants:parseInt(e.target.value)})} />
                </div>
                <div>
                  <label className="form-label">Source</label>
                  <select className="input" value={form.source} onChange={e => setForm({...form, source:e.target.value})}>
                    <option value="direct">Direct</option>
                    <option value="booking">Booking.com</option>
                    <option value="agence">Agence</option>
                    <option value="telephone">Téléphone</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Régime repas</label>
                  <select className="input" value={form.regime_repas} onChange={e => setForm({...form, regime_repas:e.target.value})}>
                    <option value="chambre_seule">Chambre seule</option>
                    <option value="petit_dejeuner">Petit-déjeuner inclus</option>
                    <option value="demi_pension">Demi-pension</option>
                    <option value="pension_complete">Pension complète</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Client */}
            <div className="card p-5">
              <div className="card-title mb-4">👤 Client *</div>
              <input type="text" placeholder="Rechercher un client..." className="input mb-3"
                value={searchClient} onChange={e => setSearchClient(e.target.value)} />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {clientsFiltres.slice(0,20).map(c => (
                  <div key={c.id} onClick={() => setForm({...form, client_id:c.id})}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs transition-colors ${form.client_id===c.id ? 'bg-blue-500/20 border border-blue-500/40' : 'hover:bg-[var(--bg-2)]'}`}>
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                      {c.prenom?.[0]}{c.nom?.[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-[var(--text-1)]">{c.prenom} {c.nom}</div>
                      <div className="text-[var(--text-3)]">{c.email}</div>
                    </div>
                    {c.segment === 'VIP' && <span className="ml-auto badge badge-purple text-[9px]">⭐ VIP</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Chambre */}
            <div className="card p-5">
              <div className="card-title mb-4">🏨 Chambre disponible *</div>
              {form.date_arrivee && form.date_depart ? (
                <div className="grid grid-cols-3 gap-2">
                  {chambres.map(ch => (
                    <div key={ch.id} onClick={() => selectionnerChambre(ch)}
                      className={`card p-3 cursor-pointer transition-all ${form.chambre_id===ch.id ? 'border-blue-500 bg-blue-500/10' : 'hover:border-blue-500/40'}`}>
                      <div className="font-bold text-sm text-[var(--text-1)]">Ch. {ch.numero}</div>
                      <div className="text-[10px] text-[var(--text-3)]">{ch.type_chambre}</div>
                      <div className="text-[10px] text-[var(--text-3)]">Étage {ch.etage}</div>
                      <div className="text-xs font-bold text-blue-400 mt-1">{fmt(ch.tarif_base,'XAF')}/nuit</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[var(--text-3)] text-center py-4">Sélectionnez les dates pour voir les chambres disponibles</div>
              )}
            </div>
          </div>

          {/* Résumé */}
          <div className="space-y-4">
            <div className="card p-4 sticky top-4">
              <div className="card-title mb-4">📋 Résumé</div>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Arrivée</span>
                  <span className="font-semibold">{form.date_arrivee || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Départ</span>
                  <span className="font-semibold">{form.date_depart || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Nuits</span>
                  <span className="font-semibold">{nuits}</span>
                </div>
                {chambreSelectionnee && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-3)]">Chambre</span>
                    <span className="font-semibold">Ch. {chambreSelectionnee.numero}</span>
                  </div>
                )}
                {chambreSelectionnee && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-3)]">Tarif/nuit</span>
                    <span className="font-semibold">{fmt(chambreSelectionnee.tarif_base,'XAF')}</span>
                  </div>
                )}
                <div className="border-t border-[var(--border-1)] pt-3 flex justify-between">
                  <span className="font-bold">Total héberg.</span>
                  <span className="font-bold text-blue-400 text-sm">{fmt(totalHeberg,'XAF')}</span>
                </div>
              </div>
              <button type="submit" disabled={saving || !form.client_id || !form.chambre_id || nuits<=0}
                className="btn btn-primary w-full btn-sm mt-5">
                {saving ? 'Création...' : '✅ Créer la réservation'}
              </button>
              <button type="button" onClick={() => router.back()} className="btn btn-ghost w-full btn-sm mt-2">
                Annuler
              </button>
            </div>
          </div>
        </div>
      </form>
    </AppLayout>
  )
}
