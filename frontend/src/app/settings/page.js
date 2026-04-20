'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { hotelsAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { hotel } = useAuthStore()
  const [params, setParams] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [onglet, setOnglet]   = useState('general')

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      if (hotel?.id) {
        const res = await hotelsAPI.obtenir(hotel.id)
        setParams(res.data.hotel)
      }
    } catch { toast.error('Erreur chargement paramètres') }
    finally { setLoading(false) }
  }

  async function sauvegarder(e) {
    e.preventDefault()
    try {
      setSaving(true)
      await hotelsAPI.majParametres(hotel.id, params)
      toast.success('Paramètres sauvegardés !')
    } catch { toast.error('Erreur sauvegarde') }
    finally { setSaving(false) }
  }

  if (loading) return (
    <AppLayout titre="Paramètres" sousTitre="Configuration de l'hôtel">
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
      </div>
    </AppLayout>
  )

  return (
    <AppLayout titre="Paramètres" sousTitre="Configuration de l'hôtel">
      <div className="space-y-5">
        {/* Infos hôtel */}
        <div className="card p-5">
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
          <div className="flex gap-2 border-b border-[var(--border-1)] mb-5">
            {[['general','⚙️ Général'], ['notifications','🔔 Notifications'], ['compte','👤 Mon compte']].map(([k,l]) => (
              <button key={k} onClick={() => setOnglet(k)}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)]'}`}>
                {l}
              </button>
            ))}
          </div>

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
              <div className="col-span-2 flex justify-end">
                <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? 'Sauvegarde...' : '💾 Sauvegarder'}
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
