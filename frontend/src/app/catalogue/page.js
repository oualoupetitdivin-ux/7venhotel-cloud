'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { catalogueAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

const ARTICLE_VIDE = {
  nom: '', description: '', categorie_id: '', prix: '', cout_revient: '',
  unite: 'unité', stock_minimum: 0, disponible: true,
}
const CATEGORIE_VIDE = { nom: '', ordre: 0 }

export default function CataloguePage() {
  const [tab, setTab]             = useState('articles')
  const [categories, setCategories] = useState([])
  const [articles, setArticles]     = useState([])
  const [loading, setLoading]       = useState(true)

  const [showArticleModal, setShowArticleModal]   = useState(false)
  const [articleForm, setArticleForm]             = useState(ARTICLE_VIDE)
  const [editingArticleId, setEditingArticleId]   = useState(null)

  const [showCatModal, setShowCatModal] = useState(false)
  const [catForm, setCatForm]           = useState(CATEGORIE_VIDE)
  const [editingCatId, setEditingCatId] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const [catRes, artRes] = await Promise.all([
        catalogueAPI.categories(),
        catalogueAPI.articles(),
      ])
      setCategories(catRes.data.categories || [])
      setArticles(artRes.data.articles || [])
    } catch { toast.error('Erreur chargement catalogue') }
    finally { setLoading(false) }
  }

  // ── Articles ────────────────────────────────────────────────────────────
  function ouvrirNouvelArticle() {
    setEditingArticleId(null)
    setArticleForm(ARTICLE_VIDE)
    setShowArticleModal(true)
  }

  function ouvrirEditionArticle(a) {
    setEditingArticleId(a.id)
    setArticleForm({
      nom: a.nom || '', description: a.description || '', categorie_id: a.categorie_id || '',
      prix: a.prix ?? '', cout_revient: a.cout_revient ?? '', unite: a.unite || 'unité',
      stock_minimum: a.stock_minimum ?? 0, disponible: a.disponible !== false,
    })
    setShowArticleModal(true)
  }

  async function soumettreArticle(e) {
    e.preventDefault()
    const payload = {
      ...articleForm,
      categorie_id: articleForm.categorie_id || null,
      prix: Number(articleForm.prix) || 0,
      cout_revient: Number(articleForm.cout_revient) || 0,
      stock_minimum: Number(articleForm.stock_minimum) || 0,
    }
    try {
      if (editingArticleId) {
        await catalogueAPI.modifierArticle(editingArticleId, payload)
        toast.success('Article modifié')
      } else {
        await catalogueAPI.creerArticle(payload)
        toast.success('Article créé')
      }
      setShowArticleModal(false)
      charger()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur enregistrement article') }
  }

  async function archiverArticle(a) {
    if (!confirm(`Archiver l'article "${a.nom}" ?`)) return
    try {
      await catalogueAPI.supprimerArticle(a.id)
      toast.success('Article archivé')
      charger()
    } catch { toast.error('Erreur archivage') }
  }

  // ── Catégories ──────────────────────────────────────────────────────────
  function ouvrirNouvelleCategorie() {
    setEditingCatId(null)
    setCatForm(CATEGORIE_VIDE)
    setShowCatModal(true)
  }

  function ouvrirEditionCategorie(c) {
    setEditingCatId(c.id)
    setCatForm({ nom: c.nom, ordre: c.ordre || 0 })
    setShowCatModal(true)
  }

  async function soumettreCategorie(e) {
    e.preventDefault()
    try {
      if (editingCatId) {
        await catalogueAPI.modifierCategorie(editingCatId, catForm)
        toast.success('Catégorie modifiée')
      } else {
        await catalogueAPI.creerCategorie(catForm)
        toast.success('Catégorie créée')
      }
      setShowCatModal(false)
      charger()
    } catch { toast.error('Erreur enregistrement catégorie') }
  }

  async function archiverCategorie(c) {
    if (!confirm(`Archiver la catégorie "${c.nom}" ?`)) return
    try {
      await catalogueAPI.supprimerCategorie(c.id)
      toast.success('Catégorie archivée')
      charger()
    } catch { toast.error('Erreur archivage') }
  }

  return (
    <AppLayout titre="Catalogue" sousTitre="Produits & menu — restaurant">
      <div className="space-y-5">
        {/* Onglets */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            <button onClick={() => setTab('articles')}
              className={`btn btn-sm ${tab === 'articles' ? 'btn-primary' : 'btn-ghost'}`}>Articles</button>
            <button onClick={() => setTab('categories')}
              className={`btn btn-sm ${tab === 'categories' ? 'btn-primary' : 'btn-ghost'}`}>Catégories</button>
          </div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
            {tab === 'articles'
              ? <button onClick={ouvrirNouvelArticle} className="btn btn-primary btn-sm">＋ Nouvel article</button>
              : <button onClick={ouvrirNouvelleCategorie} className="btn btn-primary btn-sm">＋ Nouvelle catégorie</button>}
          </div>
        </div>

        {loading ? (
          <div className="card p-4 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
          </div>
        ) : tab === 'articles' ? (
          <div className="card overflow-hidden overflow-x-auto">
            {articles.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-3)]">
                <div className="text-4xl mb-3">📖</div>
                <div className="font-semibold">Aucun article au catalogue</div>
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Nom</th><th>Catégorie</th><th>Prix</th><th>Coût</th><th>Stock actuel</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map(a => (
                    <tr key={a.id}>
                      <td className="font-semibold">{a.nom}</td>
                      <td className="text-[var(--text-2)]">{a.categorie_nom || '—'}</td>
                      <td>{fmt(a.prix)}</td>
                      <td className="text-[var(--text-2)]">{fmt(a.cout_revient)}</td>
                      <td>
                        <span className={`badge ${a.alerte_stock ? 'badge-red' : 'badge-green'}`}>
                          {Number(a.stock_actuel)} {a.unite}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => ouvrirEditionArticle(a)} className="btn btn-xs btn-ghost">✎</button>
                          <button onClick={() => archiverArticle(a)} className="btn btn-xs btn-danger">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="card overflow-hidden overflow-x-auto">
            {categories.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-3)]">
                <div className="text-4xl mb-3">🗂</div>
                <div className="font-semibold">Aucune catégorie</div>
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr><th>Nom</th><th>Ordre</th><th>Statut</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id}>
                      <td className="font-semibold">{c.nom}</td>
                      <td className="text-[var(--text-2)]">{c.ordre}</td>
                      <td><span className={`badge ${c.actif ? 'badge-green' : 'badge-gray'}`}>{c.actif ? 'Active' : 'Archivée'}</span></td>
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => ouvrirEditionCategorie(c)} className="btn btn-xs btn-ghost">✎</button>
                          <button onClick={() => archiverCategorie(c)} className="btn btn-xs btn-danger">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modal Article */}
      {showArticleModal && (
        <div className="modal-overlay" onClick={() => setShowArticleModal(false)}>
          <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">{editingArticleId ? 'Modifier l\'article' : 'Nouvel article'}</div>
              <button onClick={() => setShowArticleModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettreArticle}>
              <div className="modal-body grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Nom *</label>
                  <input className="input" required value={articleForm.nom}
                    onChange={e => setArticleForm({ ...articleForm, nom: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Description</label>
                  <textarea className="input h-16 resize-none" value={articleForm.description}
                    onChange={e => setArticleForm({ ...articleForm, description: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Catégorie</label>
                  <select className="input" value={articleForm.categorie_id}
                    onChange={e => setArticleForm({ ...articleForm, categorie_id: e.target.value })}>
                    <option value="">— Aucune —</option>
                    {categories.filter(c => c.actif).map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Unité</label>
                  <input className="input" value={articleForm.unite}
                    onChange={e => setArticleForm({ ...articleForm, unite: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Prix de vente (XAF) *</label>
                  <input type="number" min="0" step="1" className="input" required value={articleForm.prix}
                    onChange={e => setArticleForm({ ...articleForm, prix: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Coût de revient (XAF)</label>
                  <input type="number" min="0" step="1" className="input" value={articleForm.cout_revient}
                    onChange={e => setArticleForm({ ...articleForm, cout_revient: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Stock minimum (alerte)</label>
                  <input type="number" min="0" step="0.01" className="input" value={articleForm.stock_minimum}
                    onChange={e => setArticleForm({ ...articleForm, stock_minimum: e.target.value })} />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
                    <input type="checkbox" checked={articleForm.disponible}
                      onChange={e => setArticleForm({ ...articleForm, disponible: e.target.checked })} />
                    Disponible à la vente
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowArticleModal(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">{editingArticleId ? 'Enregistrer' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Catégorie */}
      {showCatModal && (
        <div className="modal-overlay" onClick={() => setShowCatModal(false)}>
          <div className="modal-box max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">{editingCatId ? 'Modifier la catégorie' : 'Nouvelle catégorie'}</div>
              <button onClick={() => setShowCatModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettreCategorie}>
              <div className="modal-body space-y-4">
                <div>
                  <label className="form-label">Nom *</label>
                  <input className="input" required value={catForm.nom}
                    onChange={e => setCatForm({ ...catForm, nom: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Ordre d'affichage</label>
                  <input type="number" className="input" value={catForm.ordre}
                    onChange={e => setCatForm({ ...catForm, ordre: Number(e.target.value) })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowCatModal(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">{editingCatId ? 'Enregistrer' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
