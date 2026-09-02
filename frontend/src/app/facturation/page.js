'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'
import { facturationAPI, API_ORIGIN } from '@/lib/api'
import { fmt, fmtDate, useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_COLOR = { brouillon:'badge-gray', emise:'badge-blue', payee:'badge-green', annulee:'badge-red' }
const STATUT_LABEL = { brouillon:'Brouillon', emise:'Émise', payee:'Payée', annulee:'Annulée' }

const TAXE_FORM_VIDE = {
  nom: '', code: '', type_taxe: 'pourcentage', valeur: '',
  s_applique_a: 'tout', incluse_prix: false, ordre: 0
}

const S_APPLIQUE_OPTIONS = [
  { value: 'tout',         label: 'Tout' },
  { value: 'hebergement',  label: 'Hébergement' },
  { value: 'restaurant',   label: 'Restaurant' },
  { value: 'services',     label: 'Services' },
]

const STATUT_PAIEMENT_COLOR = { valide: 'badge-green', en_attente: 'badge-amber', echoue: 'badge-red', rembourse: 'badge-gray' }
const STATUT_PAIEMENT_LABEL = { valide: 'Validé', en_attente: 'En attente', echoue: 'Échoué', rembourse: 'Remboursé' }
const TYPE_PAIEMENT_LABEL   = { especes: 'Espèces', mobile_money: 'Mobile Money', carte: 'Carte', virement: 'Virement', cheque: 'Chèque' }

export default function FacturationPage() {
  const { user }  = useAuthStore()
  const router    = useRouter()
  const peutGererTaxes = ['manager', 'super_admin', 'comptabilite'].includes(user?.role)

  const [factures, setFactures]       = useState([])
  const [taxes, setTaxes]             = useState([])
  const [paiements, setPaiements]     = useState([])
  const [total, setTotal]             = useState(0)
  const [loading, setLoading]         = useState(true)
  const [onglet, setOnglet]           = useState('factures')
  const [filtreStatut, setFiltreStatut] = useState('')
  const [showTaxeForm, setShowTaxeForm] = useState(false)
  const [editingTaxe, setEditingTaxe]   = useState(null)
  const [taxeForm, setTaxeForm]         = useState(TAXE_FORM_VIDE)
  const [savingTaxe, setSavingTaxe]     = useState(false)

  useEffect(() => { charger() }, [filtreStatut])

  async function charger() {
    try {
      setLoading(true)
      const promises = [
        facturationAPI.factures({ statut: filtreStatut || undefined }),
        facturationAPI.taxes(),
        facturationAPI.paiementsFolio(),
      ]
      const [fRes, tRes, pRes] = await Promise.allSettled(promises)
      if (fRes.status === 'fulfilled') {
        setFactures(fRes.value.data.data || [])
        setTotal(fRes.value.data.pagination?.total || 0)
      }
      if (tRes.status === 'fulfilled') setTaxes(tRes.value.data.taxes || [])
      if (pRes.status === 'fulfilled') setPaiements(pRes.value.data.paiements || [])
    } catch { toast.error('Erreur chargement facturation') }
    finally { setLoading(false) }
  }

  function ouvrirCreationTaxe() {
    setEditingTaxe(null)
    setTaxeForm(TAXE_FORM_VIDE)
    setShowTaxeForm(true)
  }

  function ouvrirEditionTaxe(t) {
    setEditingTaxe(t.id)
    setTaxeForm({
      nom:          t.nom || '',
      code:         t.code || '',
      type_taxe:    t.type_taxe || 'pourcentage',
      valeur:       t.valeur || '',
      s_applique_a: t.s_applique_a || 'tout',
      incluse_prix: t.incluse_prix || false,
      ordre:        t.ordre ?? 0,
    })
    setShowTaxeForm(true)
  }

  function fermerTaxeForm() {
    setShowTaxeForm(false)
    setEditingTaxe(null)
    setTaxeForm(TAXE_FORM_VIDE)
  }

  async function sauvegarderTaxe(e) {
    e.preventDefault()
    if (!taxeForm.nom.trim()) return toast.error('Nom requis')
    if (!taxeForm.code.trim()) return toast.error('Code requis')
    if (!taxeForm.valeur || isNaN(parseFloat(taxeForm.valeur))) return toast.error('Valeur requise')
    try {
      setSavingTaxe(true)
      const payload = {
        ...taxeForm,
        valeur: parseFloat(taxeForm.valeur),
        ordre:  parseInt(taxeForm.ordre) || 0,
      }
      if (editingTaxe) {
        await facturationAPI.modifierTaxe(editingTaxe, payload)
        toast.success('Taxe mise à jour')
      } else {
        await facturationAPI.creerTaxe(payload)
        toast.success('Taxe créée')
      }
      fermerTaxeForm()
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur sauvegarde taxe')
    } finally { setSavingTaxe(false) }
  }

  async function toggleTaxeActive(t) {
    try {
      await facturationAPI.modifierTaxe(t.id, { active: !t.active })
      toast.success(t.active ? 'Taxe désactivée' : 'Taxe activée')
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur')
    }
  }

  const totalPayees = factures.filter(f => f.statut === 'payee').reduce((s,f) => s + (Number(f.montant_ttc) || 0), 0)
  const totalEmises = factures.filter(f => f.statut === 'emise').reduce((s,f) => s + (Number(f.montant_ttc) || 0), 0)

  async function telechargerPdf(f) {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('7vh_token') : null
      const hotelId = typeof window !== 'undefined' ? localStorage.getItem('7vh_hotel_id') : null
      const url = `${API_ORIGIN}/api/v1/facturation/factures/${f.id}/pdf`
      const res = await fetch(url, {
        headers: {
          ...(token   ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(hotelId ? { 'X-Hotel-ID': hotelId } : {}),
        }
      })
      if (!res.ok) { toast.error('PDF indisponible'); return }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${f.numero_facture || 'facture'}.pdf`
      a.click()
      URL.revokeObjectURL(href)
    } catch { toast.error('Erreur téléchargement PDF') }
  }

  return (
    <AppLayout titre="Facturation" sousTitre="Factures & taxes">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <div className="kpi-card"><div className="kpi-label">Total factures</div><div className="kpi-value">{total}</div></div>
          <div className="kpi-card"><div className="kpi-label">Encaissé</div><div className="kpi-value text-emerald-400 text-sm">{fmt(totalPayees)}</div></div>
          <div className="kpi-card"><div className="kpi-label">En attente</div><div className="kpi-value text-amber-400 text-sm">{fmt(totalEmises)}</div></div>
          <div className="kpi-card"><div className="kpi-label">Taxes actives</div><div className="kpi-value">{taxes.filter(t=>t.active).length}</div></div>
        </div>

        {/* Onglets */}
        <div className="flex gap-2 border-b border-[var(--border-1)]">
          {[['factures','📄 Factures'], ...(peutGererTaxes ? [['taxes','% Taxes']] : [])].map(([k,l]) => (
            <button key={k} onClick={() => setOnglet(k)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_,i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
          </div>
        ) : onglet === 'factures' ? (
          <div className="space-y-4">
            {/* Filtres */}
            <div className="flex gap-2 flex-wrap">
              {['','brouillon','emise','payee','annulee'].map(s => (
                <button key={s} onClick={() => setFiltreStatut(s)}
                  className={`btn btn-sm ${filtreStatut===s ? 'btn-primary' : 'btn-ghost'}`}>
                  {s ? STATUT_LABEL[s] : 'Toutes'}
                </button>
              ))}
            </div>
            <div className="card overflow-hidden">
              {factures.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-3)]">
                  <div className="text-4xl mb-3">📄</div>
                  <div className="font-semibold">Aucune facture générée</div>
                  <div className="mt-1">Les factures sont créées automatiquement lors du checkout client</div>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-1)]">
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">N° Facture</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Client</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Date</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Montant</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {factures.map(f => (
                      <tr key={f.id}
                        onClick={() => f.reservation_id && router.push(`/reservations/${f.reservation_id}`)}
                        className={`border-b border-[var(--border-1)] hover:bg-[var(--bg-2)] ${f.reservation_id ? 'cursor-pointer' : ''}`}>
                        <td className="px-4 py-3 font-mono text-blue-400">{f.numero_facture}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{f.nom_client || '—'}</td>
                        <td className="px-4 py-3 text-[var(--text-3)]">{fmtDate(f.date_emission)}</td>
                        <td className="px-4 py-3 font-semibold">{fmt(f.montant_ttc, f.devise)}</td>
                        <td className="px-4 py-3"><span className={`badge ${STATUT_COLOR[f.statut]}`}>{STATUT_LABEL[f.statut]}</span></td>
                        <td className="px-4 py-3 text-right">
                          {f.url_pdf && (
                            <button onClick={e => { e.stopPropagation(); telechargerPdf(f) }} className="btn btn-ghost btn-xs">↓ PDF</button>
                          )}
                          {f.reservation_id && <span className="text-[9px] text-[var(--text-4)] ml-1">→ Folio</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paiements en cours (folios ouverts — avant checkout) */}
            {paiements.length > 0 && (
              <div className="card overflow-hidden">
                <div className="card-header">
                  <div className="card-title">💳 Paiements en cours — folios ouverts</div>
                  <span className="text-[10px] text-[var(--text-3)]">Encaissements avant checkout · non encore facturés</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-1)]">
                      <th className="text-left px-4 py-2.5 text-[var(--text-3)] font-medium">Client</th>
                      <th className="text-left px-4 py-2.5 text-[var(--text-3)] font-medium">Folio</th>
                      <th className="text-left px-4 py-2.5 text-[var(--text-3)] font-medium">Mode</th>
                      <th className="text-left px-4 py-2.5 text-[var(--text-3)] font-medium">Date</th>
                      <th className="text-right px-4 py-2.5 text-[var(--text-3)] font-medium">Montant</th>
                      <th className="text-left px-4 py-2.5 text-[var(--text-3)] font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paiements.map(p => (
                      <tr key={p.id}
                        onClick={() => p.reservation_id && router.push(`/reservations/${p.reservation_id}`)}
                        className={`border-b border-[var(--border-1)] hover:bg-[var(--bg-3)] ${p.reservation_id ? 'cursor-pointer' : ''}`}>
                        <td className="px-4 py-2.5 font-semibold text-[var(--text-1)]">{p.nom_client || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-[10px] text-[var(--text-3)]">{p.numero_folio || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-2)]">{TYPE_PAIEMENT_LABEL[p.type_paiement] || p.type_paiement}</td>
                        <td className="px-4 py-2.5 text-[var(--text-3)]">{fmtDate(p.cree_le)}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-emerald-400">{fmt(p.montant, p.devise)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`badge ${STATUT_PAIEMENT_COLOR[p.statut] || 'badge-gray'}`}>
                            {STATUT_PAIEMENT_LABEL[p.statut] || p.statut}
                          </span>
                          {p.reservation_id && <span className="ml-1 text-[9px] text-[var(--text-4)]">→ Folio</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header taxe */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-[var(--text-3)]">{taxes.length} taxe{taxes.length !== 1 ? 's' : ''} · {taxes.filter(t=>t.active).length} active{taxes.filter(t=>t.active).length !== 1 ? 's' : ''}</div>
              <button onClick={ouvrirCreationTaxe} className="btn btn-primary btn-sm">＋ Nouvelle taxe</button>
            </div>

            {/* Formulaire création / édition taxe */}
            {showTaxeForm && (
              <div className="card p-6">
                <div className="card-title mb-5">{editingTaxe ? 'Modifier la taxe' : 'Nouvelle taxe'}</div>
                <form onSubmit={sauvegarderTaxe} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Nom *</label>
                    <input className="input" required value={taxeForm.nom} placeholder="ex: TVA Hôtellerie"
                      onChange={e => setTaxeForm({ ...taxeForm, nom: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Code *</label>
                    <input className="input" required value={taxeForm.code} placeholder="ex: TVA_HOTEL"
                      onChange={e => setTaxeForm({ ...taxeForm, code: e.target.value.toUpperCase() })} />
                  </div>
                  <div>
                    <label className="form-label">Type de taxe *</label>
                    <select className="input" value={taxeForm.type_taxe}
                      onChange={e => setTaxeForm({ ...taxeForm, type_taxe: e.target.value })}>
                      <option value="pourcentage">Pourcentage (%)</option>
                      <option value="fixe">Montant fixe (XAF)</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Valeur * {taxeForm.type_taxe === 'pourcentage' ? '(%)' : '(XAF)'}</label>
                    <input type="number" className="input" required min="0" step="0.01"
                      value={taxeForm.valeur} placeholder={taxeForm.type_taxe === 'pourcentage' ? 'ex: 19.25' : 'ex: 500'}
                      onChange={e => setTaxeForm({ ...taxeForm, valeur: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Applicable à</label>
                    <select className="input" value={taxeForm.s_applique_a}
                      onChange={e => setTaxeForm({ ...taxeForm, s_applique_a: e.target.value })}>
                      {S_APPLIQUE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Ordre d'affichage</label>
                    <input type="number" className="input" min="0" max="999"
                      value={taxeForm.ordre}
                      onChange={e => setTaxeForm({ ...taxeForm, ordre: e.target.value })} />
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <input type="checkbox" id="incluse_prix" className="w-4 h-4"
                      checked={taxeForm.incluse_prix}
                      onChange={e => setTaxeForm({ ...taxeForm, incluse_prix: e.target.checked })} />
                    <label htmlFor="incluse_prix" className="text-xs text-[var(--text-2)]">Taxe incluse dans le prix affiché</label>
                  </div>
                  <div className="col-span-2 flex gap-2 justify-end pt-2 border-t border-[var(--border-1)]">
                    <button type="button" onClick={fermerTaxeForm} className="btn btn-ghost btn-sm">Annuler</button>
                    <button type="submit" disabled={savingTaxe} className="btn btn-primary btn-sm">
                      {savingTaxe ? 'Sauvegarde...' : editingTaxe ? 'Enregistrer' : 'Créer la taxe'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Table des taxes */}
            <div className="card overflow-hidden">
              {taxes.length === 0 ? (
                <div className="p-10 text-center text-xs text-[var(--text-3)]">
                  <div className="text-4xl mb-3">%</div>
                  <div className="font-semibold mb-1">Aucune taxe configurée</div>
                  <button onClick={ouvrirCreationTaxe} className="btn btn-primary btn-sm mt-2">＋ Créer une taxe</button>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-1)]">
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Nom</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Code</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Valeur</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Applicable à</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxes.map(t => (
                      <tr key={t.id} className={`border-b border-[var(--border-1)] hover:bg-[var(--bg-2)] ${!t.active ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-semibold text-[var(--text-1)]">{t.nom}</td>
                        <td className="px-4 py-3 font-mono text-[var(--text-3)] text-[10px]">{t.code}</td>
                        <td className="px-4 py-3 font-bold text-blue-400">
                          {t.type_taxe === 'pourcentage' ? `${t.valeur} %` : `${Number(t.valeur).toLocaleString()} XAF`}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-2)] capitalize">{t.s_applique_a}</td>
                        <td className="px-4 py-3">
                          <span className={`badge ${t.active ? 'badge-green' : 'badge-gray'}`}>{t.active ? 'Active' : 'Inactive'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            <button onClick={() => ouvrirEditionTaxe(t)} className="btn btn-xs btn-ghost">✏ Modifier</button>
                            <button onClick={() => toggleTaxeActive(t)}
                              className={`btn btn-xs btn-ghost ${t.active ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {t.active ? '⏸ Désactiver' : '▶ Activer'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
