'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { financeAPI } from '@/lib/api'
import FinanceLayout, { Etat } from '@/components/finance/FinanceLayout'
import { messageErreur } from '@/lib/finance'

const CLASSES = { 1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie', 6: 'Charges des activités ordinaires', 7: 'Produits des activités ordinaires', 8: 'Autres charges et produits' }
const NATURES = { actif: 'Actif', passif: 'Passif', charge: 'Charge', produit: 'Produit', tiers: 'Tiers', tresorerie: 'Trésorerie' }

export default function PlanComptablePage() {
  const router = useRouter()
  const [comptes, setComptes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [f, setF] = useState({ classe: '', recherche: '', inactifs: false })
  useEffect(() => { financeAPI.planComptable().then(r => setComptes(r.data.comptes)).catch(e => setErreur(messageErreur(e))) }, [])

  // ~105 comptes : filtrage côté navigateur, sans nouvel appel
  const parClasse = useMemo(() => {
    const q = f.recherche.toLowerCase()
    const g = {}
    for (const c of comptes || []) {
      if (f.classe && String(c.classe) !== f.classe) continue
      if (!f.inactifs && !c.actif) continue
      if (q && !`${c.numero} ${c.libelle}`.toLowerCase().includes(q)) continue
      ;(g[c.classe] = g[c.classe] || []).push(c)
    }
    return g
  }, [comptes, f])

  return (
    <FinanceLayout titre="Plan comptable" sousTitre="SYSCOHADA révisé — plan de l'hôtel">
      <div className="card p-3 grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
        <input className="input text-xs md:col-span-2" placeholder="Rechercher un numéro ou un intitulé…" value={f.recherche} onChange={e => setF(x => ({ ...x, recherche: e.target.value }))} />
        <select className="input text-xs" value={f.classe} onChange={e => setF(x => ({ ...x, classe: e.target.value }))}>
          <option value="">Toutes les classes</option>
          {Object.entries(CLASSES).map(([k, v]) => <option key={k} value={k}>Classe {k} — {v}</option>)}
        </select>
        <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={f.inactifs} onChange={e => setF(x => ({ ...x, inactifs: e.target.checked }))} /> Afficher les comptes inactifs</label>
      </div>
      <Etat chargement={!comptes && !erreur} erreur={erreur} vide={comptes && !Object.keys(parClasse).length && 'Aucun compte ne correspond.'}>
        <div className="space-y-4">
          {Object.entries(parClasse).map(([cl, liste]) => (
            <div key={cl} className="card overflow-x-auto">
              <div className="card-header"><div className="card-title">Classe {cl} — {CLASSES[cl]}</div><span className="text-[11px] text-[var(--text-3)]">{liste.length} compte(s)</span></div>
              <table className="table-base">
                <thead><tr><th>Numéro</th><th>Intitulé</th><th>Nature</th><th>Sens normal</th><th>Collectif</th><th>Réf. SYSCOHADA</th><th>Statut</th></tr></thead>
                <tbody>{liste.map(c => (
                  <tr key={c.id} onClick={() => router.push(`/finance/grand-livre?compte=${c.numero}`)} title="Consulter le compte au Grand Livre">
                    <td className="font-mono font-bold">{c.numero}</td><td>{c.libelle}</td><td>{NATURES[c.nature] || c.nature}</td>
                    <td>{c.sens_normal === 'D' ? 'Débiteur' : 'Créditeur'}</td><td>{c.collectif ? 'Oui' : '—'}</td>
                    <td className="font-mono text-[var(--text-3)]">{c.referentiel_numero || '—'}</td>
                    <td><span className={`badge ${c.actif ? 'badge-green' : 'badge-gray'}`}>{c.actif ? 'Actif' : 'Inactif'}</span></td>
                  </tr>))}</tbody>
              </table>
            </div>))}
        </div>
      </Etat>
    </FinanceLayout>
  )
}
