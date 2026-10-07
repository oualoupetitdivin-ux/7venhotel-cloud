'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { dateFr, messageErreur, periodeCourante, STATUT_EXERCICE, STATUT_PERIODE } from '@/lib/finance'

export default function ExercicesPage() {
  const [exercices, setExercices] = useState(null)
  const [erreur, setErreur] = useState(null)
  useEffect(() => { financeAPI.exercices().then(r => setExercices(r.data.exercices)).catch(e => setErreur(messageErreur(e))) }, [])

  return (
    <FinanceLayout titre="Exercices et périodes" actions={<Link href="/finance/cloture" prefetch={false} className="btn btn-ghost btn-sm text-xs">Préparer une clôture →</Link>}>
      <Etat chargement={!exercices && !erreur} erreur={erreur} vide={exercices && !exercices.length && 'Aucun exercice : le dossier comptable de cet hôtel n\'est pas initialisé.'}>
        <div className="space-y-4">
          {(exercices || []).map(ex => {
            const courante = periodeCourante(ex)
            const closes = ex.periodes.filter(p => p.statut === 'cloturee').length
            return (
              <div key={ex.id} className="card overflow-x-auto">
                <div className="card-header">
                  <div className="card-title">{ex.libelle || `Exercice ${ex.annee}`}</div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span>{dateFr(ex.date_debut)} → {dateFr(ex.date_fin)} · {ex.devise}</span>
                    <span className={`badge ${STATUT_EXERCICE[ex.statut]?.classe}`}>{STATUT_EXERCICE[ex.statut]?.label}</span>
                    <span className="badge badge-gray">{closes}/{ex.periodes.length} périodes clôturées</span>
                  </div>
                </div>
                <table className="table-base">
                  <thead><tr><th>N°</th><th>Période</th><th>Du</th><th>Au</th><th>Statut</th><th></th></tr></thead>
                  <tbody>{ex.periodes.map(p => (
                    <tr key={p.id} className={courante?.id === p.id ? 'bg-blue-500/5' : ''}>
                      <td>{p.numero}</td><td className="font-semibold">{p.libelle}</td><td>{dateFr(p.date_debut)}</td><td>{dateFr(p.date_fin)}</td>
                      <td><span className={`badge ${STATUT_PERIODE[p.statut]?.classe}`}>{STATUT_PERIODE[p.statut]?.label}</span></td>
                      <td className="text-[10px] text-blue-400">{courante?.id === p.id ? '● période courante' : ''}</td>
                    </tr>))}</tbody>
                </table>
              </div>)
          })}
        </div>
      </Etat>
    </FinanceLayout>
  )
}
