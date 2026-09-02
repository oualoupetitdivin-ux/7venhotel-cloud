'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/utils'
import { notificationsAPI } from '@/lib/api'

export default function Topbar({ titre, sousTitre, onToggleSidebar, onChangeBg, onResetBg, uploadingBg }) {
  const { user, hotel } = useAuthStore()
  const pathname = usePathname()
  const router   = useRouter()
  const [q,           setQ]           = useState('')
  const [menuOuvert,  setMenuOuvert]  = useState(false)
  const [bellOuvert,  setBellOuvert]  = useState(false)
  const [alertes,     setAlertes]     = useState(null)
  const [bellPulse,   setBellPulse]   = useState(false)

  const isPlatformMode = user?.role === 'super_admin'
  const isHotelPage    = !pathname?.startsWith('/platform')

  const chargerAlertes = useCallback(async () => {
    if (!isHotelPage || isPlatformMode) return
    try {
      const { data } = await notificationsAPI.alertes()
      setAlertes(prev => {
        // Active la pulse si nouvelle alerte apparaît
        if (prev !== null && data.total > (prev.total || 0)) setBellPulse(true)
        return data
      })
    } catch {}
  }, [isHotelPage, isPlatformMode])

  useEffect(() => {
    chargerAlertes()
    const t = setInterval(chargerAlertes, 60000)
    return () => clearInterval(t)
  }, [chargerAlertes])

  // Arrêter la pulse après 3s
  useEffect(() => {
    if (!bellPulse) return
    const t = setTimeout(() => setBellPulse(false), 3000)
    return () => clearTimeout(t)
  }, [bellPulse])

  const total = alertes?.total || 0

  function allerReservation(id) {
    router.push(`/reservations/${id}`)
    setBellOuvert(false)
  }

  return (
    <header className="topbar flex-shrink-0">
      {/* Hamburger */}
      <button
        onClick={onToggleSidebar}
        className="w-8 h-8 rounded-lg border border-[var(--border-1)] bg-[var(--bg-3)] flex items-center justify-center hover:bg-[var(--bg-4)] transition-colors flex-shrink-0"
        title="Menu">
        <span className="flex flex-col gap-[4px] w-4">
          <span className="h-[1.5px] w-full bg-[var(--text-2)] rounded" />
          <span className="h-[1.5px] w-3/4 bg-[var(--text-2)] rounded" />
          <span className="h-[1.5px] w-full bg-[var(--text-2)] rounded" />
        </span>
      </button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-2)] flex-shrink-0">
        <span className="text-[var(--text-4)]">7venHotel</span>
        <span className="text-[var(--text-4)]">/</span>
        <span className="font-bold text-[var(--text-0)]">{titre || 'Tableau de bord'}</span>
        {sousTitre && (
          <>
            <span className="text-[var(--text-4)]">·</span>
            <span className="text-xs text-[var(--text-3)]">{sousTitre}</span>
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
          className="bg-transparent border-none outline-none text-xs text-[var(--text-0)] placeholder:text-[var(--text-4)] flex-1 min-w-0"
        />
      </div>

      {/* Bouton Réservation */}
      {isHotelPage && !isPlatformMode && (
        <Link href="/reservations/nouvelle" className="btn btn-primary btn-sm">
          ＋ Réservation
        </Link>
      )}

      {/* Devise */}
      {hotel && isHotelPage && !isPlatformMode && (
        <span className="text-xs font-bold text-[var(--text-3)] bg-[var(--bg-4)] px-2 py-1 rounded border border-[var(--border-1)]">
          {hotel.devise || 'XAF'}
        </span>
      )}

      {/* ── Cloche notifications ────────────────────────────────────────── */}
      {isHotelPage && !isPlatformMode && (
        <div className="relative">
          <button
            onClick={() => { setBellOuvert(o => !o); setBellPulse(false) }}
            className={`relative w-8 h-8 rounded-lg border flex items-center justify-center transition-colors
              ${total > 0
                ? 'border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20'
                : 'border-[var(--border-1)] bg-[var(--bg-3)] hover:bg-[var(--bg-4)]'
              }`}
            title="Alertes opérationnelles"
          >
            <span className={`text-sm ${bellPulse ? 'animate-bounce' : ''}`}>
              {total > 0 ? '🔔' : '🔕'}
            </span>
            {total > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 rounded-full text-[8px] font-black text-white flex items-center justify-center px-0.5 animate-pulse shadow-lg shadow-red-500/40">
                {total > 9 ? '9+' : total}
              </span>
            )}
          </button>

          {bellOuvert && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBellOuvert(false)} />
              <div className="absolute right-0 top-10 z-50 bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl shadow-2xl w-72 overflow-hidden text-xs">
                <div className="px-4 py-3 border-b border-[var(--border-1)] flex items-center justify-between">
                  <span className="font-bold text-[var(--text-0)]">Alertes opérationnelles</span>
                  <span className="text-[9px] text-[var(--text-3)] uppercase tracking-wide">aujourd'hui</span>
                </div>

                {/* Arrivées du jour */}
                {alertes?.arrivees_jour?.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between">
                      <span className="text-blue-400 font-bold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        Arrivées à faire
                      </span>
                      <span className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full font-bold">
                        {alertes.arrivees_jour.length}
                      </span>
                    </div>
                    {alertes.arrivees_jour.map(r => (
                      <button key={r.id}
                        onClick={() => allerReservation(r.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-3)] flex items-center justify-between border-b border-[var(--border-1)] last:border-b-0 transition-colors">
                        <span className="text-[var(--text-1)] font-medium">{r.nom_client}</span>
                        <span className="text-[var(--text-3)] font-mono text-[10px]">
                          {r.numero_chambre ? `Ch. ${r.numero_chambre}` : r.numero_reservation}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Départs du jour */}
                {alertes?.departs_jour?.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                      <span className="text-amber-400 font-bold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Départs du jour
                      </span>
                      <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                        {alertes.departs_jour.length}
                      </span>
                    </div>
                    {alertes.departs_jour.map(r => (
                      <button key={r.id}
                        onClick={() => allerReservation(r.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-3)] flex items-center justify-between border-b border-[var(--border-1)] last:border-b-0 transition-colors">
                        <span className="text-[var(--text-1)] font-medium">{r.nom_client}</span>
                        <span className="text-amber-400 font-mono text-[10px]">
                          {r.numero_chambre ? `Ch. ${r.numero_chambre}` : r.numero_reservation}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Check-in en ligne en attente */}
                {alertes?.checkin_en_ligne?.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between">
                      <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Check-in en ligne
                      </span>
                      <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">
                        {alertes.checkin_en_ligne.length}
                      </span>
                    </div>
                    {alertes.checkin_en_ligne.map(r => (
                      <button key={r.id}
                        onClick={() => allerReservation(r.id)}
                        className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-3)] flex items-center justify-between border-b border-[var(--border-1)] last:border-b-0 transition-colors">
                        <span className="text-[var(--text-1)] font-medium">{r.nom_client}</span>
                        <span className="text-emerald-400 text-[10px]">Attente chambre →</span>
                      </button>
                    ))}
                  </div>
                )}

                {total === 0 && (
                  <div className="px-4 py-8 text-center text-[var(--text-3)]">
                    <div className="text-3xl mb-2">✓</div>
                    <div className="font-medium">Aucune alerte aujourd'hui</div>
                    <div className="text-[10px] mt-1 text-[var(--text-4)]">Arrivées, départs et check-in en ligne</div>
                  </div>
                )}

                <div className="px-4 py-2 border-t border-[var(--border-1)] flex justify-end">
                  <button onClick={chargerAlertes} className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors">
                    ↻ Actualiser
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Menu secondaire : thème */}
      <div className="relative">
        <button
          onClick={() => setMenuOuvert(o => !o)}
          className="w-8 h-8 rounded-lg border border-[var(--border-1)] bg-[var(--bg-3)] flex items-center justify-center text-sm hover:bg-[var(--bg-4)] transition-colors"
          title="Paramètres rapides"
        >
          ⋯
        </button>
        {menuOuvert && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOuvert(false)} />
            <div className="absolute right-0 top-10 z-50 bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl shadow-xl w-44 py-1 text-xs">
              <button
                onClick={() => {
                const isLight = document.documentElement.classList.toggle('light')
                try { localStorage.setItem('7vh_theme', isLight ? 'light' : 'dark') } catch {}
                setMenuOuvert(false)
              }}
                className="w-full text-left px-3 py-2 hover:bg-[var(--bg-3)] transition-colors flex items-center gap-2 text-[var(--text-1)]"
              >
                ☀️ <span>Changer le thème</span>
              </button>
              {onChangeBg && (
                <button
                  onClick={() => { onChangeBg(); setMenuOuvert(false) }}
                  disabled={uploadingBg}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-3)] transition-colors flex items-center gap-2 text-[var(--text-1)]"
                >
                  🖼 <span>{uploadingBg ? 'Upload...' : 'Mon fond d\'écran'}</span>
                </button>
              )}
              {onResetBg && (
                <button
                  onClick={() => { onResetBg(); setMenuOuvert(false) }}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--bg-3)] transition-colors flex items-center gap-2 text-red-400"
                >
                  🗑 <span>Supprimer mon fond</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  )
}
