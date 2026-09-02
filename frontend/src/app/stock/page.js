'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { stockAPI } from '@/lib/api'
import { fmt, fmtDateTime } from '@/lib/utils'
import toast from 'react-hot-toast'

const TYPE_LABEL = { entree: 'Entrée', sortie: 'Sortie', perte: 'Perte', inventaire: 'Inventaire', transfert: 'Transfert' }
const TYPE_BADGE = { entree: 'badge-green', sortie: 'badge-blue', perte: 'badge-red', inventaire: 'badge-purple', transfert: 'badge-amber' }
const MOUVEMENT_VIDE = { article_id: '', type_mouvement: 'entree', quantite: '', motif: '' }

export default function StockPage() {
  const [tab, setTab]           = useState('stock')
  const [articles, setArticles] = useState([])
  const [mouvements, setMouvements] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]         = useState(MOUVEMENT_VIDE)

  useEffect(() => { charger() }, [])
  useEffect(() => { if (tab === 'historique') chargerHistorique() }, [tab])

  async function charger() {
    try {
      setLoading(true)
      const res = await stockAPI.lister()
      setArticles(res.data.articles || [])
    } catch { toast.error('Erreur chargement stock') }
    finally { setLoading(false) }
  }

  async function chargerHistorique() {
    try {
      const res = await stockAPI.historique()
      setMouvements(res.data.mouvements || [])
    } catch { toast.error('Erreur chargement historique') }
  }

  function ouvrirModal() {
    setForm(MOUVEMENT_VIDE)
    setShowModal(true)
  }

  async function soumettreMouvement(e) {
    e.preventDefault()
    if (!form.article_id) return toast.error('Article requis')
    try {
      await stockAPI.mouvement({ ...form, quantite: Number(form.quantite) })
      toast.success('Mouvement enregistré')
      setShowModal(false)
      charger()
      if (tab === 'historique') chargerHistorique()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur enregistrement mouvement') }
  }

  const totalArticles = articles.length
  const enAlerte       = articles.filter(a => a.alerte_stock).length
  const valeurStock    = articles.reduce((s, a) => s + Number(a.stock_actuel) * Number(a.cout_revient || 0), 0)

  return (
    <AppLayout titre="Stock" sousTitre="Niveaux & mouvements — restaurant">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="kpi-card"><div className="kpi-label">Total articles</div><div className="kpi-value">{totalArticles}</div></div>
          <div className="kpi-card"><div className="kpi-label">Articles en alerte</div><div className="kpi-value text-red-400">{enAlerte}</div></div>
          <div className="kpi-card"><div className="kpi-label">Valeur stock estimée</div><div className="kpi-value">{fmt(valeurStock)}</div></div>
        </div>

        {/* Onglets */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            <button onClick={() => setTab('stock')}
              className={`btn btn-sm ${tab === 'stock' ? 'btn-primary' : 'btn-ghost'}`}>Stock actuel</button>
            <button onClick={() => setTab('historique')}
              className={`btn btn-sm ${tab === 'historique' ? 'btn-primary' : 'btn-ghost'}`}>Historique</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => (tab === 'stock' ? charger() : chargerHistorique())} className="btn btn-ghost btn-sm">↻</button>
            <button onClick={ouvrirModal} className="btn btn-primary btn-sm">＋ Mouvement manuel</button>
          </div>
        </div>

        {tab === 'stock' ? (
          <div className="card overflow-hidden overflow-x-auto">
            {loading ? (
              <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
            ) : articles.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-3)]">
                <div className="text-4xl mb-3">📦</div>
                <div className="font-semibold">Aucun article suivi en stock</div>
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr><th>Article</th><th>Catégorie</th><th>Niveau</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {articles.map(a => {
                    const denom = Math.max(Number(a.stock_minimum) * 2, 1)
                    const pct   = Math.min(100, Math.round((Number(a.stock_actuel) / denom) * 100))
                    return (
                      <tr key={a.id}>
                        <td className="font-semibold">{a.nom}</td>
                        <td className="text-[var(--text-2)]">{a.categorie_nom || '—'}</td>
                        <td className="min-w-[160px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-3)] overflow-hidden">
                              <div className={`h-full rounded-full ${a.alerte_stock ? 'bg-red-500' : 'bg-emerald-500'}`}
                                style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[var(--text-2)] tabular-nums whitespace-nowrap">
                              {Number(a.stock_actuel)} / {Number(a.stock_minimum)} {a.unite}
                            </span>
                          </div>
                        </td>
                        <td><span className={`badge ${a.alerte_stock ? 'badge-red' : 'badge-green'}`}>{a.alerte_stock ? 'Alerte' : 'OK'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden overflow-x-auto">
            {mouvements.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-3)]">
                <div className="text-4xl mb-3">📜</div>
                <div className="font-semibold">Aucun mouvement enregistré</div>
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr><th>Date</th><th>Article</th><th>Type</th><th>Quantité</th><th>Stock avant → après</th><th>Motif</th><th>Agent</th></tr>
                </thead>
                <tbody>
                  {mouvements.map(m => (
                    <tr key={m.id}>
                      <td className="text-[var(--text-2)] whitespace-nowrap">{fmtDateTime(m.cree_le)}</td>
                      <td className="font-semibold">{m.article_nom}</td>
                      <td><span className={`badge ${TYPE_BADGE[m.type_mouvement]}`}>{TYPE_LABEL[m.type_mouvement]}</span></td>
                      <td>{Number(m.quantite)} {m.unite}</td>
                      <td className="text-[var(--text-2)] tabular-nums">{Number(m.stock_avant)} → {Number(m.stock_apres)}</td>
                      <td className="text-[var(--text-2)]">{m.motif || '—'}</td>
                      <td className="text-[var(--text-2)]">{m.nom_agent || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modal Mouvement manuel */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">Mouvement manuel</div>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettreMouvement}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="form-label">Article *</label>
                  <select className="input" required value={form.article_id}
                    onChange={e => setForm({ ...form, article_id: e.target.value })}>
                    <option value="">— Sélectionner —</option>
                    {articles.map(a => <option key={a.id} value={a.id}>{a.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Type de mouvement *</label>
                  <select className="input" value={form.type_mouvement}
                    onChange={e => setForm({ ...form, type_mouvement: e.target.value })}>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">
                    {form.type_mouvement === 'inventaire' ? 'Stock réel compté *' : 'Quantité *'}
                  </label>
                  <input type="number" min="0" step="0.01" className="input" required value={form.quantite}
                    onChange={e => setForm({ ...form, quantite: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Motif</label>
                  <input className="input" value={form.motif}
                    onChange={e => setForm({ ...form, motif: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">Enregistrer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
