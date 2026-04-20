'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { facturationAPI } from '@/lib/api'
import { fmt, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_COLOR = { brouillon:'badge-gray', emise:'badge-blue', payee:'badge-green', annulee:'badge-red' }
const STATUT_LABEL = { brouillon:'Brouillon', emise:'Émise', payee:'Payée', annulee:'Annulée' }

export default function FacturationPage() {
  const [factures, setFactures] = useState([])
  const [taxes, setTaxes]       = useState([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [onglet, setOnglet]     = useState('factures')
  const [filtreStatut, setFiltreStatut] = useState('')

  useEffect(() => { charger() }, [filtreStatut])

  async function charger() {
    try {
      setLoading(true)
      const [fRes, tRes] = await Promise.allSettled([
        facturationAPI.factures({ statut: filtreStatut || undefined }),
        facturationAPI.taxes()
      ])
      if (fRes.status === 'fulfilled') {
        setFactures(fRes.value.data.data || [])
        setTotal(fRes.value.data.pagination?.total || 0)
      }
      if (tRes.status === 'fulfilled') setTaxes(tRes.value.data.taxes || [])
    } catch { toast.error('Erreur chargement facturation') }
    finally { setLoading(false) }
  }

  const totalPayees = factures.filter(f => f.statut === 'payee').reduce((s,f) => s + (f.montant_total || 0), 0)
  const totalEmises = factures.filter(f => f.statut === 'emise').reduce((s,f) => s + (f.montant_total || 0), 0)

  return (
    <AppLayout titre="Facturation" sousTitre="Factures & taxes">
      <div className="space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          <div className="kpi-card border-b-2 border-blue-500"><div className="kpi-label">Total factures</div><div className="kpi-value">{total}</div></div>
          <div className="kpi-card border-b-2 border-emerald-500"><div className="kpi-label">Encaissé</div><div className="kpi-value text-emerald-400 text-sm">{fmt(totalPayees)}</div></div>
          <div className="kpi-card border-b-2 border-amber-500"><div className="kpi-label">En attente</div><div className="kpi-value text-amber-400 text-sm">{fmt(totalEmises)}</div></div>
          <div className="kpi-card border-b-2 border-purple-500"><div className="kpi-label">Taxes actives</div><div className="kpi-value">{taxes.filter(t=>t.actif).length}</div></div>
        </div>

        {/* Onglets */}
        <div className="flex gap-2 border-b border-[var(--border-1)]">
          {[['factures','📄 Factures'], ['taxes','% Taxes']].map(([k,l]) => (
            <button key={k} onClick={() => setOnglet(k)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)]'}`}>
              {l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : onglet === 'factures' ? (
          <div className="space-y-4">
            {/* Filtres */}
            <div className="flex gap-2 flex-wrap">
              {['','brouillon','emise','payee','annulee'].map(s => (
                <button key={s} onClick={() => setFiltreStatut(s)}
                  className={`btn btn-sm ${filtreStatut===s ? 'btn-primary' : 'btn-ghost'}`}>
                  {s ? STATUT_LABEL[s] : 'Toutes'}
                </button>
              ))}
            </div>
            <div className="card overflow-hidden">
              {factures.length === 0 ? (
                <div className="p-10 text-center text-xs text-[var(--text-3)]">
                  <div className="text-4xl mb-3">📄</div>
                  <div className="font-semibold">Aucune facture</div>
                  <div className="mt-1">Les factures sont générées automatiquement lors du checkout</div>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-1)]">
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">N° Facture</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Client</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Date</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Montant</th>
                      <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factures.map(f => (
                      <tr key={f.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                        <td className="px-4 py-3 font-mono text-blue-400">{f.numero_facture}</td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{f.nom_client || '—'}</td>
                        <td className="px-4 py-3 text-[var(--text-3)]">{fmtDate(f.date_emission)}</td>
                        <td className="px-4 py-3 font-semibold">{fmt(f.montant_total, f.devise)}</td>
                        <td className="px-4 py-3"><span className={`badge ${STATUT_COLOR[f.statut]}`}>{STATUT_LABEL[f.statut]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="card-header"><div className="card-title">Taxes configurées</div></div>
            {taxes.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-3)]">Aucune taxe configurée</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-1)]">
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Nom</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Taux</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Type</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Applicable à</th>
                    <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {taxes.map(t => (
                    <tr key={t.id} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                      <td className="px-4 py-3 font-semibold text-[var(--text-1)]">{t.nom}</td>
                      <td className="px-4 py-3 font-bold text-blue-400">{t.taux}{t.type === 'pourcentage' ? '%' : ' XAF'}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{t.type}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{t.applicable_a}</td>
                      <td className="px-4 py-3"><span className={`badge ${t.actif ? 'badge-green' : 'badge-gray'}`}>{t.actif ? 'Active' : 'Inactive'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
