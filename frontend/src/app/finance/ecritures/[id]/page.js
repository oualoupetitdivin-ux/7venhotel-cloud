'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { montant, dateFr, messageErreur, STATUT_ECRITURE } from '@/lib/finance'

const SOURCE = { moteur: 'Moteur comptable (événement PMS)', manuelle: 'Saisie manuelle', contre_ecriture: 'Contre-écriture', cloture: 'Clôture' }

export default function FicheEcriture() {
  const { id } = useParams()
  const [e, setE] = useState(null)
  const [erreur, setErreur] = useState(null)
  useEffect(() => { financeAPI.ecriture(id).then(r => setE(r.data.ecriture)).catch(x => setErreur(messageErreur(x))) }, [id])

  const totD = e ? e.lignes.reduce((s, l) => s + Number(l.debit), 0) : 0
  const totC = e ? e.lignes.reduce((s, l) => s + Number(l.credit), 0) : 0
  const equilibre = Math.round(totD * 100) === Math.round(totC * 100)

  return (
    <FinanceLayout titre={e ? `Écriture ${e.numero_piece}` : 'Écriture'} actions={<Link href="/finance/ecritures" prefetch={false} className="btn btn-ghost btn-sm text-xs">← Retour aux écritures</Link>}>
      <Etat chargement={!e && !erreur} erreur={erreur}>
        {e && (
          <div className="space-y-4">
            <div className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <Info l="Pièce" v={<span className="font-mono">{e.numero_piece}</span>} />
              <Info l="Date" v={dateFr(e.date_ecriture)} />
              <Info l="Journal" v={e.journal_code} />
              <Info l="Statut" v={<span className={`badge ${STATUT_ECRITURE[e.statut]?.classe}`}>{STATUT_ECRITURE[e.statut]?.label}</span>} />
              <div className="col-span-2 md:col-span-4"><Info l="Libellé" v={e.libelle} /></div>
            </div>

            <div className="card overflow-x-auto">
              <div className="card-header"><div className="card-title">Lignes</div>
                <span className={`badge ${equilibre ? 'badge-green' : 'badge-red'}`}>{equilibre ? '✓ Équilibrée' : '✗ Déséquilibrée'} · D {montant(totD)} = C {montant(totC)}</span></div>
              <table className="table-base">
                <thead><tr><th>#</th><th>Compte</th><th>Intitulé</th><th>Tiers</th><th>Libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th></tr></thead>
                <tbody>
                  {e.lignes.map(l => (
                    <tr key={l.numero_ligne}>
                      <td>{l.numero_ligne}</td>
                      <td className="font-mono"><Link href={`/finance/grand-livre?compte=${l.compte_numero}`} prefetch={false} className="text-blue-400">{l.compte_numero}</Link></td>
                      <td>{l.compte_libelle}</td>
                      <td className="text-[10px] text-[var(--text-3)]">{l.tiers_id ? <span className="font-mono">{l.tiers_id.slice(0, 8)}…</span> : '—'}</td>
                      <td className="max-w-[260px] truncate">{l.libelle}</td>
                      <td className="text-right font-mono">{Number(l.debit) ? montant(l.debit) : ''}</td>
                      <td className="text-right font-mono">{Number(l.credit) ? montant(l.credit) : ''}</td>
                    </tr>))}
                  <tr className="font-bold"><td colSpan={5} className="text-right">Totaux</td><td className="text-right font-mono">{montant(totD)}</td><td className="text-right font-mono">{montant(totC)}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="card p-4 space-y-2 text-xs">
                <div className="card-title mb-1">Événement source</div>
                <Info l="Origine" v={SOURCE[e.source] || e.source} />
                <Info l="Type d'événement" v={e.evenement_type || '—'} />
                <Info l="Référence" v={e.reference_type ? <span className="font-mono">{e.reference_type} · {e.reference_id}</span> : '—'} />
                <Info l="Clé d'idempotence" v={e.cle_idempotence ? <span className="font-mono break-all">{e.cle_idempotence}</span> : '—'} />
              </div>
              <div className="card p-4 space-y-2 text-xs">
                <div className="card-title mb-1">Traçabilité</div>
                <Info l="Créée le" v={e.cree_le ? new Date(e.cree_le).toLocaleString('fr-FR') : '—'} />
                <Info l="Créée par" v={e.cree_par ? <span className="font-mono">{e.cree_par}</span> : 'Système'} />
                <Info l="Validée le" v={e.validee_le ? new Date(e.validee_le).toLocaleString('fr-FR') : '—'} />
                {e.ecriture_origine_id && <Info l="Contre-passe" v={<Link href={`/finance/ecritures/${e.ecriture_origine_id}`} prefetch={false} className="text-blue-400">écriture d'origine →</Link>} />}
                {e.contre_ecriture && <Info l="Contre-passée par" v={<Link href={`/finance/ecritures/${e.contre_ecriture.id}`} prefetch={false} className="text-blue-400">{e.contre_ecriture.numero_piece || 'contre-écriture'} →</Link>} />}
                <div className="text-[10px] text-[var(--text-4)] pt-1">Écriture immuable : toute correction passe par une contre-écriture (règle du moteur OHADA).</div>
              </div>
            </div>
          </div>
        )}
      </Etat>
    </FinanceLayout>
  )
}

function Info({ l, v }) {
  return <div><div className="text-[9.5px] uppercase tracking-wide text-[var(--text-3)]">{l}</div><div className="mt-0.5">{v}</div></div>
}
