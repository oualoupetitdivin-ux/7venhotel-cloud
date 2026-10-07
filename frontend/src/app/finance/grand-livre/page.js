'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, dateFr, messageErreur, exerciceParDefaut, telechargerCSV } from '@/lib/finance'

export default function GrandLivrePage() {
  const router = useRouter()
  const [exercices, setExercices] = useState([])
  const [comptes, setComptes] = useState([])          // comptes mouvementés (balance)
  const [f, setF] = useState({ exercice_id: '', periode: '', compte: '', date_debut: '', date_fin: '', recherche: '' })
  const [gl, setGl] = useState(null)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    const compteUrl = new URLSearchParams(window.location.search).get('compte') || ''
    financeAPI.exercices().then(r => {
      const ex = exerciceParDefaut(r.data.exercices)
      setExercices(r.data.exercices)
      setF(x => ({ ...x, exercice_id: ex?.id || '', compte: compteUrl }))
    }).catch(e => setErreur(messageErreur(e)))
  }, [])

  // Liste des comptes mouvementés de l'exercice (léger) — sert de sélecteur
  useEffect(() => {
    if (!f.exercice_id) return
    financeAPI.balance({ exercice_id: f.exercice_id }).then(r => setComptes(r.data.lignes)).catch(() => {})
  }, [f.exercice_id])

  // Le Grand Livre n'est chargé que sur demande (un compte, ou « tous » explicitement)
  useEffect(() => {
    if (!f.exercice_id || !f.compte) { setGl(null); return }
    setChargement(true); setErreur(null)
    const params = { exercice_id: f.exercice_id }
    if (f.compte !== '*') params.compte = f.compte
    if (f.date_debut) params.date_debut = f.date_debut
    if (f.date_fin) params.date_fin = f.date_fin
    financeAPI.grandLivre(params).then(r => setGl(r.data)).catch(e => setErreur(messageErreur(e))).finally(() => setChargement(false))
  }, [f.exercice_id, f.compte, f.date_debut, f.date_fin])

  const ex = exercices.find(e => e.id === f.exercice_id)
  function choisirPeriode(id) {
    const p = ex?.periodes.find(x => x.id === id)
    setF(x => ({ ...x, periode: id, date_debut: p?.date_debut || '', date_fin: p?.date_fin || '' }))
  }
  const q = f.recherche.toLowerCase()
  const comptesAffiches = (gl?.comptes || []).map(c => ({ ...c, lignes: c.lignes.filter(l => !q || `${l.piece} ${l.libelle} ${l.reference || ''}`.toLowerCase().includes(q)) }))

  function exporter() {
    const rows = []
    for (const c of comptesAffiches) for (const l of c.lignes) rows.push([c.numero, c.libelle, l.date, l.journal, l.piece, l.libelle, l.reference || '', l.debit, l.credit, l.solde])
    telechargerCSV(`grand-livre_${ex?.annee || ''}${f.compte && f.compte !== '*' ? '_' + f.compte : ''}.csv`,
      ['Compte', 'Intitule', 'Date', 'Journal', 'Piece', 'Libelle', 'Reference', 'Debit', 'Credit', 'Solde'], rows)
  }

  return (
    <FinanceLayout titre="Grand Livre" actions={gl && <button className="btn btn-ghost btn-sm text-xs" onClick={exporter}>⬇ Export CSV</button>}>
      <div className="card p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
        <select className="input text-xs" value={f.exercice_id} onChange={e => setF(x => ({ ...x, exercice_id: e.target.value, periode: '', date_debut: '', date_fin: '' }))}>
          {exercices.map(e => <option key={e.id} value={e.id}>Exercice {e.annee}</option>)}
        </select>
        <select className="input text-xs" value={f.periode} onChange={e => choisirPeriode(e.target.value)}>
          <option value="">Toute la période</option>
          {(ex?.periodes || []).map(p => <option key={p.id} value={p.id}>{p.libelle}</option>)}
        </select>
        <select className="input text-xs md:col-span-2" value={f.compte} onChange={e => setF(x => ({ ...x, compte: e.target.value }))}>
          <option value="">— Choisir un compte —</option>
          <option value="*">Tous les comptes mouvementés</option>
          {comptes.map(c => <option key={c.compte} value={c.compte}>{c.compte} — {c.libelle}</option>)}
        </select>
        <input type="date" className="input text-xs" value={f.date_debut} onChange={e => setF(x => ({ ...x, periode: '', date_debut: e.target.value }))} title="Du" />
        <input type="date" className="input text-xs" value={f.date_fin} onChange={e => setF(x => ({ ...x, periode: '', date_fin: e.target.value }))} title="Au" />
        <input className="input text-xs col-span-2 md:col-span-6" placeholder="Rechercher dans les mouvements (pièce, libellé, référence)…" value={f.recherche} onChange={e => setF(x => ({ ...x, recherche: e.target.value }))} />
        <div className="col-span-2 md:col-span-6 text-[10px] text-[var(--text-4)]">Tiers : aucun compte auxiliaire de tiers n'est alimenté par le moteur à ce jour — le suivi se fait sur les comptes collectifs (411, 401…).</div>
      </div>

      <Etat chargement={chargement} erreur={erreur} vide={!f.compte && 'Choisissez un compte (ou « Tous les comptes mouvementés ») pour afficher ses mouvements.'}>
        {gl && (gl.comptes.length === 0 ? <div className="card p-8 text-center text-xs text-[var(--text-3)]">Aucun mouvement pour ces critères.</div> :
          <div className="space-y-4">
            {comptesAffiches.map(c => (
              <div key={c.numero} className="card overflow-x-auto">
                <div className="card-header"><div className="card-title"><span className="font-mono">{c.numero}</span> — {c.libelle}</div>
                  <span className="text-[11px] font-mono text-[var(--text-2)]">Ouverture {montant(c.solde_ouverture)} · D {montant(c.total_debit)} · C {montant(c.total_credit)} · Solde {montant(c.solde_cloture)}</span></div>
                <table className="table-base">
                  <thead><tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Référence</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde progressif</th></tr></thead>
                  <tbody>{c.lignes.map((l, i) => (
                    <tr key={l.ecriture_id + i} onClick={() => router.push(`/finance/ecritures/${l.ecriture_id}`)}>
                      <td>{dateFr(l.date)}</td><td>{l.journal}</td><td className="font-mono">{l.piece}</td>
                      <td className="max-w-[240px] truncate">{l.libelle}</td>
                      <td className="text-[10px] text-[var(--text-3)] max-w-[160px] truncate">{l.reference || '—'}</td>
                      <td className="text-right font-mono">{l.debit ? montant(l.debit) : ''}</td>
                      <td className="text-right font-mono">{l.credit ? montant(l.credit) : ''}</td>
                      <td className={`text-right font-mono ${l.solde < 0 ? 'text-amber-300' : ''}`}>{montant(l.solde)}</td>
                    </tr>))}</tbody>
                </table>
              </div>))}
            <div className="text-right text-xs font-mono">Totaux : débit {montant(gl.totaux?.debit)} · crédit {montant(gl.totaux?.credit)}</div>
          </div>)}
      </Etat>
    </FinanceLayout>
  )
}
