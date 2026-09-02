'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import AppLayout from '@/components/layout/AppLayout'
import { chambresAPI, typesChambreAPI, API_ORIGIN } from '@/lib/api'
import { STATUT_CHAMBRE_COULEUR, useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = {
  libre_propre: 'Libre & Propre', occupee: 'Occupée', sale: 'Sale',
  nettoyage: 'En nettoyage', inspection: 'Inspection', hors_service: 'Hors service'
}
const STATUT_ICON = {
  libre_propre: '✅', occupee: '🔵', sale: '🟡',
  nettoyage: '🧹', inspection: '🔍', hors_service: '🔴'
}
const STATUTS = ['','libre_propre','occupee','sale','nettoyage','hors_service']
const FORM_VIDE = {
  numero: '', etage: 1, type_chambre_id: '',
  description: '', vue: '', superficie_m2: '',
  tarif_specifique: '', notes_internes: ''
}

export default function ChambresPage() {
  const { user } = useAuthStore()
  const peutAdministrer = user?.role === 'manager' || user?.role === 'super_admin'
  const peutGererMenage = user?.role !== 'reception'
  const [chambres, setChambres]   = useState([])
  const [apiStats, setApiStats]   = useState(null)
  const [types, setTypes]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [filtre, setFiltre]       = useState('')
  const [vue, setVue]             = useState('grille')
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null)
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState(FORM_VIDE)
  const [images, setImages]       = useState([])
  const [uploadingImage, setUploadingImage] = useState(false)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const [chRes, tcRes] = await Promise.allSettled([
        chambresAPI.lister(),
        typesChambreAPI.lister(),
      ])
      if (chRes.status === 'fulfilled') {
        setChambres(chRes.value.data.donnees || [])
        setApiStats(chRes.value.data.stats   || null)
      }
      if (tcRes.status === 'fulfilled') setTypes((tcRes.value.data.types || []).filter(t => t.actif))
    } catch { toast.error('Erreur chargement chambres') }
    finally { setLoading(false) }
  }

  async function changerStatut(id, statut) {
    try {
      await chambresAPI.changerStatut(id, { statut })
      toast.success('Statut mis à jour')
      charger()
    } catch { toast.error('Erreur mise à jour statut') }
  }

  function ouvrirCreation() {
    setEditing(null)
    setForm(FORM_VIDE)
    setShowForm(true)
  }

  async function chargerImages(chambreId) {
    try {
      const res = await chambresAPI.obtenir(chambreId)
      setImages(res.data.images || [])
    } catch { setImages([]) }
  }

  function ouvrirEdition(c) {
    setEditing(c.id)
    setForm({
      numero:          c.numero || '',
      etage:           c.etage ?? 1,
      type_chambre_id: c.type_chambre_id || '',
      description:     c.description || '',
      vue:             c.vue || '',
      superficie_m2:   c.superficie_m2 || '',
      tarif_specifique:c.tarif_specifique || '',
      notes_internes:  c.notes_internes || '',
    })
    setImages([])
    chargerImages(c.id)
    setShowForm(true)
  }

  function fermerForm() {
    setShowForm(false)
    setEditing(null)
    setForm(FORM_VIDE)
    setImages([])
  }

  async function uploaderImage(file) {
    if (!editing) return
    try {
      setUploadingImage(true)
      await chambresAPI.uploaderImage(editing, file)
      await chargerImages(editing)
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur upload image')
    } finally { setUploadingImage(false) }
  }

  async function supprimerImage(imageId) {
    if (!window.confirm('Supprimer cette image ?')) return
    try {
      await chambresAPI.supprimerImage(editing, imageId)
      await chargerImages(editing)
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur suppression image')
    }
  }

  async function definirPrincipale(imageId) {
    try {
      await chambresAPI.definirImagePrincipale(editing, imageId)
      await chargerImages(editing)
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur')
    }
  }

  async function sauvegarder(e) {
    e.preventDefault()
    if (!form.numero.trim()) return toast.error('Numéro requis')
    try {
      setSaving(true)
      const payload = {
        ...form,
        etage:            parseInt(form.etage),
        superficie_m2:    form.superficie_m2  ? parseFloat(form.superficie_m2)   : null,
        tarif_specifique: form.tarif_specifique ? parseFloat(form.tarif_specifique) : null,
        type_chambre_id:  form.type_chambre_id || null,
      }
      if (editing) {
        await chambresAPI.modifier(editing, payload)
        toast.success('Chambre mise à jour')
        fermerForm()
      } else {
        const res = await chambresAPI.creer(payload)
        const creee = res.data.chambre
        toast.success('Chambre créée — ajoutez des photos ci-dessous')
        setEditing(creee.id)
        setImages([])
      }
      charger()
    } catch (err) {
      const msg = err?.response?.data?.erreur || 'Erreur sauvegarde'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  async function mettreHorsService(c) {
    const raison = window.prompt(`Motif de mise hors service — chambre ${c.numero} :`)
    if (!raison?.trim()) return
    try {
      await chambresAPI.supprimer(c.id, { raison: raison.trim() })
      toast.success(`Chambre ${c.numero} hors service`)
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur')
    }
  }

  async function remettreEnService(c) {
    if (!window.confirm(`Remettre la chambre ${c.numero} en service ?`)) return
    try {
      await chambresAPI.changerStatut(c.id, { hors_service: false })
      toast.success(`Chambre ${c.numero} remise en service`)
      charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur')
    }
  }

  const filtrees = filtre ? chambres.filter(c => c.statut === filtre) : chambres
  const stats = {
    total:       apiStats?.total    ?? chambres.length,
    libres:      apiStats?.libres   ?? chambres.filter(c => c.statut === 'libre_propre').length,
    occupees:    apiStats?.occupees ?? chambres.filter(c => c.statut === 'occupee').length,
    menage:      apiStats?.a_nettoyer ?? chambres.filter(c => ['sale','nettoyage'].includes(c.statut)).length,
    hors_service: apiStats?.hors_service ?? chambres.filter(c => c.hors_service).length,
  }

  return (
    <AppLayout titre="Chambres" sousTitre="État en temps réel">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total',        val: stats.total,        icon: '🏨' },
            { label: 'Disponibles',  val: stats.libres,       icon: '✅' },
            { label: 'Occupées',     val: stats.occupees,     icon: '🔵' },
            { label: 'Hors service', val: stats.hors_service, icon: '🔴' },
          ].map(k => (
            <div key={k.label} className="kpi-card">
              <div className="absolute right-3 top-3 text-xl opacity-10">{k.icon}</div>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.val}</div>
            </div>
          ))}
        </div>

        {/* Filtres + Vue + Bouton créer */}
        <div className="card px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-1.5 flex-wrap">
            {STATUTS.map(s => (
              <button key={s} onClick={() => setFiltre(s)}
                className={`btn btn-sm ${filtre === s ? 'btn-primary' : ''}`}
                style={filtre !== s ? {
                  background: 'var(--bg-3)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border-1)',
                } : {}}>
                {s ? `${STATUT_ICON[s]} ${STATUT_LABEL[s]}` : '✦ Toutes'}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 border-l border-[var(--border-1)] pl-3">
            <button onClick={() => setVue('grille')} className="btn btn-sm" style={vue==='grille' ? {} : { background:'var(--bg-3)', color:'var(--text-1)', border:'1px solid var(--border-1)' }}>⊞ Grille</button>
            <button onClick={() => setVue('liste')}  className="btn btn-sm" style={vue==='liste'  ? {} : { background:'var(--bg-3)', color:'var(--text-1)', border:'1px solid var(--border-1)' }}>☰ Liste</button>
            <button onClick={charger} className="btn btn-sm" style={{ background:'var(--bg-3)', color:'var(--text-1)', border:'1px solid var(--border-1)' }}>↻</button>
            {peutAdministrer && (
              <button onClick={ouvrirCreation} className="btn btn-primary btn-sm">＋ Nouvelle chambre</button>
            )}
          </div>
        </div>

        {/* Formulaire création / édition */}
        {showForm && (
          <div className="card p-6">
            <div className="card-title mb-5">{editing ? 'Modifier la chambre' : 'Nouvelle chambre'}</div>
            <form onSubmit={sauvegarder} className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Numéro de chambre *</label>
                <input className="input" required value={form.numero} placeholder="ex: 101, 205A..."
                  onChange={e => setForm({ ...form, numero: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Étage *</label>
                <input type="number" className="input" min="0" max="50" required value={form.etage}
                  onChange={e => setForm({ ...form, etage: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Type de chambre</label>
                <select className="input" value={form.type_chambre_id}
                  onChange={e => setForm({ ...form, type_chambre_id: e.target.value })}>
                  <option value="">— Sans type —</option>
                  {types.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nom} ({Number(t.tarif_base).toLocaleString()} XAF/nuit)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Vue (optionnel)</label>
                <input className="input" value={form.vue} placeholder="ex: Vue jardin, Vue ville..."
                  onChange={e => setForm({ ...form, vue: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Superficie (m²)</label>
                <input type="number" className="input" min="0" step="0.5" value={form.superficie_m2}
                  placeholder="ex: 24"
                  onChange={e => setForm({ ...form, superficie_m2: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Tarif spécifique (XAF/nuit)</label>
                <input type="number" className="input" min="0" value={form.tarif_specifique}
                  placeholder="Laissez vide pour utiliser le tarif du type"
                  onChange={e => setForm({ ...form, tarif_specifique: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Description</label>
                <input className="input" value={form.description} placeholder="Description spécifique à cette chambre..."
                  onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Notes internes</label>
                <input className="input" value={form.notes_internes} placeholder="Notes pour l'équipe..."
                  onChange={e => setForm({ ...form, notes_internes: e.target.value })} />
              </div>
              {/* ── Galerie d'images (édition uniquement) ── */}
              {editing && (
                <div className="col-span-2 border-t border-[var(--border-1)] pt-4 mt-1">
                  <div className="flex items-center justify-between mb-3">
                    <span className="form-label mb-0">Galerie d'images ({images.length}/7)</span>
                    {images.length < 7 ? (
                      <label className={`btn btn-sm btn-ghost cursor-pointer ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                        {uploadingImage ? '⏳ Upload...' : '＋ Ajouter une image'}
                        <input type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden"
                          disabled={uploadingImage}
                          onChange={e => { if (e.target.files[0]) uploaderImage(e.target.files[0]); e.target.value = '' }} />
                      </label>
                    ) : (
                      <span className="text-xs text-red-400 font-medium">⚠ Maximum 7 images atteint</span>
                    )}
                  </div>
                  {images.length === 0 ? (
                    <div className="text-xs text-[var(--text-3)] py-2">
                      Aucune image — ajoutez-en jusqu'à 7 (JPG, PNG, WebP)
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {images.map(img => (
                        <div key={img.id}
                          className={`relative rounded-lg overflow-hidden border-2 ${img.est_principale ? 'border-blue-500' : 'border-[var(--border-1)]'}`}>
                          <img src={`${API_ORIGIN}${img.url_fichier}`} alt={img.nom_fichier}
                            className="w-full h-24 object-cover bg-[var(--bg-2)]" />
                          {img.est_principale && (
                            <div className="absolute top-1 left-1 bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded font-semibold">
                              ★ Principale
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/70 flex">
                            {!img.est_principale && (
                              <button type="button" onClick={() => definirPrincipale(img.id)}
                                className="flex-1 text-[10px] text-yellow-300 py-1 hover:bg-white/10 transition-colors"
                                title="Définir comme principale">
                                ★
                              </button>
                            )}
                            <button type="button" onClick={() => supprimerImage(img.id)}
                              className="flex-1 text-[10px] text-red-400 py-1 hover:bg-white/10 transition-colors"
                              title="Supprimer">
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="col-span-2 flex gap-2 justify-end pt-2 border-t border-[var(--border-1)]">
                <button type="button" onClick={fermerForm} className="btn btn-ghost btn-sm">{editing ? 'Terminer' : 'Annuler'}</button>
                <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? 'Sauvegarde...' : editing ? 'Enregistrer' : 'Créer la chambre'}
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : filtrees.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-4xl mb-3">🏨</div>
            <div className="text-sm font-semibold text-[var(--text-1)] mb-1">
              {filtre ? `Aucune chambre "${STATUT_LABEL[filtre]}"` : 'Aucune chambre configurée'}
            </div>
            {!filtre && peutAdministrer && (
              <button onClick={ouvrirCreation} className="btn btn-primary btn-sm mt-3">＋ Créer une chambre</button>
            )}
          </div>
        ) : vue === 'grille' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filtrees.map(c => (
              <div key={c.id} className={`card p-3 transition-all group ${c.hors_service ? 'opacity-40' : 'hover:border-blue-500/50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-black text-[var(--text-1)]">{c.numero}</span>
                  <span className="text-base">{STATUT_ICON[c.statut]}</span>
                </div>
                <div className="text-[10px] text-[var(--text-3)] mb-0.5">Étage {c.etage}</div>
                <div className="text-[10px] text-[var(--text-3)] mb-2 truncate">{c.type_chambre || '—'}</div>
                <span className={`badge text-[9px] ${STATUT_CHAMBRE_COULEUR[c.statut] || 'badge-gray'}`}>
                  {STATUT_LABEL[c.statut]}
                </span>
                {/* Actions rapides hover */}
                <div className="mt-2 space-y-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {c.reservation_active_id && (
                    <Link href={`/reservations/${c.reservation_active_id}`}
                      className="btn btn-xs btn-ghost w-full text-[9px] text-blue-400">
                      → Voir réservation
                    </Link>
                  )}
                  {peutGererMenage && c.statut === 'sale' && (
                    <button onClick={() => changerStatut(c.id, 'nettoyage')}
                      className="btn btn-xs btn-ghost w-full text-[9px]">🧹 Nettoyer</button>
                  )}
                  {peutGererMenage && c.statut === 'nettoyage' && (
                    <button onClick={() => changerStatut(c.id, 'libre_propre')}
                      className="btn btn-xs btn-ghost w-full text-[9px]">✅ Propre</button>
                  )}
                  {peutAdministrer && (
                    <button onClick={() => ouvrirEdition(c)}
                      className="btn btn-xs btn-ghost w-full text-[9px]">✏ Modifier</button>
                  )}
                  {c.hors_service ? (
                    <button onClick={() => remettreEnService(c)}
                      className="btn btn-xs btn-ghost w-full text-[9px] text-green-400">✅ Remettre en service</button>
                  ) : peutAdministrer && c.statut !== 'occupee' && (
                    <button onClick={() => mettreHorsService(c)}
                      className="btn btn-xs btn-ghost w-full text-[9px] text-red-400">🚫 Hors service</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-1)]">
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Numéro</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Étage</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Type</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtrees.map(c => (
                  <tr key={c.id} className={`border-b border-[var(--border-1)] hover:bg-[var(--bg-2)] ${c.hors_service ? 'opacity-40' : ''}`}>
                    <td className="px-4 py-3 font-bold text-[var(--text-1)]">{c.numero}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">Étage {c.etage}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{c.type_chambre || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUT_CHAMBRE_COULEUR[c.statut] || 'badge-gray'}`}>
                        {STATUT_ICON[c.statut]} {STATUT_LABEL[c.statut]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {c.reservation_active_id && (
                          <Link href={`/reservations/${c.reservation_active_id}`}
                            className="btn btn-xs btn-ghost text-blue-400">
                            → Réservation
                          </Link>
                        )}
                        {peutGererMenage && c.statut === 'sale' && (
                          <button onClick={() => changerStatut(c.id, 'nettoyage')} className="btn btn-xs btn-ghost">🧹</button>
                        )}
                        {peutGererMenage && c.statut === 'nettoyage' && (
                          <button onClick={() => changerStatut(c.id, 'libre_propre')} className="btn btn-xs btn-ghost">✅</button>
                        )}
                        {peutAdministrer && (
                          <button onClick={() => ouvrirEdition(c)} className="btn btn-xs btn-ghost">✏ Modifier</button>
                        )}
                        {c.hors_service ? (
                          <button onClick={() => remettreEnService(c)} className="btn btn-xs btn-ghost text-green-400">✅ En service</button>
                        ) : peutAdministrer && c.statut !== 'occupee' && (
                          <button onClick={() => mettreHorsService(c)} className="btn btn-xs btn-ghost text-red-400">🚫</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
