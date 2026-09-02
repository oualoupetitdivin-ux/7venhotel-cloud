'use client'
import { useState, useEffect, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { restaurantAPI } from '@/lib/api'
import { useAuthStore, fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

// Statuts réels en base — NE PAS changer
const STATUT_LABEL  = { nouvelle:'Nouvelle', en_preparation:'En préparation', prete:'Prête', servie:'Servie', annulee:'Annulée' }
const STATUT_COLOR  = { nouvelle:'badge-amber', en_preparation:'badge-blue', prete:'badge-green', servie:'badge-gray', annulee:'badge-red' }
const STATUT_NEXT   = { nouvelle:'en_preparation', en_preparation:'prete', prete:'servie' }
const STATUT_NEXT_L = { nouvelle:'▶ Préparer', en_preparation:'✅ Prête', prete:'🍽 Servir' }
const CATEGORIE_L   = { petit_dejeuner:'☀️ Petit-déj', entree:'🥗 Entrée', plat:'🍽 Plat', dessert:'🍰 Dessert', boisson:'🥤 Boisson' }
const MODE_PAIEMENT_L = { especes:'Espèces', carte:'Carte', mobile_money:'Mobile Money', virement:'Virement' }

// ─── Emoji encodé en préfixe de description "[EMOJI] texte" ──────────────────
function parseArticleEmoji(description) {
  if (!description) return { emoji: null, desc: '' }
  const m = description.match(/^\[(.{1,2})\] (.*)/)
  if (m) return { emoji: m[1], desc: m[2] }
  return { emoji: null, desc: description }
}

function duree(min) {
  if (min == null || isNaN(min)) return null
  const m = Math.round(min)
  if (m < 60) return `${m}min`
  return `${Math.floor(m/60)}h${(m%60).toString().padStart(2,'0')}`
}

function alerteMin(min, seuil) {
  if (min == null) return 'text-[var(--text-3)]'
  const m = Math.round(min)
  if (m > seuil * 1.5) return 'text-red-400'
  if (m > seuil) return 'text-amber-400'
  return 'text-emerald-400'
}

// ─── Modal détail commande ────────────────────────────────────────────────────
function ModalDetailCommande({ commande: c, onClose, onStatutChange, salleSeulement }) {
  if (!c) return null
  const fmtH = (d) => new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
  const fmtD = (d) => new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'})
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="card w-full max-w-md" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="card-header border-b border-[var(--border-1)]">
          <div>
            <div className="card-title">
              Table {c.numero_table || c.numero_chambre || '—'}
            </div>
            <div className="text-[10px] text-[var(--text-3)] mt-0.5">
              {c.numero_commande} · {fmtD(c.heure_commande)} à {fmtH(c.heure_commande)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${STATUT_COLOR[c.statut]}`}>{STATUT_LABEL[c.statut]}</span>
            <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text-1)] text-xl leading-none">×</button>
          </div>
        </div>

        {/* Lignes commande */}
        <div className="p-4 space-y-1 max-h-64 overflow-y-auto">
          {c.lignes?.length > 0 ? c.lignes.map((l, i) => {
            const { emoji: emLigne, desc: nomLigne } = parseArticleEmoji(l.nom_article || l.designation || '—')
            return (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-[var(--border-0)] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-400 w-5 text-center">{l.quantite}×</span>
                  {emLigne && <span className="text-sm">{emLigne}</span>}
                  <span className="text-xs text-[var(--text-1)]">{nomLigne}</span>
                </div>
                <span className="text-xs font-semibold text-[var(--text-1)] tabular-nums">{fmt(l.montant_total, c.devise || 'XAF')}</span>
              </div>
            )
          }) : (
            <div className="text-center text-xs text-[var(--text-3)] py-4">Aucun article</div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-1)] px-4 py-3 space-y-3">
          {c.notes && (
            <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
              ⚠ Note : {c.notes}
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-xs text-[var(--text-3)]">
              {c.minutes_depuis_commande != null && (
                <span>⏱ {duree(c.minutes_depuis_commande)} depuis commande</span>
              )}
            </div>
            <div className="text-sm font-black text-[var(--text-1)] tabular-nums">
              {fmt(c.total, c.devise || 'XAF')}
            </div>
          </div>
          {STATUT_NEXT[c.statut] && (!salleSeulement || c.statut === 'prete') && (
            <button onClick={() => { onStatutChange(c.id, STATUT_NEXT[c.statut]); onClose() }}
              className="btn btn-primary btn-sm w-full">
              {STATUT_NEXT_L[c.statut]}
            </button>
          )}
          {['nouvelle', 'en_preparation'].includes(c.statut) && (
            <button onClick={() => { onStatutChange(c.id, 'annulee'); onClose() }}
              className="btn btn-sm btn-danger w-full">
              ✕ Annuler la commande
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function TimerBadge({ minutes, seuil, label }) {
  if (minutes == null) return null
  const m = Math.round(minutes)
  const col = m > seuil * 1.5 ? 'bg-red-500/20 text-red-400 border-red-500/30'
            : m > seuil ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${col}`}>
      ⏱ {duree(m)} {label}
    </span>
  )
}

// ─── Onglet Salle (prise de commande + suivi) ──────────────────────────────
function OngletSalle({ menu, commandes, charger }) {
  const [panier, setPanier]         = useState([])
  const [table,  setTable]          = useState('')
  const [notes,  setNotes]          = useState('')
  const [view,   setView]           = useState('active') // 'active' | 'nouvelle'
  const [saving, setSaving]         = useState(false)
  const [detailCommande, setDetail] = useState(null)

  // Mode hébergement vs de passage
  const [modeClient,    setModeClient]    = useState('passage')   // 'passage' | 'hebergement'
  const [modePaiement,  setModePaiement]  = useState('especes')   // pour walk_in
  const [reservations,  setReservations]  = useState([])
  const [reservationId, setReservationId] = useState('')
  const [resvLoading,   setResvLoading]   = useState(false)

  useEffect(() => {
    if (modeClient !== 'hebergement') return
    setResvLoading(true)
    restaurantAPI.reservationsActives()
      .then(r => setReservations(r.data.reservations || []))
      .catch(() => toast.error('Erreur chargement réservations'))
      .finally(() => setResvLoading(false))
  }, [modeClient])

  const menuParCat = menu.reduce((acc, a) => {
    if (!acc[a.categorie]) acc[a.categorie] = []
    acc[a.categorie].push(a); return acc
  }, {})

  function ajouterPanier(art) {
    setPanier(p => {
      const ex = p.find(x => x.id === art.id)
      if (ex) return p.map(x => x.id === art.id ? { ...x, qte: x.qte + 1 } : x)
      return [...p, { ...art, qte: 1 }]
    })
  }

  function modifierQte(id, delta) {
    setPanier(p => p.map(x => x.id === id ? { ...x, qte: Math.max(0, x.qte + delta) } : x).filter(x => x.qte > 0))
  }

  const totalPanier = panier.reduce((s, p) => s + p.prix * p.qte, 0)

  async function passerCommande() {
    if (!panier.length) return toast.error('Panier vide')

    if (modeClient === 'hebergement') {
      if (!reservationId) return toast.error('Sélectionnez une réservation')
    } else {
      if (!table) return toast.error('Numéro de table requis')
    }

    const resv = reservations.find(r => r.id === reservationId)
    const payload = modeClient === 'hebergement'
      ? {
          type_client:    'hebergement',
          mode_reglement: 'chambre',
          reservation_id: reservationId,
          numero_chambre: resv?.numero_chambre || '',
          total: totalPanier,
          notes:  notes || undefined,
          lignes: panier.map(p => ({ article_id: p.id, quantite: p.qte, prix_unitaire: p.prix, montant_total: p.prix * p.qte, nom_article: p.nom })),
        }
      : {
          type_client:    'walk_in',
          mode_reglement: 'immediat',
          mode_paiement:  modePaiement,
          numero_table:   table,
          total: totalPanier,
          notes:  notes || undefined,
          lignes: panier.map(p => ({ article_id: p.id, quantite: p.qte, prix_unitaire: p.prix, montant_total: p.prix * p.qte, nom_article: p.nom })),
        }

    try {
      setSaving(true)
      await restaurantAPI.creerCommande(payload)
      const label = modeClient === 'hebergement'
        ? `Chambre ${resv?.numero_chambre || ''} — ${resv?.nom_client || ''}`
        : `Table ${table}`
      toast.success(`Commande ${label} envoyée en cuisine`)
      setPanier([])
      setTable('')
      setNotes('')
      setReservationId('')
      setView('active')
      charger()
    } catch (e) {
      toast.error(e?.response?.data?.erreur || 'Erreur commande')
    } finally { setSaving(false) }
  }

  async function changerStatut(id, statut) {
    try {
      const { data } = await restaurantAPI.changerStatut(id, { statut })
      const cmd = data.commande
      if (statut === 'servie' && cmd?.mode_reglement === 'immediat') {
        const moyen = MODE_PAIEMENT_L[cmd.mode_paiement] || cmd.mode_paiement || 'paiement'
        toast.success(`✅ Table ${cmd.numero_table || cmd.numero_chambre || ''} servie — ${moyen} encaissé`)
      } else {
        toast.success('Commande mise à jour')
      }
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
  }

  const actives = commandes.filter(c => !['servie','annulee'].includes(c.statut))

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[['active',`📋 Commandes actives (${actives.length})`],['nouvelle','＋ Nouvelle commande']].map(([k,l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${view===k ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'border-[var(--border-1)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
            {l}
          </button>
        ))}
      </div>

      {view === 'active' && (
        <div className="space-y-3">
          {actives.length === 0 ? (
            <div className="card p-10 text-center">
              <div className="text-4xl mb-3 opacity-30">🍽</div>
              <div className="text-sm text-[var(--text-3)] font-semibold">Aucune commande active</div>
            </div>
          ) : actives.map(c => (
            <div key={c.id} className="card p-4 cursor-pointer hover:border-blue-500/30 transition-colors"
              onClick={() => setDetail(c)}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-bold text-[var(--text-1)]">Table {c.numero_table || c.numero_chambre || '—'}</div>
                  <div className="text-[10px] text-[var(--text-3)]">{c.numero_commande} · {new Date(c.heure_commande).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className={`badge ${STATUT_COLOR[c.statut]}`}>{STATUT_LABEL[c.statut]}</span>
                  <span className="font-black text-sm text-[var(--text-1)]">{fmt(c.total, c.devise || 'XAF')}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {c.statut === 'nouvelle' && (
                  <TimerBadge minutes={c.minutes_depuis_commande} seuil={10} label="d'attente" />
                )}
                {c.statut === 'en_preparation' && (
                  <TimerBadge minutes={c.minutes_en_preparation} seuil={20} label="en prép." />
                )}
                <span className="text-[9px] text-[var(--text-3)] ml-auto">Cliquer pour détails →</span>
              </div>

              {c.statut === 'prete' && (
                <button
                  onClick={e => { e.stopPropagation(); changerStatut(c.id, 'servie') }}
                  className="btn btn-sm btn-primary text-xs">
                  🍽 Servir
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {detailCommande && (
        <ModalDetailCommande
          commande={detailCommande}
          onClose={() => setDetail(null)}
          onStatutChange={(id, s) => { changerStatut(id, s); setDetail(null) }}
          salleSeulement
        />
      )}

      {view === 'nouvelle' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2 space-y-4">
            {Object.entries(menuParCat).map(([cat, articles]) => (
              <div key={cat}>
                <div className="text-xs font-bold text-[var(--text-2)] uppercase tracking-wider mb-2">
                  {CATEGORIE_L[cat] || cat}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {articles.filter(a => a.disponible).map(a => {
                    const inPanier = panier.find(p => p.id === a.id)
                    const { emoji, desc } = parseArticleEmoji(a.description)
                    return (
                      <div key={a.id}
                        className={`card p-3 cursor-pointer hover:border-blue-500/40 transition-all ${inPanier ? 'border-blue-500/40 bg-blue-500/5' : ''}`}
                        onClick={() => ajouterPanier(a)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {emoji && <span className="text-base flex-shrink-0">{emoji}</span>}
                              <span className="text-xs font-semibold text-[var(--text-1)] truncate">{a.nom}</span>
                            </div>
                            {desc && <div className="text-[10px] text-[var(--text-2)] line-clamp-1 mt-0.5">{desc}</div>}
                            <div className="text-xs font-bold text-blue-400 mt-1">{fmt(a.prix, a.devise || 'XAF')}</div>
                          </div>
                          {inPanier ? (
                            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                              <button onClick={() => modifierQte(a.id, -1)} className="w-5 h-5 rounded-full bg-[var(--bg-3)] text-xs hover:bg-red-500/20 hover:text-red-400 transition-colors">−</button>
                              <span className="text-xs font-bold text-blue-400 w-4 text-center">{inPanier.qte}</span>
                              <button onClick={() => modifierQte(a.id, +1)} className="w-5 h-5 rounded-full bg-[var(--bg-3)] text-xs hover:bg-blue-500/20 hover:text-blue-400 transition-colors">＋</button>
                            </div>
                          ) : (
                            <button className="btn btn-xs btn-primary flex-shrink-0">＋</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {Object.keys(menuParCat).length === 0 && (
              <div className="card p-8 text-center text-[var(--text-3)] text-xs">Menu vide — configurez les articles depuis les paramètres</div>
            )}
          </div>

          {/* Panier */}
          <div className="card p-4 h-fit sticky top-4 space-y-3">
            <div className="font-bold text-sm text-[var(--text-1)]">🛒 Commande</div>

            {/* Toggle mode client */}
            <div className="flex rounded-lg overflow-hidden border border-[var(--border-1)]">
              {[['passage','🚶 De passage'],['hebergement','🛏 Hébergement']].map(([k,l]) => (
                <button key={k} onClick={() => setModeClient(k)}
                  className={`flex-1 text-[10px] font-bold py-1.5 transition-colors ${modeClient===k ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* Champs selon mode */}
            {modeClient === 'passage' ? (
              <div className="space-y-2">
                <div>
                  <label className="form-label">Table N°</label>
                  <input className="input" placeholder="ex: 5" value={table}
                    onChange={e => setTable(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Moyen de paiement</label>
                  <select className="input" value={modePaiement} onChange={e => setModePaiement(e.target.value)}>
                    <option value="especes">💵 Espèces</option>
                    <option value="carte">💳 Carte</option>
                    <option value="mobile_money">📱 Mobile Money</option>
                  </select>
                </div>
              </div>
            ) : (
              <div>
                <label className="form-label">Réservation active</label>
                {resvLoading ? (
                  <div className="text-xs text-[var(--text-3)] py-2">Chargement…</div>
                ) : reservations.length === 0 ? (
                  <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg p-2">
                    Aucune réservation active (arrivée / en cours)
                  </div>
                ) : (
                  <select className="input" value={reservationId} onChange={e => setReservationId(e.target.value)}>
                    <option value="">— Sélectionner —</option>
                    {reservations.map(r => (
                      <option key={r.id} value={r.id}>
                        Ch. {r.numero_chambre} — {r.nom_client}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Notes cuisine */}
            <div>
              <label className="form-label">Notes cuisine</label>
              <textarea className="input" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="ex: sans oignons, allergie noix..." />
            </div>

            {/* Articles du panier */}
            {panier.length === 0 ? (
              <div className="text-center text-xs text-[var(--text-2)] py-4 border border-dashed border-[var(--border-1)] rounded-lg">
                Cliquez sur un article pour l'ajouter
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {panier.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => modifierQte(p.id, -1)} className="w-5 h-5 rounded bg-[var(--bg-3)] text-xs">−</button>
                      <span className="text-xs font-bold w-4 text-center">{p.qte}</span>
                      <button onClick={() => modifierQte(p.id, +1)} className="w-5 h-5 rounded bg-[var(--bg-3)] text-xs">＋</button>
                    </div>
                    <span className="flex-1 text-xs truncate">{p.nom}</span>
                    <span className="text-xs font-semibold flex-shrink-0">{fmt(p.prix*p.qte,'XAF')}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-[var(--border-1)] pt-3 flex justify-between">
              <span className="text-xs font-bold">Total</span>
              <span className="font-bold text-blue-400">{fmt(totalPanier,'XAF')}</span>
            </div>

            {modeClient === 'hebergement' && reservationId && (
              <div className="text-[10px] text-emerald-400 bg-emerald-500/10 rounded-lg px-2 py-1.5">
                ✓ Ajouté au folio chambre au passage en "Servie"
              </div>
            )}

            <button onClick={passerCommande} disabled={!panier.length || saving}
              className="btn btn-primary w-full btn-sm">
              {saving ? '…' : 'Envoyer en cuisine →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Onglet Cuisine ────────────────────────────────────────────────────────
function OngletCuisine({ charger }) {
  const [cuisine, setCuisine] = useState({ nouvelle:[], en_preparation:[], prete:[] })
  const [loading, setLoading] = useState(true)

  const chargerCuisine = useCallback(async () => {
    try {
      const res = await restaurantAPI.cuisine()
      setCuisine(res.data.cuisine || { nouvelle:[], en_preparation:[], prete:[] })
    } catch { /* silencieux */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    chargerCuisine()
    const t = setInterval(chargerCuisine, 20000)
    return () => clearInterval(t)
  }, [chargerCuisine])

  async function avancer(id, statut) {
    try {
      await restaurantAPI.changerStatut(id, { statut })
      chargerCuisine()
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
  }

  const cols = [
    { key: 'nouvelle',       label: 'Nouvelles',       color: 'bg-amber-500/10 border-amber-500/30 text-amber-400',   seuil: 5,  next: 'en_preparation', nextL: '▶ Préparer' },
    { key: 'en_preparation', label: 'En préparation',  color: 'bg-blue-500/10 border-blue-500/30 text-blue-400',      seuil: 20, next: 'prete',           nextL: '✅ Prête' },
    { key: 'prete',          label: 'Prêtes à servir', color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', seuil: 5, next: 'servie',       nextL: '🍽 Servie' },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {cols.map(col => (
        <div key={col.key} className="flex-1 min-w-[220px]">
          <div className={`flex items-center justify-between mb-3 px-3 py-2 rounded-xl border ${col.color}`}>
            <span className="text-xs font-bold">{col.label}</span>
            <span className="text-xs opacity-70 font-mono">{cuisine[col.key]?.length || 0}</span>
          </div>
          <div className="space-y-3">
            {(cuisine[col.key] || []).map(c => {
              const minCom = c.minutes_depuis_commande
              const minPrep = c.minutes_en_preparation
              return (
                <div key={c.id} className="bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-bold text-sm text-[var(--text-1)]">Table {c.numero_table || c.numero_chambre || '—'}</div>
                      <div className="text-[9px] text-[var(--text-4)] font-mono">{c.numero_commande}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-xs text-[var(--text-2)]">{fmt(c.total, c.devise || 'XAF')}</div>
                      <div className="text-[9px] text-[var(--text-4)]">
                        {new Date(c.heure_commande).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
                      </div>
                    </div>
                  </div>

                  {/* Timer */}
                  <div className="mb-2 flex gap-1 flex-wrap">
                    {col.key === 'nouvelle' && <TimerBadge minutes={minCom} seuil={col.seuil} label="d'attente" />}
                    {col.key === 'en_preparation' && <TimerBadge minutes={minPrep} seuil={col.seuil} label="en prép." />}
                    {col.key === 'prete' && <TimerBadge minutes={minCom} seuil={30} label="total" />}
                  </div>

                  {/* Lignes */}
                  {c.lignes?.length > 0 && (
                    <div className="space-y-0.5 mb-2">
                      {c.lignes.map((l, i) => {
                        const { emoji: emK, desc: nomK } = parseArticleEmoji(l.nom_article || l.designation || '')
                        return (
                          <div key={i} className="flex justify-between text-[10px] text-[var(--text-2)]">
                            <span>{l.quantite}× {emK ? `${emK} ` : ''}{nomK}</span>
                            <span className="text-[var(--text-3)]">{fmt(l.montant_total, c.devise || 'XAF')}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {c.notes && <div className="text-[9px] text-amber-400 mb-2">⚠️ {c.notes}</div>}

                  <button onClick={() => avancer(c.id, col.next)}
                    className="w-full text-[10px] font-semibold py-1.5 rounded-lg bg-[var(--bg-3)] hover:bg-blue-500/20 text-[var(--text-2)] hover:text-blue-400 transition-colors">
                    {col.nextL} →
                  </button>
                </div>
              )
            })}
            {(!cuisine[col.key] || cuisine[col.key].length === 0) && (
              <div className="text-center text-[10px] text-[var(--text-4)] py-6 border border-dashed border-[var(--border-1)] rounded-xl">
                Aucune commande
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Onglet Performance ────────────────────────────────────────────────────
function OngletPerformance() {
  const [perf, setPerf]       = useState(null)
  const [date, setDate]       = useState(new Date().toISOString().slice(0,10))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    restaurantAPI.performance(date)
      .then(r => setPerf(r.data))
      .catch(() => toast.error('Erreur chargement performance'))
      .finally(() => setLoading(false))
  }, [date])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
    </div>
  )

  const s = perf?.stats || {}
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--text-3)]">Date :</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="input w-auto" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Commandes</div>
          <div className="kpi-value">{s.total || 0}</div>
          <div className="text-[9px] text-[var(--text-4)] mt-1">{s.servies || 0} servies · {s.annulees || 0} annulées</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Attente préparation</div>
          <div className={`kpi-value ${alerteMin(s.avg_attente_preparation_min, 8)}`}>
            {duree(s.avg_attente_preparation_min) || '—'}
          </div>
          <div className="text-[9px] text-[var(--text-4)] mt-1">Commande → prise en charge cuisine</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Temps préparation</div>
          <div className={`kpi-value ${alerteMin(s.avg_preparation_min, 20)}`}>
            {duree(s.avg_preparation_min) || '—'}
          </div>
          <div className="text-[9px] text-[var(--text-4)] mt-1">Cuisine → prêt</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Temps total service</div>
          <div className={`kpi-value ${alerteMin(s.avg_total_min, 35)}`}>
            {duree(s.avg_total_min) || '—'}
          </div>
          <div className="text-[9px] text-[var(--text-4)] mt-1">Commande → servi</div>
        </div>
      </div>

      {/* Chiffre d'affaires */}
      <div className="grid grid-cols-2 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">Chiffre d'affaires</div>
          <div className="kpi-value text-emerald-400">{s.chiffre_affaires ? fmt(s.chiffre_affaires,'XAF') : '—'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Panier moyen</div>
          <div className="kpi-value text-blue-400">{s.panier_moyen ? fmt(s.panier_moyen,'XAF') : '—'}</div>
        </div>
      </div>

      {/* Par serveur */}
      {perf?.parServeur?.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-bold text-[var(--text-1)] mb-3">Performance par serveur</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-4)] uppercase text-[9px] tracking-wide border-b border-[var(--border-1)]">
                  <th className="text-left pb-2">Serveur</th>
                  <th className="text-center pb-2">Commandes</th>
                  <th className="text-center pb-2">Servies</th>
                  <th className="text-center pb-2">CA</th>
                  <th className="text-center pb-2">Temps moyen</th>
                </tr>
              </thead>
              <tbody>
                {perf.parServeur.map((sv, i) => (
                  <tr key={i} className="border-b border-[var(--border-1)]/50">
                    <td className="py-2.5 font-semibold text-[var(--text-1)]">{sv.nom_serveur || 'Inconnu'}</td>
                    <td className="text-center py-2.5 text-[var(--text-2)]">{sv.commandes}</td>
                    <td className="text-center py-2.5 text-emerald-400 font-semibold">{sv.servies}</td>
                    <td className="text-center py-2.5 font-bold text-[var(--text-1)]">{sv.ca ? fmt(sv.ca,'XAF') : '—'}</td>
                    <td className={`text-center py-2.5 font-mono ${alerteMin(sv.avg_service, 35)}`}>
                      {duree(sv.avg_service) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trend 7 jours */}
      {perf?.trend?.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-bold text-[var(--text-1)] mb-3">Tendance 7 jours</div>
          <div className="flex items-end gap-2 h-24">
            {perf.trend.map((j, i) => {
              const max = Math.max(...perf.trend.map(x => x.total || 0), 1)
              const pct = Math.round(((j.total || 0) / max) * 100)
              const pctS = j.total > 0 ? Math.round(((j.servies || 0) / j.total) * 100) : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[8px] text-[var(--text-4)]">{j.ca ? fmt(j.ca,'XAF') : '—'}</div>
                  <div className="w-full relative flex flex-col justify-end" style={{ height: '52px' }}>
                    <div className="w-full bg-[var(--bg-3)] rounded-t" style={{ height: `${pct}%` }}>
                      <div className="w-full bg-blue-500/60 rounded-t" style={{ height: `${pctS}%` }} />
                    </div>
                  </div>
                  <div className="text-[8px] text-[var(--text-4)]">
                    {j.jour ? new Date(j.jour).toLocaleDateString('fr-FR', { weekday: 'short' }) : '—'}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 mt-2 text-[9px] text-[var(--text-4)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--bg-3)] inline-block"/>Total</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/60 inline-block"/>Servies</span>
          </div>
        </div>
      )}

      {!s.total && (
        <div className="card p-10 text-center text-[var(--text-3)]">
          <div className="text-4xl mb-3 opacity-30">📊</div>
          <div className="font-semibold">Aucune commande pour cette date</div>
        </div>
      )}
    </div>
  )
}

// ─── Onglet Menu (gestion articles) ───────────────────────────────────────
const CATEGORIES_MENU = ['Petit-déjeuner', 'Entrées', 'Plats', 'Desserts', 'Boissons', 'Autre']

function OngletMenu({ menu, onArticleCree }) {
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState({ nom: '', prix: '', categorie: 'Plats', description: '', emoji: '' })

  function setF(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function creer(e) {
    e.preventDefault()
    if (!form.nom.trim() || !form.prix) return toast.error('Nom et prix requis')
    setSaving(true)
    try {
      await restaurantAPI.creerArticle({
        nom:         form.nom.trim(),
        prix:        parseFloat(form.prix),
        categorie:   form.categorie,
        description: form.description.trim() || undefined,
        emoji:       form.emoji.trim() || undefined,
      })
      toast.success('Article ajouté au menu')
      setForm({ nom: '', prix: '', categorie: 'Plats', description: '', emoji: '' })
      setShowForm(false)
      if (onArticleCree) onArticleCree()
    } catch (e) {
      toast.error(e?.response?.data?.erreur || 'Erreur création article')
    } finally { setSaving(false) }
  }

  // Grouper articles par catégorie
  const parCat = menu.reduce((acc, a) => {
    const k = a.categorie || 'Autre'
    if (!acc[k]) acc[k] = []
    acc[k].push(a)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-[var(--text-1)]">{menu.length} article{menu.length > 1 ? 's' : ''} au menu</div>
        <button onClick={() => setShowForm(v => !v)} className="btn btn-primary btn-sm">
          {showForm ? '✕ Annuler' : '＋ Nouvel article'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={creer} className="card p-4 space-y-3 border-blue-500/30">
          <div className="text-xs font-bold text-[var(--text-1)] mb-1">Nouvel article</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Emoji</label>
              <input className="input text-center text-lg" maxLength={2} placeholder="🍽"
                value={form.emoji} onChange={e => setF('emoji', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Catégorie</label>
              <select className="input" value={form.categorie} onChange={e => setF('categorie', e.target.value)}>
                {CATEGORIES_MENU.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Nom de l'article *</label>
            <input className="input" placeholder="ex: Entrecôte grillée" value={form.nom}
              onChange={e => setF('nom', e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Prix (XAF) *</label>
              <input className="input" type="number" min="0" placeholder="0" value={form.prix}
                onChange={e => setF('prix', e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Description</label>
              <input className="input" placeholder="Herbes fraîches, tomates…" value={form.description}
                onChange={e => setF('description', e.target.value)} />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn btn-primary w-full btn-sm">
            {saving ? '…' : 'Ajouter au menu →'}
          </button>
        </form>
      )}

      {/* Liste articles par catégorie */}
      {Object.entries(parCat).map(([cat, arts]) => (
        <div key={cat}>
          <div className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">{cat}</div>
          <div className="space-y-1">
            {arts.map(a => {
              const { emoji, desc } = parseArticleEmoji(a.description)
              return (
                <div key={a.id} className="card p-3 flex items-center gap-3">
                  {emoji ? (
                    <span className="text-xl w-8 text-center flex-shrink-0">{emoji}</span>
                  ) : (
                    <span className="text-xl w-8 text-center flex-shrink-0 text-[var(--text-4)]">—</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-1)]">{a.nom}</div>
                    {desc && <div className="text-[10px] text-[var(--text-3)] truncate">{desc}</div>}
                  </div>
                  <div className="text-xs font-bold text-blue-400 flex-shrink-0">{fmt(a.prix, a.devise || 'XAF')}</div>
                  <div className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${a.disponible ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {a.disponible ? 'Dispo' : 'Indispo'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {menu.length === 0 && (
        <div className="card p-10 text-center text-[var(--text-3)]">
          <div className="text-4xl mb-3 opacity-30">🍽</div>
          <div className="text-sm font-semibold">Aucun article au menu</div>
          <div className="text-xs mt-1">Cliquez sur "Nouvel article" pour commencer</div>
        </div>
      )}
    </div>
  )
}

// ─── Page principale ───────────────────────────────────────────────────────
export default function RestaurantPage() {
  const { user } = useAuthStore()
  const [onglet,   setOnglet]   = useState('salle')
  const [menu,     setMenu]     = useState([])
  const [commandes,setCommandes]= useState([])
  const [loading,  setLoading]  = useState(true)

  const charger = useCallback(async () => {
    try {
      const [menuR, cmdR] = await Promise.allSettled([
        restaurantAPI.menu(),
        restaurantAPI.commandes(),
      ])
      if (menuR.status === 'fulfilled') setMenu(menuR.value.data.articles || [])
      if (cmdR.status === 'fulfilled')  setCommandes(cmdR.value.data.commandes || [])
    } catch { toast.error('Erreur chargement restaurant') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { charger() }, [charger])

  // Auto-refresh salle toutes les 30s
  useEffect(() => {
    if (onglet !== 'salle') return
    const t = setInterval(charger, 30000)
    return () => clearInterval(t)
  }, [onglet, charger])

  const actives = commandes.filter(c => !['servie','annulee'].includes(c.statut))

  return (
    <AppLayout titre="Restaurant" sousTitre="Service & cuisine">
      <div className="space-y-5">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="kpi-card">
            <div className="kpi-label">Commandes actives</div>
            <div className={`kpi-value ${actives.length > 0 ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>{actives.length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">En préparation</div>
            <div className="kpi-value text-blue-400">{commandes.filter(c => c.statut === 'en_preparation').length}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Prêtes à servir</div>
            <div className={`kpi-value ${commandes.filter(c => c.statut === 'prete').length > 0 ? 'text-emerald-400' : 'text-[var(--text-3)]'}`}>
              {commandes.filter(c => c.statut === 'prete').length}
            </div>
          </div>
        </div>

        {/* Onglets */}
        <div className="flex gap-1 border-b border-[var(--border-1)]">
          {[['salle','🍽 Salle'],['cuisine','👨‍🍳 Cuisine'],['performance','📊 Performance'],['menu','📋 Menu']].map(([k,l]) => (
            <button key={k} onClick={() => setOnglet(k)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
              {l}
              {k==='cuisine' && commandes.filter(c=>c.statut==='nouvelle').length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[9px] font-black rounded-full bg-amber-500 text-white">
                  {commandes.filter(c=>c.statut==='nouvelle').length}
                </span>
              )}
            </button>
          ))}
          <div className="flex-1"/>
          <button onClick={charger} className="btn btn-ghost btn-sm text-xs self-end mb-1">↻</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : onglet === 'salle' ? (
          <OngletSalle menu={menu} commandes={commandes} charger={charger} />
        ) : onglet === 'cuisine' ? (
          <OngletCuisine charger={charger} />
        ) : onglet === 'menu' ? (
          <OngletMenu menu={menu} onArticleCree={charger} />
        ) : (
          <OngletPerformance />
        )}
      </div>
    </AppLayout>
  )
}
