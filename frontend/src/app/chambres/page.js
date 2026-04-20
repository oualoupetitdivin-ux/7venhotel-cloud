'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { chambresAPI } from '@/lib/api'
import { STATUT_CHAMBRE_COULEUR } from '@/lib/utils'
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

export default function ChambresPage() {
  const [chambres, setChambres] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filtre, setFiltre]     = useState('')
  const [vue, setVue]           = useState('grille')

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const res = await chambresAPI.lister()
      setChambres(res.data.chambres || [])
    } catch { toast.error('Erreur chargement chambres') }
    finally { setLoading(false) }
  }

  async function changerStatut(id, statut) {
    try {
      await chambresAPI.changerStatut(id, { statut })
      toast.success('Statut mis à jour')
      charger()
    } catch { toast.error('Erreur mise à jour') }
  }

  const filtrees = filtre ? chambres.filter(c => c.statut === filtre) : chambres
  const stats = {
    total: chambres.length,
    libres: chambres.filter(c => c.statut === 'libre_propre').length,
    occupees: chambres.filter(c => c.statut === 'occupee').length,
    menage: chambres.filter(c => ['sale','nettoyage'].includes(c.statut)).length,
  }

  return (
    <AppLayout titre="Chambres" sousTitre="État en temps réel">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total', val: stats.total, color: 'border-blue-500', icon: '🏨' },
            { label: 'Disponibles', val: stats.libres, color: 'border-emerald-500', icon: '✅' },
            { label: 'Occupées', val: stats.occupees, color: 'border-blue-400', icon: '🔵' },
            { label: 'Ménage requis', val: stats.menage, color: 'border-amber-500', icon: '🧹' },
          ].map(k => (
            <div key={k.label} className={`kpi-card border-b-2 ${k.color}`}>
              <div className="absolute right-3 top-3 text-xl opacity-10">{k.icon}</div>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.val}</div>
            </div>
          ))}
        </div>

        {/* Filtres + Vue */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            {STATUTS.map(s => (
              <button key={s} onClick={() => setFiltre(s)}
                className={`btn btn-sm ${filtre === s ? 'btn-primary' : 'btn-ghost'}`}>
                {s ? `${STATUT_ICON[s]} ${STATUT_LABEL[s]}` : 'Toutes'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setVue('grille')} className={`btn btn-sm ${vue==='grille' ? 'btn-primary' : 'btn-ghost'}`}>⊞ Grille</button>
            <button onClick={() => setVue('liste')} className={`btn btn-sm ${vue==='liste' ? 'btn-primary' : 'btn-ghost'}`}>☰ Liste</button>
            <button onClick={charger} className="btn btn-ghost btn-sm">↻</button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : vue === 'grille' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filtrees.map(c => (
              <div key={c.id} className="card p-3 cursor-pointer hover:border-blue-500/50 transition-all group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-lg font-black text-[var(--text-1)]">{c.numero}</span>
                  <span className="text-base">{STATUT_ICON[c.statut]}</span>
                </div>
                <div className="text-[10px] text-[var(--text-3)] mb-1">Étage {c.etage}</div>
                <div className="text-[10px] text-[var(--text-3)] mb-2 truncate">{c.type_chambre}</div>
                <span className={`badge text-[9px] ${STATUT_CHAMBRE_COULEUR[c.statut] || 'badge-gray'}`}>
                  {STATUT_LABEL[c.statut]}
                </span>
                {/* Actions rapides */}
                <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {c.statut === 'sale' && (
                    <button onClick={() => changerStatut(c.id, 'nettoyage')}
                      className="btn btn-xs btn-ghost w-full mt-1 text-[9px]">🧹 Nettoyer</button>
                  )}
                  {c.statut === 'nettoyage' && (
                    <button onClick={() => changerStatut(c.id, 'libre_propre')}
                      className="btn btn-xs btn-ghost w-full mt-1 text-[9px]">✅ Marquer propre</button>
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
                  <tr key={c.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                    <td className="px-4 py-3 font-bold text-[var(--text-1)]">{c.numero}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">Étage {c.etage}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{c.type_chambre}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUT_CHAMBRE_COULEUR[c.statut] || 'badge-gray'}`}>
                        {STATUT_ICON[c.statut]} {STATUT_LABEL[c.statut]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {c.statut === 'sale' && (
                          <button onClick={() => changerStatut(c.id, 'nettoyage')} className="btn btn-xs btn-ghost">🧹 Nettoyer</button>
                        )}
                        {c.statut === 'nettoyage' && (
                          <button onClick={() => changerStatut(c.id, 'libre_propre')} className="btn btn-xs btn-ghost">✅ Propre</button>
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
