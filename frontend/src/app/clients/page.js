'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { clientsAPI } from '@/lib/api'
import toast from 'react-hot-toast'

export default function ClientsPage() {
  const [clients, setClients]   = useState([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ prenom:'', nom:'', email:'', telephone:'', pays:'Cameroun', segment:'regular' })

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const res = await clientsAPI.lister({ search: search || undefined })
      setClients(res.data.data || [])
      setTotal(res.data.pagination?.total || 0)
    } catch { toast.error('Erreur chargement clients') }
    finally { setLoading(false) }
  }

  async function creerClient(e) {
    e.preventDefault()
    try {
      await clientsAPI.creer(form)
      toast.success('Client créé !')
      setShowForm(false)
      setForm({ prenom:'', nom:'', email:'', telephone:'', pays:'Cameroun', segment:'regular' })
      charger()
    } catch { toast.error('Erreur création client') }
  }

  return (
    <AppLayout titre="Clients" sousTitre="Base clientèle">
      <div className="space-y-5">
        {/* En-tête */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2 flex-1">
            <input type="text" placeholder="Rechercher un client..." value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && charger()}
              className="input flex-1 max-w-xs" />
            <button onClick={charger} className="btn btn-ghost btn-sm">🔍 Rechercher</button>
          </div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
            <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm">＋ Nouveau client</button>
          </div>
        </div>

        {/* Formulaire création */}
        {showForm && (
          <div className="card p-5">
            <div className="card-title mb-4">Nouveau client</div>
            <form onSubmit={creerClient} className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Prénom *</label>
                <input className="input" required value={form.prenom} onChange={e => setForm({...form, prenom: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Nom *</label>
                <input className="input" required value={form.nom} onChange={e => setForm({...form, nom: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Téléphone</label>
                <input className="input" value={form.telephone} onChange={e => setForm({...form, telephone: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Pays</label>
                <input className="input" value={form.pays} onChange={e => setForm({...form, pays: e.target.value})} />
              </div>
              <div>
                <label className="form-label">Segment</label>
                <select className="input" value={form.segment} onChange={e => setForm({...form, segment: e.target.value})}>
                  <option value="regular">Regular</option>
                  <option value="VIP">VIP</option>
                  <option value="corporate">Corporate</option>
                </select>
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">Créer le client</button>
              </div>
            </form>
          </div>
        )}

        {/* Liste */}
        <div className="card overflow-hidden">
          <div className="card-header">
            <div className="card-title">Clients <span className="text-[var(--text-3)] font-normal ml-2 text-xs">{total} au total</span></div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : clients.length === 0 ? (
            <div className="p-10 text-center text-xs text-[var(--text-3)]">
              <div className="text-4xl mb-3">👥</div>
              <div className="font-semibold mb-1">Aucun client</div>
              <div>Créez votre premier client avec le bouton ci-dessus</div>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-1)]">
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Client</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Contact</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Pays</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Segment</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Fidélité</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                          {c.prenom?.[0]}{c.nom?.[0]}
                        </div>
                        <div>
                          <div className="font-semibold text-[var(--text-1)]">{c.prenom} {c.nom}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[var(--text-2)]">{c.email || '—'}</div>
                      <div className="text-[var(--text-3)]">{c.telephone || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{c.pays || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${c.segment === 'VIP' ? 'badge-purple' : c.segment === 'corporate' ? 'badge-blue' : 'badge-gray'}`}>
                        {c.segment === 'VIP' ? '⭐ VIP' : c.segment}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{c.points_fidelite || 0} pts</td>
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
