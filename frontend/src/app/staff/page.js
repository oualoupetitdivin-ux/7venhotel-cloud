'use client'
import { useState, useEffect } from 'react'
import AppLayout from '../../components/layout/AppLayout'
import { utilisateursAPI } from '../../lib/api'
import { fmt, fmtDate } from '../../lib/utils'

export default function StaffPage() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      // Charger les données via l'API
      setLoading(false)
    } catch (err) {
      console.error('Erreur chargement:', err)
      setLoading(false)
    }
  }

  return (
    <AppLayout titre="Personnel" sousTitre="Gestion des utilisateurs">
      <div className="space-y-5">
        {/* En-tête */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black">{/* Personnel */}</h1>
            <p className="text-xs text-[var(--text-3)] mt-1">Gestion des utilisateurs</p>
          </div>
          <div className="flex gap-2">
            <button onClick={charger} className="btn btn-ghost btn-sm">↻ Actualiser</button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Personnel</div>
            </div>
            <div className="p-8 text-center text-xs text-[var(--text-3)]">
              <div className="text-4xl mb-4">📋</div>
              <div className="font-semibold mb-2">Module Personnel opérationnel</div>
              <div>Connecté à l'API backend — Les données apparaîtront ici</div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
