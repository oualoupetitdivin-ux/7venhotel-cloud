'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { fournisseursAPI } from '@/lib/api'
import { fmt, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = { brouillon: 'Brouillon', envoye: 'Envoyé', recu_partiel: 'Reçu partiel', recu: 'Reçu', annule: 'Annulé' }
const STATUT_BADGE = { brouillon: 'badge-gray', envoye: 'badge-blue', recu_partiel: 'badge-amber', recu: 'badge-green', annule: 'badge-red' }
const FOURNISSEUR_VIDE = { nom: '', contact_nom: '', telephone: '', email: '', adresse: '', delai_livraison_jours: 3 }

export default function FournisseursPage() {
  const [fournisseurs, setFournisseurs] = useState([])
  const [loading, setLoading]           = useState(true)
  const [selectedId, setSelectedId]     = useState(null)
  const [detail, setDetail]             = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState(FOURNISSEUR_VIDE)
  const [editingId, setEditingId] = useState(null)

  useEffect(() => { charger() }, [])
  useEffect(() => { if (selectedId) chargerDetail(selectedId) }, [selectedId])

  async function charger() {
    try {
      setLoading(true)
      const res = await fournisseursAPI.lister()
      const liste = res.data.fournisseurs || []
      setFournisseurs(liste)
      if (!selectedId && liste.length) setSelectedId(liste[0].id)
    } catch { toast.error('Erreur chargement fournisseurs') }
    finally { setLoading(false) }
  }

  async function chargerDetail(id) {
    try {
      setDetailLoading(true)
      const res = await fournisseursAPI.obtenir(id)
      setDetail(res.data)
    } catch { toast.error('Erreur chargement fiche fournisseur') }
    finally { setDetailLoading(false) }
  }

  function ouvrirNouveau() {
    setEditingId(null)
    setForm(FOURNISSEUR_VIDE)
    setShowModal(true)
  }

  function ouvrirEdition(f) {
    setEditingId(f.id)
    setForm({
      nom: f.nom, contact_nom: f.contact_nom || '', telephone: f.telephone || '',
      email: f.email || '', adresse: f.adresse || '', delai_livraison_jours: f.delai_livraison_jours ?? 3,
    })
    setShowModal(true)
  }

  async function soumettre(e) {
    e.preventDefault()
    const payload = { ...form, delai_livraison_jours: Number(form.delai_livraison_jours) || 0 }
    try {
      if (editingId) {
        await fournisseursAPI.modifier(editingId, payload)
        toast.success('Fournisseur modifié')
      } else {
        await fournisseursAPI.creer(payload)
        toast.success('Fournisseur créé')
      }
      setShowModal(false)
      charger()
      if (editingId && editingId === selectedId) chargerDetail(selectedId)
    } catch { toast.error('Erreur enregistrement fournisseur') }
  }

  async function archiver(f) {
    if (!confirm(`Archiver le fournisseur "${f.nom}" ?`)) return
    try {
      await fournisseursAPI.supprimer(f.id)
      toast.success('Fournisseur archivé')
      if (selectedId === f.id) setSelectedId(null)
      charger()
    } catch { toast.error('Erreur archivage') }
  }

  return (
    <AppLayout titre="Fournisseurs" sousTitre="Contacts & historique d'approvisionnement">
      <div className="space-y-5">
        <div className="flex items-center justify-end gap-2">
          <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
          <button onClick={ouvrirNouveau} className="btn btn-primary btn-sm">＋ Nouveau fournisseur</button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Liste */}
          <div className="card overflow-hidden col-span-1">
            {loading ? (
              <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
            ) : fournisseurs.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--text-3)]">
                <div className="text-3xl mb-2">🚚</div>
                <div className="font-semibold">Aucun fournisseur</div>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-0)]">
                {fournisseurs.map(f => (
                  <button key={f.id} onClick={() => setSelectedId(f.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-[var(--bg-3)] transition-colors ${selectedId === f.id ? 'bg-[var(--bg-3)]' : ''}`}>
                    <div className="text-xs font-semibold text-[var(--text-0)]">{f.nom}</div>
                    <div className="text-[10.5px] text-[var(--text-3)]">{f.contact_nom || f.telephone || '—'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fiche */}
          <div className="card p-5 col-span-2">
            {!selectedId || detailLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-8 rounded-lg" />)}</div>
            ) : !detail ? (
              <div className="text-xs text-[var(--text-3)]">Sélectionnez un fournisseur</div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="card-title">{detail.fournisseur.nom}</div>
                    <div className="text-[10.5px] text-[var(--text-3)] mt-0.5">
                      Délai de livraison : {detail.fournisseur.delai_livraison_jours} jour(s)
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => ouvrirEdition(detail.fournisseur)} className="btn btn-xs btn-ghost">✎ Modifier</button>
                    <button onClick={() => archiver(detail.fournisseur)} className="btn btn-xs btn-danger">🗑 Archiver</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><div className="text-[var(--text-3)] mb-0.5">Contact</div><div>{detail.fournisseur.contact_nom || '—'}</div></div>
                  <div><div className="text-[var(--text-3)] mb-0.5">Téléphone</div><div>{detail.fournisseur.telephone || '—'}</div></div>
                  <div><div className="text-[var(--text-3)] mb-0.5">Email</div><div>{detail.fournisseur.email || '—'}</div></div>
                  <div><div className="text-[var(--text-3)] mb-0.5">Adresse</div><div>{detail.fournisseur.adresse || '—'}</div></div>
                </div>

                <div>
                  <div className="card-title mb-2 text-xs">Historique des commandes</div>
                  {detail.bons.length === 0 ? (
                    <div className="text-xs text-[var(--text-3)]">Aucun bon d'achat pour ce fournisseur</div>
                  ) : (
                    <table className="table-base">
                      <thead>
                        <tr><th>N°</th><th>Date</th><th>Statut</th></tr>
                      </thead>
                      <tbody>
                        {detail.bons.map(b => (
                          <tr key={b.id}>
                            <td className="font-semibold">{b.numero_bon}</td>
                            <td className="text-[var(--text-2)]">{fmtDate(b.cree_le)}</td>
                            <td><span className={`badge ${STATUT_BADGE[b.statut]}`}>{STATUT_LABEL[b.statut]}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Fournisseur */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">{editingId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</div>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettre}>
              <div className="modal-body grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Nom *</label>
                  <input className="input" required value={form.nom}
                    onChange={e => setForm({ ...form, nom: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Contact</label>
                  <input className="input" value={form.contact_nom}
                    onChange={e => setForm({ ...form, contact_nom: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Téléphone</label>
                  <input className="input" value={form.telephone}
                    onChange={e => setForm({ ...form, telephone: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input type="email" className="input" value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Délai de livraison (jours)</label>
                  <input type="number" min="0" className="input" value={form.delai_livraison_jours}
                    onChange={e => setForm({ ...form, delai_livraison_jours: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Adresse</label>
                  <textarea className="input h-16 resize-none" value={form.adresse}
                    onChange={e => setForm({ ...form, adresse: e.target.value })} />
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
