'use client'
import { useState, useEffect } from 'react'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import AppLayout from '@/components/layout/AppLayout'
import { analyticsAPI } from '@/lib/api'
import { fmt } from '@/lib/utils'
import toast from 'react-hot-toast'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler)

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#4A6080', font: { size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { color: '#4A6080', font: { size: 10 } } }
  }
}

export default function AnalyticsPage() {
  const [dash, setDash]         = useState(null)
  const [mensuel, setMensuel]   = useState(null)
  const [quotidien, setQuotidien] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)
      const [d, m, q] = await Promise.allSettled([
        analyticsAPI.dashboard(),
        analyticsAPI.mensuelles(),
        analyticsAPI.quotidiennes({ jours: 30 })
      ])
      if (d.status === 'fulfilled') setDash(d.value.data)
      if (m.status === 'fulfilled') setMensuel(m.value.data)
      if (q.status === 'fulfilled') setQuotidien(q.value.data)
    } catch { toast.error('Erreur chargement analytics') }
    finally { setLoading(false) }
  }

  const occData = quotidien?.donnees ? {
    labels: quotidien.donnees.slice(-14).map(d => new Date(d.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})),
    datasets: [{ label: 'Occupation %', data: quotidien.donnees.slice(-14).map(d => d.taux_occupation), borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.1)', tension: .4, fill: true, pointRadius: 2 }]
  } : null

  const revData = mensuel?.donnees ? {
    labels: mensuel.donnees.map(d => d.mois),
    datasets: [{ data: mensuel.donnees.map(d => Math.round(d.revenu_total/1000)), backgroundColor: 'rgba(59,130,246,.7)', borderRadius: 5 }]
  } : null

  const srcData = {
    labels: ['Direct','Booking.com','Agences','Autres'],
    datasets: [{ data: [38,27,22,13], backgroundColor: ['#3B82F6','#10B981','#F59E0B','#8B5CF6'], borderWidth: 0 }]
  }

  if (loading) return (
    <AppLayout titre="Analytique" sousTitre="Performance & statistiques">
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
      </div>
    </AppLayout>
  )

  return (
    <AppLayout titre="Analytique" sousTitre="Performance & statistiques">
      <div className="space-y-5">
        {/* KPIs */}
        {dash && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Taux occupation', val: `${dash.taux_occupation || 0}%`, color: 'border-blue-500' },
              { label: 'Revenu du jour', val: fmt(dash.revenu_jour || 0), color: 'border-emerald-500' },
              { label: 'RevPAR', val: fmt(dash.revpar || 0), color: 'border-purple-500' },
              { label: 'ADR', val: fmt(dash.adr || 0), color: 'border-amber-500' },
            ].map(k => (
              <div key={k.label} className={`kpi-card border-b-2 ${k.color}`}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value">{k.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Graphiques */}
        <div className="grid grid-cols-3 gap-5">
          {/* Occupation 14 jours */}
          <div className="col-span-2 card p-4">
            <div className="card-title mb-4">Occupation — 14 derniers jours</div>
            <div className="h-48">
              {occData ? <Line data={occData} options={CHART_OPTS} /> : (
                <div className="flex items-center justify-center h-full text-xs text-[var(--text-3)]">Données insuffisantes</div>
              )}
            </div>
          </div>
          {/* Sources */}
          <div className="card p-4">
            <div className="card-title mb-4">Sources réservations</div>
            <div className="h-48 flex items-center justify-center">
              <Doughnut data={srcData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:'#4A6080', font:{size:10} } } } }} />
            </div>
          </div>
        </div>

        {/* Revenus mensuels */}
        {revData && (
          <div className="card p-4">
            <div className="card-title mb-4">Revenus mensuels (kXAF)</div>
            <div className="h-48">
              <Bar data={revData} options={CHART_OPTS} />
            </div>
          </div>
        )}

        {/* Tableau derniers jours */}
        {quotidien?.donnees && (
          <div className="card overflow-hidden">
            <div className="card-header"><div className="card-title">Détail — 7 derniers jours</div></div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border-1)]">
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Date</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Occupation</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Chambres occ.</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Revenu héberg.</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Revenu total</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Arrivées</th>
                  <th className="text-left px-4 py-3 text-[var(--text-3)] font-medium">Départs</th>
                </tr>
              </thead>
              <tbody>
                {quotidien.donnees.slice(-7).reverse().map((d,i) => (
                  <tr key={i} className="border-b border-[var(--border-1)] hover:bg-[var(--bg-2)]">
                    <td className="px-4 py-3 font-semibold">{new Date(d.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-[var(--bg-3)] rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{width:`${d.taux_occupation}%`}} />
                        </div>
                        <span>{d.taux_occupation}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{d.chambres_occupees}</td>
                    <td className="px-4 py-3 text-[var(--text-2)]">{fmt(d.revenu_hebergement)}</td>
                    <td className="px-4 py-3 font-semibold">{fmt(d.revenu_total)}</td>
                    <td className="px-4 py-3 text-emerald-400">{d.arrivees}</td>
                    <td className="px-4 py-3 text-amber-400">{d.departs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
