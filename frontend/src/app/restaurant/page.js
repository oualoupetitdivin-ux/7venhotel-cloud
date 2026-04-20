'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { restaurantAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

const CATEGORIE_LABEL = { petit_dejeuner:'☀️ Petit-déj', entree:'🥗 Entrée', plat:'🍽 Plat', dessert:'🍰 Dessert', boisson:'🥤 Boisson' }
const STATUT_COLOR = { en_attente:'badge-amber', en_preparation:'badge-blue', pret:'badge-green', servi:'badge-gray', annule:'badge-red' }
const STATUT_LABEL = { en_attente:'En attente', en_preparation:'En préparation', pret:'Prêt', servi:'Servi', annule:'Annulé' }

export default function RestaurantPage() {
  const [menu, setMenu]           = useState([])
  const [commandes, setCommandes] = useState([])
  const [loading, setLoading]     = useState(true)
  const [onglet, setOnglet]       = useState('commandes')
  const [panier, setPanier]       = useState([])
  const [tableNum, setTableNum]   = useState('')

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const [menuRes, cmdRes] = await Promise.allSettled([
        restaurantAPI.menu(),
        restaurantAPI.commandes({ statut: 'en_attente' })
      ])
      if (menuRes.status === 'fulfilled') setMenu(menuRes.value.data.articles || [])
      if (cmdRes.status === 'fulfilled') setCommandes(cmdRes.value.data.data || [])
    } catch { toast.error('Erreur chargement') }
    finally { setLoading(false) }
  }

  function ajouterAuPanier(article) {
    setPanier(prev => {
      const ex = prev.find(p => p.id === article.id)
      if (ex) return prev.map(p => p.id === article.id ? {...p, qte: p.qte+1} : p)
      return [...prev, {...article, qte: 1}]
    })
  }

  function retirerDuPanier(id) {
    setPanier(prev => prev.filter(p => p.id !== id))
  }

  async function passerCommande() {
    if (!panier.length) return toast.error('Panier vide')
    if (!tableNum) return toast.error('Numéro de table requis')
    try {
      await restaurantAPI.creerCommande({
        table_numero: tableNum,
        lignes: panier.map(p => ({ article_id: p.id, quantite: p.qte, prix_unitaire: p.prix })),
        total: panier.reduce((s,p) => s + p.prix*p.qte, 0)
      })
      toast.success('Commande passée !')
      setPanier([])
      setTableNum('')
      charger()
    } catch { toast.error('Erreur commande') }
  }

  async function changerStatutCmd(id, statut) {
    try {
      await restaurantAPI.changerStatut(id, { statut })
      toast.success('Commande mise à jour')
      charger()
    } catch { toast.error('Erreur mise à jour') }
  }

  const totalPanier = panier.reduce((s,p) => s + p.prix*p.qte, 0)
  const menuParCategorie = menu.reduce((acc, a) => {
    if (!acc[a.categorie]) acc[a.categorie] = []
    acc[a.categorie].push(a)
    return acc
  }, {})

  return (
    <AppLayout titre="Restaurant" sousTitre="Point de vente & commandes">
      <div className="space-y-5">
        {/* Onglets */}
        <div className="flex gap-2 border-b border-[var(--border-1)] pb-0">
          {[['commandes','📋 Commandes'], ['menu','🍽 Menu & Nouvelle commande']].map(([k,l]) => (
            <button key={k} onClick={() => setOnglet(k)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : onglet === 'commandes' ? (
          <div className="space-y-3">
            {commandes.length === 0 ? (
              <div className="card p-10 text-center text-xs text-[var(--text-3)]">
                <div className="text-4xl mb-3">🍽</div>
                <div className="font-semibold">Aucune commande en attente</div>
              </div>
            ) : commandes.map(c => (
              <div key={c.id} className="card p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold text-sm">Table {c.table_numero}</div>
                    <div className="text-xs text-[var(--text-3)]">{new Date(c.cree_le).toLocaleTimeString('fr-FR')}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${STATUT_COLOR[c.statut]}`}>{STATUT_LABEL[c.statut]}</span>
                    <span className="font-bold text-sm">{fmt(c.total, 'XAF')}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {c.statut === 'en_attente' && <button onClick={() => changerStatutCmd(c.id,'en_preparation')} className="btn btn-xs btn-primary">▶ Préparer</button>}
                  {c.statut === 'en_preparation' && <button onClick={() => changerStatutCmd(c.id,'pret')} className="btn btn-xs btn-ghost">✅ Prêt</button>}
                  {c.statut === 'pret' && <button onClick={() => changerStatutCmd(c.id,'servi')} className="btn btn-xs btn-ghost">🍽 Servi</button>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {/* Menu */}
            <div className="col-span-2 space-y-5">
              {Object.entries(menuParCategorie).map(([cat, articles]) => (
                <div key={cat}>
                  <div className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">{CATEGORIE_LABEL[cat] || cat}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {articles.filter(a => a.disponible).map(a => (
                      <div key={a.id} className="card p-3 flex items-center justify-between hover:border-blue-500/40 transition-all cursor-pointer" onClick={() => ajouterAuPanier(a)}>
                        <div>
                          <div className="text-xs font-semibold text-[var(--text-1)]">{a.nom}</div>
                          <div className="text-[10px] text-[var(--text-3)]">{a.description}</div>
                          <div className="text-xs font-bold text-blue-400 mt-1">{fmt(a.prix, 'XAF')}</div>
                        </div>
                        <button className="btn btn-xs btn-primary ml-2 flex-shrink-0">＋</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Panier */}
            <div className="card p-4 h-fit sticky top-4">
              <div className="font-bold text-sm mb-3">🛒 Commande</div>
              <div className="mb-3">
                <label className="form-label">Table N°</label>
                <input className="input" placeholder="ex: 5" value={tableNum} onChange={e => setTableNum(e.target.value)} />
              </div>
              {panier.length === 0 ? (
                <div className="text-center text-xs text-[var(--text-3)] py-4">Cliquez sur un article pour l'ajouter</div>
              ) : (
                <div className="space-y-2 mb-3">
                  {panier.map(p => (
                    <div key={p.id} className="flex items-center justify-between text-xs">
                      <span className="flex-1 truncate">{p.qte}x {p.nom}</span>
                      <span className="font-semibold ml-2">{fmt(p.prix*p.qte,'XAF')}</span>
                      <button onClick={() => retirerDuPanier(p.id)} className="ml-2 text-red-400 hover:text-red-300">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-[var(--border-1)] pt-3 flex items-center justify-between mb-3">
                <span className="text-xs font-bold">Total</span>
                <span className="font-bold text-blue-400">{fmt(totalPanier,'XAF')}</span>
              </div>
              <button onClick={passerCommande} disabled={!panier.length} className="btn btn-primary w-full btn-sm">
                Passer la commande
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
