'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/utils'
import { hotelsAPI, API_ORIGIN } from '@/lib/api'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import OuwaloDrawer from './OuwaloDrawer'

function useTableEnhancements(pathname) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const timers = new Map()

    function onEnter(e) {
      const tr = e.currentTarget
      const timer = setTimeout(() => {
        tr.closest('table')?.classList.add('table-focus-mode')
        tr.classList.add('row-focused')
      }, 4000)
      timers.set(tr, timer)
    }

    function onLeave(e) {
      const tr = e.currentTarget
      clearTimeout(timers.get(tr))
      timers.delete(tr)
      const tbl = tr.closest('table')
      if (tbl) {
        tbl.classList.remove('table-focus-mode')
        tbl.querySelectorAll('tr.row-focused').forEach(r => r.classList.remove('row-focused'))
      }
    }

    function onClick(e) {
      if (e.target.closest('a, button, input, select, [data-no-row-click]')) return
      const link = e.currentTarget.querySelector('a[href]')
      if (link) link.click()
    }

    function attach() {
      document.querySelectorAll('.table-base tbody tr').forEach(tr => {
        tr.removeEventListener('mouseenter', onEnter)
        tr.removeEventListener('mouseleave', onLeave)
        tr.removeEventListener('click', onClick)
        tr.addEventListener('mouseenter', onEnter)
        tr.addEventListener('mouseleave', onLeave)
        tr.addEventListener('click', onClick)
      })
    }

    attach()
    const obs = new MutationObserver(attach)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => {
      obs.disconnect()
      timers.forEach(clearTimeout)
    }
  }, [pathname])
}

// Pages accessibles par rôle — frontière UX (la vraie sécurité est backend)
const PAGES_AUTORISEES = {
  // ── Plateforme (super_admin uniquement) ──────────────────────────────────
  '/platform':            ['super_admin'],
  '/platform/dashboard':  ['super_admin'],
  '/platform/tenants':    ['super_admin'],
  '/platform/billing':    ['super_admin'],
  '/platform/audit':      ['super_admin'],
  '/platform/ai':         ['super_admin'],
  '/platform/health':     ['super_admin'],
  '/platform/compliance': ['super_admin'],
  '/platform/config':     ['super_admin'],
  '/platform/iam':        ['super_admin'],

  // ── Onboarding hôtel (manager sans hotel_id) ────────────────────────────
  '/onboarding':   ['manager'],

  // ── Exploitation hôtel ────────────────────────────────────────────────────
  '/dashboard':    ['super_admin', 'manager', 'reception'],
  '/reservations': ['super_admin', 'manager', 'reception'],
  '/timeline':     ['super_admin', 'manager', 'reception'],
  '/chambres':       ['super_admin', 'manager', 'reception', 'housekeeping', 'technicien'],
  '/types-chambre':  ['super_admin', 'manager'],
  '/menage':       ['super_admin', 'manager', 'reception', 'housekeeping'],
  '/restaurant':   ['super_admin', 'manager', 'restaurant'],
  '/cuisine':      ['super_admin', 'manager', 'restaurant'],
  '/maintenance':  ['super_admin', 'manager', 'reception', 'technicien'],
  '/clients':      ['super_admin', 'manager', 'reception'],
  '/facturation':  ['super_admin', 'manager', 'comptabilite', 'reception'],
  '/arrhes':       ['super_admin', 'manager', 'comptabilite'],
  // PHASE1-A — F&B
  '/catalogue':    ['super_admin', 'manager', 'restaurant'],
  '/stock':        ['super_admin', 'manager', 'restaurant'],
  '/fournisseurs': ['super_admin', 'manager', 'restaurant'],
  '/achats':       ['super_admin', 'manager', 'restaurant'],
  // PHASE1-B
  '/charges':      ['super_admin', 'manager', 'comptabilite'],
  '/caisse':       ['super_admin', 'manager', 'reception', 'comptabilite'],
  '/fidelite':     ['super_admin', 'manager'],
  '/evenements':   ['super_admin', 'manager', 'reception'],
  '/analytics':    ['super_admin', 'manager', 'comptabilite'],
  '/diagnostic':   ['super_admin', 'manager', 'comptabilite'],
  '/ai':           ['super_admin', 'manager'],
  '/staff':        ['super_admin', 'manager'],
  '/settings':     ['super_admin', 'manager'],
  '/tenants':      ['super_admin'],
  '/billing':      ['super_admin'],
}

// Page d'accueil par rôle pour les redirections
const ACCUEIL_PAR_ROLE = {
  super_admin:  '/platform/dashboard',   // ← PLATFORM-FIRST
  manager:      '/dashboard',
  reception:    '/timeline',
  housekeeping: '/menage',
  restaurant:   '/restaurant',
  comptabilite: '/facturation',
  technicien:   '/maintenance',
}

export default function AppLayout({ children, titre, sousTitre }) {
  const router   = useRouter()
  const pathname = usePathname()
  const { user, hotel, init } = useAuthStore()

  useTableEnhancements(pathname)

  // Sidebar overlay state — persisted in localStorage
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [aiOpen,      setAiOpen]      = useState(false)
  function toggleSidebar() {
    setSidebarOpen(o => {
      const next = !o
      try { localStorage.setItem('7vh_sidebar', next ? 'open' : 'closed') } catch {}
      return next
    })
  }
  function closeSidebar() { setSidebarOpen(false); try { localStorage.setItem('7vh_sidebar', 'closed') } catch {} }

  // Effect 0 — apply persisted theme on mount
  useEffect(() => {
    try {
      const theme = localStorage.getItem('7vh_theme')
      if (theme === 'light') document.documentElement.classList.add('light')
      else document.documentElement.classList.remove('light')
    } catch {}
  }, [])

  // Effect 1 — hydrate le store depuis localStorage une seule fois au montage.
  // init() est une référence stable Zustand — l'omettre des deps est intentionnel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  // Effect 2 — guards d'accès, re-run uniquement quand user ou pathname changent.
  // init() n'est plus ici → plus de boucle set() → rerender → set().
  useEffect(() => {
    const token = localStorage.getItem('7vh_token')
    if (!token) {
      router.replace('/auth/connexion')
      return
    }
    if (!user) return

    // Super_admin sans hotel_id → pages exploitation interdites sauf /platform/*
    const pageBase = '/' + (pathname.split('/')[1] || '')
    if (user.role === 'super_admin' && !user.hotel_id && !pageBase.startsWith('/platform')) {
      router.replace('/platform/dashboard')
      return
    }

    const autorisees = PAGES_AUTORISEES[pageBase]
    if (!autorisees || !autorisees.includes(user.role)) {
      const accueil = ACCUEIL_PAR_ROLE[user.role] || '/dashboard'
      router.replace(accueil)
    }
  }, [user, pathname, router])

  // Tous les hooks doivent être avant tout return conditionnel
  const [bgUrl, setBgUrl]     = useState(null)  // fond hôtel
  const [userBg, setUserBg]   = useState(null)  // fond perso (localStorage)
  const [uploadingBg, setUploadingBg] = useState(false)
  const bgInputRef = useRef(null)

  // Charge le fond hôtel
  useEffect(() => {
    if (!hotel?.id) return
    hotelsAPI.obtenir(hotel.id)
      .then(res => { setBgUrl(res.data.parametres?.image_fond_url || null) })
      .catch(() => {})
  }, [hotel?.id])

  // Charge le fond perso depuis localStorage
  useEffect(() => {
    if (!user?.id) return
    try { setUserBg(localStorage.getItem('7vh_bg_user_' + user.id) || null) } catch {}
  }, [user?.id])

  // Upload fond perso et stockage localStorage
  async function handleUserBgChange(e) {
    const file = e.target.files?.[0]
    if (!file || !hotel?.id) return
    try {
      setUploadingBg(true)
      const res = await hotelsAPI.uploadImageFond(hotel.id, file)
      const url = res.data.url
      const fullUrl = url.startsWith('/uploads/') ? `${API_ORIGIN}${url}` : url
      try { localStorage.setItem('7vh_bg_user_' + user.id, fullUrl) } catch {}
      setUserBg(fullUrl)
    } catch {}
    finally { setUploadingBg(false); e.target.value = '' }
  }

  function supprimerUserBg() {
    try { localStorage.removeItem('7vh_bg_user_' + user?.id) } catch {}
    setUserBg(null)
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-0)]">
        <div className="w-6 h-6 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  // Priorité : fond perso > fond hôtel
  const activeBgUrl = userBg || (bgUrl?.startsWith('/uploads/') ? `${API_ORIGIN}${bgUrl}` : bgUrl)
  const bgStyle = activeBgUrl ? {
    backgroundImage: `linear-gradient(to bottom, rgba(8,9,24,0.85) 0%, rgba(8,9,24,0.78) 100%), url(${activeBgUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed',
  } : {}

  return (
    <>
    <div key={pathname} className="nav-progress-bar" aria-hidden="true" />
    <div className="flex min-h-screen" style={bgStyle}>
      {/* Backdrop overlay when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          onClick={closeSidebar}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={closeSidebar} />

      {/* Input file caché pour fond perso */}
      <input ref={bgInputRef} type="file" accept="image/jpeg,image/png,image/webp"
        className="hidden" onChange={handleUserBgChange} />

      <div className="flex-1 flex flex-col min-h-screen">
        <Topbar
          titre={titre}
          sousTitre={sousTitre}
          onToggleSidebar={toggleSidebar}
          onChangeBg={() => bgInputRef.current?.click()}
          onResetBg={userBg ? supprimerUserBg : null}
          uploadingBg={uploadingBg}
        />
        <main key={pathname} className="flex-1 p-6 anim-up">
          {children}
        </main>
        {/* Boutons flottants — uniquement pour les rôles exploitation hôtel */}
        {user?.role !== 'super_admin' && (
          <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-40">
            <button
              title="Ouwalou AI"
              onClick={() => setAiOpen(o => !o)}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-base shadow-lg shadow-blue-500/30 hover:scale-110 transition-transform cursor-pointer">
              🤖
            </button>
            <a href="/aide" title="Centre d'aide"
              className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white text-base shadow-lg shadow-purple-500/30 hover:scale-110 transition-transform cursor-pointer">
              ❓
            </a>
          </div>
        )}
      </div>
    </div>

    <OuwaloDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    </>
  )
}
