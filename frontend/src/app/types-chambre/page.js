'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { typesChambreAPI, API_ORIGIN } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

const FORM_VIDE = {
  nom: '', description: '', capacite_adultes: 2, capacite_enfants: 0,
  superficie_m2: '', tarif_base: '', devise: 'XAF',
  amenagements: []
}

const AMENAGEMENTS_LISTE = [
  'Climatisation', 'Wi-Fi', 'TV écran plat', 'Mini-bar', 'Coffre-fort',
  'Baignoire', 'Douche italienne', 'Balcon', 'Vue sur jardin', 'Vue sur ville',
  'Bureau de travail', 'Canapé', 'Cuisine équipée', 'Jacuzzi', 'Piscine privée'
]

export default function TypesChambrePage() {
  const [types, setTypes]             = useState([])
  const [total, setTotal]             = useState(0)
  const [loading, setLoading]         = useState(true)
  const [showForm, setShowForm]       = useState(false)
  const [editing, setEditing]         = useState(null)
  const [saving, setSaving]           = useState(false)
  const [form, setForm]               = useState(FORM_VIDE)
  const [photos, setPhotos]           = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const res = await typesChambreAPI.lister()
      setTypes(res.data.types || [])
      setTotal(res.data.total || 0)
    } catch { toast.error('Erreur chargement types de chambre') }
    finally { setLoading(false) }
  }

  function ouvrirCreation() {
    setEditing(null)
    setForm(FORM_VIDE)
    setPhotos([])
    setShowForm(true)
  }

  function ouvrirEdition(t) {
    setEditing(t.id)
    setPhotos(Array.isArray(t.photos) ? t.photos : [])
    setForm({
      nom:              t.nom || '',
      description:      t.description || '',
      capacite_adultes: t.capacite_adultes ?? 2,
      capacite_enfants: t.capacite_enfants ?? 0,
      superficie_m2:    t.superficie_m2 || '',
      tarif_base:       t.tarif_base || '',
      devise:           t.devise || 'XAF',
      amenagements:     Array.isArray(t.amenagements) ? t.amenagements : [],
    })
    setShowForm(true)
  }

  function fermerForm() {
    setShowForm(false)
    setEditing(null)
    setForm(FORM_VIDE)
    setPhotos([])
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const fd = new FormData()
    fd.append('file', file)
    setUploadingPhoto(true)
    try {
      const res = await typesChambreAPI.uploadPhoto(editing, fd)
      setPhotos(res.data.photos || [])
      charger()
      toast.success('Photo ajoutée')
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur upload photo')
    } finally { setUploadingPhoto(false) }
  }

  async function supprimerPhoto(url) {
    try {
      const res = await typesChambreAPI.supprimerPhoto(editing, url)
      setPhotos(res.data.photos || [])
      charger()
      toast.success('Photo supprimée')
    } catch {
      toast.error('Erreur suppression photo')
    }
  }

  function toggleAmenagement(a) {
    setForm(f => ({
      ...f,
      amenagements: f.amenagements.includes(a)
        ? f.amenagements.filter(x => x !== a)
        : [...f.amenagements, a]
    }))
  }

  async function sauvegarder(e) {
    e.preventDefault()
    if (!form.nom.trim()) return toast.error('Nom requis')
    if (!form.tarif_base || isNaN(parseFloat(form.tarif_base)))
      return toast.error('Tarif de base requis')
    try {
      setSaving(true)
      const payload = {
        ...form,
        tarif_base:    parseFloat(form.tarif_base),
        superficie_m2: form.superficie_m2 ? parseFloat(form.superficie_m2) : null,
        capacite_adultes: parseInt(form.capacite_adultes),
        capacite_enfants: parseInt(form.capacite_enfants),
      }
      if (editing) {
        await typesChambreAPI.modifier(editing, payload)
        toast.success('Type mis à jour')
      } else {
        await typesChambreAPI.creer(payload)
        toast.success('Type créé')
      }
      fermerForm()
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur sauvegarde')
    } finally { setSaving(false) }
  }

  async function toggleActif(t) {
    try {
      await typesChambreAPI.modifier(t.id, { actif: !t.actif })
      toast.success(t.actif ? 'Type désactivé' : 'Type activé')
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur')
    }
  }

  async function supprimer(t) {
    if (!window.confirm(`Désactiver "${t.nom}" ?`)) return
    try {
      await typesChambreAPI.supprimer(t.id)
      toast.success('Type désactivé')
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur suppression')
    }
  }

  return (
    <AppLayout titre="Types de chambre" sousTitre="Configuration des catégories">
      <div className="space-y-5">
        {/* En-tête */}
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--text-3)]">{total} type{total !== 1 ? 's' : ''} configuré{total !== 1 ? 's' : ''}</div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
            <button onClick={ouvrirCreation} className="btn btn-primary btn-sm">＋ Nouveau type</button>
          </div>
        </div>

        {/* Formulaire création / édition */}
        {showForm && (
          <div className="card p-6">
            <div className="card-title mb-5">{editing ? 'Modifier le type' : 'Nouveau type de chambre'}</div>
            <form onSubmit={sauvegarder} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="form-label">Nom du type *</label>
                  <input className="input" required value={form.nom}
                    placeholder="ex: Suite Junior, Standard Twin..."
                    onChange={e => setForm({ ...form, nom: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Description</label>
                  <textarea className="input min-h-[72px] resize-none" value={form.description}
                    placeholder="Description de la catégorie..."
                    onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Capacité adultes</label>
                  <input type="number" className="input" min="1" max="20"
                    value={form.capacite_adultes}
                    onChange={e => setForm({ ...form, capacite_adultes: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Capacité enfants</label>
                  <input type="number" className="input" min="0" max="10"
                    value={form.capacite_enfants}
                    onChange={e => setForm({ ...form, capacite_enfants: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Superficie (m²)</label>
                  <input type="number" className="input" min="0" step="0.5"
                    value={form.superficie_m2} placeholder="ex: 24"
                    onChange={e => setForm({ ...form, superficie_m2: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Tarif de référence (XAF/nuit) *</label>
                  <input type="number" className="input" min="0" required
                    value={form.tarif_base} placeholder="ex: 45000"
                    onChange={e => setForm({ ...form, tarif_base: e.target.value })} />
                </div>
              </div>

              {/* Aménagements */}
              <div>
                <label className="form-label mb-2 block">Aménagements inclus</label>
                <div className="flex flex-wrap gap-2">
                  {AMENAGEMENTS_LISTE.map(a => (
                    <button key={a} type="button"
                      onClick={() => toggleAmenagement(a)}
                      className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                        form.amenagements.includes(a)
                          ? 'bg-blue-500/20 border-blue-500/60 text-blue-400'
                          : 'border-[var(--border-1)] text-[var(--text-3)] hover:border-[var(--border-2)]'
                      }`}>
                      {a}
                    </button>
                  ))}
                </div>
                {form.amenagements.length > 0 && (
                  <div className="text-[10px] text-[var(--text-3)] mt-1.5">
                    {form.amenagements.length} aménagement{form.amenagements.length > 1 ? 's' : ''} sélectionné{form.amenagements.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>

              {/* Photos — section visible uniquement en mode édition */}
              {editing ? (
                <div>
                  <label className="form-label mb-2 block">Photos du type</label>
                  {photos.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-2">
                      {photos.map((url, i) => (
                        <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border-1)]">
                          <img src={API_ORIGIN + url} alt={`photo ${i+1}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => supprimerPhoto(url)}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-600/90 hover:bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center transition-colors"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {photos.length < 5 && (
                    <label className={`cursor-pointer inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${uploadingPhoto ? 'opacity-50 cursor-not-allowed' : 'text-blue-400 border-blue-500/30 hover:bg-blue-500/10'}`}>
                      <span>📷</span>
                      <span>{uploadingPhoto ? 'Envoi...' : 'Ajouter une photo'}</span>
                      <input type="file" accept=".jpg,.jpeg,.png,.webp" className="sr-only"
                        disabled={uploadingPhoto} onChange={handlePhotoUpload} />
                    </label>
                  )}
                  <div className="text-[10px] text-[var(--text-4)] mt-1">{photos.length}/5 photos · JPG, PNG, WebP</div>
                </div>
              ) : (
                <div className="text-[10px] text-[var(--text-4)] italic">Les photos peuvent être ajoutées après création du type.</div>
              )}

              <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border-1)]">
                <button type="button" onClick={fermerForm} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? 'Sauvegarde...' : editing ? 'Enregistrer les modifications' : 'Créer le type'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : types.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-4xl mb-3">🏷</div>
            <div className="text-sm font-semibold text-[var(--text-1)] mb-1">Aucun type de chambre</div>
            <div className="text-xs text-[var(--text-3)] mb-4">Créez vos premiers types pour configurer vos chambres</div>
            <button onClick={ouvrirCreation} className="btn btn-primary btn-sm">＋ Créer un type</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {types.map(t => (
              <div key={t.id} className={`card p-4 flex items-center gap-4 transition-opacity ${!t.actif ? 'opacity-50' : ''}`}>
                {/* Miniature photo ou icône */}
                {Array.isArray(t.photos) && t.photos.length > 0 ? (
                  <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-[var(--border-1)]">
                    <img src={API_ORIGIN + t.photos[0]} alt={t.nom} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/20 flex items-center justify-center text-lg flex-shrink-0">
                    🛏
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[var(--text-1)]">{t.nom}</span>
                    {!t.actif && <span className="badge badge-gray text-[9px]">Inactif</span>}
                  </div>
                  {t.description && (
                    <div className="text-xs text-[var(--text-3)] mt-0.5 truncate">{t.description}</div>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="text-[10px] text-[var(--text-3)]">
                      👤 {t.capacite_adultes} adulte{t.capacite_adultes > 1 ? 's' : ''}
                      {t.capacite_enfants > 0 ? ` + ${t.capacite_enfants} enfant${t.capacite_enfants > 1 ? 's' : ''}` : ''}
                    </span>
                    {t.superficie_m2 && (
                      <span className="text-[10px] text-[var(--text-3)]">📐 {t.superficie_m2} m²</span>
                    )}
                    {Array.isArray(t.amenagements) && t.amenagements.length > 0 && (
                      <span className="text-[10px] text-[var(--text-3)]">✓ {t.amenagements.length} aménagements</span>
                    )}
                  </div>
                </div>

                {/* Tarif */}
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-blue-400 text-sm">{fmt(t.tarif_base, 'XAF')}</div>
                  <div className="text-[10px] text-[var(--text-3)]">/ nuit · HT</div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => ouvrirEdition(t)} className="btn btn-ghost btn-xs">✏ Modifier</button>
                  <button onClick={() => toggleActif(t)}
                    className={`btn btn-xs ${t.actif ? 'btn-ghost text-amber-400' : 'btn-ghost text-emerald-400'}`}>
                    {t.actif ? '⏸ Désactiver' : '▶ Activer'}
                  </button>
                  {!t.actif && (
                    <button onClick={() => supprimer(t)} className="btn btn-ghost btn-xs text-red-400">
                      🗑 Supprimer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
