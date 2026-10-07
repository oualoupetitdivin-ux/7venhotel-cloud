'use client'
import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, dateFr, messageErreur, exerciceParDefaut, telechargerCSV, telechargerBlob } from '@/lib/finance'

// Uniquement les états produits par le moteur (etats.engine) : bilan + compte de résultat + contrôles.
export default function EtatsPage() {
  const [exercices, setExercices] = useState([])
  const [exId, setExId] = useState('')
  const [e, setE] = useState(null)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    financeAPI.exercices().then(r => { setExercices(r.data.exercices); setExId(exerciceParDefaut(r.data.exercices)?.id || '') })
      .catch(x => setErreur(messageErreur(x)))
  }, [])
  useEffect(() => {
    if (!exId) return
    setE(null)
    financeAPI.etats({ exercice_id: exId }).then(r => setE(r.data)).catch(x => setErreur(messageErreur(x)))
  }, [exId])

  function exporterCSV() {
    const rows = []
    const bloc = (etat, cote, rubriques) => rubriques.forEach(r => r.comptes.forEach(c => rows.push([etat, cote, r.code, r.libelle, c.numero, c.libelle, c.montant])))
    bloc('Bilan', 'Actif', e.bilan.actif.rubriques); bloc('Bilan', 'Passif', e.bilan.passif.rubriques)
    bloc('Compte de résultat', 'Produits', e.compte_resultat.produits.rubriques); bloc('Compte de résultat', 'Charges', e.compte_resultat.charges.rubriques)
    telechargerCSV(`etats_financiers_${e.exercice.annee}.csv`, ['Etat', 'Cote', 'Rubrique', 'Intitule rubrique', 'Compte', 'Intitule compte', 'Montant'], rows)
  }

  return (
    <FinanceLayout titre="États financiers" actions={e && <>
      <button className="btn btn-ghost btn-sm text-xs" onClick={exporterCSV}>⬇ CSV</button>
      <button className="btn btn-ghost btn-sm text-xs" onClick={() => telechargerBlob(new Blob([JSON.stringify(e, null, 2)], { type: 'application/json' }), `etats_financiers_${e.exercice.annee}.json`)}>⬇ JSON</button>
      <button className="btn btn-ghost btn-sm text-xs" onClick={() => window.print()}>🖨 Imprimer</button>
    </>}>
      <div className="card p-3 flex flex-wrap items-center gap-3 text-xs">
        <select className="input text-xs w-44" value={exId} onChange={x => setExId(x.target.value)}>
          {exercices.map(x => <option key={x.id} value={x.id}>Exercice {x.annee}</option>)}
        </select>
        {e && <span className="text-[var(--text-3)]">Du {dateFr(e.exercice.date_debut)} au {dateFr(e.exercice.date_fin)} · exercice {e.exercice.statut} · référentiel des rubriques {e.referentiel_rubriques}</span>}
      </div>

      <Etat chargement={!e && !erreur} erreur={erreur}>
        {e && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Controle ok={e.controles.balance_equilibree} libelle="Balance équilibrée" />
              <Controle ok={e.controles.bilan_equilibre} libelle={`Bilan équilibré${e.bilan.ecart ? ` (écart ${montant(e.bilan.ecart)})` : ''}`} />
              <Controle ok={!e.controles.comptes_non_classes?.length} libelle={e.controles.comptes_non_classes?.length ? `Comptes non classés : ${e.controles.comptes_non_classes.join(', ')}` : 'Tous les comptes classés'} />
              <span className="badge badge-gray">{e.controles.nb_comptes_mouvementes} comptes mouvementés</span>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Bloc titre="Bilan — Actif" rubriques={e.bilan.actif.rubriques} total={e.bilan.actif.total} />
              <Bloc titre="Bilan — Passif" rubriques={e.bilan.passif.rubriques} total={e.bilan.passif.total} />
              <Bloc titre="Compte de résultat — Produits" rubriques={e.compte_resultat.produits.rubriques} total={e.compte_resultat.produits.total} />
              <Bloc titre="Compte de résultat — Charges" rubriques={e.compte_resultat.charges.rubriques} total={e.compte_resultat.charges.total} />
            </div>

            <div className={`card p-4 text-sm font-black ${e.compte_resultat.resultat >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Résultat de l'exercice : {montant(e.compte_resultat.resultat)} XAF ({e.compte_resultat.nature === 'perte' ? 'perte' : 'bénéfice'})
            </div>

            <div className="card">
              <div className="card-header"><div className="card-title">États figés (historique)</div></div>
              <Etat vide={!e.snapshots?.length && 'Aucun état figé : les états sont figés par le moteur lors de la clôture de l\'exercice.'}>
                <table className="table-base"><thead><tr><th>Type</th><th>Arrêté au</th><th>Empreinte</th><th>Généré le</th></tr></thead>
                  <tbody>{(e.snapshots || []).map(s => <tr key={s.id}><td>{s.type_etat}</td><td>{dateFr(s.date_arrete)}</td><td className="font-mono text-[10px]">{String(s.empreinte).slice(0, 16)}…</td><td>{new Date(s.genere_le).toLocaleString('fr-FR')}</td></tr>)}</tbody></table>
              </Etat>
            </div>
            <div className="text-[10px] text-[var(--text-4)]">Source : {e.source}</div>
          </div>
        )}
      </Etat>
    </FinanceLayout>
  )
}

function Controle({ ok, libelle }) {
  return <span className={`badge ${ok ? 'badge-green' : 'badge-red'}`}>{ok ? '✓' : '✗'} {libelle}</span>
}

function Bloc({ titre, rubriques, total }) {
  const [ouvert, setOuvert] = useState({})
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">{titre}</div><span className="font-mono text-xs font-bold">{montant(total)}</span></div>
      {!rubriques.length ? <div className="p-4 text-xs text-[var(--text-3)]">Aucun montant.</div> :
        <table className="table-base"><tbody>
          {rubriques.map(r => (
            <Fragment key={r.code}>
              <tr onClick={() => setOuvert(o => ({ ...o, [r.code]: !o[r.code] }))}>
                <td className="w-10 font-mono text-[10px]">{r.code}</td><td>{ouvert[r.code] ? '▾' : '▸'} {r.libelle}</td><td className="text-right font-mono">{montant(r.montant)}</td>
              </tr>
              {ouvert[r.code] && r.comptes.map(c => (
                <tr key={r.code + c.numero} className="text-[var(--text-2)]">
                  <td></td><td className="pl-6"><Link href={`/finance/grand-livre?compte=${c.numero}`} prefetch={false} className="font-mono text-blue-400">{c.numero}</Link> {c.libelle}</td><td className="text-right font-mono">{montant(c.montant)}</td>
                </tr>))}
            </Fragment>))}
        </tbody></table>}
    </div>
  )
}

