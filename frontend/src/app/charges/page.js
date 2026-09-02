'use client'
import { useState, useEffect, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { chargesAPI } from '@/lib/api'
import { useAuthStore, fmt, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_META = {
  saisie:  { label: 'En attente', cls: 'badge-amber', icon: '⏳' },
  validee: { label: 'Validée',    cls: 'badge-blue',  icon: '✔' },
  payee:   { label: 'Payée',      cls: 'badge-green', icon: '✅' },
}

function debutDuMoisISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function aujourdhuiISO() {
  return new Date().toISOString().slice(0, 10)
}

// ── Modal : nouvelle / modifier charge ───────────────────────────────────────
function ModalCharge({ charge, categories, onClose, onSuccess, onCategorieCreee }) {
  const estModification = !!charge
  const [form, setForm] = useState({
    categorie_id: charge?.categorie_id || '',
    libelle:      charge?.libelle || '',
    montant:      charge?.montant || '',
    date_charge:  charge?.date_charge?.slice(0, 10) || aujourdhuiISO(),
    notes:        charge?.notes || '',
  })
  const [nouvelleCategorie, setNouvelleCategorie] = useState('')
  const [ajoutCategorie, setAjoutCategorie] = useState(false)
  const [saving, setSaving] = useState(false)

  async function creerCategorie() {
    if (!nouvelleCategorie.trim()) return
    try {
      const { data } = await chargesAPI.creerCategorie({ nom: nouvelleCategorie.trim() })
      onCategorieCreee(data.categorie)
      setForm(f => ({ ...f, categorie_id: data.categorie.id }))
      setNouvelleCategorie('')
      setAjoutCategorie(false)
      toast.success('Catégorie créée')
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.libelle.trim()) return toast.error('Libellé requis')
    if (!form.montant || Number(form.montant) <= 0) return toast.error('Montant requis')
    try {
      setSaving(true)
      const payload = { ...form, categorie_id: form.categorie_id || null, montant: Number(form.montant) }
      const { data } = estModification
        ? await chargesAPI.modifier(charge.id, payload)
        : await chargesAPI.creer(payload)
      toast.success(data.message)
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box max-w-md">
        <div className="modal-header">
          <h3 className="font-bold text-[var(--text-1)]">{estModification ? 'Modifier la charge' : '+ Nouvelle charge'}</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-3">
            <div>
              <label className="form-label">Libellé</label>
              <input className="input" value={form.libelle}
                onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
                placeholder="Ex : Facture électricité août" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Montant (XAF)</label>
                <input type="number" className="input" value={form.montant} min="1"
                  onChange={e => setForm(f => ({ ...f, montant: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Date</label>
                <input type="date" className="input" value={form.date_charge}
                  onChange={e => setForm(f => ({ ...f, date_charge: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">Catégorie</label>
              {!ajoutCategorie ? (
                <div className="flex gap-2">
                  <select className="input flex-1" value={form.categorie_id}
                    onChange={e => setForm(f => ({ ...f, categorie_id: e.target.value }))}>
                    <option value="">— Aucune —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.icone ? `${c.icone} ` : ''}{c.nom}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => setAjoutCategorie(true)}
                    className="btn btn-ghost btn-sm text-xs whitespace-nowrap">+ Catégorie</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input className="input flex-1" value={nouvelleCategorie}
                    onChange={e => setNouvelleCategorie(e.target.value)}
                    placeholder="Nom de la nouvelle catégorie" />
                  <button type="button" onClick={creerCategorie} className="btn btn-primary btn-sm text-xs">Créer</button>
                  <button type="button" onClick={() => setAjoutCategorie(false)} className="btn btn-ghost btn-sm text-xs">✕</button>
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Notes</label>
              <textarea className="input" rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : estModification ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Page principale ────────────────────────────────────────────────────────
export default function ChargesPage() {
  const { user } = useAuthStore()
  const peutGerer  = user?.role === 'manager'
  const peutValider = ['manager', 'comptabilite'].includes(user?.role)
  const accesAutorise = ['manager', 'comptabilite'].includes(user?.role)

  const [charges,    setCharges]    = useState([])
  const [categories, setCategories] = useState([])
  const [kpis,       setKpis]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [modalCharge, setModalCharge] = useState(null)
  const [modalOuvert, setModalOuvert] = useState(false)

  const [filtres, setFiltres] = useState({ categorie_id: '', statut: '', debut: '', fin: '' })

  const charger = useCallback(async () => {
    if (!accesAutorise) { setLoading(false); return }
    try {
      const debutMois = debutDuMoisISO(), finMois = aujourdhuiISO()
      const [listeRes, totauxRes, valideesRes, attenteRes, categoriesRes] = await Promise.allSettled([
        chargesAPI.lister({
          ...(filtres.categorie_id ? { categorie_id: filtres.categorie_id } : {}),
          ...(filtres.statut ? { statut: filtres.statut } : {}),
          ...(filtres.debut ? { debut: filtres.debut } : {}),
          ...(filtres.fin ? { fin: filtres.fin } : {}),
          limite: 100,
        }),
        chargesAPI.totaux({ debut: debutMois, fin: finMois }),
        chargesAPI.lister({ debut: debutMois, fin: finMois, statut: 'validee', limite: 1 }),
        chargesAPI.lister({ debut: debutMois, fin: finMois, statut: 'saisie',  limite: 1 }),
        chargesAPI.categories(),
      ])

      if (listeRes.status === 'fulfilled') setCharges(listeRes.value.data.data || [])
      if (categoriesRes.status === 'fulfilled') setCategories(categoriesRes.value.data.categories || [])

      const totaux    = totauxRes.status === 'fulfilled' ? totauxRes.value.data : null
      const validees  = valideesRes.status === 'fulfilled' ? valideesRes.value.data.pagination.total : 0
      const enAttente = attenteRes.status === 'fulfilled' ? attenteRes.value.data.pagination.total : 0

      setKpis({
        charges_mois: totaux?.total_charges || 0,
        validees, enAttente,
        solde_pl: totaux?.solde_pl ?? 0,
        par_categorie: totaux?.par_categorie || [],
      })
    } catch { toast.error('Erreur chargement charges') }
    finally { setLoading(false) }
  }, [filtres, accesAutorise])

  useEffect(() => { charger() }, [charger])

  function onSuccess() {
    setModalCharge(null)
    setModalOuvert(false)
    charger()
  }

  async function valider(c) {
    try {
      const { data } = await chargesAPI.valider(c.id)
      toast.success(data.message)
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
  }

  async function supprimer(c) {
    if (!confirm(`Supprimer la charge "${c.libelle}" ?`)) return
    try {
      const { data } = await chargesAPI.supprimer(c.id)
      toast.success(data.message)
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
  }

  if (!accesAutorise) {
    return (
      <AppLayout titre="Charges" sousTitre="Charges opérationnelles">
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4 opacity-20">🚫</div>
          <div className="font-bold text-[var(--text-1)] mb-2">Accès refusé</div>
          <div className="text-xs text-[var(--text-3)]">Ce module est réservé aux rôles manager et comptabilité.</div>
        </div>
      </AppLayout>
    )
  }

  const maxCategorie = Math.max(1, ...(kpis?.par_categorie || []).map(c => Number(c.total_montant) || 0))

  return (
    <AppLayout titre="Charges" sousTitre="Charges opérationnelles — sorties d'argent">
      <div className="space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="kpi-card">
            <div className="kpi-label">Charges du mois</div>
            <div className="kpi-value text-red-400">{kpis ? fmt(kpis.charges_mois, 'XAF') : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Charges validées</div>
            <div className="kpi-value text-blue-400">{kpis?.validees ?? '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Charges en attente</div>
            <div className={`kpi-value ${kpis?.enAttente > 0 ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>{kpis?.enAttente ?? '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Solde P&L estimé</div>
            <div className={`kpi-value ${kpis && kpis.solde_pl < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {kpis ? fmt(kpis.solde_pl, 'XAF') : '—'}
            </div>
            <div className="text-[9px] text-[var(--text-4)] mt-0.5">Encaissements − Charges (ce mois)</div>
          </div>
        </div>

        {/* Répartition par catégorie (mois en cours) */}
        {kpis?.par_categorie?.length > 0 && (
          <div className="card p-4 space-y-2">
            <div className="card-title text-xs">Charges par catégorie — ce mois</div>
            <div className="space-y-2">
              {kpis.par_categorie.map(cat => (
                <div key={cat.categorie_id || 'none'} className="flex items-center gap-2">
                  <div className="w-32 text-[10px] text-[var(--text-3)] truncate">
                    {cat.categorie_icone ? `${cat.categorie_icone} ` : ''}{cat.categorie_nom || 'Sans catégorie'}
                  </div>
                  <div className="flex-1 h-1.5 bg-[var(--bg-3)] rounded-full overflow-hidden">
                    <div className="h-full bg-red-500 rounded-full"
                      style={{ width: `${Math.round((Number(cat.total_montant) / maxCategorie) * 100)}%` }} />
                  </div>
                  <div className="w-24 text-right text-[10px] font-semibold text-[var(--text-1)]">{fmt(cat.total_montant, 'XAF')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filtres */}
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input py-1.5 text-xs w-auto" value={filtres.categorie_id}
            onChange={e => setFiltres(f => ({ ...f, categorie_id: e.target.value }))}>
            <option value="">Toutes catégories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icone ? `${c.icone} ` : ''}{c.nom}</option>)}
          </select>
          <select className="input py-1.5 text-xs w-auto" value={filtres.statut}
            onChange={e => setFiltres(f => ({ ...f, statut: e.target.value }))}>
            <option value="">Tous statuts</option>
            <option value="saisie">En attente</option>
            <option value="validee">Validée</option>
            <option value="payee">Payée</option>
          </select>
          <input type="date" className="input py-1.5 text-xs w-auto" value={filtres.debut}
            onChange={e => setFiltres(f => ({ ...f, debut: e.target.value }))} />
          <span className="text-[10px] text-[var(--text-4)]">→</span>
          <input type="date" className="input py-1.5 text-xs w-auto" value={filtres.fin}
            onChange={e => setFiltres(f => ({ ...f, fin: e.target.value }))} />
          <div className="flex-1" />
          <button onClick={charger} className="btn btn-ghost btn-sm text-xs">↻</button>
          {peutGerer && (
            <button onClick={() => setModalOuvert(true)} className="btn btn-primary btn-sm text-xs">+ Nouvelle charge</button>
          )}
        </div>

        {/* Tableau */}
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
          </div>
        ) : charges.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-5xl mb-4 opacity-20">💸</div>
            <div className="font-bold text-[var(--text-1)] mb-2">Aucune charge</div>
            <div className="text-xs text-[var(--text-3)]">Les charges opérationnelles apparaîtront ici une fois saisies.</div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-1)] text-[var(--text-4)] uppercase text-[9px] tracking-wide">
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-left px-4 py-3">Catégorie</th>
                    <th className="text-left px-4 py-3">Libellé</th>
                    <th className="text-right px-4 py-3">Montant</th>
                    <th className="text-center px-4 py-3">Statut</th>
                    <th className="text-center px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map(c => {
                    const meta = STATUT_META[c.statut] || STATUT_META.saisie
                    return (
                      <tr key={c.id} className="border-b border-[var(--border-1)]/50 hover:bg-[var(--bg-3)]/50 transition-colors">
                        <td className="px-4 py-3 text-[var(--text-2)]">{fmtDate(c.date_charge)}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">
                          {c.categorie_icone ? `${c.categorie_icone} ` : ''}{c.categorie_nom || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[var(--text-1)] font-medium">{c.libelle}</div>
                          {c.notes && <div className="text-[9px] text-[var(--text-4)] truncate max-w-xs">{c.notes}</div>}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-[var(--text-1)]">{fmt(c.montant, c.devise)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-center flex-wrap">
                            {c.statut === 'saisie' && peutValider && (
                              <button onClick={() => valider(c)} className="btn btn-xs btn-primary text-[9px]">✔ Valider</button>
                            )}
                            {c.statut !== 'payee' && peutGerer && (
                              <button onClick={() => setModalCharge(c)} className="btn btn-xs btn-ghost text-[9px]">✎ Modifier</button>
                            )}
                            {c.statut === 'saisie' && peutGerer && (
                              <button onClick={() => supprimer(c)} className="btn btn-xs btn-ghost text-[9px] text-red-400">🗑</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {(modalOuvert || modalCharge) && (
        <ModalCharge
          charge={modalCharge}
          categories={categories}
          onClose={() => { setModalOuvert(false); setModalCharge(null) }}
          onSuccess={onSuccess}
          onCategorieCreee={(cat) => setCategories(cs => [...cs, cat])}
        />
      )}
    </AppLayout>
  )
}
