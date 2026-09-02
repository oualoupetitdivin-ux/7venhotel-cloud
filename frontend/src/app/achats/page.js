'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { achatsAPI, fournisseursAPI, catalogueAPI } from '@/lib/api'
import { fmt, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = { brouillon: 'Brouillon', envoye: 'Envoyé', recu_partiel: 'Reçu partiel', recu: 'Reçu', annule: 'Annulé' }
const STATUT_BADGE = { brouillon: 'badge-gray', envoye: 'badge-blue', recu_partiel: 'badge-amber', recu: 'badge-green', annule: 'badge-red' }
const LIGNE_VIDE = { article_id: '', quantite_commandee: '', prix_unitaire: '' }
const BON_VIDE = { fournisseur_id: '', date_commande: '', date_livraison_prevue: '', notes: '' }

export default function AchatsPage() {
  const [bons, setBons]               = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [articles, setArticles]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [filtreStatut, setFiltreStatut] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState(BON_VIDE)
  const [lignes, setLignes]       = useState([{ ...LIGNE_VIDE }])

  useEffect(() => { chargerReferences() }, [])
  useEffect(() => { charger() }, [filtreStatut])

  async function chargerReferences() {
    try {
      const [fRes, aRes] = await Promise.all([fournisseursAPI.lister(), catalogueAPI.articles()])
      setFournisseurs(fRes.data.fournisseurs || [])
      setArticles(aRes.data.articles || [])
    } catch { toast.error('Erreur chargement fournisseurs/articles') }
  }

  async function charger() {
    try {
      setLoading(true)
      const res = await achatsAPI.bons({ statut: filtreStatut || undefined })
      setBons(res.data.bons || [])
    } catch { toast.error('Erreur chargement bons d\'achat') }
    finally { setLoading(false) }
  }

  function ouvrirNouveau() {
    setForm(BON_VIDE)
    setLignes([{ ...LIGNE_VIDE }])
    setShowModal(true)
  }

  function ajouterLigne() { setLignes(l => [...l, { ...LIGNE_VIDE }]) }
  function retirerLigne(i) { setLignes(l => l.filter((_, idx) => idx !== i)) }
  function majLigne(i, champ, val) { setLignes(l => l.map((x, idx) => idx === i ? { ...x, [champ]: val } : x)) }

  const totalBon = lignes.reduce((s, l) => s + (Number(l.quantite_commandee) || 0) * (Number(l.prix_unitaire) || 0), 0)

  async function soumettre(e) {
    e.preventDefault()
    if (!form.fournisseur_id) return toast.error('Fournisseur requis')
    const lignesValides = lignes.filter(l => l.article_id && Number(l.quantite_commandee) > 0)
    if (!lignesValides.length) return toast.error('Au moins une ligne article valide requise')
    try {
      await achatsAPI.creer({
        ...form,
        date_commande: form.date_commande || null,
        date_livraison_prevue: form.date_livraison_prevue || null,
        lignes: lignesValides.map(l => ({
          article_id: l.article_id,
          quantite_commandee: Number(l.quantite_commandee),
          prix_unitaire: Number(l.prix_unitaire) || 0,
        })),
      })
      toast.success('Bon d\'achat créé')
      setShowModal(false)
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur création bon d\'achat') }
  }

  async function marquerRecu(bon) {
    if (!confirm(`Marquer le bon ${bon.numero_bon} comme reçu ? Le stock sera mis à jour automatiquement.`)) return
    try {
      await achatsAPI.recevoir(bon.id, {})
      toast.success('Réception enregistrée — stock mis à jour')
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur réception') }
  }

  async function annuler(bon) {
    if (!confirm(`Annuler le bon ${bon.numero_bon} ?`)) return
    try {
      await achatsAPI.annuler(bon.id)
      toast.success('Bon annulé')
      charger()
    } catch { toast.error('Erreur annulation') }
  }

  return (
    <AppLayout titre="Achats" sousTitre="Bons d'achat & réception fournisseurs">
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            {['', 'brouillon', 'envoye', 'recu_partiel', 'recu', 'annule'].map(s => (
              <button key={s} onClick={() => setFiltreStatut(s)}
                className={`btn btn-sm ${filtreStatut === s ? 'btn-primary' : 'btn-ghost'}`}>
                {s ? STATUT_LABEL[s] : 'Tous'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
            <button onClick={ouvrirNouveau} className="btn btn-primary btn-sm">＋ Nouveau bon</button>
          </div>
        </div>

        <div className="card overflow-hidden overflow-x-auto">
          {loading ? (
            <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
          ) : bons.length === 0 ? (
            <div className="p-10 text-center text-xs text-[var(--text-3)]">
              <div className="text-4xl mb-3">🧾</div>
              <div className="font-semibold">Aucun bon d'achat</div>
            </div>
          ) : (
            <table className="table-base">
              <thead>
                <tr><th>N°</th><th>Fournisseur</th><th>Date commande</th><th>Livraison prévue</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {bons.map(b => (
                  <tr key={b.id}>
                    <td className="font-semibold">{b.numero_bon}</td>
                    <td>{b.fournisseur_nom}</td>
                    <td className="text-[var(--text-2)]">{fmtDate(b.date_commande)}</td>
                    <td className="text-[var(--text-2)]">{fmtDate(b.date_livraison_prevue)}</td>
                    <td><span className={`badge ${STATUT_BADGE[b.statut]}`}>{STATUT_LABEL[b.statut]}</span></td>
                    <td>
                      <div className="flex gap-1">
                        {['brouillon', 'envoye', 'recu_partiel'].includes(b.statut) && (
                          <button onClick={() => marquerRecu(b)} className="btn btn-xs btn-success">✅ Marquer reçu</button>
                        )}
                        {b.statut === 'brouillon' && (
                          <button onClick={() => annuler(b)} className="btn btn-xs btn-danger">✕ Annuler</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Nouveau bon */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">Nouveau bon d'achat</div>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettre}>
              <div className="modal-body space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-1">
                    <label className="form-label">Fournisseur *</label>
                    <select className="input" required value={form.fournisseur_id}
                      onChange={e => setForm({ ...form, fournisseur_id: e.target.value })}>
                      <option value="">— Sélectionner —</option>
                      {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Date commande</label>
                    <input type="date" className="input" value={form.date_commande}
                      onChange={e => setForm({ ...form, date_commande: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">Livraison prévue</label>
                    <input type="date" className="input" value={form.date_livraison_prevue}
                      onChange={e => setForm({ ...form, date_livraison_prevue: e.target.value })} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="form-label mb-0">Articles</label>
                    <button type="button" onClick={ajouterLigne} className="btn btn-xs btn-ghost">＋ Ajouter ligne</button>
                  </div>
                  <div className="space-y-2">
                    {lignes.map((l, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <select className="input col-span-5" value={l.article_id}
                          onChange={e => majLigne(i, 'article_id', e.target.value)}>
                          <option value="">— Article —</option>
                          {articles.map(a => <option key={a.id} value={a.id}>{a.nom}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01" placeholder="Qté" className="input col-span-3"
                          value={l.quantite_commandee} onChange={e => majLigne(i, 'quantite_commandee', e.target.value)} />
                        <input type="number" min="0" step="1" placeholder="Prix unit." className="input col-span-3"
                          value={l.prix_unitaire} onChange={e => majLigne(i, 'prix_unitaire', e.target.value)} />
                        <button type="button" onClick={() => retirerLigne(i)} className="btn btn-xs btn-ghost col-span-1">🗑</button>
                      </div>
                    ))}
                  </div>
                  <div className="text-right text-xs font-semibold mt-2">Total estimé : {fmt(totalBon)}</div>
                </div>

                <div>
                  <label className="form-label">Notes</label>
                  <textarea className="input h-16 resize-none" value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">Créer le bon</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
