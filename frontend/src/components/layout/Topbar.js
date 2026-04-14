'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '../../lib/utils'

export default function Topbar({ titre, sousTitre }) {
  const { user, hotel } = useAuthStore()
  const [q, setQ] = useState('')

  return (
    <header className="topbar flex-shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-2)] flex-shrink-0">
        <span>7venHotel</span>
        <span className="text-[var(--text-4)]">/</span>
        <span className="font-bold text-[var(--text-0)]">{titre || 'Tableau de bord'}</span>
        {sousTitre && (
          <>
            <span className="text-[var(--text-4)]">·</span>
            <span className="text-[10.5px] text-[var(--text-3)]">{sousTitre}</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Recherche */}
      <div className="flex items-center gap-1.5 bg-[var(--bg-3)] border border-[var(--border-1)] rounded-lg px-2.5 py-1.5 w-44 focus-within:w-56 focus-within:border-blue-500 transition-all">
        <span className="text-[var(--text-3)] text-xs">🔍</span>
        <input
          type="text" placeholder="Rechercher… ⌘K"
          value={q} onChange={e => setQ(e.target.value)}
          className="bg-transparent border-none outline-none text-[11.5px] text-[var(--text-0)] placeholder:text-[var(--text-4)] flex-1 min-w-0"
        />
      </div>

      {/* Nouvelle réservation */}
      <Link href="/reservations/nouvelle" className="btn btn-primary btn-sm">
        ＋ Réservation
      </Link>

      {/* Notifications */}
      <button className="w-8 h-8 rounded-lg border border-[var(--border-1)] bg-[var(--bg-3)] flex items-center justify-center text-sm relative hover:bg-[var(--bg-4)] transition-colors">
        🔔
        <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
      </button>

      {/* Theme toggle */}
      <button
        onClick={() => document.documentElement.classList.toggle('light')}
        className="w-8 h-8 rounded-lg border border-[var(--border-1)] bg-[var(--bg-3)] flex items-center justify-center text-xs hover:bg-[var(--bg-4)] transition-colors"
        title="Changer de thème"
      >
        ☀️
      </button>

      {/* Devise */}
      {hotel && (
        <span className="text-[10px] font-bold text-[var(--text-3)] bg-[var(--bg-4)] px-2 py-1 rounded border border-[var(--border-1)]">
          {hotel.devise || 'XAF'}
        </span>
      )}
    </header>
  )
}
