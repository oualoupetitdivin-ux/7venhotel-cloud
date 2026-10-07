'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, messageErreur, exerciceParDefaut, telechargerCSV } from '@/lib/finance'

const CLASSES = { 1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Autres charges et produits' }

export default function BalancePage() {
  const router = useRouter()
  const [exercices, setExercices] = useState([])
  const [f, setF] = useState({ exercice_id: '', date_fin: '', classe: '', recherche: '' })
  const [b, setB] = useState(null)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    financeAPI.exercices().then(r => { setExercices(r.data.exercices); setF(x => ({ ...x, exercice_id: exerciceParDefaut(r.data.exercices)?.id || '' })) })
      .catch(e => setErreur(messageErreur(e)))
  }, [])

  useEffect(() => {
    if (!f.exercice_id) return
    setB(null)
    financeAPI.balance({ exercice_id: f.exercice_id, ...(f.date_fin ? { date_fin: f.date_fin } : {}) })
      .then(r => setB(r.data)).catch(e => setErreur(messageErreur(e)))
  }, [f.exercice_id, f.date_fin])

  const lignes = (b?.lignes || []).filter(l => (!f.classe || String(l.classe) === f.classe) &&
    (!f.recherche || `${l.compte} ${l.libelle}`.toLowerCase().includes(f.recherche.toLowerCase())))
  const filtre = !!(f.classe || f.recherche)
  const sous = lignes.reduce((s, l) => ({ d: s.d + l.total_debit, c: s.c + l.total_credit, sd: s.sd + l.solde_debiteur, sc: s.sc + l.solde_crediteur }), { d: 0, c: 0, sd: 0, sc: 0 })
  const ex = exercices.find(e => e.id === f.exercice_id)

  function exporter() {
    telechargerCSV(`balance_${ex?.annee || ''}${f.date_fin ? '_au_' + f.date_fin : ''}.csv`,
      ['Compte', 'Intitule', 'Classe', 'Mouvements debit', 'Mouvements credit', 'Solde debiteur', 'Solde crediteur'],
      [...lignes.map(l => [l.compte, l.libelle, l.classe, l.total_debit, l.total_credit, l.solde_debiteur, l.solde_crediteur]),
       ['TOTAUX', '', '', b.totaux.total_debit, b.totaux.total_credit, b.totaux.solde_debiteur, b.totaux.solde_crediteur]])
  }

  return (
    <FinanceLayout titre="Balance générale" actions={b && <button className="btn btn-ghost btn-sm text-xs" onClick={exporter}>⬇ Export CSV</button>}>
      <div className="card p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        <select className="input text-xs" value={f.exercice_id} onChange={e => setF(x => ({ ...x, exercice_id: e.target.value }))}>
          {exercices.map(e => <option key={e.id} value={e.id}>Exercice {e.annee}</option>)}
        </select>
        <input type="date" className="input text-xs" value={f.date_fin} onChange={e => setF(x => ({ ...x, date_fin: e.target.value }))} title="Balance arrêtée au" />
        <select className="input text-xs" value={f.classe} onChange={e => setF(x => ({ ...x, classe: e.target.value }))}>
          <option value="">Toutes les classes</option>
          {Object.entries(CLASSES).map(([k, v]) => <option key={k} value={k}>Classe {k} — {v}</option>)}
        </select>
        <input className="input text-xs" placeholder="Compte ou intitulé…" value={f.recherche} onChange={e => setF(x => ({ ...x, recherche: e.target.value }))} />
      </div>

      <Etat chargement={!b && !erreur} erreur={erreur} vide={b && !b.lignes.length && 'Aucun compte mouvementé sur cet exercice.'}>
        {b && (
          <>
            <div className={`card p-4 flex flex-wrap items-center gap-4 ${b.equilibre ? 'border border-emerald-500/30' : 'border border-red-500/50'}`}>
              <span className={`text-sm font-black ${b.equilibre ? 'text-emerald-400' : 'text-red-400'}`}>{b.equilibre ? '✓ Balance équilibrée' : '✗ Balance NON équilibrée'}</span>
              <span className="text-xs font-mono">Mouvements : D {montant(b.totaux.total_debit)} / C {montant(b.totaux.total_credit)}</span>
              <span className="text-xs font-mono">Soldes : D {montant(b.totaux.solde_debiteur)} / C {montant(b.totaux.solde_crediteur)}</span>
              <span className="text-[10px] text-[var(--text-3)] ml-auto">Exercice {b.exercice?.annee} ({b.exercice?.statut}){b.date_fin ? ` · arrêtée au ${b.date_fin}` : ''} · à-nouveaux (journal AN) inclus dans les mouvements</span>
            </div>
            <div className="card overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Compte</th><th>Intitulé</th><th>Cl.</th><th className="text-right">Mvts débit</th><th className="text-right">Mvts crédit</th><th className="text-right">Solde débiteur</th><th className="text-right">Solde créditeur</th></tr></thead>
                <tbody>
                  {lignes.map(l => (
                    <tr key={l.compte} onClick={() => router.push(`/finance/grand-livre?compte=${l.compte}`)}>
                      <td className="font-mono">{l.compte}</td><td>{l.libelle}</td><td>{l.classe}</td>
                      <td className="text-right font-mono">{montant(l.total_debit)}</td><td className="text-right font-mono">{montant(l.total_credit)}</td>
                      <td className="text-right font-mono">{l.solde_debiteur ? montant(l.solde_debiteur) : ''}</td><td className="text-right font-mono">{l.solde_crediteur ? montant(l.solde_crediteur) : ''}</td>
                    </tr>))}
                  {filtre && <tr className="font-semibold text-[var(--text-2)]"><td colSpan={3}>Sous-total (filtre)</td><td className="text-right font-mono">{montant(sous.d)}</td><td className="text-right font-mono">{montant(sous.c)}</td><td className="text-right font-mono">{montant(sous.sd)}</td><td className="text-right font-mono">{montant(sous.sc)}</td></tr>}
                  <tr className="font-black"><td colSpan={3}>TOTAUX GÉNÉRAUX</td><td className="text-right font-mono">{montant(b.totaux.total_debit)}</td><td className="text-right font-mono">{montant(b.totaux.total_credit)}</td><td className="text-right font-mono">{montant(b.totaux.solde_debiteur)}</td><td className="text-right font-mono">{montant(b.totaux.solde_crediteur)}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Etat>
    </FinanceLayout>
  )
}
