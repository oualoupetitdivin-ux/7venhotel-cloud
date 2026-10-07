'use client'
import { useCallback, useEffect, useState } from 'react'
import { financeAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, dateFr, messageErreur, exerciceParDefaut, droitsFinance, STATUT_EXERCICE, STATUT_PERIODE } from '@/lib/finance'
import toast from 'react-hot-toast'

// Préparation / consultation de clôture. Les règles restent celles du moteur (cloturerPeriode /
// cloturerExercice) : l'écran affiche les mêmes contrôles et le moteur tranche à l'exécution.
export default function CloturePage() {
  const { user } = useAuthStore()
  const droits = droitsFinance(user?.role)
  const [exercices, setExercices] = useState([])
  const [exId, setExId] = useState('')
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [action, setAction] = useState(null)

  useEffect(() => {
    financeAPI.exercices().then(r => { setExercices(r.data.exercices); setExId(exerciceParDefaut(r.data.exercices)?.id || '') })
      .catch(e => setErreur(messageErreur(e)))
  }, [])

  const charger = useCallback(() => {
    if (!exId) return
    setD(null)
    Promise.all([financeAPI.exercices(), financeAPI.ecritures({ exercice_id: exId, statut: 'brouillon', limit: 500 }),
                 financeAPI.balance({ exercice_id: exId }), financeAPI.controle()])
      .then(([e, br, bal, ctl]) => setD({
        exercice: e.data.exercices.find(x => x.id === exId), brouillons: br.data.ecritures,
        balance: bal.data, controle: ctl.data.exercices.find(x => x.exercice_id === exId),
      })).catch(x => setErreur(messageErreur(x)))
  }, [exId])
  useEffect(() => { charger() }, [charger])

  const ex = d?.exercice
  const prochaine = ex?.periodes.find(p => p.statut === 'ouverte') || null
  const brouillonsPeriode = prochaine ? d.brouillons.filter(b => b.date_ecriture >= prochaine.date_debut && b.date_ecriture <= prochaine.date_fin).length : 0
  const anterieuresOuvertes = prochaine ? ex.periodes.filter(p => p.numero < prochaine.numero && p.statut !== 'cloturee').length : 0
  const ctrlPeriode = prochaine && [
    { ok: brouillonsPeriode === 0, libelle: `Aucun brouillon dans la période (${brouillonsPeriode})` },
    { ok: anterieuresOuvertes === 0, libelle: `Périodes antérieures clôturées (${anterieuresOuvertes} ouverte(s))` },
    { ok: !d.controle || Number(d.controle.ecart) === 0, libelle: 'Écritures équilibrées (débit = crédit)' },
  ]
  const ctrlExercice = ex && [
    { ok: d.brouillons.length === 0, libelle: `Aucun brouillon sur l'exercice (${d.brouillons.length})` },
    { ok: d.balance.equilibre, libelle: `Balance équilibrée (D ${montant(d.balance.totaux?.total_debit)} / C ${montant(d.balance.totaux?.total_credit)})` },
  ]

  async function cloturer(type) {
    const cible = type === 'periode' ? `la période ${prochaine.libelle}` : `l'exercice ${ex.annee} (clôture des périodes ouvertes et génération des à-nouveaux)`
    if (!window.confirm(`Clôturer ${cible} ? Cette opération est définitive.`)) return
    setAction(type)
    try {
      await financeAPI.cloture(type === 'periode' ? { type, periode_id: prochaine.id } : { type, exercice_id: ex.id })
      toast.success(type === 'periode' ? `${prochaine.libelle} clôturée` : `Exercice ${ex.annee} clôturé`)
      charger()
    } catch (e) {
      const det = e?.response?.data?.details
      toast.error(messageErreur(e, 'Clôture refusée') + (det ? ` — ${Object.entries(det).filter(([, v]) => v === false).map(([k]) => k).join(', ')}` : ''))
    } finally { setAction(null) }
  }

  return (
    <FinanceLayout titre="Clôture comptable">
      <div className="card p-3 flex flex-wrap items-center gap-3 text-xs">
        <select className="input text-xs w-44" value={exId} onChange={e => setExId(e.target.value)}>
          {exercices.map(e => <option key={e.id} value={e.id}>Exercice {e.annee}</option>)}
        </select>
        {ex && <span className={`badge ${STATUT_EXERCICE[ex.statut]?.classe}`}>{STATUT_EXERCICE[ex.statut]?.label}</span>}
        <span className="text-[var(--text-3)] ml-auto">{droits.cloturer ? 'Vous pouvez clôturer (finance.cloture).' : 'Consultation : la clôture est réservée au rôle disposant de finance.cloture.'}</span>
      </div>

      <Etat chargement={!d && !erreur} erreur={erreur}>
        {d && ex && (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="card p-4 space-y-3">
              <div className="card-title">Clôture de période</div>
              {!prochaine ? <div className="text-xs text-[var(--text-3)]">Toutes les périodes sont clôturées.</div> : <>
                <div className="text-xs">Prochaine période à clôturer : <b>{prochaine.libelle}</b> ({dateFr(prochaine.date_debut)} → {dateFr(prochaine.date_fin)})</div>
                <Controles liste={ctrlPeriode} />
                {droits.cloturer && <button className="btn btn-primary btn-sm text-xs" disabled={!!action || ctrlPeriode.some(c => !c.ok)} onClick={() => cloturer('periode')}>
                  {action === 'periode' ? 'Clôture…' : `Clôturer ${prochaine.libelle}`}</button>}
              </>}
            </div>
            <div className="card p-4 space-y-3">
              <div className="card-title">Clôture d'exercice</div>
              {ex.statut === 'cloture' ? <div className="text-xs text-[var(--text-3)]">Exercice clôturé.</div> : <>
                <div className="text-xs">Clôture de l'exercice {ex.annee} : les périodes encore ouvertes sont clôturées et les à-nouveaux (journal AN) sont générés sur l'exercice suivant.</div>
                <Controles liste={ctrlExercice} />
                {droits.cloturer && <button className="btn btn-primary btn-sm text-xs" disabled={!!action || ctrlExercice.some(c => !c.ok)} onClick={() => cloturer('exercice')}>
                  {action === 'exercice' ? 'Clôture…' : `Clôturer l'exercice ${ex.annee}`}</button>}
              </>}
            </div>
            <div className="card lg:col-span-2 overflow-x-auto">
              <div className="card-header"><div className="card-title">Historique des périodes</div></div>
              <table className="table-base"><thead><tr><th>N°</th><th>Période</th><th>Du</th><th>Au</th><th>Statut</th></tr></thead>
                <tbody>{ex.periodes.map(p => <tr key={p.id}><td>{p.numero}</td><td>{p.libelle}</td><td>{dateFr(p.date_debut)}</td><td>{dateFr(p.date_fin)}</td>
                  <td><span className={`badge ${STATUT_PERIODE[p.statut]?.classe}`}>{STATUT_PERIODE[p.statut]?.label}</span></td></tr>)}</tbody></table>
            </div>
          </div>
        )}
      </Etat>
    </FinanceLayout>
  )
}

function Controles({ liste }) {
  return <ul className="space-y-1">{liste.map((c, i) => <li key={i} className={`text-xs ${c.ok ? 'text-emerald-400' : 'text-red-400'}`}>{c.ok ? '✓' : '✗'} {c.libelle}</li>)}</ul>
}
