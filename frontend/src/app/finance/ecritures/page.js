'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, dateFr, messageErreur, telechargerBlob, exerciceParDefaut, STATUT_ECRITURE } from '@/lib/finance'
import toast from 'react-hot-toast'

const PAR_PAGE = 50

export default function EcrituresPage() {
  const router = useRouter()
  const [journaux, setJournaux] = useState([])
  const [exercices, setExercices] = useState([])
  const [f, setF] = useState({ exercice_id: '', journal: '', statut: '', source: '', recherche: '' })
  const [page, setPage] = useState(0)
  const [lignes, setLignes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [export_, setExport] = useState(null)

  // Référentiels (petits) chargés une fois, en parallèle de la première page
  useEffect(() => {
    Promise.all([financeAPI.journaux(), financeAPI.exercices()])
      .then(([j, e]) => { setJournaux(j.data.journaux); setExercices(e.data.exercices); setF(x => ({ ...x, exercice_id: exerciceParDefaut(e.data.exercices)?.id || '' })) })
      .catch(e => setErreur(messageErreur(e)))
  }, [])

  const charger = useCallback(() => {
    setLignes(null)
    const params = { limit: PAR_PAGE, offset: page * PAR_PAGE }
    for (const k of ['exercice_id', 'journal', 'statut', 'source']) if (f[k]) params[k] = f[k]
    financeAPI.ecritures(params).then(r => setLignes(r.data.ecritures)).catch(e => setErreur(messageErreur(e)))
  }, [f.exercice_id, f.journal, f.statut, f.source, page])

  useEffect(() => { if (exercices.length || erreur) charger() }, [charger, exercices.length])

  const filtrer = (k, v) => { setPage(0); setF(x => ({ ...x, [k]: v })) }
  const visibles = (lignes || []).filter(e => !f.recherche || `${e.numero_piece} ${e.libelle} ${e.reference_type || ''} ${e.evenement_type || ''}`.toLowerCase().includes(f.recherche.toLowerCase()))
  const annee = exercices.find(e => e.id === f.exercice_id)?.annee || ''

  async function exporter(format) {
    setExport(format)
    try {
      const params = f.exercice_id ? { exercice_id: f.exercice_id } : {}
      if (format === 'csv') { const r = await financeAPI.exportCSV(params); telechargerBlob(r.data, `ecritures_${annee}.csv`) }
      else { const r = await financeAPI.exportJSON(params); telechargerBlob(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }), `finance_${annee}.json`) }
    } catch (e) { toast.error(messageErreur(e, 'Export impossible')) } finally { setExport(null) }
  }

  return (
    <FinanceLayout titre="Écritures comptables" actions={<>
      <button className="btn btn-ghost btn-sm text-xs" disabled={!!export_} onClick={() => exporter('csv')}>{export_ === 'csv' ? 'Export…' : '⬇ CSV (écritures validées)'}</button>
      <button className="btn btn-ghost btn-sm text-xs" disabled={!!export_} onClick={() => exporter('json')}>{export_ === 'json' ? 'Export…' : '⬇ JSON (dossier complet)'}</button>
    </>}>
      <div className="card p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        <select className="input text-xs" value={f.exercice_id} onChange={e => filtrer('exercice_id', e.target.value)}>
          {exercices.map(e => <option key={e.id} value={e.id}>Exercice {e.annee}</option>)}
        </select>
        <select className="input text-xs" value={f.journal} onChange={e => filtrer('journal', e.target.value)}>
          <option value="">Tous les journaux</option>
          {journaux.map(j => <option key={j.id} value={j.code}>{j.code} — {j.libelle}</option>)}
        </select>
        <select className="input text-xs" value={f.statut} onChange={e => filtrer('statut', e.target.value)}>
          <option value="">Tous statuts</option><option value="validee">Validées</option><option value="brouillon">Brouillons</option>
        </select>
        <select className="input text-xs" value={f.source} onChange={e => filtrer('source', e.target.value)}>
          <option value="">Toutes sources</option><option value="moteur">Moteur (PMS)</option><option value="manuelle">Manuelles</option>
        </select>
        <input className="input text-xs" placeholder="Rechercher pièce, libellé, référence…" value={f.recherche} onChange={e => setF(x => ({ ...x, recherche: e.target.value }))} />
      </div>

      <div className="card overflow-x-auto">
        <Etat chargement={lignes === null && !erreur} erreur={erreur} vide={lignes && !visibles.length && 'Aucune écriture pour ces critères.'}>
          <table className="table-base">
            <thead><tr><th>Pièce</th><th>Date</th><th>Journal</th><th>Libellé</th><th>Référence</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th>Statut</th></tr></thead>
            <tbody>{visibles.map(e => (
              <tr key={e.id} onClick={() => router.push(`/finance/ecritures/${e.id}`)}>
                <td className="font-mono">{e.numero_piece}</td>
                <td>{dateFr(e.date_ecriture)}</td>
                <td>{e.journal}</td>
                <td className="max-w-[280px] truncate" title={e.libelle}>{e.libelle}{e.ecriture_origine_id && <span className="ml-1 badge badge-purple">contre-passation</span>}</td>
                <td className="text-[10px] text-[var(--text-3)]">{e.evenement_type || e.reference_type || (e.source === 'manuelle' ? 'manuelle' : '—')}</td>
                <td className="text-right font-mono">{montant(e.total_debit)}</td>
                <td className="text-right font-mono">{montant(e.total_credit)}</td>
                <td><span className={`badge ${STATUT_ECRITURE[e.statut]?.classe}`}>{STATUT_ECRITURE[e.statut]?.label}</span></td>
              </tr>))}</tbody>
          </table>
        </Etat>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-3)]">Page {page + 1} · {lignes?.length ?? 0} écriture(s) chargée(s)</span>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Précédentes</button>
          <button className="btn btn-ghost btn-sm text-xs" disabled={!lignes || lignes.length < PAR_PAGE} onClick={() => setPage(p => p + 1)}>Suivantes →</button>
        </div>
      </div>
    </FinanceLayout>
  )
}
