'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { menageAPI } from '@/lib/api'
import { PRIORITE_COULEUR } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = { ouverte:'À faire', en_cours:'En cours', terminee:'Terminée', verifiee:'Vérifiée' }
const STATUT_COLOR = { ouverte:'badge-amber', en_cours:'badge-blue', terminee:'badge-green', verifiee:'badge-purple' }
const TYPE_LABEL   = { nettoyage_depart:'Départ', nettoyage_sejour:'Séjour', inspection:'Inspection', recouverture:'Recouverture' }

export default function MenagePage() {
  const [kanban, setKanban] = useState({ ouverte:[], en_cours:[], terminee:[], verifiee:[] })
  const [loading, setLoading] = useState(true)
  const [vue, setVue] = useState('kanban')

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const res = await menageAPI.kanban()
      setKanban(res.data)
    } catch { toast.error('Erreur chargement ménage') }
    finally { setLoading(false) }
  }

  async function changerStatut(id, statut) {
    try {
      await menageAPI.changerStatut(id, { statut })
      toast.success('Statut mis à jour')
      charger()
    } catch { toast.error('Erreur mise à jour') }
  }

  const total = Object.values(kanban).flat().length
  const stats = {
    ouverte: kanban.ouverte?.length || 0,
    en_cours: kanban.en_cours?.length || 0,
    terminee: (kanban.terminee?.length || 0) + (kanban.verifiee?.length || 0),
  }

  const ColKanban = ({ titre, statut, taches, couleur, nextStatut, nextLabel }) => (
    <div className="flex-1 min-w-0">
      <div className={`flex items-center gap-2 mb-3 px-1`}>
        <span className={`badge ${couleur}`}>{titre}</span>
        <span className="text-xs text-[var(--text-3)]">{taches?.length || 0}</span>
      </div>
      <div className="space-y-2">
        {(taches || []).map(t => (
          <div key={t.id} className="card p-3 hover:border-blue-500/40 transition-all">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="font-semibold text-xs text-[var(--text-1)]">Ch. {t.numero_chambre || '—'}</div>
              <span className={`badge text-[9px] ${PRIORITE_COULEUR[t.priorite] || 'badge-gray'}`}>{t.priorite}</span>
            </div>
            <div className="text-[10px] text-[var(--text-3)] mb-1">{TYPE_LABEL[t.type_tache] || t.type_tache}</div>
            <div className="text-[10px] text-[var(--text-2)] mb-2 line-clamp-2">{t.description}</div>
            {nextStatut && (
              <button onClick={() => changerStatut(t.id, nextStatut)}
                className="btn btn-xs btn-ghost w-full text-[10px]">
                {nextLabel} →
              </button>
            )}
          </div>
        ))}
        {(!taches || taches.length === 0) && (
          <div className="text-center text-[10px] text-[var(--text-4)] py-4">Aucune tâche</div>
        )}
      </div>
    </div>
  )

  return (
    <AppLayout titre="Ménage" sousTitre="Gestion du housekeeping">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="kpi-card border-b-2 border-amber-500">
            <div className="kpi-label">À faire</div>
            <div className="kpi-value text-amber-400">{stats.ouverte}</div>
          </div>
          <div className="kpi-card border-b-2 border-blue-500">
            <div className="kpi-label">En cours</div>
            <div className="kpi-value text-blue-400">{stats.en_cours}</div>
          </div>
          <div className="kpi-card border-b-2 border-emerald-500">
            <div className="kpi-label">Terminées</div>
            <div className="kpi-value text-emerald-400">{stats.terminee}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button onClick={charger} className="btn btn-ghost btn-sm">↻ Actualiser</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            <ColKanban titre="À faire" statut="ouverte" taches={kanban.ouverte} couleur="badge-amber" nextStatut="en_cours" nextLabel="Commencer" />
            <ColKanban titre="En cours" statut="en_cours" taches={kanban.en_cours} couleur="badge-blue" nextStatut="terminee" nextLabel="Terminer" />
            <ColKanban titre="Terminée" statut="terminee" taches={kanban.terminee} couleur="badge-green" nextStatut="verifiee" nextLabel="Vérifier" />
            <ColKanban titre="Vérifiée" statut="verifiee" taches={kanban.verifiee} couleur="badge-purple" nextStatut={null} nextLabel={null} />
          </div>
        )}
      </div>
    </AppLayout>
  )
}
