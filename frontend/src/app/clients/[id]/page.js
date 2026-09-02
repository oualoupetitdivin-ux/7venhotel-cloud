'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'
import { clientsAPI } from '@/lib/api'
import { fmtDate, fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

const SEGMENTS = ['standard', 'regular', 'VIP', 'corporate']
const SEGMENT_BADGE = { VIP: 'badge-purple', corporate: 'badge-blue' }

export default function ClientDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [client, setClient]   = useState(null)
  const [sejours, setSejours] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({})

  useEffect(() => { charger() }, [id])

  async function charger() {
    try {
      setLoading(true)
      const res = await clientsAPI.obtenir(id)
      setClient(res.data.client)
      setSejours(res.data.sejours_recents || [])
      setForm(res.data.client)
    } catch { toast.error('Client introuvable') }
    finally { setLoading(false) }
  }

  async function sauvegarder(e) {
    e.preventDefault()
    try {
      setSaving(true)
      const res = await clientsAPI.modifier(id, {
        prenom: form.prenom, nom: form.nom, email: form.email,
        telephone: form.telephone, pays_residence: form.pays_residence,
        segment: form.segment, notes_internes: form.notes_internes,
        nationalite: form.nationalite, adresse: form.adresse,
        ville: form.ville, code_postal: form.code_postal,
      })
      setClient(res.data.client)
      setForm(res.data.client)
      setEditing(false)
      toast.success('Client mis à jour')
    } catch { toast.error('Erreur mise à jour') }
    finally { setSaving(false) }
  }

  const STATUT_COLOR = { confirmee:'badge-blue', checkin:'badge-green', checkout:'badge-gray', annulee:'badge-red', no_show:'badge-red' }
  const STATUT_LABEL = { confirmee:'Confirmée', checkin:'En cours', checkout:'Terminée', annulee:'Annulée', no_show:'No-show' }

  if (loading) return (
    <AppLayout titre="Client" sousTitre="Fiche client">
      <div className="space-y-4">
        <div className="skeleton h-28 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_,i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
        <div className="skeleton h-64 rounded-xl" />
      </div>
    </AppLayout>
  )

  if (!client) return (
    <AppLayout titre="Client" sousTitre="Fiche client">
      <div className="p-10 text-center text-xs text-[var(--text-3)]">Client introuvable</div>
    </AppLayout>
  )

  return (
    <AppLayout titre={`${client.prenom} ${client.nom}`} sousTitre="Fiche client">
      <div className="space-y-5">
        {/* Actions */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/clients')} className="btn btn-ghost btn-sm">← Retour</button>
          <div className="ml-auto flex gap-2">
            {!editing && (
              <button onClick={() => setEditing(true)} className="btn btn-primary btn-sm">✏️ Modifier</button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {/* Fiche principale */}
          <div className="col-span-2 space-y-5">
            <div className="card p-5">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
                  {client.prenom?.[0]}{client.nom?.[0]}
                </div>
                <div>
                  <div className="text-lg font-bold text-[var(--text-1)]">{client.prenom} {client.nom}</div>
                  <span className={`badge ${SEGMENT_BADGE[client.segment] || 'badge-gray'} text-[10px]`}>
                    {client.segment === 'VIP' ? '⭐ VIP' : client.segment}
                  </span>
                </div>
                {!editing && (
                  <div className="ml-auto text-right text-xs text-[var(--text-3)]">
                    <div>Client depuis</div>
                    <div className="font-semibold text-[var(--text-2)]">{fmtDate(client.cree_le)}</div>
                  </div>
                )}
              </div>

              {editing ? (
                <form onSubmit={sauvegarder} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Prénom *</label>
                      <input className="input" required value={form.prenom || ''} onChange={e => setForm({...form, prenom:e.target.value})} />
                    </div>
                    <div>
                      <label className="form-label">Nom *</label>
                      <input className="input" required value={form.nom || ''} onChange={e => setForm({...form, nom:e.target.value})} />
                    </div>
                    <div>
                      <label className="form-label">Email</label>
                      <input className="input" type="email" value={form.email || ''} onChange={e => setForm({...form, email:e.target.value})} />
                    </div>
                    <div>
                      <label className="form-label">Téléphone</label>
                      <input className="input" value={form.telephone || ''} onChange={e => setForm({...form, telephone:e.target.value})} />
                    </div>
                    <div>
                      <label className="form-label">Pays de résidence</label>
                      <input className="input" value={form.pays_residence || ''} onChange={e => setForm({...form, pays_residence:e.target.value})} />
                    </div>
                    <div>
                      <label className="form-label">Segment</label>
                      <select className="input" value={form.segment || 'standard'} onChange={e => setForm({...form, segment:e.target.value})}>
                        {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Nationalité</label>
                      <input className="input" value={form.nationalite || ''} onChange={e => setForm({...form, nationalite:e.target.value})} />
                    </div>
                    <div>
                      <label className="form-label">Ville</label>
                      <input className="input" value={form.ville || ''} onChange={e => setForm({...form, ville:e.target.value})} />
                    </div>
                    <div className="col-span-2">
                      <label className="form-label">Notes internes</label>
                      <textarea className="input" rows={3} value={form.notes_internes || ''} onChange={e => setForm({...form, notes_internes:e.target.value})} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => { setEditing(false); setForm(client) }} className="btn btn-ghost btn-sm">Annuler</button>
                    <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                      {saving ? 'Enregistrement...' : '✅ Enregistrer'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs">
                  {[
                    ['Email', client.email],
                    ['Téléphone', client.telephone],
                    ['Pays', client.pays_residence],
                    ['Nationalité', client.nationalite],
                    ['Ville', client.ville],
                    ['Code postal', client.code_postal],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div className="text-[var(--text-3)] mb-0.5">{label}</div>
                      <div className="font-medium text-[var(--text-1)]">{val || '—'}</div>
                    </div>
                  ))}
                  {client.notes_internes && (
                    <div className="col-span-2">
                      <div className="text-[var(--text-3)] mb-0.5">Notes internes</div>
                      <div className="font-medium text-[var(--text-1)]">{client.notes_internes}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Séjours récents */}
            <div className="card overflow-hidden">
              <div className="card-header"><div className="card-title">Historique séjours</div></div>
              {sejours.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-3)]">Aucun séjour enregistré</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-1)]">
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Arrivée</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Départ</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Chambre</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Montant</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sejours.map(s => (
                      <tr key={s.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                        <td className="px-4 py-3 text-[var(--text-2)]">{fmtDate(s.date_arrivee)}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{fmtDate(s.date_depart)}</td>
                        <td className="px-4 py-3 text-[var(--text-3)]">{s.chambre_id?.slice(0,8)}…</td>
                        <td className="px-4 py-3 font-semibold">{fmt(s.total_general, s.devise)}</td>
                        <td className="px-4 py-3">
                          <span className={`badge ${STATUT_COLOR[s.statut] || 'badge-gray'}`}>
                            {STATUT_LABEL[s.statut] || s.statut}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Sidebar fidélité */}
          <div className="space-y-4">
            <div className="card p-4">
              <div className="card-title mb-4">Fidélité</div>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Points</span>
                  <span className="font-bold text-blue-400 text-base">{client.points_fidelite || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Séjours</span>
                  <span className="font-semibold">{client.nombre_sejours || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-3)]">Revenu total</span>
                  <span className="font-semibold text-emerald-400">{fmt(client.revenu_total || 0, 'XAF')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
