'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Bar, Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout'
import { analyticsAPI, reservationsAPI, aiAPI, facturationAPI } from '@/lib/api'
import { fmt, STATUT_RESERVATION_COULEUR, useAuthStore } from '@/lib/utils'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

function getChartOpts() {
  const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('light')
  const gridColor  = isLight ? 'rgba(30,50,100,.07)' : 'rgba(255,255,255,.05)'
  const tickColor  = isLight ? '#475569' : '#4A6080'
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 10 } } }
    }
  }
}
const CHART_OPTS = getChartOpts()

export default function DashboardPage() {
  const router = useRouter()
  const hotel  = useAuthStore(s => s.hotel)

  const [kpis, setKpis]           = useState(null)
  const [quotidien, setQuotidien] = useState(null)
  const [mensuel, setMensuel]     = useState(null)
  const [arrivees, setArrivees]   = useState([])
  const [departs, setDeparts]     = useState([])
  const [alertes, setAlertes]     = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    charger()
    const interval = setInterval(charger, 60000)
    return () => clearInterval(interval)
  }, [])

  async function charger() {
    try {
      const today = new Date().toISOString().split('T')[0]
      const [kpiRes, quotRes, mensRes, arrRes, depRes, opsRes, aiRes] = await Promise.allSettled([
        analyticsAPI.dashboard(),
        analyticsAPI.quotidiennes({ jours: 7 }),
        analyticsAPI.mensuelles(),
        reservationsAPI.lister({ statut: 'confirmee', date_debut: today, date_fin: today }),
        reservationsAPI.lister({ statut: 'arrivee', date_fin: today }),
        reservationsAPI.alertes(),
        aiAPI.alertes()
      ])
      if (kpiRes.status === 'fulfilled') setKpis(kpiRes.value.data)
      if (quotRes.status === 'fulfilled') setQuotidien(quotRes.value.data)
      if (mensRes.status === 'fulfilled') setMensuel(mensRes.value.data)
      if (arrRes.status === 'fulfilled') setArrivees(arrRes.value.data.data?.slice(0, 8) || [])
      if (depRes.status === 'fulfilled') setDeparts(depRes.value.data.data?.slice(0, 8) || [])

      // Alertes : opérationnelles (déterministes) en premier, IA ensuite
      const opsAlertes = opsRes.status === 'fulfilled' ? (opsRes.value.data.alertes || []) : []
      const aiAlertes  = aiRes.status  === 'fulfilled' ? (aiRes.value.data.alertes  || []) : []
      setAlertes([...opsAlertes, ...aiAlertes].slice(0, 8))
    } catch (err) {
      console.error('Erreur dashboard:', err)
    } finally { setLoading(false) }
  }

  // Graphique occupation — construit depuis les données réelles des 7 derniers jours
  const quotDonnees = quotidien?.data || []
  const occData = quotDonnees.length > 0 ? {
    labels: quotDonnees.slice(-7).map(d =>
      new Date(d.date).toLocaleDateString('fr-FR', { weekday: 'short' })
    ),
    datasets: [{
      label: 'Occupation %',
      data: quotDonnees.slice(-7).map(d => parseFloat(d.taux_occupation_pct || d.taux_occupation || 0)),
      backgroundColor: 'rgba(59,130,246,.7)',
      borderRadius: 5,
    }]
  } : null

  // Graphique revenus mensuels — construit depuis données réelles
  const mensDonnees = mensuel?.data || []
  const revData = mensDonnees.length > 0 ? {
    labels: mensDonnees.map(d => d.mois || d.date?.slice(0, 7) || ''),
    datasets: [{
      label: 'Revenus (kXAF)',
      data: mensDonnees.map(d => Math.round((d.revenu_total || 0) / 1000)),
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59,130,246,.07)',
      tension: .4, fill: true, pointRadius: 3
    }]
  } : null

  const KPI_CARDS = kpis ? [
    { label: 'Occupation',      valeur: `${kpis.taux_occupation || 0}%`, sous: `${kpis.chambres_occupees || 0} chambres occupées`,    icone: '🏨' },
    { label: 'Recettes du jour',valeur: fmt(kpis.revenu_jour || 0),       sous: kpis.revenu_source === 'folio' ? 'Depuis le ledger' : 'Estimation tarifs', icone: '💳' },
    { label: 'Arrivées',        valeur: kpis.arrivees_aujourd_hui || 0,   sous: 'Attendues ce jour',  icone: '🛬' },
    { label: 'Départs',         valeur: kpis.departs_aujourd_hui || 0,    sous: 'À traiter ce jour',  icone: '🛫' },
    { label: 'Ménage',          valeur: kpis.taches_menage_ouvertes || 0, sous: 'Tâches en attente',  icone: '🧹' },
    { label: 'Urgences',        valeur: kpis.tickets_urgents || 0,         sous: 'Tickets critiques',  icone: '⚠' },
  ] : []

  if (loading) return (
    <AppLayout titre="Tableau de bord">
      <div className="grid grid-cols-6 gap-3 mb-5">
        {[...Array(6)].map((_,i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="col-span-2 skeleton h-56 rounded-xl" />
        <div className="skeleton h-56 rounded-xl" />
      </div>
    </AppLayout>
  )

  return (
    <AppLayout titre="Tableau de bord" sousTitre="Vue temps réel">
      {/* Barre de statut */}
      <div className="card px-4 py-2.5 mb-5 flex items-center gap-4 flex-wrap text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_#10B981] animate-pulse" />
          <span className="font-semibold text-emerald-400">Système opérationnel</span>
        </div>
        <span className="text-[var(--text-4)]">·</span>
        <span className="text-[var(--text-2)]">{hotel?.nom || '—'}</span>
        <div className="flex-1" />
        <button onClick={charger} className="btn btn-ghost btn-xs">↻ Actualiser</button>
        <Link href="/reservations/nouvelle" className="btn btn-primary btn-sm">＋ Réservation</Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-6 gap-3 mb-5">
        {KPI_CARDS.map(k => (
          <div key={k.label} className="kpi-card">
            <div className="absolute right-3 top-3 text-xl opacity-10">{k.icone}</div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.valeur}</div>
            <div className="text-[10px] text-[var(--text-3)] mt-1">{k.sous}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Occupation — données réelles ou absent */}
        <div className="card col-span-2">
          <div className="card-header">
            <div className="card-title">Occupation — 7 derniers jours</div>
          </div>
          <div className="p-4 h-44">
            {occData ? (
              <Bar data={occData} options={CHART_OPTS} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-[var(--text-3)]">
                <span className="text-2xl opacity-30">📊</span>
                <span>Données indisponibles</span>
                <span className="text-[10px] opacity-60">Historique non encore généré</span>
              </div>
            )}
          </div>
        </div>

        {/* Sources — pas d'API disponible */}
        <div className="card">
          <div className="card-header"><div className="card-title">Sources réservations</div></div>
          <div className="p-4 h-44 flex flex-col items-center justify-center gap-3 text-xs text-[var(--text-3)]">
            <span className="text-3xl opacity-20">🔮</span>
            <span className="font-medium">Données non disponibles</span>
            <span className="text-[10px] opacity-60 text-center">Analyse sources disponible<br/>dans une prochaine version</span>
          </div>
        </div>
      </div>

      {/* Revenue chart — données réelles ou absent */}
      {revData ? (
        <div className="card mb-5">
          <div className="card-header">
            <div className="card-title">Recettes mensuelles</div>
            <span className="text-[10px] text-[var(--text-3)]">en milliers XAF</span>
          </div>
          <div className="p-4 h-40">
            <Line data={revData} options={CHART_OPTS} />
          </div>
        </div>
      ) : (
        <div className="card mb-5 p-4 flex items-center justify-center h-28 text-xs text-[var(--text-3)]">
          <div className="text-center">
            <span className="text-xl opacity-20">📈</span>
            <div className="mt-1">Données mensuelles insuffisantes — en cours de constitution</div>
          </div>
        </div>
      )}

      {/* Panels */}
      <div className="grid grid-cols-3 gap-4">
        {/* Arrivées */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">🛬 Arrivées du jour</div>
            <span className="badge badge-blue">{arrivees.length}</span>
          </div>
          <div className="overflow-y-auto max-h-56">
            <table className="table-base">
              <thead><tr><th>Client</th><th>Ch.</th><th>Statut</th></tr></thead>
              <tbody>
                {arrivees.length ? arrivees.map(r => (
                  <tr key={r.id} onClick={() => router.push(`/reservations/${r.id}`)}>
                    <td className="font-medium truncate max-w-[100px]">{r.nom_client || '—'}</td>
                    <td className="font-mono font-bold">{r.numero_chambre}</td>
                    <td><span className={`badge ${STATUT_RESERVATION_COULEUR[r.statut]}`}>{r.statut}</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="text-center py-6 text-[var(--text-3)] text-xs">Aucune arrivée</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Départs */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">🛫 Départs du jour</div>
            <span className="badge badge-amber">{departs.length}</span>
          </div>
          <div className="overflow-y-auto max-h-56">
            <table className="table-base">
              <thead><tr><th>Client</th><th>Ch.</th><th>Statut</th></tr></thead>
              <tbody>
                {departs.length ? departs.map(r => (
                  <tr key={r.id} onClick={() => router.push(`/reservations/${r.id}`)}>
                    <td className="font-medium truncate max-w-[100px]">{r.nom_client || '—'}</td>
                    <td className="font-mono font-bold">{r.numero_chambre}</td>
                    <td><span className={`badge ${STATUT_RESERVATION_COULEUR[r.statut]}`}>{r.statut}</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="text-center py-6 text-[var(--text-3)] text-xs">Aucun départ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alertes IA */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">⚡ Alertes Ouwalou</div>
            <span className="badge badge-red">{alertes.filter(a=>a.severite==='critique').length} critiques</span>
          </div>
          <div className="overflow-y-auto max-h-56">
            {alertes.length ? alertes.map(a => (
              <div key={a.id} className="flex items-start gap-2 px-4 py-2.5 border-b border-[var(--border-0)] last:border-0 text-xs">
                <span>{a.severite==='critique'?'🔴':a.severite==='avertissement'?'🟡':'🔵'}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{a.titre}</div>
                  <div className="text-[var(--text-3)] text-[10px] mt-0.5 truncate">{a.message}</div>
                  {a.type === 'operationnelle' && (
                    <div className="text-[9px] text-[var(--text-4)] mt-0.5">⚡ Règle SQL — se résout automatiquement</div>
                  )}
                </div>
                {a.type !== 'operationnelle' && (
                  <button onClick={() => aiAPI.marquerLue(a.id).then(charger)} className="text-[var(--text-4)] hover:text-emerald-400 transition-colors flex-shrink-0">✓</button>
                )}
              </div>
            )) : (
              <div className="text-center py-6 text-[var(--text-3)] text-xs">✓ Aucune alerte active</div>
            )}
          </div>
          <div className="p-2 border-t border-[var(--border-0)]">
            <Link href="/ai" className="btn btn-ghost btn-xs w-full justify-center">Voir Ouwalou AI →</Link>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
