'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, dateFr, messageErreur, exerciceParDefaut, STATUT_ECRITURE } from '@/lib/finance'

const TYPES = { VE: 'Ventes', AC: 'Achats', CA: 'Caisse', BQ: 'Banque', OD: 'Opérations diverses', AN: 'À-nouveaux', MM: 'Mobile Money' }

export default function JournauxPage() {
  const router = useRouter()
  const [journaux, setJournaux] = useState(null)
  const [exercices, setExercices] = useState([])
  const [exId, setExId] = useState('')
  const [comptes, setComptes] = useState({})      // code → { n, total }
  const [sel, setSel] = useState(null)            // détail du journal choisi
  const [periode, setPeriode] = useState('')
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    Promise.all([financeAPI.journaux(), financeAPI.exercices()]).then(([j, e]) => {
      setJournaux(j.data.journaux); setExercices(e.data.exercices); setExId(exerciceParDefaut(e.data.exercices)?.id || '')
    }).catch(x => setErreur(messageErreur(x)))
  }, [])

  // Nombre d'écritures par journal : chargé après l'affichage de la liste (non bloquant)
  useEffect(() => {
    if (!journaux || !exId) return
    setComptes({})
    journaux.forEach(j => financeAPI.journaux({ code: j.code, exercice_id: exId })
      .then(r => setComptes(c => ({ ...c, [j.code]: { n: r.data.ecritures.length, total: r.data.ecritures.reduce((s, e) => s + Number(e.total_debit), 0) } })))
      .catch(() => {}))
  }, [journaux, exId])

  function ouvrir(code) {
    setSel({ code, ecritures: null }); setPeriode('')
    financeAPI.journaux({ code, exercice_id: exId }).then(r => setSel({ code, ...r.data })).catch(x => setErreur(messageErreur(x)))
  }

  const ex = exercices.find(e => e.id === exId)
  const p = ex?.periodes.find(x => x.id === periode)
  const ecrituresSel = (sel?.ecritures || []).filter(e => !p || (e.date_ecriture >= p.date_debut && e.date_ecriture <= p.date_fin))

  return (
    <FinanceLayout titre="Journaux comptables">
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <select className="input text-xs w-44" value={exId} onChange={e => { setExId(e.target.value); setSel(null) }}>
          {exercices.map(e => <option key={e.id} value={e.id}>Exercice {e.annee}</option>)}
        </select>
      </div>
      <Etat chargement={!journaux && !erreur} erreur={erreur} vide={journaux && !journaux.length && 'Aucun journal : dossier comptable non initialisé.'}>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Code</th><th>Libellé</th><th>Type</th><th>Contrepartie par défaut</th><th className="text-right">Écritures</th><th className="text-right">Total mouvements</th><th>Actif</th></tr></thead>
            <tbody>{(journaux || []).map(j => (
              <tr key={j.id} onClick={() => ouvrir(j.code)} className={sel?.code === j.code ? 'bg-[var(--bg-3)]' : ''}>
                <td className="font-mono font-bold">{j.code}</td><td>{j.libelle}</td><td>{TYPES[j.type_journal] || j.type_journal}</td>
                <td className="font-mono">{j.compte_contrepartie_defaut || '—'}</td>
                <td className="text-right">{comptes[j.code] ? comptes[j.code].n : '…'}</td>
                <td className="text-right font-mono">{comptes[j.code] ? montant(comptes[j.code].total) : '…'}</td>
                <td>{j.actif ? '✓' : '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Etat>

      {sel && (
        <div className="card overflow-x-auto">
          <div className="card-header"><div className="card-title">Journal {sel.code}{sel.journal ? ` — ${sel.journal.libelle}` : ''}</div>
            <select className="input text-xs w-44" value={periode} onChange={e => setPeriode(e.target.value)}>
              <option value="">Toutes les périodes</option>
              {(ex?.periodes || []).map(x => <option key={x.id} value={x.id}>{x.libelle}</option>)}
            </select></div>
          <Etat chargement={!sel.ecritures} vide={sel.ecritures && !ecrituresSel.length && 'Aucune écriture dans ce journal pour cette période.'}>
            <table className="table-base">
              <thead><tr><th>Pièce</th><th>Date</th><th>Libellé</th><th>Source</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th>Statut</th></tr></thead>
              <tbody>{ecrituresSel.map(e => (
                <tr key={e.id} onClick={() => router.push(`/finance/ecritures/${e.id}`)}>
                  <td className="font-mono">{e.numero_piece}</td><td>{dateFr(e.date_ecriture)}</td><td className="max-w-[300px] truncate">{e.libelle}</td><td>{e.source}</td>
                  <td className="text-right font-mono">{montant(e.total_debit)}</td><td className="text-right font-mono">{montant(e.total_credit)}</td>
                  <td><span className={`badge ${STATUT_ECRITURE[e.statut]?.classe}`}>{STATUT_ECRITURE[e.statut]?.label}</span></td>
                </tr>))}</tbody>
            </table>
          </Etat>
        </div>
      )}
    </FinanceLayout>
  )
}
