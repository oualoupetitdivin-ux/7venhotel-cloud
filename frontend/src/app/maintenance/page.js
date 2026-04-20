'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { maintenanceAPI } from '@/lib/api'
import { PRIORITE_COULEUR, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = { ouvert:'Ouvert', en_cours:'En cours', resolu:'Résolu', ferme:'Fermé' }
const STATUT_COLOR = { ouvert:'badge-red', en_cours:'badge-blue', resolu:'badge-green', ferme:'badge-gray' }
const CATEGORIE_ICON = { technique:'⚙️', plomberie:'🔧', electricite:'⚡', climatisation:'❄️', mobilier:'🪑', autre:'🔨' }

export default function MaintenancePage() {
  const [tickets, setTickets]   = useState([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [filtreStatut, setFiltreStatut] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ titre:'', description:'', categorie:'technique', priorite:'normale' })

  useEffect(() => { charger() }, [filtreStatut])

  async function charger() {
    try {
      setLoading(true)
      const res = await maintenanceAPI.tickets({ statut: filtreStatut || undefined })
      setTickets(res.data.data || [])
      setTotal(res.data.pagination?.total || 0)
    } catch { toast.error('Erreur chargement tickets') }
    finally { setLoading(false) }
  }

  async function creerTicket(e) {
    e.preventDefault()
    try {
      await maintenanceAPI.creer(form)
      toast.success('Ticket créé !')
      setShowForm(false)
      setForm({ titre:'', description:'', categorie:'technique', priorite:'normale' })
      charger()
    } catch { toast.error('Erreur création ticket') }
  }

  async function changerStatut(id, statut) {
    try {
      await maintenanceAPI.modifier(id, { statut })
      toast.success('Statut mis à jour')
      charger()
    } catch { toast.error('Erreur mise à jour') }
  }

  const urgents = tickets.filter(t => t.priorite === 'urgente' && t.statut === 'ouvert').length

  return (
    <AppLayout titre="Maintenance" sousTitre="Tickets & interventions">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <div className="kpi-card border-b-2 border-blue-500"><div className="kpi-label">Total</div><div className="kpi-value">{total}</div></div>
          <div className="kpi-card border-b-2 border-red-500"><div className="kpi-label">Urgents</div><div className="kpi-value text-red-400">{urgents}</div></div>
          <div className="kpi-card border-b-2 border-amber-500"><div className="kpi-label">Ouverts</div><div className="kpi-value text-amber-400">{tickets.filter(t=>t.statut==='ouvert').length}</div></div>
          <div className="kpi-card border-b-2 border-emerald-500"><div className="kpi-label">Résolus</div><div className="kpi-value text-emerald-400">{tickets.filter(t=>t.statut==='resolu').length}</div></div>
        </div>

        {/* Filtres */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            {['','ouvert','en_cours','resolu','ferme'].map(s => (
              <button key={s} onClick={() => setFiltreStatut(s)}
                className={`btn btn-sm ${filtreStatut===s ? 'btn-primary' : 'btn-ghost'}`}>
                {s ? STATUT_LABEL[s] : 'Tous'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
            <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm">＋ Nouveau ticket</button>
          </div>
        </div>

        {/* Formulaire */}
        {showForm && (
          <div className="card p-5">
            <div className="card-title mb-4">Nouveau ticket</div>
            <form onSubmit={creerTicket} className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="form-label">Titre *</label>
                <input className="input" required value={form.titre} onChange={e => setForm({...form, titre:e.target.value})} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Description</label>
                <textarea className="input h-20 resize-none" value={form.description} onChange={e => setForm({...form, description:e.target.value})} />
              </div>
              <div>
                <label className="form-label">Catégorie</label>
                <select className="input" value={form.categorie} onChange={e => setForm({...form, categorie:e.target.value})}>
                  {Object.entries(CATEGORIE_ICON).map(([k,v]) => <option key={k} value={k}>{v} {k}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Priorité</label>
                <select className="input" value={form.priorite} onChange={e => setForm({...form, priorite:e.target.value})}>
                  <option value="basse">Basse</option>
                  <option value="normale">Normale</option>
                  <option value="haute">Haute</option>
                  <option value="urgente">Urgente</option>
                </select>
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">Créer</button>
              </div>
            </form>
          </div>
        )}

        {/* Liste */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-10 text-center text-xs text-[var(--text-3)]">
              <div className="text-4xl mb-3">🔧</div>
              <div className="font-semibold">Aucun ticket de maintenance</div>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-1)]">
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Ticket</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Catégorie</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Priorité</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--text-1)]">{t.titre}</div>
                      <div className="text-[var(--text-3)] line-clamp-1">{t.description}</div>
                    </td>
                    <td className="px-4 py-3">{CATEGORIE_ICON[t.categorie]} {t.categorie}</td>
                    <td className="px-4 py-3"><span className={`badge ${PRIORITE_COULEUR[t.priorite]}`}>{t.priorite}</span></td>
                    <td className="px-4 py-3"><span className={`badge ${STATUT_COLOR[t.statut]}`}>{STATUT_LABEL[t.statut]}</span></td>
                    <td className="px-4 py-3 text-[var(--text-3)]">{fmtDate(t.cree_le)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {t.statut === 'ouvert' && <button onClick={() => changerStatut(t.id,'en_cours')} className="btn btn-xs btn-ghost">▶ Prendre</button>}
                        {t.statut === 'en_cours' && <button onClick={() => changerStatut(t.id,'resolu')} className="btn btn-xs btn-ghost">✅ Résoudre</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
