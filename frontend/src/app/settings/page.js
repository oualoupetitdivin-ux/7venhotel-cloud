'use client'
import { useState, useEffect, useRef } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { hotelsAPI, API_ORIGIN } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'

const TAUX_TVA_DEFAUT  = 18
const TAUX_CSS_DEFAUT  = 1

export default function SettingsPage() {
  const { hotel } = useAuthStore()
  const [params,       setParams]       = useState(null)
  const [taxes,        setTaxes]        = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [savingTx,     setSavingTx]     = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [onglet,       setOnglet]       = useState('general')
  const fileInputRef = useRef(null)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      if (hotel?.id) {
        const res = await hotelsAPI.obtenir(hotel.id)
        const p = res.data.parametres || {}
        setParams({ ...res.data.hotel, image_fond_url: p.image_fond_url || '' })
        setTaxes({
          tva_active:           p.tva_active           ?? true,
          tva_taux:             p.tva_taux             != null ? parseFloat((p.tva_taux * 100).toFixed(4)) : TAUX_TVA_DEFAUT,
          css_active:           p.css_active           ?? true,
          css_taux:             p.css_taux             != null ? parseFloat((p.css_taux * 100).toFixed(4)) : TAUX_CSS_DEFAUT,
          taxe_sejour_active:   p.taxe_sejour_active   ?? false,
          taxe_sejour_montant:  p.taxe_sejour_montant  ?? 0,
          tva_numero:           p.tva_numero           || '',
        })
      }
    } catch { toast.error('Erreur chargement paramètres') }
    finally { setLoading(false) }
  }

  async function sauvegarder(e) {
    e.preventDefault()
    try {
      setSaving(true)
      const { image_fond_url, ...hotelFields } = params
      await hotelsAPI.mettreAJour(hotel.id, hotelFields)
      await hotelsAPI.majParametres(hotel.id, { image_fond_url: image_fond_url || null })
      toast.success('Paramètres sauvegardés !')
    } catch { toast.error('Erreur sauvegarde') }
    finally { setSaving(false) }
  }

  async function handleImageChange(e) {
    const fichier = e.target.files?.[0]
    if (!fichier || !hotel?.id) return
    try {
      setUploadingImg(true)
      const res = await hotelsAPI.uploadImageFond(hotel.id, fichier)
      const url = res.data.url
      setParams(p => ({ ...p, image_fond_url: url }))
      toast.success('Photo d\'ambiance mise à jour !')
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur upload')
    } finally {
      setUploadingImg(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function sauvegarderTaxes(e) {
    e.preventDefault()
    if (!taxes) return
    const tvaTaux = parseFloat(taxes.tva_taux)
    const cssTaux = parseFloat(taxes.css_taux)
    if (isNaN(tvaTaux) || tvaTaux < 0 || tvaTaux > 100) {
      toast.error('Taux TVA invalide (0-100)')
      return
    }
    if (isNaN(cssTaux) || cssTaux < 0 || cssTaux > 100) {
      toast.error('Taux CSS invalide (0-100)')
      return
    }
    try {
      setSavingTx(true)
      await hotelsAPI.majParametres(hotel.id, {
        tva_active:          taxes.tva_active,
        tva_taux:            (tvaTaux / 100).toFixed(4),
        css_active:          taxes.css_active,
        css_taux:            (cssTaux / 100).toFixed(4),
        taxe_sejour_active:  taxes.taxe_sejour_active,
        taxe_sejour_montant: parseInt(taxes.taxe_sejour_montant) || 0,
        tva_numero:          taxes.tva_numero || null,
      })
      toast.success('Configuration fiscale sauvegardée !')
    } catch { toast.error('Erreur sauvegarde fiscale') }
    finally { setSavingTx(false) }
  }

  if (loading) return (
    <AppLayout titre="Paramètres" sousTitre="Configuration de l'hôtel">
      <div className="space-y-4">
        <div className="skeleton h-48 rounded-xl" />
        <div className="skeleton h-36 rounded-xl" />
        <div className="skeleton h-36 rounded-xl" />
      </div>
    </AppLayout>
  )

  const TVA_EXEMPLE  = taxes ? Math.round(100000 * (parseFloat(taxes.tva_taux) || 0) / 100) : 0
  const CSS_EXEMPLE  = taxes ? Math.round(100000 * (parseFloat(taxes.css_taux) || 0) / 100) : 0
  const TS_EXEMPLE   = taxes ? parseInt(taxes.taxe_sejour_montant) || 0 : 0
  const TTC_EXEMPLE  = 100000
    + (taxes?.tva_active ? TVA_EXEMPLE : 0)
    + (taxes?.css_active ? CSS_EXEMPLE : 0)
    + (taxes?.taxe_sejour_active ? TS_EXEMPLE : 0)

  return (
    <AppLayout titre="Paramètres" sousTitre="Configuration de l'hôtel">
      <div className="space-y-5">
        <div className="card p-5">
          {/* En-tête */}
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl text-white font-black">
              7
            </div>
            <div>
              <div className="text-lg font-black text-[var(--text-1)]">{hotel?.nom || 'Hôtel'}</div>
              <div className="text-xs text-[var(--text-3)]">Cloud PMS v5 · {hotel?.devise || 'XAF'} · {hotel?.fuseau_horaire || 'Africa/Douala'}</div>
            </div>
          </div>

          {/* Onglets */}
          <div className="flex gap-2 border-b border-[var(--border-1)] mb-5 flex-wrap">
            {[
              ['general',     '⚙️ Général'],
              ['fiscalite',   '🧾 Fiscalité'],
              ['notifications','🔔 Notifications'],
              ['compte',      '👤 Mon compte'],
            ].map(([k, l]) => (
              <button key={k} onClick={() => setOnglet(k)}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)]'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* ── Général ── */}
          {onglet === 'general' && params && (
            <form onSubmit={sauvegarder} className="grid grid-cols-2 gap-5">
              <div>
                <label className="form-label">Nom de l'hôtel</label>
                <input className="input" value={params.nom || ''} onChange={e => setParams({...params, nom:e.target.value})} />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input className="input" type="email" value={params.email || ''} onChange={e => setParams({...params, email:e.target.value})} />
              </div>
              <div>
                <label className="form-label">Téléphone</label>
                <input className="input" value={params.telephone || ''} onChange={e => setParams({...params, telephone:e.target.value})} />
              </div>
              <div>
                <label className="form-label">Ville</label>
                <input className="input" value={params.ville || ''} onChange={e => setParams({...params, ville:e.target.value})} />
              </div>
              <div>
                <label className="form-label">Adresse</label>
                <input className="input" value={params.adresse || ''} onChange={e => setParams({...params, adresse:e.target.value})} />
              </div>
              <div>
                <label className="form-label">Pays</label>
                <input className="input" value={params.pays || ''} onChange={e => setParams({...params, pays:e.target.value})} />
              </div>
              <div className="col-span-2">
                <label className="form-label">Photo d'ambiance — fond d'écran de l'interface</label>

                {/* Zone de prévisualisation / drop zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="relative mt-1 rounded-xl border-2 border-dashed border-[var(--border-1)] overflow-hidden cursor-pointer hover:border-blue-500/60 transition-colors"
                  style={{ height: '140px', background: 'var(--bg-2)' }}>

                  {params.image_fond_url ? (
                    <>
                      <img
                        src={params.image_fond_url.startsWith('/uploads/')
                          ? `${API_ORIGIN}${params.image_fond_url}`
                          : params.image_fond_url}
                        alt="Fond d'écran actuel"
                        className="w-full h-full object-cover"
                        onError={e => { e.target.style.display = 'none' }} />
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                        <span className="text-2xl">🖼</span>
                        <span className="text-xs text-white font-medium">Changer l'image</span>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--text-3)]">
                      {uploadingImg ? (
                        <>
                          <div className="w-6 h-6 border-2 border-blue-500/40 border-t-blue-500 rounded-full animate-spin" />
                          <span className="text-xs">Envoi en cours…</span>
                        </>
                      ) : (
                        <>
                          <span className="text-3xl">📸</span>
                          <span className="text-xs font-medium">Cliquer pour choisir une photo</span>
                          <span className="text-[10px]">JPG, PNG, WebP — max 10 Mo</span>
                        </>
                      )}
                    </div>
                  )}

                  {uploadingImg && params.image_fond_url && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleImageChange}
                  disabled={uploadingImg} />

                {params.image_fond_url && (
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-[var(--text-3)] font-mono truncate max-w-xs">
                      {params.image_fond_url}
                    </span>
                    <button type="button"
                      onClick={() => setParams(p => ({ ...p, image_fond_url: null }))}
                      className="text-[10px] text-red-400 hover:text-red-300 ml-2 flex-shrink-0">
                      ✕ Supprimer
                    </button>
                  </div>
                )}

                <p className="text-xs text-[var(--text-3)] mt-1">
                  Affichée en fond semi-transparent sur toute l'interface. L'upload est immédiat.
                </p>
              </div>
              <div className="col-span-2 flex justify-end">
                <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? 'Sauvegarde...' : '💾 Sauvegarder'}
                </button>
              </div>
            </form>
          )}

          {/* ── Fiscalité ── */}
          {onglet === 'fiscalite' && taxes && (
            <form onSubmit={sauvegarderTaxes} className="space-y-6">
              <p className="text-xs text-[var(--text-3)]">
                Configuration OHADA — les taux s'appliquent sur le montant HT hébergement lors de la facturation.
              </p>

              {/* TVA */}
              <div className="card p-4 space-y-3" style={{background:'var(--bg-2)'}}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-[var(--text-1)]">TVA — Taxe sur la Valeur Ajoutée</div>
                    <div className="text-xs text-[var(--text-3)]">Cameroun : 19,25 % (18 % TVA + 1,25 % CAC) — saisir le taux global applicable</div>
                  </div>
                  <button type="button" onClick={() => setTaxes({...taxes, tva_active: !taxes.tva_active})}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${taxes.tva_active ? 'bg-blue-500' : 'bg-[var(--border-1)]'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${taxes.tva_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
                {taxes.tva_active && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Taux TVA (%)</label>
                      <div className="flex items-center gap-2">
                        <input className="input" type="number" step="0.01" min="0" max="100"
                          value={taxes.tva_taux}
                          onChange={e => setTaxes({...taxes, tva_taux: e.target.value})} />
                        <span className="text-xs text-[var(--text-3)]">%</span>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">N° TVA de l'hôtel</label>
                      <input className="input" placeholder="CM-TXP-2024-001"
                        value={taxes.tva_numero}
                        onChange={e => setTaxes({...taxes, tva_numero: e.target.value})} />
                    </div>
                  </div>
                )}
              </div>

              {/* CSS */}
              <div className="card p-4 space-y-3" style={{background:'var(--bg-2)'}}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-[var(--text-1)]">CSS — Contribution Spéciale de Solidarité</div>
                    <div className="text-xs text-[var(--text-3)]">Cameroun : 1 % sur le montant HT</div>
                  </div>
                  <button type="button" onClick={() => setTaxes({...taxes, css_active: !taxes.css_active})}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${taxes.css_active ? 'bg-blue-500' : 'bg-[var(--border-1)]'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${taxes.css_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
                {taxes.css_active && (
                  <div className="w-1/2">
                    <label className="form-label">Taux CSS (%)</label>
                    <div className="flex items-center gap-2">
                      <input className="input" type="number" step="0.01" min="0" max="100"
                        value={taxes.css_taux}
                        onChange={e => setTaxes({...taxes, css_taux: e.target.value})} />
                      <span className="text-xs text-[var(--text-3)]">%</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Taxe de séjour */}
              <div className="card p-4 space-y-3" style={{background:'var(--bg-2)'}}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-[var(--text-1)]">Taxe de séjour</div>
                    <div className="text-xs text-[var(--text-3)]">Montant fixe par nuit (en {hotel?.devise || 'XAF'})</div>
                  </div>
                  <button type="button" onClick={() => setTaxes({...taxes, taxe_sejour_active: !taxes.taxe_sejour_active})}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${taxes.taxe_sejour_active ? 'bg-blue-500' : 'bg-[var(--border-1)]'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${taxes.taxe_sejour_active ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </div>
                {taxes.taxe_sejour_active && (
                  <div className="w-1/2">
                    <label className="form-label">Montant par nuit ({hotel?.devise || 'XAF'})</label>
                    <input className="input" type="number" min="0"
                      value={taxes.taxe_sejour_montant}
                      onChange={e => setTaxes({...taxes, taxe_sejour_montant: e.target.value})} />
                  </div>
                )}
              </div>

              {/* Simulateur */}
              <div className="card p-4" style={{background:'var(--bg-2)', borderColor:'var(--border-1)'}}>
                <div className="text-xs font-bold text-[var(--text-2)] mb-3">Simulation sur une facture HT de 100 000 {hotel?.devise || 'XAF'}</div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <span className="text-[var(--text-3)]">Montant HT</span>
                  <span className="text-right text-[var(--text-1)]">100 000</span>
                  {taxes.tva_active && <>
                    <span className="text-[var(--text-3)]">TVA ({taxes.tva_taux}%)</span>
                    <span className="text-right text-amber-400">+ {TVA_EXEMPLE.toLocaleString('fr-FR')}</span>
                  </>}
                  {taxes.css_active && <>
                    <span className="text-[var(--text-3)]">CSS ({taxes.css_taux}%)</span>
                    <span className="text-right text-amber-400">+ {CSS_EXEMPLE.toLocaleString('fr-FR')}</span>
                  </>}
                  {taxes.taxe_sejour_active && <>
                    <span className="text-[var(--text-3)]">Taxe séjour (1 nuit)</span>
                    <span className="text-right text-amber-400">+ {TS_EXEMPLE.toLocaleString('fr-FR')}</span>
                  </>}
                  <div className="col-span-2 border-t border-[var(--border-1)] my-1" />
                  <span className="font-bold text-[var(--text-1)]">Total TTC</span>
                  <span className="text-right font-bold text-blue-400">{TTC_EXEMPLE.toLocaleString('fr-FR')}</span>
                </div>
              </div>

              <div className="flex justify-end">
                <button type="submit" disabled={savingTx} className="btn btn-primary btn-sm">
                  {savingTx ? 'Sauvegarde...' : '💾 Sauvegarder configuration fiscale'}
                </button>
              </div>
            </form>
          )}

          {onglet === 'notifications' && (
            <div className="space-y-3 text-sm">
              {[
                'Nouvelles réservations',
                'Check-in / Check-out',
                'Tickets maintenance urgents',
                'Tâches ménage en retard',
                'Rapports quotidiens',
              ].map(label => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-[var(--border-1)]">
                  <span className="text-xs text-[var(--text-2)]">{label}</span>
                  <div className="w-8 h-4 bg-blue-500 rounded-full cursor-pointer flex items-center justify-end px-0.5">
                    <div className="w-3 h-3 bg-white rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {onglet === 'compte' && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="form-label">Version</label>
                <div className="text-xs text-[var(--text-2)]">7venHotel Cloud PMS v5.0</div>
              </div>
              <div>
                <label className="form-label">Environnement</label>
                <div className="text-xs text-[var(--text-2)]">Production · Railway</div>
              </div>
              <div>
                <label className="form-label">Support</label>
                <div className="text-xs text-[var(--text-2)]">support@7venhotel.com</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
