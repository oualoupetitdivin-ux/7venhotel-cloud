'use client'
import { useState, useEffect } from 'react'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import AppLayout from '../../components/layout/AppLayout'
import { analyticsAPI, reservationsAPI, aiAPI } from '../../lib/api'
import { fmt, fmtDate, STATUT_RESERVATION_COULEUR } from '../../lib/utils'
import toast from 'react-hot-toast'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler)

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#4A6080', font: { size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#4A6080', font: { size: 10 } } }
  }
}

export default function DashboardPage() {
  const [kpis, setKpis]         = useState(null)
  const [arrivees, setArrivees] = useState([])
  const [departs, setDeparts]   = useState([])
  const [alertes, setAlertes]   = useState([])
  const [previsions, setPrevisions] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    charger()
    const interval = setInterval(charger, 60000) // Rafraîchir chaque minute
    return () => clearInterval(interval)
  }, [])

  async function charger() {
    try {
      const [kpiRes, arrRes, depRes, aiRes, prevRes] = await Promise.allSettled([
        analyticsAPI.dashboard(),
        reservationsAPI.lister({ statut: 'confirmee', date_debut: new Date().toISOString().split('T')[0], date_fin: new Date().toISOString().split('T')[0] }),
        reservationsAPI.lister({ statut: 'arrivee',   date_fin: new Date().toISOString().split('T')[0] }),
        aiAPI.alertes(),
        aiAPI.previsions()
      ])
      if (kpiRes.status === 'fulfilled') setKpis(kpiRes.value.data)
      if (arrRes.status === 'fulfilled') setArrivees(arrRes.value.data.data?.slice(0, 8) || [])
      if (depRes.status === 'fulfilled') setDeparts(depRes.value.data.data?.slice(0, 8) || [])
      if (aiRes.status === 'fulfilled') setAlertes(aiRes.value.data.alertes?.slice(0, 5) || [])
      if (prevRes.status === 'fulfilled') setPrevisions(prevRes.value.data.previsions || [])
    } catch (err) {
      console.error('Erreur dashboard:', err)
    } finally { setLoading(false) }
  }

  const occData = {
    labels: ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'],
    datasets: [{
      label: 'Occupation %',
      data: [78, 82, 85, 91, 94, 97, 87],
      backgroundColor: 'rgba(59,130,246,.7)',
      borderRadius: 5,
    }]
  }

  const revData = {
    labels: ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'],
    datasets: [{
      label: 'Revenus (kXAF)',
      data: [32,28,38,45,50,54,68,72,60,48,38,42],
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59,130,246,.07)',
      tension: .4, fill: true, pointRadius: 3
    }]
  }

  const srcData = {
    labels: ['Direct','Booking.com','Agences','Autres'],
    datasets: [{ data: [38,27,22,13], backgroundColor: ['#3B82F6','#10B981','#F59E0B','#8B5CF6'], borderWidth: 0, hoverOffset: 4 }]
  }

  const KPI_CARDS = kpis ? [
    { label: 'Occupation', valeur: `${kpis.taux_occupation || 0}%`,  sous: '↑ +4.2% vs sem.',  couleur: 'border-blue-500', icone: '🏨' },
    { label: 'Recettes du jour', valeur: fmt(kpis.revenu_jour || 0), sous: '↑ +12% vs hier',  couleur: 'border-emerald-500', icone: '💳' },
    { label: 'Arrivées', valeur: kpis.arrivees_aujourd_hui || 0,       sous: 'Attendues ce jour',  couleur: 'border-purple-500', icone: '🛬' },
    { label: 'Départs',  valeur: kpis.departs_aujourd_hui || 0,        sous: 'À traiter ce jour',  couleur: 'border-amber-500', icone: '🛫' },
    { label: 'Ménage',   valeur: kpis.taches_menage_ouvertes || 0,    sous: 'Tâches en attente', couleur: 'border-amber-400', icone: '🧹' },
    { label: 'Urgences', valeur: kpis.tickets_urgents || 0,             sous: 'Tickets critiques',  couleur: 'border-red-500', icone: '⚠' },
  ] : []

  if (loading) return (
    <AppLayout titre="Tableau de bord">
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
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
        <span className="text-[var(--text-2)]">Hôtel Royal Yaoundé</span>
        <div className="flex-1" />
        <button onClick={charger} className="btn btn-ghost btn-xs">↻ Actualiser</button>
        <a href="/reservations/nouvelle" className="btn btn-primary btn-sm">＋ Réservation</a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-6 gap-3 mb-5">
        {KPI_CARDS.map(k => (
          <div key={k.label} className={`kpi-card border-b-2 ${k.couleur}`}>
            <div className="absolute right-3 top-3 text-xl opacity-10">{k.icone}</div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.valeur}</div>
            <div className="text-[10px] text-[var(--text-3)] mt-1">{k.sous}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="card col-span-2">
          <div className="card-header">
            <div className="card-title">Occupation hebdomadaire</div>
            <div className="flex gap-1">
              {['Sem.','Mois'].map(p => (
                <button key={p} className="btn btn-ghost btn-xs">{p}</button>
              ))}
            </div>
          </div>
          <div className="p-4 h-44">
            <Bar data={occData} options={CHART_OPTS} />
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">Sources réservations</div></div>
          <div className="p-4 h-44 flex flex-col items-center justify-center gap-3">
            <div style={{ height: 110 }}><Doughnut data={srcData} options={{ ...CHART_OPTS, scales: undefined, plugins: { legend: { display: false } }, cutout: '70%' }} /></div>
            <div className="w-full space-y-1 text-[10.5px]">
              {['Direct 38%','Booking.com 27%','Agences 22%','Autres 13%'].map((l,i) => (
                <div key={l} className="flex justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: ['#3B82F6','#10B981','#F59E0B','#8B5CF6'][i] }} />
                    {l.split(' ')[0]}
                  </span>
                  <span className="font-bold">{l.split(' ')[1]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue chart */}
      <div className="card mb-5">
        <div className="card-header">
          <div className="card-title">Recettes mensuelles 2026</div>
          <span className="text-[10px] text-[var(--text-3)]">en milliers XAF</span>
        </div>
        <div className="p-4 h-40">
          <Line data={revData} options={CHART_OPTS} />
        </div>
      </div>

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
                  <tr key={r.id} onClick={() => window.location.href=`/reservations/${r.id}`}>
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
                  <tr key={r.id} onClick={() => window.location.href=`/reservations/${r.id}`}>
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
                </div>
                <button onClick={() => aiAPI.marquerLue(a.id).then(charger)} className="text-[var(--text-4)] hover:text-emerald-400 transition-colors flex-shrink-0">✓</button>
              </div>
            )) : (
              <div className="text-center py-6 text-[var(--text-3)] text-xs">✓ Aucune alerte</div>
            )}
          </div>
          <div className="p-2 border-t border-[var(--border-0)]">
            <a href="/ai" className="btn btn-ghost btn-xs w-full justify-center">Voir Ouwalou AI →</a>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
