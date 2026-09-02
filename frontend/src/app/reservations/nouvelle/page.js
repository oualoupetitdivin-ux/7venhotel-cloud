'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'
import { reservationsAPI, chambresAPI, clientsAPI, facturationAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

function calculerTaxes(tarifNuit, nuits, taxes) {
  const totalHT = tarifNuit * nuits
  let totalTaxes = 0
  const detail = []
  for (const t of (taxes || [])) {
    if (t.actif === false) continue
    const montant = t.type_taxe === 'pourcentage'
      ? Math.round(totalHT * (t.valeur / 100))
      : Math.round(t.valeur * nuits)
    totalTaxes += montant
    detail.push({ nom: t.nom, montant })
  }
  return { totalHT, totalTaxes, total: totalHT + totalTaxes, detail }
}

function Row({ label, val, dim }) {
  return (
    <div className="flex justify-between">
      <span className={dim ? 'text-[var(--text-4)]' : 'text-[var(--text-3)]'}>{label}</span>
      <span className={`font-semibold ${dim ? 'text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>{val}</span>
    </div>
  )
}

export default function NouvelleReservationPage() {
  const router = useRouter()

  const [form, setForm] = useState({
    client_id: '', chambre_id: '', date_arrivee: '', date_depart: '',
    nombre_adultes: 2, nombre_enfants: 0, source: 'direct',
    regime_repas: 'chambre_seule', notes_internes: ''
  })
  const [clientChoisi,   setClientChoisi]   = useState(null)
  const [chambreChoisie, setChambreChoisie] = useState(null)
  const [taxes,          setTaxes]          = useState([])
  const [saving,         setSaving]         = useState(false)

  // Modale active : null | 'client' | 'chambre'
  const [modale, setModale] = useState(null)

  // — État modale client
  const [clients,        setClients]        = useState([])
  const [clientsLoaded,  setClientsLoaded]  = useState(false)
  const [searchClient,   setSearchClient]   = useState('')
  const [onglet,         setOnglet]         = useState('chercher')
  const [formClient,     setFormClient]     = useState({ prenom:'', nom:'', email:'', telephone:'' })
  const [savingClient,   setSavingClient]   = useState(false)

  // — État modale chambre
  const [chambresDispos,  setChambresDispos]  = useState([])
  const [chambresLoading, setChambresLoading] = useState(false)

  useEffect(() => {
    facturationAPI.taxes()
      .then(r => {
        // Seules les taxes hébergement et "tout" s'appliquent à une réservation
        const taxesHotel = (r.data.taxes || []).filter(t =>
          t.s_applique_a === 'hebergement' || t.s_applique_a === 'tout'
        )
        setTaxes(taxesHotel)
      })
      .catch(() => {})
  }, [])

  const nuits = form.date_arrivee && form.date_depart
    ? Math.max(0, Math.round((new Date(form.date_depart) - new Date(form.date_arrivee)) / 86400000))
    : 0

  const totaux = chambreChoisie && nuits > 0
    ? calculerTaxes(chambreChoisie.tarif_base || 0, nuits, taxes)
    : { totalHT: 0, totalTaxes: 0, total: 0, detail: [] }

  // ── Modale client ─────────────────────────────────────────────────────────

  async function ouvrirModaleClient() {
    setModale('client')
    setOnglet('chercher')
    if (!clientsLoaded) {
      try {
        const r = await clientsAPI.lister({ limite: 300 })
        setClients(r.data.data || [])
        setClientsLoaded(true)
      } catch (err) {
        const detail = err?.response?.data?.erreur || err?.response?.status || err?.message || 'réseau'
        console.error('[ModaleClient] erreur:', err?.response?.status, err?.response?.data)
        toast.error(`Erreur clients : ${detail}`)
      }
    }
  }

  function selectionnerClient(c) {
    setClientChoisi(c)
    setForm(f => ({ ...f, client_id: c.id }))
    setModale(null)
    setSearchClient('')
  }

  async function creerClient(e) {
    e.preventDefault()
    if (!formClient.prenom || !formClient.nom || !formClient.email) {
      toast.error('Prénom, nom et email obligatoires')
      return
    }
    setSavingClient(true)
    try {
      const r = await clientsAPI.creer(formClient)
      const nouveau = r.data.client
      setClients(prev => [nouveau, ...prev])
      selectionnerClient(nouveau)
      toast.success('Client créé et sélectionné')
      setFormClient({ prenom:'', nom:'', email:'', telephone:'' })
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur création client')
    } finally { setSavingClient(false) }
  }

  // ── Modale chambre ────────────────────────────────────────────────────────

  async function ouvrirModaleChambre() {
    if (!form.date_arrivee || !form.date_depart) {
      toast.error('Choisissez d\'abord les dates d\'arrivée et de départ')
      return
    }
    setModale('chambre')
    setChambresLoading(true)
    try {
      const r = await chambresAPI.disponibles({
        date_arrivee: form.date_arrivee,
        date_depart:  form.date_depart,
      })
      setChambresDispos(r.data.chambres_disponibles || [])
    } catch (err) {
      const detail = err?.response?.data?.erreur || err?.response?.status || err?.message || 'réseau'
      console.error('[ModaleChambres] erreur:', err?.response?.status, err?.response?.data)
      toast.error(`Erreur chambres : ${detail}`)
    } finally { setChambresLoading(false) }
  }

  function selectionnerChambre(ch) {
    setChambreChoisie(ch)
    setForm(f => ({ ...f, chambre_id: ch.id }))
    setModale(null)
  }

  function changerDate(champ, valeur) {
    setForm(f => ({ ...f, [champ]: valeur, ...(chambreChoisie ? { chambre_id: '' } : {}) }))
    if (chambreChoisie) setChambreChoisie(null)
  }

  // ── Création réservation ──────────────────────────────────────────────────

  async function creerReservation(e) {
    e.preventDefault()
    if (!form.client_id)  return toast.error('Sélectionnez un client')
    if (!form.chambre_id) return toast.error('Sélectionnez une chambre')
    if (nuits <= 0)       return toast.error('Dates invalides')
    try {
      setSaving(true)
      const { data: created } = await reservationsAPI.creer({
        ...form,
        tarif_nuit:        chambreChoisie?.tarif_base || 0,
        total_hebergement: totaux.totalHT,
        total_general:     totaux.total,
        devise:            'XAF',
      })
      toast.success('Réservation créée !')
      router.push(`/reservations/${created.reservation.id}`)
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur création réservation')
    } finally { setSaving(false) }
  }

  const clientsFiltres = searchClient
    ? clients.filter(c => `${c.prenom} ${c.nom} ${c.email}`.toLowerCase().includes(searchClient.toLowerCase()))
    : clients

  return (
    <AppLayout titre="Nouvelle réservation" sousTitre="Créer une réservation">
      <form onSubmit={creerReservation} className="space-y-5">
        <div className="grid grid-cols-3 gap-5">

          {/* ── Colonne principale ── */}
          <div className="col-span-2 space-y-5">

            {/* Dates + options */}
            <div className="card p-5">
              <div className="card-title mb-4">📅 Séjour</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Arrivée *</label>
                  <input type="date" className="input" required value={form.date_arrivee}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={e => changerDate('date_arrivee', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Départ *</label>
                  <input type="date" className="input" required value={form.date_depart}
                    min={form.date_arrivee || new Date().toISOString().split('T')[0]}
                    onChange={e => changerDate('date_depart', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Adultes</label>
                  <input type="number" className="input" min="1" max="10" value={form.nombre_adultes}
                    onChange={e => setForm(f => ({...f, nombre_adultes: parseInt(e.target.value)}))} />
                </div>
                <div>
                  <label className="form-label">Enfants</label>
                  <input type="number" className="input" min="0" max="10" value={form.nombre_enfants}
                    onChange={e => setForm(f => ({...f, nombre_enfants: parseInt(e.target.value)}))} />
                </div>
                <div>
                  <label className="form-label">Source</label>
                  <select className="input" value={form.source}
                    onChange={e => setForm(f => ({...f, source: e.target.value}))}>
                    <option value="direct">Direct</option>
                    <option value="telephone">Téléphone</option>
                    <option value="ota">OTA (Booking.com, Expedia…)</option>
                    <option value="reception">Réception</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Régime repas</label>
                  <select className="input" value={form.regime_repas}
                    onChange={e => setForm(f => ({...f, regime_repas: e.target.value}))}>
                    <option value="chambre_seule">Chambre seule</option>
                    <option value="bb">Petit-déjeuner inclus</option>
                    <option value="demi_pension">Demi-pension</option>
                    <option value="pension_complete">Pension complète</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="form-label">Notes internes</label>
                  <input className="input" value={form.notes_internes}
                    placeholder="Notes pour l'équipe..."
                    onChange={e => setForm(f => ({...f, notes_internes: e.target.value}))} />
                </div>
              </div>
            </div>

            {/* Sélection client */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="card-title">👤 Client *</div>
                <button type="button" onClick={ouvrirModaleClient} className="btn btn-ghost btn-sm">
                  {clientChoisi ? '↩ Changer' : '＋ Sélectionner'}
                </button>
              </div>
              {clientChoisi ? (
                <div className="flex items-center gap-3 p-3 bg-[var(--bg-2)] rounded-xl border border-[var(--border-1)]">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {clientChoisi.prenom?.[0]}{clientChoisi.nom?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-[var(--text-1)]">{clientChoisi.prenom} {clientChoisi.nom}</div>
                    <div className="text-xs text-[var(--text-3)]">{clientChoisi.email}</div>
                    {clientChoisi.telephone && <div className="text-xs text-[var(--text-4)]">{clientChoisi.telephone}</div>}
                  </div>
                  {clientChoisi.segment === 'VIP' && <span className="badge badge-purple text-xs">⭐ VIP</span>}
                </div>
              ) : (
                <button type="button" onClick={ouvrirModaleClient}
                  className="w-full border-2 border-dashed border-[var(--border-1)] rounded-xl p-6 text-center text-xs text-[var(--text-3)] hover:border-blue-500/50 hover:text-blue-400 transition-colors">
                  Cliquez pour sélectionner ou créer un client
                </button>
              )}
            </div>

            {/* Sélection chambre */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="card-title">🛏 Chambre *</div>
                <button type="button" onClick={ouvrirModaleChambre}
                  disabled={!form.date_arrivee || !form.date_depart}
                  className="btn btn-ghost btn-sm disabled:opacity-40">
                  {chambreChoisie ? '↩ Changer' : '＋ Sélectionner'}
                </button>
              </div>
              {!form.date_arrivee || !form.date_depart ? (
                <div className="text-xs text-[var(--text-4)] text-center py-5">
                  Choisissez les dates d&apos;arrivée et de départ pour voir les chambres disponibles
                </div>
              ) : chambreChoisie ? (
                <div className="flex items-center gap-3 p-3 bg-[var(--bg-2)] rounded-xl border border-[var(--border-1)]">
                  <span className="text-2xl flex-shrink-0">🛏</span>
                  <div className="flex-1">
                    <div className="font-bold text-sm text-[var(--text-1)]">Chambre {chambreChoisie.numero}</div>
                    <div className="text-xs text-[var(--text-3)]">
                      {chambreChoisie.type_chambre} · Étage {chambreChoisie.etage}
                      {chambreChoisie.vue ? ` · ${chambreChoisie.vue}` : ''}
                    </div>
                    <div className="text-xs font-bold text-blue-400 mt-0.5">{fmt(chambreChoisie.tarif_base, 'XAF')}/nuit HT</div>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={ouvrirModaleChambre}
                  className="w-full border-2 border-dashed border-[var(--border-1)] rounded-xl p-6 text-center text-xs text-[var(--text-3)] hover:border-blue-500/50 hover:text-blue-400 transition-colors">
                  Cliquez pour sélectionner une chambre disponible
                </button>
              )}
            </div>
          </div>

          {/* ── Résumé ── */}
          <div>
            <div className="card p-4 sticky top-4 space-y-3 text-xs">
              <div className="card-title">📋 Résumé</div>
              <Row label="Arrivée" val={form.date_arrivee || '—'} />
              <Row label="Départ"  val={form.date_depart  || '—'} />
              <Row label="Nuits"   val={nuits || '—'} />
              {chambreChoisie && <Row label="Chambre" val={`Ch. ${chambreChoisie.numero}`} />}
              {chambreChoisie && <Row label="Tarif/nuit" val={`${fmt(chambreChoisie.tarif_base, 'XAF')} HT`} />}

              {nuits > 0 && chambreChoisie && (
                <>
                  <div className="border-t border-[var(--border-1)] pt-2">
                    <Row label="Hébergement HT" val={fmt(totaux.totalHT, 'XAF')} />
                  </div>
                  {totaux.detail.map(t => (
                    <Row key={t.nom} label={t.nom} val={`+ ${fmt(t.montant, 'XAF')}`} dim />
                  ))}
                  <div className="border-t border-[var(--border-1)] pt-2 flex justify-between font-bold">
                    <span className="text-[var(--text-1)] text-sm">Total TTC</span>
                    <span className="text-blue-400 text-sm">{fmt(totaux.total, 'XAF')}</span>
                  </div>
                </>
              )}

              <button type="submit"
                disabled={saving || !form.client_id || !form.chambre_id || nuits <= 0}
                className="btn btn-primary w-full btn-sm mt-2">
                {saving ? 'Création...' : '✅ Créer la réservation'}
              </button>
              <button type="button" onClick={() => router.back()} className="btn btn-ghost w-full btn-sm">
                Annuler
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* ════════════════════════════════════════════════════════
          MODALE CLIENT
      ════════════════════════════════════════════════════════ */}
      {modale === 'client' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setModale(null)} />
          <div className="relative bg-[var(--bg-1)] border border-[var(--border-1)] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{maxHeight:'82vh'}}>

            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-1)] flex-shrink-0">
              <div className="font-bold text-sm text-[var(--text-1)]">👤 Sélectionner un client</div>
              <button type="button" onClick={() => setModale(null)} className="btn btn-ghost btn-xs">✕</button>
            </div>

            <div className="flex border-b border-[var(--border-1)] flex-shrink-0">
              {[['chercher','🔍 Chercher'],['creer','＋ Créer']].map(([k,l]) => (
                <button key={k} type="button" onClick={() => setOnglet(k)}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)]'}`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {onglet === 'chercher' ? (
                <>
                  <input type="text" placeholder="Nom, prénom, email…" className="input mb-3 text-xs"
                    value={searchClient} autoFocus
                    onChange={e => setSearchClient(e.target.value)} />
                  {clientsFiltres.length === 0 ? (
                    <div className="text-center text-xs text-[var(--text-4)] py-8">
                      Aucun client — passez sur l&apos;onglet «&nbsp;Créer&nbsp;»
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {clientsFiltres.slice(0, 50).map(c => (
                        <button key={c.id} type="button" onClick={() => selectionnerClient(c)}
                          className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-[var(--bg-3)] transition-colors text-left">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                            {c.prenom?.[0]}{c.nom?.[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-[var(--text-1)] truncate">{c.prenom} {c.nom}</div>
                            <div className="text-[10px] text-[var(--text-3)] truncate">{c.email}</div>
                          </div>
                          {c.segment === 'VIP' && <span className="badge badge-purple text-[9px]">VIP</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <form onSubmit={creerClient} className="space-y-3">
                  {[['prenom','Prénom *','text'],['nom','Nom *','text'],['email','Email *','email'],['telephone','Téléphone','tel']].map(([f,l,t]) => (
                    <div key={f}>
                      <label className="form-label">{l}</label>
                      <input type={t} className="input text-xs" value={formClient[f]}
                        onChange={e => setFormClient(p => ({...p,[f]:e.target.value}))} />
                    </div>
                  ))}
                  <button type="submit" disabled={savingClient} className="btn btn-primary w-full btn-sm mt-3">
                    {savingClient ? 'Création…' : '＋ Créer et sélectionner'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          MODALE CHAMBRE
      ════════════════════════════════════════════════════════ */}
      {modale === 'chambre' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setModale(null)} />
          <div className="relative bg-[var(--bg-1)] border border-[var(--border-1)] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{maxHeight:'82vh'}}>

            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-1)] flex-shrink-0">
              <div>
                <div className="font-bold text-sm text-[var(--text-1)]">🛏 Chambres disponibles</div>
                <div className="text-xs text-[var(--text-3)]">
                  {form.date_arrivee} → {form.date_depart} · {nuits} nuit{nuits > 1 ? 's' : ''}
                </div>
              </div>
              <button type="button" onClick={() => setModale(null)} className="btn btn-ghost btn-xs">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {chambresLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : chambresDispos.length === 0 ? (
                <div className="text-center text-xs text-[var(--text-4)] py-12">
                  <div className="text-3xl mb-3">📅</div>
                  Aucune chambre disponible pour ces dates
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {chambresDispos.map(ch => (
                    <button key={ch.id} type="button" onClick={() => selectionnerChambre(ch)}
                      className="card p-4 text-left hover:border-blue-500 hover:bg-blue-500/5 transition-all">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-bold text-sm text-[var(--text-1)]">Ch. {ch.numero}</div>
                          <div className="text-xs text-[var(--text-3)]">{ch.type_chambre}</div>
                          <div className="text-[10px] text-[var(--text-4)]">Étage {ch.etage}{ch.vue ? ` · ${ch.vue}` : ''}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-blue-400 font-black text-sm">{fmt(ch.tarif_base, 'XAF')}</div>
                          <div className="text-[10px] text-[var(--text-4)]">/nuit HT</div>
                        </div>
                      </div>
                      {nuits > 0 && (
                        <div className="pt-2 mt-1 border-t border-[var(--border-1)] text-xs font-semibold text-[var(--text-2)]">
                          {nuits} nuit{nuits>1?'s':''} → {fmt(ch.tarif_base * nuits, 'XAF')} HT
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
