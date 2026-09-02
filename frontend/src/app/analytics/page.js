'use client'
import { useState, useEffect } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js'
import AppLayout from '@/components/layout/AppLayout'
import { analyticsAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler)

// ── Utilitaires locaux ───────────────────────────────────────────────────
function fmtPct(v) { return (parseFloat(v) || 0).toFixed(1) + ' %' }
function fmtNum(v) { return new Intl.NumberFormat('fr-FR').format(Math.round(v || 0)) }
function dateLocale(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
function semLocale(d) {
  return 'Sem. ' + new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
function todayISO(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}
function extraire(res) { return res.status === 'fulfilled' ? res.value.data : null }
function moyenne(arr, sel) { return arr.length ? arr.reduce((s, d) => s + sel(d), 0) / arr.length : 0 }
function deltaPct(base, val) { return base ? ((val - base) / base) * 100 : 0 }
function occSel(d) { return Number(d.taux_occupation_pct ?? d.taux_occupation ?? 0) }

// ── Palette Chart.js ─────────────────────────────────────────────────────
const BLEU   = { line: '#3B82F6', bg: 'rgba(59,130,246,.7)',  bgLight: 'rgba(59,130,246,.1)' }
const VERT   = { line: '#10B981', bg: 'rgba(16,185,129,.7)',  bgLight: 'rgba(16,185,129,.1)' }
const ORANGE = { line: '#F59E0B', bg: 'rgba(245,158,11,.7)',  bgLight: 'rgba(245,158,11,.1)' }
const ROUGE  = { line: '#EF4444', bg: 'rgba(239,68,68,.7)',   bgLight: 'rgba(239,68,68,.1)' }
const VIOLET = { line: '#8B5CF6', bg: 'rgba(139,92,246,.7)',  bgLight: 'rgba(139,92,246,.1)' }
const GRIS   = { line: '#94A3B8', bg: 'rgba(148,163,184,.6)' }
const AXE_COLOR   = '#4A6080'
const GRILLE_COLOR = 'rgba(255,255,255,.04)'

function chartOpts({ legend = false } = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: legend, labels: { color: AXE_COLOR, font: { size: 10 }, boxWidth: 10 } } },
    scales: {
      x: { grid: { color: GRILLE_COLOR }, ticks: { color: AXE_COLOR, font: { size: 9 } } },
      y: { grid: { color: GRILLE_COLOR }, ticks: { color: AXE_COLOR, font: { size: 9 } } },
    }
  }
}
const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: true, position: 'bottom', labels: { color: AXE_COLOR, font: { size: 10 }, boxWidth: 10, padding: 10 } } }
}

// ── Onglets ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'dashboard',    label: 'Dashboard',    icone: '📊' },
  { id: 'pnl',          label: 'P&L',          icone: '💰' },
  { id: 'hebergement',  label: 'Hébergement',  icone: '🏨' },
  { id: 'fb',           label: 'F&B',          icone: '🍽' },
  { id: 'stock',        label: 'Stock',        icone: '📦' },
  { id: 'achats',       label: 'Achats',       icone: '🚚' },
]

const PERIODES_RAPIDES = [
  { label: '7j',    jours: 7 },
  { label: '30j',   jours: 30 },
  { label: '3 mois', jours: 90 },
  { label: '6 mois', jours: 180 },
]

// ── Chargeurs par onglet — tolérants aux échecs individuels (Promise.allSettled) ──
const FETCHERS = {
  dashboard: async () => {
    const [dash, pnlMois, kpiHosp, quot7, pnl7] = await Promise.allSettled([
      analyticsAPI.dashboard(),
      analyticsAPI.pnl(),
      analyticsAPI.kpiHospitality(),
      analyticsAPI.quotidiennes({ jours: 7 }),
      analyticsAPI.pnl({ debut: todayISO(-7), fin: todayISO(0) }),
    ])
    return { dash: extraire(dash), pnlMois: extraire(pnlMois), kpiHosp: extraire(kpiHosp), quot7: extraire(quot7), pnl7: extraire(pnl7) }
  },
  pnl: async (periode) => {
    const [pnl, revVent] = await Promise.allSettled([
      analyticsAPI.pnl(periode),
      analyticsAPI.revenusVentiles(periode),
    ])
    return { pnl: extraire(pnl), revVent: extraire(revVent) }
  },
  hebergement: async (periode) => {
    const [kpiHosp, quot90] = await Promise.allSettled([
      analyticsAPI.kpiHospitality(periode),
      analyticsAPI.quotidiennes({ jours: 90 }),
    ])
    return { kpiHosp: extraire(kpiHosp), quot90: extraire(quot90) }
  },
  fb: async (periode) => {
    const [fb] = await Promise.allSettled([analyticsAPI.fbAnalyse(periode)])
    return { fb: extraire(fb) }
  },
  stock: async () => {
    const [stock] = await Promise.allSettled([analyticsAPI.stockAnalyse()])
    return { stock: extraire(stock) }
  },
  achats: async (periode) => {
    const [achats] = await Promise.allSettled([analyticsAPI.achatsAnalyse(periode)])
    return { achats: extraire(achats) }
  },
}

// ── Petits composants réutilisés ────────────────────────────────────────
function EmptyState({ icone = '📊', texte = 'Aucune donnée sur la période sélectionnée' }) {
  return (
    <div className="text-center py-12 text-[var(--text-3)] text-sm">
      <div className="text-3xl opacity-20 mb-2">{icone}</div>
      <div>{texte}</div>
    </div>
  )
}

function KpiCard({ label, valeur, icone, couleurValeur, badge, sousTexte }) {
  return (
    <div className="kpi-card">
      {icone && <div className="absolute right-3 top-3 text-lg opacity-10">{icone}</div>}
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${couleurValeur || ''}`}>{valeur}</div>
      {badge}
      {sousTexte && <div className="text-[10px] text-[var(--text-3)] mt-1">{sousTexte}</div>}
    </div>
  )
}

function SkeletonOnglet() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>
      <div className="skeleton h-52 rounded-xl" />
    </div>
  )
}

// ── Onglet 1 — Dashboard ─────────────────────────────────────────────────
function OngletDashboard({ data, loading }) {
  if (loading && !data) return <SkeletonOnglet />
  const dash    = data?.dash || {}
  const pnlMois = data?.pnlMois || {}
  const kpiHosp = data?.kpiHosp || {}
  const quot7   = data?.quot7?.data || data?.quot7?.donnees || []
  const pnl7    = data?.pnl7 || {}

  const resultatBrut = Number(pnlMois?.resultat?.brut ?? 0)
  const resultatPositif = resultatBrut >= 0

  const cartes = [
    { label: 'Occupation',        valeur: fmtPct(dash.taux_occupation), icone: '🏨' },
    { label: 'Revenu du jour',    valeur: fmt(dash.revenu_jour || 0),   icone: '💰' },
    { label: 'Charges du jour',   valeur: fmt(dash.charges_jour || 0),  icone: '📉' },
    { label: 'Résultat du mois',  valeur: fmt(resultatBrut), icone: resultatPositif ? '📈' : '📉',
      couleurValeur: resultatPositif ? 'text-emerald-400' : 'text-red-400' },
    { label: 'RevPAR',            valeur: fmt(kpiHosp.revpar || 0),     icone: '🛏' },
  ]

  const occChart = quot7.length ? {
    labels: quot7.map(d => dateLocale(d.date)),
    datasets: [{ data: quot7.map(occSel), backgroundColor: BLEU.bg, borderRadius: 4 }]
  } : null

  const revparChart = quot7.length ? {
    labels: quot7.map(d => dateLocale(d.date)),
    datasets: [{
      data: quot7.map(d => Number(d.revpar ?? (d.chambres_occupees ? Number(d.revenu_hebergement || 0) / d.chambres_occupees : 0))),
      borderColor: BLEU.line, backgroundColor: BLEU.bgLight, tension: .4, fill: true, pointRadius: 2,
    }]
  } : null

  const chargesCategories = pnl7?.charges?.categories || []
  const chargesChart = chargesCategories.length ? {
    labels: chargesCategories.map(c => c.categorie_nom),
    datasets: [{ data: chargesCategories.map(c => Number(c.total_charges || 0)), backgroundColor: ROUGE.bg, borderRadius: 4 }]
  } : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-5 gap-3">
        {cartes.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="card-title mb-2 text-xs">Occupation — 7 jours</div>
          <div style={{ height: 120 }}>
            {occChart ? <Bar data={occChart} options={chartOpts()} /> : <EmptyState icone="🏨" />}
          </div>
        </div>
        <div className="card p-4">
          <div className="card-title mb-2 text-xs">RevPAR — 7 jours</div>
          <div style={{ height: 120 }}>
            {revparChart ? <Line data={revparChart} options={chartOpts()} /> : <EmptyState icone="🛏" />}
          </div>
        </div>
        <div className="card p-4">
          <div className="card-title mb-2 text-xs">Charges — 7 jours</div>
          <div style={{ height: 120 }}>
            {chargesChart ? <Bar data={chargesChart} options={chartOpts()} /> : <EmptyState icone="📉" />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Onglet 2 — P&L ───────────────────────────────────────────────────────
function OngletPnl({ data, loading }) {
  if (loading && !data) return <SkeletonOnglet />
  const pnl     = data?.pnl || {}
  const revVent = data?.revVent?.data || data?.revVent?.donnees || []

  const revenus  = pnl.revenus || {}
  const charges  = pnl.charges || {}
  const resultat = pnl.resultat || {}
  const positif  = Number(resultat.brut ?? 0) >= 0

  const revVentChart = revVent.length ? {
    labels: revVent.map(d => dateLocale(d.date)),
    datasets: [
      { label: 'Hébergement', data: revVent.map(d => Number(d.hebergement || 0)), borderColor: BLEU.line, backgroundColor: BLEU.bgLight, tension: .4, fill: true, pointRadius: 2 },
      { label: 'Restaurant',  data: revVent.map(d => Number(d.restaurant || 0)),  borderColor: ORANGE.line, backgroundColor: ORANGE.bgLight, tension: .4, fill: true, pointRadius: 2 },
      { label: 'Extras',      data: revVent.map(d => Number(d.extras || 0)),      borderColor: VERT.line, backgroundColor: VERT.bgLight, tension: .4, fill: true, pointRadius: 2 },
    ]
  } : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-6">
        <div className="card p-5" style={{ background: 'rgba(16,185,129,.04)' }}>
          <div className="card-title mb-3">Revenus</div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-[var(--text-2)]">Hébergement</span><span className="font-semibold">{fmt(revenus.hebergement || 0)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-2)]">Restaurant</span><span className="font-semibold">{fmt(revenus.restaurant || 0)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-2)]">Extras</span><span className="font-semibold">{fmt(revenus.extras || 0)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-2)]">Taxes collectées</span><span className="font-semibold">{fmt(revenus.taxes || 0)}</span></div>
            <div className="border-t border-[var(--border-1)] my-2" />
            <div className="flex justify-between items-center">
              <span className="font-bold text-[var(--text-0)]">TOTAL REVENUS</span>
              <span className="font-black text-lg text-emerald-400">{fmt(revenus.total || 0)}</span>
            </div>
          </div>
        </div>

        <div className="card p-5" style={{ background: 'rgba(239,68,68,.04)' }}>
          <div className="card-title mb-3">Charges</div>
          <div className="space-y-2 text-xs">
            {(charges.categories || []).length ? charges.categories.map((c, i) => (
              <div key={i} className="flex justify-between"><span className="text-[var(--text-2)]">{c.categorie_nom}</span><span className="font-semibold">{fmt(c.total_charges || 0)}</span></div>
            )) : <div className="text-[var(--text-3)]">Aucune charge sur la période</div>}
            <div className="border-t border-[var(--border-1)] my-2" />
            <div className="flex justify-between items-center">
              <span className="font-bold text-[var(--text-0)]">TOTAL CHARGES</span>
              <span className="font-black text-lg text-red-400">{fmt(charges.total || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={`card p-4 text-center ${positif ? 'bg-emerald-500/10' : 'bg-red-500/10'}`} style={{ borderColor: positif ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)' }}>
        <span className={`text-sm font-semibold ${positif ? 'text-emerald-400' : 'text-red-400'}`}>
          Résultat opérationnel : {fmt(resultat.brut || 0)} • Marge : {fmtPct(resultat.marge_pct ?? resultat.marge)}
        </span>
      </div>

      <div className="card p-4">
        <div className="card-title mb-3">Revenus ventilés sur la période</div>
        <div style={{ height: 220 }}>
          {revVentChart ? <Line data={revVentChart} options={chartOpts({ legend: true })} /> : <EmptyState icone="💰" />}
        </div>
      </div>
    </div>
  )
}

// ── Onglet 3 — Hébergement ───────────────────────────────────────────────
function OngletHebergement({ data, loading }) {
  if (loading && !data) return <SkeletonOnglet />
  const kpiHosp = data?.kpiHosp || {}
  const quot90  = data?.quot90?.data || data?.quot90?.donnees || []

  const adr    = Number(kpiHosp.adr || 0)
  const revpar = Number(kpiHosp.revpar || 0)
  const goppar = Number(kpiHosp.goppar || 0)
  const occ    = Number(kpiHosp.taux_occupation || 0)

  const cartes = [
    { label: 'ADR', valeur: fmt(adr), badge: (
      <span className={`badge ${adr > 20000 ? 'badge-green' : 'badge-blue'} mt-1.5`}>{adr > 20000 ? 'Bon' : 'Standard'}</span>
    )},
    { label: 'RevPAR', valeur: fmt(revpar), badge: (
      <span className={`badge ${revpar > adr * 0.6 ? 'badge-green' : 'badge-amber'} mt-1.5`}>{revpar > adr * 0.6 ? 'Objectif atteint' : 'En dessous objectif'}</span>
    )},
    { label: 'GOPPAR', valeur: fmt(goppar), badge: (
      <span className={`badge ${goppar > 0 ? 'badge-green' : 'badge-red'} mt-1.5`}>{goppar > 0 ? 'Positif' : 'Négatif'}</span>
    )},
    { label: 'Taux occupation', valeur: fmtPct(occ) },
  ]

  const occChart = quot90.length ? {
    labels: quot90.map(d => dateLocale(d.date)),
    datasets: [{ data: quot90.map(occSel), backgroundColor: BLEU.bg, borderRadius: 3 }]
  } : null

  const half  = Math.floor(quot90.length / 2)
  const perN1 = quot90.slice(0, half)
  const perN  = quot90.slice(half)
  const adrSel = d => { const o = Number(d.chambres_occupees || 0); return o > 0 ? Number(d.revenu_hebergement || 0) / o : 0 }

  const lignesComparatif = quot90.length >= 4 ? [
    { label: 'Occupation moyenne', n1: moyenne(perN1, occSel), n: moyenne(perN, occSel), formatteur: fmtPct },
    { label: 'Revenu héberg. moyen/jour', n1: moyenne(perN1, d => Number(d.revenu_hebergement || 0)), n: moyenne(perN, d => Number(d.revenu_hebergement || 0)), formatteur: fmt },
    { label: 'ADR estimé', n1: moyenne(perN1, adrSel), n: moyenne(perN, adrSel), formatteur: fmt },
  ] : []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {cartes.map(c => <KpiCard key={c.label} {...c} />)}
      </div>

      <div className="card p-4">
        <div className="card-title mb-3">Occupation — {quot90.length || 90} jours</div>
        <div style={{ height: 200 }}>
          {occChart ? <Bar data={occChart} options={chartOpts()} /> : <EmptyState icone="🏨" />}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><div className="card-title">Comparatif — première moitié vs seconde moitié de la période</div></div>
        {lignesComparatif.length ? (
          <table className="table-base">
            <thead><tr><th>Métrique</th><th>Période N-1</th><th>Période N</th><th>Évolution</th></tr></thead>
            <tbody>
              {lignesComparatif.map(l => {
                const delta = deltaPct(l.n1, l.n)
                const hausse = delta >= 0
                return (
                  <tr key={l.label}>
                    <td className="font-semibold">{l.label}</td>
                    <td className="text-[var(--text-2)]">{l.formatteur(l.n1)}</td>
                    <td className="text-[var(--text-2)]">{l.formatteur(l.n)}</td>
                    <td className={hausse ? 'text-emerald-400' : 'text-red-400'}>
                      {hausse ? '↑' : '↓'} {Math.abs(delta).toFixed(1)} %
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <EmptyState icone="🏨" texte="Historique insuffisant pour un comparatif" />}
      </div>
    </div>
  )
}

// ── Onglet 4 — F&B ───────────────────────────────────────────────────────
function OngletFB({ data, loading }) {
  if (loading && !data) return <SkeletonOnglet />
  const fb = data?.fb || {}

  const topArticles = fb.top_articles || []
  const caSemaines  = fb.ca_semaines || []
  // Pas de total fourni par l'API — dérivé de la somme des CA hebdomadaires.
  const caTotal = caSemaines.reduce((s, d) => s + Number(d.ca_semaine || 0), 0)
  const margeBruteTotale = topArticles.reduce((s, a) => s + Number(a.marge || 0), 0)
  const { sorties = 0, pertes = 0, taux_perte: tauxPerte = 0 } = fb.stock_pertes || {}

  const caChart = caSemaines.length ? {
    labels: caSemaines.map(d => semLocale(d.semaine)),
    datasets: [{ data: caSemaines.map(d => Number(d.ca_semaine || 0)), backgroundColor: ORANGE.bg, borderRadius: 4 }]
  } : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="CA restaurant total" valeur={fmt(caTotal)} icone="🍽" />
        <KpiCard label="Marge brute totale" valeur={fmt(margeBruteTotale)} icone="💵" couleurValeur={margeBruteTotale >= 0 ? 'text-emerald-400' : 'text-red-400'} />
        <KpiCard label="Taux de perte stock" valeur={fmtPct(tauxPerte)} icone="⚠" couleurValeur={tauxPerte > 10 ? 'text-red-400' : 'text-emerald-400'} />
      </div>

      <div className="card p-4">
        <div className="card-title mb-3">CA restaurant / semaine</div>
        <div style={{ height: 180 }}>
          {caChart ? <Bar data={caChart} options={chartOpts()} /> : <EmptyState icone="🍽" />}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><div className="card-title">Top 10 articles</div></div>
        {topArticles.length ? (
          <table className="table-base">
            <thead><tr><th>Article</th><th>Qté vendue</th><th>CA</th><th>Coût revient total</th><th>Marge</th><th>Marge %</th></tr></thead>
            <tbody>
              {topArticles.slice(0, 10).map((a, i) => {
                const ca = Number(a.ca_article || 0)
                const margePct = ca ? (Number(a.marge || 0) / ca) * 100 : 0
                const badge = margePct > 40 ? 'badge-green' : margePct >= 20 ? 'badge-amber' : 'badge-red'
                return (
                  <tr key={i}>
                    <td className="font-semibold">{a.nom}</td>
                    <td className="text-[var(--text-2)]">{fmtNum(a.qte_vendue)}</td>
                    <td>{fmt(ca)}</td>
                    <td className="text-[var(--text-2)]">{fmt(a.cout_revient || 0)}</td>
                    <td>{fmt(a.marge || 0)}</td>
                    <td><span className={`badge ${badge}`}>{fmtPct(margePct)}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <EmptyState icone="🍽" />}
      </div>

      <div className="card p-4">
        <div className="card-title mb-3">Pertes de stock</div>
        <div className="text-xs text-[var(--text-2)] mb-2">
          Sorties : {fmtNum(sorties)} unités — Pertes : {fmtNum(pertes)} unités — Taux : {fmtPct(tauxPerte)}
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-3)] overflow-hidden">
          <div className={`h-full rounded-full ${tauxPerte > 10 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, tauxPerte)}%` }} />
        </div>
      </div>
    </div>
  )
}

// ── Onglet 5 — Stock ─────────────────────────────────────────────────────
function OngletStock({ data, loading }) {
  if (loading && !data) return <SkeletonOnglet />
  const stock = data?.stock || {}

  const valeurStock = Number(stock.valeur_stock || 0)
  const articlesAlerte = Number(stock.articles_en_alerte || 0)

  const consommation = stock.consommation_30j || []
  const consoChart = consommation.length ? {
    labels: consommation.map(d => dateLocale(d.jour)),
    datasets: [{ data: consommation.map(d => Number(d.sorties || 0)), borderColor: ORANGE.line, backgroundColor: ORANGE.bgLight, tension: .4, fill: true, pointRadius: 2 }]
  } : null

  const topConso = (stock.top_consommateurs || []).slice(0, 5)
  const maxConso = Math.max(1, ...topConso.map(c => Number(c.valeur_consommee || 0)))

  const rotationLente = stock.rotation_lente || []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Valeur stock actuelle" valeur={fmt(valeurStock)} icone="📦" />
        <KpiCard label="Articles en alerte" valeur={fmtNum(articlesAlerte)} icone="⚠" couleurValeur={articlesAlerte > 0 ? 'text-red-400' : 'text-emerald-400'} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 col-span-2">
          <div className="card-title mb-3">Consommation — 30 jours</div>
          <div style={{ height: 180 }}>
            {consoChart ? <Line data={consoChart} options={chartOpts()} /> : <EmptyState icone="📦" />}
          </div>
        </div>
        <div className="card p-4">
          <div className="card-title mb-3">Top 5 consommateurs</div>
          {topConso.length ? (
            <div className="space-y-3">
              {topConso.map((c, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="font-semibold truncate">{c.nom}</span>
                    <span className="text-[var(--text-2)]">{fmt(c.valeur_consommee || 0)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--bg-3)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(Number(c.valeur_consommee || 0) / maxConso) * 100}%`, background: VIOLET.line }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icone="📦" />}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><div className="card-title">Rotation lente</div></div>
        {rotationLente.length ? (
          <table className="table-base">
            <thead><tr><th>Article</th><th>Stock actuel</th><th>Valeur immobilisée</th><th></th></tr></thead>
            <tbody>
              {rotationLente.map((a, i) => (
                <tr key={i}>
                  <td className="font-semibold">{a.nom}</td>
                  <td className="text-[var(--text-2)]">{fmtNum(a.stock_actuel)}</td>
                  <td>{fmt(a.valeur_immobilisee || 0)}</td>
                  <td><span className="badge badge-amber">Rotation lente</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState icone="📦" />}
      </div>
    </div>
  )
}

// ── Onglet 6 — Achats ────────────────────────────────────────────────────
function OngletAchats({ data, loading }) {
  if (loading && !data) return <SkeletonOnglet />
  const achats = data?.achats || {}

  const fournisseurs = achats.fournisseurs || []
  // Pas de total fourni par l'API — dérivé de la somme des montants commandés par fournisseur.
  const totalAchats = fournisseurs.reduce((s, f) => s + Number(f.montant_commande || 0), 0)
  const tauxService = Number(achats.taux_service ?? 0)
  const fournisseursActifs = fournisseurs.length

  const parMois = achats.achats_par_mois || []
  const moisChart = parMois.length ? {
    labels: parMois.map(d => new Date(d.mois).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })),
    datasets: [{ data: parMois.map(d => Number(d.montant || 0)), backgroundColor: VIOLET.bg, borderRadius: 4 }]
  } : null

  const parFournisseur = [...fournisseurs].sort((a, b) => Number(b.montant_recu || 0) - Number(a.montant_recu || 0))
  const top5 = parFournisseur.slice(0, 5)
  const autres = parFournisseur.slice(5).reduce((s, f) => s + Number(f.montant_recu || 0), 0)
  const doughnutLabels = [...top5.map(f => f.nom), ...(autres > 0 ? ['Autres'] : [])]
  const doughnutData   = [...top5.map(f => Number(f.montant_recu || 0)), ...(autres > 0 ? [autres] : [])]
  const doughnutColors = [BLEU.bg, VERT.bg, ORANGE.bg, ROUGE.bg, VIOLET.bg, GRIS.bg]
  const doughnutChart = doughnutLabels.length ? {
    labels: doughnutLabels,
    datasets: [{ data: doughnutData, backgroundColor: doughnutColors.slice(0, doughnutLabels.length), borderWidth: 0 }]
  } : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total achats" valeur={fmt(totalAchats)} icone="🚚" />
        <KpiCard label="Taux de service fournisseurs" valeur={fmtPct(tauxService)} icone="✅" />
        <KpiCard label="Nb fournisseurs actifs" valeur={fmtNum(fournisseursActifs)} icone="🏭" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="card-title mb-3">Achats par mois</div>
          <div style={{ height: 220 }}>
            {moisChart ? <Bar data={moisChart} options={chartOpts()} /> : <EmptyState icone="🚚" />}
          </div>
        </div>
        <div className="card p-4">
          <div className="card-title mb-3">Répartition par fournisseur</div>
          <div style={{ height: 220 }}>
            {doughnutChart ? <Doughnut data={doughnutChart} options={DOUGHNUT_OPTS} /> : <EmptyState icone="🚚" />}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><div className="card-title">Fournisseurs</div></div>
        {fournisseurs.length ? (
          <table className="table-base">
            <thead><tr><th>Fournisseur</th><th>Bons</th><th>Commandé</th><th>Reçu</th><th>Délai moy.</th><th>Taux service</th></tr></thead>
            <tbody>
              {fournisseurs.map((f, i) => {
                // Taux de service par fournisseur non fourni par l'API (seul un
                // taux global existe) — dérivé ici du ratio reçu/commandé.
                const commande = Number(f.montant_commande || 0)
                const ts = commande > 0 ? (Number(f.montant_recu || 0) / commande) * 100 : 0
                const badge = ts > 90 ? 'badge-green' : ts >= 70 ? 'badge-amber' : 'badge-red'
                return (
                  <tr key={i}>
                    <td className="font-semibold">{f.nom}</td>
                    <td className="text-[var(--text-2)]">{fmtNum(f.nb_bons)}</td>
                    <td>{fmt(f.montant_commande || 0)}</td>
                    <td>{fmt(f.montant_recu || 0)}</td>
                    <td className="text-[var(--text-2)]">{f.delai_moyen_jours != null ? `${f.delai_moyen_jours} j` : '—'}</td>
                    <td><span className={`badge ${badge}`}>{fmtPct(ts)}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <EmptyState icone="🚚" />}
      </div>
    </div>
  )
}

// ── Page principale ──────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [periode, setPeriode]         = useState({ debut: todayISO(-30), fin: todayISO(0) })
  const [ongletActif, setOngletActif] = useState('dashboard')
  const [dataTab, setDataTab]         = useState({})
  const [loadingTab, setLoadingTab]   = useState({})
  const [chargeKeyTab, setChargeKeyTab] = useState({})

  const periodeKey = `${periode.debut}|${periode.fin}`

  useEffect(() => {
    if (chargeKeyTab[ongletActif] === periodeKey) return
    chargerOnglet(ongletActif)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ongletActif, periode.debut, periode.fin])

  async function chargerOnglet(tab) {
    setLoadingTab(s => ({ ...s, [tab]: true }))
    try {
      const res = await FETCHERS[tab](periode)
      setDataTab(s => ({ ...s, [tab]: res }))
      setChargeKeyTab(s => ({ ...s, [tab]: periodeKey }))
    } catch {
      toast.error('Erreur chargement des données')
    } finally {
      setLoadingTab(s => ({ ...s, [tab]: false }))
    }
  }

  function appliquerPeriodeRapide(jours) {
    setPeriode({ debut: todayISO(-jours), fin: todayISO(0) })
  }

  return (
    <AppLayout titre="Analytique" sousTitre="Centre de pilotage — vue consolidée des modules">
      {/* Sélecteur de période */}
      <div className="card px-4 py-3 mb-5 flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-[var(--text-2)]">Période :</span>
        <div className="flex gap-1">
          {PERIODES_RAPIDES.map(p => (
            <button key={p.jours} onClick={() => appliquerPeriodeRapide(p.jours)} className="btn btn-ghost btn-xs">{p.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input type="date" className="input w-auto text-xs" value={periode.debut}
            onChange={e => setPeriode(p => ({ ...p, debut: e.target.value }))} />
          <span className="text-[var(--text-4)] text-xs">→</span>
          <input type="date" className="input w-auto text-xs" value={periode.fin}
            onChange={e => setPeriode(p => ({ ...p, fin: e.target.value }))} />
        </div>
      </div>

      {/* Barre d'onglets */}
      <div className="flex items-center gap-1 border-b border-[var(--border-1)] mb-5 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setOngletActif(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              ongletActif === t.id ? 'border-blue-500 text-[var(--text-0)]' : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}>
            {t.icone} {t.label}
          </button>
        ))}
      </div>

      {/* Contenu onglet actif */}
      {ongletActif === 'dashboard'   && <OngletDashboard   data={dataTab.dashboard}   loading={loadingTab.dashboard} />}
      {ongletActif === 'pnl'         && <OngletPnl         data={dataTab.pnl}         loading={loadingTab.pnl} />}
      {ongletActif === 'hebergement' && <OngletHebergement data={dataTab.hebergement} loading={loadingTab.hebergement} />}
      {ongletActif === 'fb'          && <OngletFB          data={dataTab.fb}          loading={loadingTab.fb} />}
      {ongletActif === 'stock'       && <OngletStock       data={dataTab.stock}       loading={loadingTab.stock} />}
      {ongletActif === 'achats'      && <OngletAchats      data={dataTab.achats}      loading={loadingTab.achats} />}
    </AppLayout>
  )
}
