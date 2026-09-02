'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { fideliteAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

const TYPE_OFFRE_LABEL = { remise_pct: 'Remise %', remise_fixe: 'Remise fixe', nuit_gratuite: 'Nuit gratuite', upgrade: 'Surclassement' }
const NIVEAU_LABEL = { silver: 'Silver+', gold: 'Gold' }
const REGLES_VIDE = { points_par_nuit: 10, points_par_1000_xaf: 5, seuil_silver: 200, seuil_gold: 500 }
const OFFRE_VIDE = { titre: '', description: '', type_offre: 'remise_pct', valeur: '', date_debut: '', date_fin: '', conditions: '', niveau_requis: '', actif: true }

function valeurAffichee(offre) {
  if (offre.type_offre === 'remise_pct') return `${Number(offre.valeur || 0)}%`
  if (offre.type_offre === 'remise_fixe') return fmt(offre.valeur || 0)
  if (offre.type_offre === 'nuit_gratuite') return 'Nuit offerte'
  if (offre.type_offre === 'upgrade') return 'Surclassement'
  return offre.valeur ?? '—'
}

export default function FidelitePage() {
  const [tab, setTab] = useState('regles')

  const [regles, setRegles]   = useState(REGLES_VIDE)
  const [loadingRegles, setLoadingRegles] = useState(true)
  const [savingRegles, setSavingRegles]   = useState(false)

  const [offres, setOffres]   = useState([])
  const [loadingOffres, setLoadingOffres] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState(OFFRE_VIDE)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => { chargerRegles(); chargerOffres() }, [])

  async function chargerRegles() {
    try {
      setLoadingRegles(true)
      const res = await fideliteAPI.regles()
      setRegles({ ...REGLES_VIDE, ...res.data.regles })
    } catch { toast.error('Erreur chargement règles fidélité') }
    finally { setLoadingRegles(false) }
  }

  async function soumettreRegles(e) {
    e.preventDefault()
    try {
      setSavingRegles(true)
      await fideliteAPI.majRegles({
        points_par_nuit:     Number(regles.points_par_nuit) || 0,
        points_par_1000_xaf: Number(regles.points_par_1000_xaf) || 0,
        seuil_silver:         Number(regles.seuil_silver) || 0,
        seuil_gold:           Number(regles.seuil_gold) || 0,
      })
      toast.success('Règles enregistrées')
    } catch { toast.error('Erreur enregistrement règles') }
    finally { setSavingRegles(false) }
  }

  async function chargerOffres() {
    try {
      setLoadingOffres(true)
      const res = await fideliteAPI.offres()
      setOffres(res.data.offres || [])
    } catch { toast.error('Erreur chargement offres') }
    finally { setLoadingOffres(false) }
  }

  function ouvrirNouvelleOffre() {
    setEditingId(null)
    setForm(OFFRE_VIDE)
    setShowModal(true)
  }

  function ouvrirEditionOffre(o) {
    setEditingId(o.id)
    setForm({
      titre: o.titre || '', description: o.description || '', type_offre: o.type_offre || 'remise_pct',
      valeur: o.valeur ?? '', date_debut: o.date_debut ? o.date_debut.slice(0, 10) : '',
      date_fin: o.date_fin ? o.date_fin.slice(0, 10) : '', conditions: o.conditions || '',
      niveau_requis: o.niveau_requis || '', actif: o.actif !== false,
    })
    setShowModal(true)
  }

  async function soumettreOffre(e) {
    e.preventDefault()
    const payload = {
      ...form,
      valeur: form.valeur === '' ? null : Number(form.valeur),
      date_debut: form.date_debut || null,
      date_fin: form.date_fin || null,
      niveau_requis: form.niveau_requis || null,
    }
    try {
      if (editingId) {
        await fideliteAPI.modifierOffre(editingId, payload)
        toast.success('Offre modifiée')
      } else {
        await fideliteAPI.creerOffre(payload)
        toast.success('Offre créée')
      }
      setShowModal(false)
      chargerOffres()
    } catch { toast.error('Erreur enregistrement offre') }
  }

  async function desactiverOffre(o) {
    if (!confirm(`Désactiver l'offre "${o.titre}" ?`)) return
    try {
      await fideliteAPI.desactiverOffre(o.id)
      toast.success('Offre désactivée')
      chargerOffres()
    } catch { toast.error('Erreur désactivation') }
  }

  return (
    <AppLayout titre="Fidélité" sousTitre="Règles de points & offres client">
      <div className="space-y-5">
        <div className="flex gap-2">
          <button onClick={() => setTab('regles')} className={`btn btn-sm ${tab === 'regles' ? 'btn-primary' : 'btn-ghost'}`}>Règles</button>
          <button onClick={() => setTab('offres')} className={`btn btn-sm ${tab === 'offres' ? 'btn-primary' : 'btn-ghost'}`}>Offres</button>
        </div>

        {tab === 'regles' && (
          <div className="card p-5 max-w-lg">
            <div className="card-title mb-4">Règles de calcul des points</div>
            {loadingRegles ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-9 rounded-lg" />)}</div>
            ) : (
              <form onSubmit={soumettreRegles} className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Points par nuit</label>
                  <input type="number" min="0" className="input" value={regles.points_par_nuit}
                    onChange={e => setRegles({ ...regles, points_par_nuit: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Points par 1 000 XAF dépensés</label>
                  <input type="number" min="0" className="input" value={regles.points_par_1000_xaf}
                    onChange={e => setRegles({ ...regles, points_par_1000_xaf: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Seuil niveau Silver</label>
                  <input type="number" min="0" className="input" value={regles.seuil_silver}
                    onChange={e => setRegles({ ...regles, seuil_silver: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Seuil niveau Gold</label>
                  <input type="number" min="0" className="input" value={regles.seuil_gold}
                    onChange={e => setRegles({ ...regles, seuil_gold: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <button type="submit" disabled={savingRegles} className="btn btn-primary btn-sm">
                    {savingRegles ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {tab === 'offres' && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <button onClick={chargerOffres} className="btn btn-ghost btn-sm">↻</button>
              <button onClick={ouvrirNouvelleOffre} className="btn btn-primary btn-sm">＋ Nouvelle offre</button>
            </div>

            <div className="card overflow-hidden overflow-x-auto">
              {loadingOffres ? (
                <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
              ) : offres.length === 0 ? (
                <div className="p-10 text-center text-xs text-[var(--text-3)]">
                  <div className="text-4xl mb-3">🎁</div>
                  <div className="font-semibold">Aucune offre configurée</div>
                </div>
              ) : (
                <table className="table-base">
                  <thead>
                    <tr><th>Titre</th><th>Type</th><th>Valeur</th><th>Validité</th><th>Niveau requis</th><th>Statut</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {offres.map(o => (
                      <tr key={o.id}>
                        <td className="font-semibold">{o.titre}</td>
                        <td className="text-[var(--text-2)]">{TYPE_OFFRE_LABEL[o.type_offre] || o.type_offre}</td>
                        <td>{valeurAffichee(o)}</td>
                        <td className="text-[var(--text-2)]">
                          {o.date_debut ? o.date_debut.slice(0, 10) : '—'} → {o.date_fin ? o.date_fin.slice(0, 10) : 'illimité'}
                        </td>
                        <td>{o.niveau_requis ? <span className="badge badge-purple">{NIVEAU_LABEL[o.niveau_requis] || o.niveau_requis}</span> : <span className="text-[var(--text-3)]">Tous</span>}</td>
                        <td><span className={`badge ${o.actif ? 'badge-green' : 'badge-gray'}`}>{o.actif ? 'Active' : 'Inactive'}</span></td>
                        <td>
                          <div className="flex gap-1">
                            <button onClick={() => ouvrirEditionOffre(o)} className="btn btn-xs btn-ghost">✎</button>
                            {o.actif && <button onClick={() => desactiverOffre(o)} className="btn btn-xs btn-danger">🗑</button>}
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

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">{editingId ? "Modifier l'offre" : 'Nouvelle offre'}</div>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettreOffre}>
              <div className="modal-body grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Titre *</label>
                  <input className="input" required value={form.titre}
                    onChange={e => setForm({ ...form, titre: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Description</label>
                  <textarea className="input h-16 resize-none" value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Type d'offre</label>
                  <select className="input" value={form.type_offre}
                    onChange={e => setForm({ ...form, type_offre: e.target.value })}>
                    {Object.entries(TYPE_OFFRE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Valeur (% ou montant)</label>
                  <input type="number" min="0" step="0.01" className="input" value={form.valeur}
                    onChange={e => setForm({ ...form, valeur: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Date début</label>
                  <input type="date" className="input" value={form.date_debut}
                    onChange={e => setForm({ ...form, date_debut: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Date fin</label>
                  <input type="date" className="input" value={form.date_fin}
                    onChange={e => setForm({ ...form, date_fin: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Niveau requis</label>
                  <select className="input" value={form.niveau_requis}
                    onChange={e => setForm({ ...form, niveau_requis: e.target.value })}>
                    <option value="">Tous niveaux</option>
                    <option value="silver">Silver+</option>
                    <option value="gold">Gold</option>
                  </select>
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
                    <input type="checkbox" checked={form.actif}
                      onChange={e => setForm({ ...form, actif: e.target.checked })} />
                    Offre active
                  </label>
                </div>
                <div className="col-span-2">
                  <label className="form-label">Conditions</label>
                  <textarea className="input h-14 resize-none" placeholder="ex: min 3 nuits" value={form.conditions}
                    onChange={e => setForm({ ...form, conditions: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm">{editingId ? 'Enregistrer' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
