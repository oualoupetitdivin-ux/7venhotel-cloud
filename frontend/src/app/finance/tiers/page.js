'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat, Kpi } from '@/components/finance/FinanceLayout'
import { montant, messageErreur, exerciceParDefaut } from '@/lib/finance'

// Comptes de tiers = classe 4 du plan de l'hôtel. Le moteur ne tient pas (encore) de comptes
// auxiliaires par client / fournisseur : soldes et mouvements sont ceux des comptes collectifs.
const GROUPES = [
  { cle: 'clients',      titre: 'Clients',              filtre: n => n.startsWith('41') },
  { cle: 'fournisseurs', titre: 'Fournisseurs',         filtre: n => n.startsWith('40') },
  { cle: 'personnel',    titre: 'Personnel',            filtre: n => n.startsWith('42') },
  { cle: 'etat',         titre: 'État et organismes',   filtre: n => n.startsWith('43') || n.startsWith('44') },
  { cle: 'autres',       titre: 'Autres tiers',         filtre: n => n.startsWith('4') && !/^4[0-4]/.test(n) },
]

export default function TiersPage() {
  const router = useRouter()
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    financeAPI.exercices().then(r => {
      const ex = exerciceParDefaut(r.data.exercices)
      return Promise.all([financeAPI.planComptable({ classe: 4 }), financeAPI.balance(ex ? { exercice_id: ex.id } : {})])
    }).then(([p, b]) => {
      const bal = Object.fromEntries(b.data.lignes.map(l => [l.compte, l]))
      setD(p.data.comptes.map(c => ({ ...c, b: bal[c.numero] })))
    }).catch(e => setErreur(messageErreur(e)))
  }, [])

  const solde = (c) => c.b ? c.b.total_debit - c.b.total_credit : 0
  const tot = (g) => (d || []).filter(c => g.filtre(c.numero)).reduce((s, c) => s + solde(c), 0)

  return (
    <FinanceLayout titre="Tiers" sousTitre="Comptes de tiers (classe 4) — soldes et mouvements de l'exercice">
      <Etat chargement={!d && !erreur} erreur={erreur}>
        {d && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi libelle="Créances clients (41)" valeur={montant(tot(GROUPES[0]))} sous="solde débiteur net" />
              <Kpi libelle="Dettes fournisseurs (40)" valeur={montant(-tot(GROUPES[1]))} sous="solde créditeur net" />
              <Kpi libelle="État (43–44)" valeur={montant(-tot(GROUPES[3]))} sous="solde créditeur net" />
              <Kpi libelle="Comptes de tiers mouvementés" valeur={d.filter(c => c.b).length} sous={`sur ${d.length} comptes de classe 4`} />
            </div>
            <div className="card p-3 text-[11px] text-[var(--text-3)]">
              Suivi auxiliaire : le moteur comptable enregistre aujourd'hui les tiers sur les comptes collectifs (411 Clients, 401 Fournisseurs…). Aucun compte individuel par client ou fournisseur n'est encore alimenté ; le détail par client reste disponible côté PMS (folios, factures).
            </div>
            {GROUPES.map(g => {
              const liste = d.filter(c => g.filtre(c.numero))
              if (!liste.length) return null
              return (
                <div key={g.cle} className="card overflow-x-auto">
                  <div className="card-header"><div className="card-title">{g.titre}</div><span className="text-xs font-mono">{montant(tot(g))}</span></div>
                  <table className="table-base">
                    <thead><tr><th>Compte</th><th>Intitulé</th><th>Collectif</th><th className="text-right">Mvts débit</th><th className="text-right">Mvts crédit</th><th className="text-right">Solde</th></tr></thead>
                    <tbody>{liste.map(c => (
                      <tr key={c.id} onClick={() => router.push(`/finance/grand-livre?compte=${c.numero}`)} className={c.b ? '' : 'opacity-60'}>
                        <td className="font-mono font-bold">{c.numero}</td><td>{c.libelle}</td><td>{c.collectif ? 'Oui' : '—'}</td>
                        <td className="text-right font-mono">{c.b ? montant(c.b.total_debit) : '—'}</td>
                        <td className="text-right font-mono">{c.b ? montant(c.b.total_credit) : '—'}</td>
                        <td className="text-right font-mono">{c.b ? `${montant(Math.abs(solde(c)))} ${solde(c) >= 0 ? 'D' : 'C'}` : '—'}</td>
                      </tr>))}</tbody>
                  </table>
                </div>)
            })}
          </div>
        )}
      </Etat>
    </FinanceLayout>
  )
}
