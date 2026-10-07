'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { messageErreur } from '@/lib/finance'

// Règles de comptabilisation (mappings_comptables) — lecture. Les comptes et leurs intitulés
// viennent exclusivement des données de l'hôtel ; la modification reste réservée au moteur (PUT /mappings).
export default function MappingPage() {
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [recherche, setRecherche] = useState('')

  useEffect(() => {
    Promise.all([financeAPI.mappings(), financeAPI.planComptable(), financeAPI.journaux()])
      .then(([m, p, j]) => setD({
        mappings: m.data.mappings,
        comptes: Object.fromEntries(p.data.comptes.map(c => [c.numero, c.libelle])),
        journaux: Object.fromEntries(j.data.journaux.map(x => [x.code, x.libelle])),
      })).catch(e => setErreur(messageErreur(e)))
  }, [])

  const q = recherche.toLowerCase()
  const groupes = {}
  for (const m of d?.mappings || []) {
    if (q && !`${m.evenement_type} ${m.libelle} ${m.compte_debit} ${m.compte_credit} ${m.compte_taxe || ''}`.toLowerCase().includes(q)) continue
    ;(groupes[m.evenement_type] = groupes[m.evenement_type] || []).push(m)
  }
  const Compte = ({ n }) => n ? <Link href={`/finance/grand-livre?compte=${n}`} prefetch={false} className="block"><span className="font-mono font-bold text-blue-400">{n}</span><span className="block text-[10px] text-[var(--text-3)]">{d.comptes[n] || ''}</span></Link> : '—'
  const conditions = (c) => { try { const o = typeof c === 'string' ? JSON.parse(c) : c; const e = Object.entries(o || {}); return e.length ? e.map(([k, v]) => `${k} = ${v}`).join(', ') : 'toujours' } catch { return String(c) } }

  return (
    <FinanceLayout titre="Mapping PMS → Comptabilité" sousTitre="Comment chaque événement de l'hôtel est comptabilisé">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <input className="input text-xs w-80" placeholder="Événement, libellé ou compte…" value={recherche} onChange={e => setRecherche(e.target.value)} />
        <span className="text-[11px] text-[var(--text-3)]">Événement PMS → journal → compte débité → compte crédité (± taxe). Règles appliquées par priorité décroissante, selon les conditions.</span>
      </div>
      <Etat chargement={!d && !erreur} erreur={erreur} vide={d && !Object.keys(groupes).length && 'Aucune règle de mapping.'}>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Événement PMS</th><th>Règle</th><th>Conditions</th><th>Journal</th><th>Débit</th><th>Crédit</th><th>Taxe</th><th>Prio.</th><th>Actif</th></tr></thead>
            <tbody>
              {Object.entries(groupes).map(([ev, regles]) => regles.map((m, i) => (
                <tr key={m.id} className={m.actif ? '' : 'opacity-50'}>
                  {i === 0 && <td rowSpan={regles.length} className="font-mono font-bold align-top">{ev}</td>}
                  <td>{m.libelle}</td>
                  <td className="text-[10px] text-[var(--text-2)]">{conditions(m.conditions)}</td>
                  <td><span className="font-mono">{m.journal}</span><span className="block text-[10px] text-[var(--text-3)]">{d.journaux[m.journal] || ''}</span></td>
                  <td><Compte n={m.compte_debit} /></td>
                  <td><Compte n={m.compte_credit} /></td>
                  <td>{m.compte_taxe ? <><Compte n={m.compte_taxe} /><span className="text-[10px] text-[var(--text-3)]">{m.mode_taxe}{m.cote_taxe ? ` · côté ${m.cote_taxe}` : ''}{m.taux_taxe != null ? ` · ${m.taux_taxe} %` : ''}</span></> : <span className="text-[10px] text-[var(--text-3)]">{m.mode_taxe === 'aucune' ? 'sans taxe' : m.mode_taxe}</span>}</td>
                  <td className="text-center">{m.priorite}</td>
                  <td>{m.actif ? '✓' : '—'}</td>
                </tr>)))}
            </tbody>
          </table>
        </div>
      </Etat>
    </FinanceLayout>
  )
}
