'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { utilisateursAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'

const ROLE_LABEL = { super_admin:'Super Admin', manager:'Manager', reception:'Réception', housekeeping:'Housekeeping', restaurant:'Restaurant', comptabilite:'Comptabilité', technicien:'Technicien' }
const ROLE_COLOR = { super_admin:'badge-purple', manager:'badge-blue', reception:'badge-green', housekeeping:'badge-amber', restaurant:'badge-amber', comptabilite:'badge-gray', technicien:'badge-gray' }
const ROLE_ICON  = { super_admin:'⚙️', manager:'🏨', reception:'🔑', housekeeping:'🧹', restaurant:'🍽', comptabilite:'💳', technicien:'🔧' }

// ── Modification d'un compte (HELICONIA-RETOUR-01) ──────────────────────────
// Le modèle est mono-rôle (utilisateurs.role) : un compte = un rôle. Un changement de rôle, d'accès
// ou de mot de passe révoque les sessions ouvertes du compte (reconnexion avec les nouveaux droits).
function ModalEdition({ utilisateur, estMoi, onClose, onSuccess }) {
  const [form, setForm] = useState({
    prenom: utilisateur.prenom || '', nom: utilisateur.nom || '', email: utilisateur.email || '',
    telephone: utilisateur.telephone || '', role: utilisateur.role, actif: !!utilisateur.actif,
  })
  const [mdpMode, setMdpMode] = useState('aucun')   // aucun | generer | saisir
  const [mdp, setMdp] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const corps = {}
    for (const k of ['prenom', 'nom', 'email', 'telephone', 'role', 'actif']) {
      const avant = k === 'actif' ? !!utilisateur.actif : (utilisateur[k] || '')
      if (form[k] !== avant) corps[k] = k === 'telephone' && !form[k] ? null : form[k]
    }
    if (mdpMode === 'generer') corps.generer_mot_de_passe = true
    if (mdpMode === 'saisir') {
      if (mdp.length < 8) return toast.error('Mot de passe : 8 caractères minimum')
      corps.mot_de_passe = mdp
    }
    if (!Object.keys(corps).length) return onClose()
    try {
      setSaving(true)
      const { data } = await utilisateursAPI.modifier(utilisateur.id, corps)
      toast.success(data.sessions_revoquees ? `Compte mis à jour — ${data.sessions_revoquees} session(s) fermée(s)` : 'Compte mis à jour')
      onSuccess(data.mot_de_passe_temporaire ? { email: data.utilisateur.email, mdp: data.mot_de_passe_temporaire } : null)
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur modification utilisateur')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box max-w-lg" data-testid="modal-edition-utilisateur">
        <div className="modal-header">
          <h3 className="font-bold text-[var(--text-1)]">Modifier {utilisateur.prenom} {utilisateur.nom}</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body grid grid-cols-2 gap-3">
            <div><label className="form-label">Prénom *</label><input className="input" name="prenom" required value={form.prenom} onChange={e => setForm({ ...form, prenom: e.target.value })} /></div>
            <div><label className="form-label">Nom *</label><input className="input" name="nom" required value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} /></div>
            <div><label className="form-label">Email *</label><input className="input" name="email" type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="form-label">Téléphone</label><input className="input" name="telephone" value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })} /></div>
            <div>
              <label className="form-label">Rôle</label>
              <select className="input" name="role" value={form.role} disabled={estMoi} onChange={e => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'super_admin').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {estMoi && <div className="text-[10px] text-[var(--text-4)] mt-1">Votre propre rôle ne se modifie pas ici.</div>}
            </div>
            <div>
              <label className="form-label">Statut</label>
              <select className="input" name="actif" value={form.actif ? '1' : '0'} disabled={estMoi} onChange={e => setForm({ ...form, actif: e.target.value === '1' })}>
                <option value="1">Actif</option><option value="0">Inactif</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="form-label">Mot de passe</label>
              <select className="input" name="mdp_mode" value={mdpMode} onChange={e => setMdpMode(e.target.value)}>
                <option value="aucun">Inchangé</option>
                <option value="generer">Réinitialiser — générer un mot de passe temporaire</option>
                <option value="saisir">Réinitialiser — saisir un nouveau mot de passe</option>
              </select>
              {mdpMode === 'saisir' && (
                <input className="input mt-2" name="nouveau_mdp" type="password" autoComplete="new-password" minLength={8} placeholder="8 caractères minimum" value={mdp} onChange={e => setMdp(e.target.value)} />
              )}
              {mdpMode !== 'aucun' && <div className="text-[10px] text-[var(--text-4)] mt-1">Changement imposé à la prochaine connexion.</div>}
            </div>
            <div className="col-span-2 text-[10px] text-[var(--text-4)]">
              Un compte = un rôle. Changer le rôle, désactiver le compte ou réinitialiser le mot de passe ferme ses sessions ouvertes.
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">{saving ? '…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function StaffPage() {
  const { user } = useAuthStore()
  const [edition, setEdition]   = useState(null)
  const [staff, setStaff]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  // QA-01 : plus de mot de passe pré-rempli (« demo123 ») — vide ⇒ mot de passe temporaire généré
  // par le serveur, affiché une fois ; changement imposé à la première connexion.
  const [form, setForm]         = useState({ prenom:'', nom:'', email:'', role:'reception', mot_de_passe:'' })
  const [mdpTemporaire, setMdpTemporaire] = useState(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const res = await utilisateursAPI.lister()
      setStaff(res.data.utilisateurs || [])
    } catch { toast.error('Erreur chargement personnel') }
    finally { setLoading(false) }
  }

  async function creerUtilisateur(e) {
    e.preventDefault()
    try {
      const { mot_de_passe, ...reste } = form
      const res = await utilisateursAPI.creer(mot_de_passe ? form : reste)
      toast.success('Utilisateur créé !')
      setMdpTemporaire(res.data?.mot_de_passe_temporaire ? { email: form.email, mdp: res.data.mot_de_passe_temporaire } : null)
      setShowForm(false)
      setForm({ prenom:'', nom:'', email:'', role:'reception', mot_de_passe:'' })
      charger()
    } catch (err) {
      const msg = err?.response?.data?.erreur || err?.message || ''
      if (msg.includes('dupliquée') || msg.includes('unique') || err?.response?.status === 409) {
        toast.error('Cet email est déjà utilisé')
      } else {
        toast.error(err?.response?.data?.erreur || 'Erreur création utilisateur')
      }
    }
  }

  async function toggleActif(id, actif) {
    try {
      await utilisateursAPI.modifier(id, { actif: !actif })
      toast.success(actif ? 'Compte désactivé' : 'Compte activé')
      charger()
    } catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur') }
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
          <div className="kpi-card"><div className="kpi-label">Total staff</div><div className="kpi-value">{stats.total}</div></div>
          <div className="kpi-card"><div className="kpi-label">Actifs</div><div className="kpi-value text-emerald-400">{stats.actifs}</div></div>
          <div className="kpi-card"><div className="kpi-label">Management</div><div className="kpi-value text-purple-400">{stats.managers}</div></div>
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
              <div><label className="form-label">Mot de passe</label><input className="input" type="password" autoComplete="new-password" minLength={8} placeholder="Vide = généré automatiquement" value={form.mot_de_passe} onChange={e => setForm({...form, mot_de_passe:e.target.value})} /></div>
              <div className="flex items-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">Créer</button>
              </div>
            </form>
          </div>
        )}

        {mdpTemporaire && (
          <div className="card p-4 border border-amber-500/30" data-testid="mdp-temporaire">
            <div className="text-xs font-bold text-amber-400 mb-1">Mot de passe temporaire de {mdpTemporaire.email}</div>
            <div className="font-mono text-sm text-[var(--text-1)]">{mdpTemporaire.mdp}</div>
            <div className="text-[10px] text-[var(--text-4)] mt-1">Affiché une seule fois — à transmettre de façon sécurisée. Changement imposé à la première connexion.</div>
            <button type="button" onClick={() => setMdpTemporaire(null)} className="btn btn-ghost btn-sm mt-2">J&apos;ai noté</button>
          </div>
        )}

        {/* Liste */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_,i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
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
                        <div className="flex gap-1">
                        <button onClick={() => setEdition(s)} className="btn btn-xs btn-ghost" data-testid={`modifier-${s.email}`}>✏️ Modifier</button>
                        {s.id !== user?.id && <button onClick={() => toggleActif(s.id, s.actif)}
                          className={`btn btn-xs ${s.actif ? 'btn-ghost text-red-400' : 'btn-ghost text-emerald-400'}`}>
                          {s.actif ? 'Désactiver' : 'Activer'}
                        </button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {edition && (
        <ModalEdition utilisateur={edition} estMoi={edition.id === user?.id} onClose={() => setEdition(null)}
          onSuccess={(mdp) => { setEdition(null); if (mdp) setMdpTemporaire(mdp); charger() }} />
      )}
    </AppLayout>
  )
}
