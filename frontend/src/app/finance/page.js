'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat, Kpi } from '@/components/finance/FinanceLayout'
import { montant, dateFr, exerciceParDefaut, periodeCourante, soldeNet, messageErreur, STATUT_ECRITURE, STATUT_EXERCICE } from '@/lib/finance'

export default function FinanceDashboard() {
  const router = useRouter()
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    // Un seul aller-retour parallèle — aucune donnée détaillée (lignes) chargée ici
    Promise.all([
      financeAPI.exercices(), financeAPI.balance(), financeAPI.etats(), financeAPI.controle(),
      financeAPI.ecritures({ limit: 8 }), financeAPI.ecritures({ statut: 'brouillon', limit: 100 }),
    ]).then(([ex, bal, et, ctl, rec, br]) => setD({
      exercices: ex.data.exercices, balance: bal.data, etats: et.data, controle: ctl.data.exercices,
      recentes: rec.data.ecritures, brouillons: br.data.ecritures.length,
    })).catch(e => setErreur(messageErreur(e)))
  }, [])

  const ex = d && exerciceParDefaut(d.exercices)
  const per = ex && periodeCourante(ex)
  const lignes = d?.balance?.lignes || []
  const k = d && {
    ca:          -soldeNet(lignes, c => c.startsWith('7')),
    tresorerie:   soldeNet(lignes, c => c.startsWith('5')),
    creances:     soldeNet(lignes, c => c.startsWith('41')),
    dettesFour:  -soldeNet(lignes, c => c.startsWith('40')),
    dettesFisc:  -soldeNet(lignes, c => c.startsWith('44')),
    resultat:     d.etats?.compte_resultat?.resultat ?? 0,
  }
  const ctl = d?.controle?.find(c => c.exercice_id === ex?.id)
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const retard = (ex?.periodes || []).filter(p => p.statut === 'ouverte' && p.date_fin < aujourdHui)
  const alertes = d ? [
    ctl && Number(ctl.ecart) !== 0 && { niveau: 'rouge', texte: `Écart débit/crédit sur l'exercice : ${montant(ctl.ecart)} XAF` },
    d.balance && !d.balance.equilibre && { niveau: 'rouge', texte: 'Balance non équilibrée' },
    d.etats?.controles && !d.etats.controles.bilan_equilibre && { niveau: 'rouge', texte: 'Bilan non équilibré' },
    d.etats?.controles?.comptes_non_classes?.length > 0 && { niveau: 'ambre', texte: `${d.etats.controles.comptes_non_classes.length} compte(s) mouvementé(s) non classé(s) dans les états` },
    d.brouillons > 0 && { niveau: 'ambre', texte: `${d.brouillons} écriture(s) en brouillon à valider` },
    retard.length === 1 && { niveau: 'ambre', texte: `Période ${retard[0].libelle} terminée mais non clôturée` },
    retard.length > 1 && { niveau: 'ambre', texte: `${retard.length} périodes terminées non clôturées (${retard[0].libelle} → ${retard[retard.length - 1].libelle})` },
  ].filter(Boolean) : []

  return (
    <FinanceLayout titre="Finance OHADA">
      <Etat chargement={!d && !erreur} erreur={erreur}>
        {d && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--text-3)]">Exercice</span>
              <span className="font-bold">{ex ? ex.annee : '—'}</span>
              {ex && <span className={`badge ${STATUT_EXERCICE[ex.statut]?.classe}`}>{STATUT_EXERCICE[ex.statut]?.label}</span>}
              <span className="text-[var(--text-3)] ml-3">Période courante</span>
              <span className="font-bold">{per ? `${per.libelle} (${per.statut === 'ouverte' ? 'ouverte' : 'clôturée'})` : '—'}</span>
              <span className={`ml-auto badge ${d.balance.equilibre ? 'badge-green' : 'badge-red'}`}>
                Balance {d.balance.equilibre ? 'équilibrée' : 'déséquilibrée'} · {montant(d.balance.totaux?.total_debit)} = {montant(d.balance.totaux?.total_credit)}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Kpi libelle="Chiffre d'affaires (cl. 7)" valeur={montant(k.ca)} sous="XAF HT" />
              <Kpi libelle="Trésorerie (cl. 5)" valeur={montant(k.tresorerie)} sous="XAF" couleur="text-emerald-400" />
              <Kpi libelle="Créances clients (41)" valeur={montant(k.creances)} sous="XAF" />
              <Kpi libelle="Dettes fournisseurs (40)" valeur={montant(k.dettesFour)} sous="XAF" />
              <Kpi libelle="Dettes fiscales (44)" valeur={montant(k.dettesFisc)} sous="XAF" />
              <Kpi libelle="Résultat" valeur={montant(k.resultat)} sous={d.etats?.compte_resultat?.nature === 'perte' ? 'Perte' : 'Bénéfice'}
                couleur={k.resultat >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="card lg:col-span-2">
                <div className="card-header"><div className="card-title">Écritures récentes</div>
                  <Link href="/finance/ecritures" prefetch={false} className="text-[11px] text-blue-400">Toutes les écritures →</Link></div>
                <Etat vide={!d.recentes.length && 'Aucune écriture pour le moment.'}>
                  <table className="table-base">
                    <thead><tr><th>Pièce</th><th>Date</th><th>Jnl</th><th>Libellé</th><th className="text-right">Montant</th><th>Statut</th></tr></thead>
                    <tbody>{d.recentes.map(e => (
                      <tr key={e.id} onClick={() => router.push(`/finance/ecritures/${e.id}`)}>
                        <td className="font-mono">{e.numero_piece}</td><td>{dateFr(e.date_ecriture)}</td><td>{e.journal}</td>
                        <td className="max-w-[260px] truncate">{e.libelle}</td><td className="text-right font-mono">{montant(e.total_debit)}</td>
                        <td><span className={`badge ${STATUT_ECRITURE[e.statut]?.classe}`}>{STATUT_ECRITURE[e.statut]?.label}</span></td>
                      </tr>))}</tbody>
                  </table>
                </Etat>
              </div>
              <div className="card">
                <div className="card-header"><div className="card-title">Alertes comptables</div></div>
                <div className="p-3 space-y-2">
                  {alertes.length === 0
                    ? <div className="text-xs text-emerald-400">✓ Aucune anomalie : balance équilibrée, aucun brouillon, périodes à jour.</div>
                    : alertes.map((a, i) => (
                      <div key={i} className={`text-xs rounded-lg px-3 py-2 ${a.niveau === 'rouge' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{a.texte}</div>))}
                  <div className="text-[10px] text-[var(--text-4)] pt-2">Contrôle : {ctl ? `${ctl.nb_ecritures} écritures validées, écart ${montant(ctl.ecart)}` : '—'}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </Etat>
    </FinanceLayout>
  )
}
