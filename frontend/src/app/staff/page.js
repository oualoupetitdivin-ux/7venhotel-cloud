'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { utilisateursAPI } from '@/lib/api'
import toast from 'react-hot-toast'

const ROLE_LABEL = { super_admin:'Super Admin', manager:'Manager', reception:'Réception', housekeeping:'Housekeeping', restaurant:'Restaurant', comptabilite:'Comptabilité', technicien:'Technicien' }
const ROLE_COLOR = { super_admin:'badge-purple', manager:'badge-blue', reception:'badge-green', housekeeping:'badge-amber', restaurant:'badge-amber', comptabilite:'badge-gray', technicien:'badge-gray' }
const ROLE_ICON  = { super_admin:'⚙️', manager:'🏨', reception:'🔑', housekeeping:'🧹', restaurant:'🍽', comptabilite:'💳', technicien:'🔧' }

export default function StaffPage() {
  const [staff, setStaff]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ prenom:'', nom:'', email:'', role:'reception', mot_de_passe:'demo123' })

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const res = await utilisateursAPI.lister()
      setStaff(res.data.data || [])
    } catch { toast.error('Erreur chargement personnel') }
    finally { setLoading(false) }
  }

  async function creerUtilisateur(e) {
    e.preventDefault()
    try {
      await utilisateursAPI.creer(form)
      toast.success('Utilisateur créé !')
      setShowForm(false)
      setForm({ prenom:'', nom:'', email:'', role:'reception', mot_de_passe:'demo123' })
      charger()
    } catch { toast.error('Erreur création utilisateur') }
  }

  async function toggleActif(id, actif) {
    try {
      await utilisateursAPI.modifier(id, { actif: !actif })
      toast.success(actif ? 'Compte désactivé' : 'Compte activé')
      charger()
    } catch { toast.error('Erreur') }
  }

  const stats = {
    total: staff.length,
    actifs: staff.filter(s => s.actif).length,
    managers: staff.filter(s => ['manager','super_admin'].includes(s.role)).length,
  }

  return (
    <AppLayout titre="Personnel" sousTitre="Gestion des utilisateurs">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="kpi-card border-b-2 border-blue-500"><div className="kpi-label">Total staff</div><div className="kpi-value">{stats.total}</div></div>
          <div className="kpi-card border-b-2 border-emerald-500"><div className="kpi-label">Actifs</div><div className="kpi-value text-emerald-400">{stats.actifs}</div></div>
          <div className="kpi-card border-b-2 border-purple-500"><div className="kpi-label">Management</div><div className="kpi-value text-purple-400">{stats.managers}</div></div>
        </div>

        {/* En-tête */}
        <div className="flex justify-between items-center">
          <button onClick={charger} className="btn btn-ghost btn-sm">↻ Actualiser</button>
          <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm">＋ Nouvel utilisateur</button>
        </div>

        {/* Formulaire */}
        {showForm && (
          <div className="card p-5">
            <div className="card-title mb-4">Nouvel utilisateur</div>
            <form onSubmit={creerUtilisateur} className="grid grid-cols-2 gap-4">
              <div><label className="form-label">Prénom *</label><input className="input" required value={form.prenom} onChange={e => setForm({...form, prenom:e.target.value})} /></div>
              <div><label className="form-label">Nom *</label><input className="input" required value={form.nom} onChange={e => setForm({...form, nom:e.target.value})} /></div>
              <div><label className="form-label">Email *</label><input className="input" type="email" required value={form.email} onChange={e => setForm({...form, email:e.target.value})} /></div>
              <div><label className="form-label">Rôle</label>
                <select className="input" value={form.role} onChange={e => setForm({...form, role:e.target.value})}>
                  {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'super_admin').map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="form-label">Mot de passe</label><input className="input" value={form.mot_de_passe} onChange={e => setForm({...form, mot_de_passe:e.target.value})} /></div>
              <div className="flex items-end gap-2">
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
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-1)]">
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Utilisateur</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Rôle</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                          {s.prenom?.[0]}{s.nom?.[0]}
                        </div>
                        <div className="font-semibold text-[var(--text-1)]">{s.prenom} {s.nom}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${ROLE_COLOR[s.role] || 'badge-gray'}`}>
                        {ROLE_ICON[s.role]} {ROLE_LABEL[s.role] || s.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{s.email}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${s.actif ? 'badge-green' : 'badge-gray'}`}>{s.actif ? 'Actif' : 'Inactif'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {s.role !== 'super_admin' && (
                        <button onClick={() => toggleActif(s.id, s.actif)}
                          className={`btn btn-xs ${s.actif ? 'btn-ghost text-red-400' : 'btn-ghost text-emerald-400'}`}>
                          {s.actif ? 'Désactiver' : 'Activer'}
                        </button>
                      )}
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
