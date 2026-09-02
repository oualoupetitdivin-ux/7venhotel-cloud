'use client'
// PlatformLayout — Layout exclusif Opérateur Plateforme SaaS
// Aucun composant PMS. Aucun contexte hôtel. Aucun sélecteur propriété.
// Contexte : "7venHotel Cloud — Centre de Contrôle"

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/utils'

// ── Bannière impersonation ────────────────────────────────────────────────────
// Visible sur TOUTES les pages platform quand une session d'impersonation est active.
// Invariant : non-masquable, affichage permanent, révocation en 1 clic.
function ImpersonationBanner() {
  const [session, setSession] = useState(null)
  const [terminating, setTerminating] = useState(false)
  const token = useAuthStore(s => s.token)

  const checkSession = useCallback(() => {
    const sessionId = localStorage.getItem('7vh_impersonation_session_id')
    const tenant    = localStorage.getItem('7vh_impersonation_tenant')
    const expire    = localStorage.getItem('7vh_impersonation_expire')
    if (!sessionId || !tenant) { setSession(null); return }
    // Vérifier que la session n'est pas expirée
    if (expire && new Date(expire) <= new Date()) {
      localStorage.removeItem('7vh_impersonation_token')
      localStorage.removeItem('7vh_impersonation_session_id')
      localStorage.removeItem('7vh_impersonation_tenant')
      localStorage.removeItem('7vh_impersonation_expire')
      setSession(null); return
    }
    const ms = new Date(expire) - Date.now()
    const h  = Math.floor(ms / 3600000)
    const m  = Math.floor((ms % 3600000) / 60000)
    setSession({ sessionId, tenant, remaining: h > 0 ? `${h}h ${m}m` : `${m}m` })
  }, [])

  useEffect(() => {
    checkSession()
    const iv = setInterval(checkSession, 30_000)
    return () => clearInterval(iv)
  }, [checkSession])

  async function handleTerminate() {
    if (!session || !confirm(`Terminer l'impersonation de "${session.tenant}" ?`)) return
    setTerminating(true)
    try {
      const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'
      await fetch(`${API}/platform/iam/impersonate/${session.sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      localStorage.removeItem('7vh_impersonation_token')
      localStorage.removeItem('7vh_impersonation_session_id')
      localStorage.removeItem('7vh_impersonation_tenant')
      localStorage.removeItem('7vh_impersonation_expire')
      setSession(null)
    } catch { alert('Erreur lors de la terminaison de la session') }
    finally { setTerminating(false) }
  }

  if (!session) return null

  return (
    <>
      {/* ── Bannière haute — NON masquable, z-index max ── */}
      <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-4 px-4 py-2 bg-amber-500 text-black text-[10px] font-bold shadow-lg border-b-2 border-amber-600">
        <div className="flex items-center gap-3">
          {/* Indicateur pulsant */}
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-700 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-800" />
          </span>
          <span className="uppercase tracking-wider">Impersonation active</span>
          <span className="h-3 w-px bg-black/30" />
          <span className="font-black text-[11px]">{session.tenant}</span>
          <span className="h-3 w-px bg-black/30" />
          <span className="font-normal opacity-70">Vous agissez AU NOM de ce tenant</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono opacity-70">⏱ {session.remaining} restant</span>
          <a href="/platform/iam"
            className="bg-black/15 hover:bg-black/25 px-2.5 py-1 rounded text-[9px] transition-colors">
            Gérer →
          </a>
          <button onClick={handleTerminate} disabled={terminating}
            className="bg-red-800/80 hover:bg-red-900 text-white px-3 py-1 rounded text-[9px] font-bold transition-colors disabled:opacity-50">
            {terminating ? '…' : '✕ Terminer'}
          </button>
        </div>
      </div>

      {/* ── Overlay latéral gauche — renforce le boundary visuel ── */}
      <div className="fixed left-0 top-8 bottom-0 w-1 z-[9998] bg-amber-500 opacity-80" />
      <div className="fixed right-0 top-8 bottom-0 w-1 z-[9998] bg-amber-500 opacity-80" />
    </>
  )
}

// ── Navigation plateforme ─────────────────────────────────────────────────────
const NAV_PLATFORM = [
  {
    groupe: 'Supervision Globale',
    items: [
      { href: '/platform/dashboard', icon: '⊞', label: 'Platform Command' },
      { href: '/platform/tenants',   icon: '🏢', label: 'Tenants' },
      { href: '/platform/health',    icon: '📡', label: 'Observabilité' },
    ],
  },
  {
    groupe: 'Sécurité & Accès',
    items: [
      { href: '/platform/iam',       icon: '🔑', label: 'IAM & Sessions' },
      { href: '/platform/audit',     icon: '🛡', label: 'Audit & Conformité' },
    ],
  },
  {
    groupe: 'Business & Finance',
    items: [
      { href: '/platform/billing',   icon: '💰', label: 'Facturation SaaS' },
      { href: '/platform/ai',        icon: '🤖', label: 'IA Gouvernance' },
    ],
  },
  {
    groupe: 'Configuration',
    items: [
      { href: '/platform/config',    icon: '⚙', label: 'Platform Config' },
    ],
  },
]

// ── Sidebar plateforme ────────────────────────────────────────────────────────
function PlatformSidebar({ health }) {
  const pathname    = usePathname()
  const router      = useRouter()
  const { user, logout } = useAuthStore()

  const healthColor = health === 'healthy' ? 'bg-emerald-500' : health === 'degraded' ? 'bg-amber-500' : 'bg-red-500'
  const healthGlow  = health === 'healthy' ? 'shadow-[0_0_6px_#10B981]' : health === 'degraded' ? 'shadow-[0_0_6px_#F59E0B]' : 'shadow-[0_0_6px_#EF4444]'

  async function handleLogout() {
    logout()
    router.replace('/auth/connexion')
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 flex flex-col bg-[var(--bg-1)] border-r border-[var(--border-0)] z-30">

      {/* ── Brand Plateforme ── */}
      <div className="px-4 py-4 border-b border-[var(--border-0)]">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 via-purple-600 to-cyan-500 flex items-center justify-center text-white text-xs font-black shadow-md shadow-blue-500/30 flex-shrink-0">7</div>
          <div>
            <div className="text-[12.5px] font-black leading-tight">
              <span className="text-blue-400">7ven</span>
              <span className="text-[var(--text-0)]">Hotel</span>
            </div>
            <div className="text-[8px] tracking-[0.15em] text-purple-400 font-bold uppercase">Cloud Platform</div>
          </div>
        </div>

        {/* Statut plateforme */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-2)] border border-[var(--border-0)]">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthColor} ${healthGlow}`} />
          <span className="text-[10px] text-[var(--text-2)] flex-1">
            {health === 'healthy' ? 'Tous systèmes actifs' : health === 'degraded' ? 'Mode dégradé' : 'Incident en cours'}
          </span>
          <span className="text-[8px] font-mono text-[var(--text-4)]">v1.0</span>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {NAV_PLATFORM.map(groupe => (
          <div key={groupe.groupe}>
            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-4)] px-2 mb-1.5">{groupe.groupe}</div>
            <div className="space-y-0.5">
              {groupe.items.map(item => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const isInspection = groupe.groupe === 'Inspection'
                return (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all
                      ${active
                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                        : isInspection
                          ? 'text-[var(--text-4)] hover:text-[var(--text-2)] hover:bg-[var(--bg-2)] border border-transparent border-dashed hover:border-[var(--border-0)]'
                          : 'text-[var(--text-2)] hover:text-[var(--text-0)] hover:bg-[var(--bg-2)] border border-transparent'
                      }`}>
                    <span className="text-sm opacity-75 w-4 text-center flex-shrink-0">{item.icon}</span>
                    <span className="flex-1 font-medium">{item.label}</span>
                    {item.sub && <span className="text-[8px] text-[var(--text-4)] bg-[var(--bg-3)] px-1 rounded">{item.sub}</span>}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer opérateur ── */}
      <div className="border-t border-[var(--border-0)] p-3">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-2)] mb-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
            {(user?.prenom?.[0] || '') + (user?.nom?.[0] || '')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold text-[var(--text-0)] truncate">{user?.prenom} {user?.nom}</div>
            <div className="text-[8px] text-purple-400 font-semibold">Platform Operator</div>
          </div>
        </div>
        <button onClick={handleLogout}
          className="w-full text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)] px-2 py-1.5 rounded-lg hover:bg-[var(--bg-2)] transition-colors text-left flex items-center gap-1.5">
          <span>⎋</span> Déconnexion
        </button>
      </div>
    </aside>
  )
}

// ── Topbar plateforme ─────────────────────────────────────────────────────────
function PlatformTopbar({ titre, sousTitre }) {
  const pathname = usePathname()

  // Breadcrumb du chemin platform
  const segments = pathname.split('/').filter(Boolean)
  const breadcrumb = segments.map((s, i) => ({
    label: s === 'platform' ? 'Platform' : s.charAt(0).toUpperCase() + s.slice(1),
    active: i === segments.length - 1,
  }))

  return (
    <header className="h-12 flex-shrink-0 border-b border-[var(--border-0)] bg-[var(--bg-1)] flex items-center px-5 gap-4">

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-[var(--text-4)] text-[10px] font-semibold tracking-wide">7venHotel Cloud</span>
        {breadcrumb.map((b, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="text-[var(--text-4)]">/</span>
            <span className={b.active ? 'font-bold text-[var(--text-0)]' : 'text-[var(--text-3)]'}>{b.label}</span>
          </span>
        ))}
      </div>

      <div className="flex-1" />

      {/* Contexte plateforme — PAS de contexte hôtel */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold px-2 py-1 rounded border border-purple-500/30 bg-purple-500/10 text-purple-400">
          Platform Mode
        </span>
        <span className="text-[10px] text-[var(--text-4)] font-mono">
          {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </header>
  )
}

// ── Layout principal ──────────────────────────────────────────────────────────
export default function PlatformLayout({ children, titre, sousTitre }) {
  const router   = useRouter()
  const pathname = usePathname()
  // user vient du store Zustand — mis à jour par init()
  const { user, init } = useAuthStore()
  const [health, setHealth]           = useState('healthy')
  const [isImpersonating, setImpersonating] = useState(false)
  // isReady = useState local React — TOUJOURS déclenche un re-render.
  // Remplace la dépendance sur _hydrated Zustand (store update peut être
  // bloquée dans certains contextes SSR/hydration Next.js 14 + React 18 Strict Mode).
  const [isReady, setIsReady] = useState(false)

  // Détecter session d'impersonation active
  useEffect(() => {
    const check = () => {
      const sessionId = localStorage.getItem('7vh_impersonation_session_id')
      const expire    = localStorage.getItem('7vh_impersonation_expire')
      setImpersonating(!!sessionId && !!expire && new Date(expire) > new Date())
    }
    check()
    const iv = setInterval(check, 5000)
    return () => clearInterval(iv)
  }, [])

  // Hydratation — init() lit localStorage et met à jour Zustand.
  // setIsReady(true) garantit le re-render via React useState (non Zustand).
  useEffect(() => {
    init()
    setIsReady(true)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Guard d'accès — déclenché quand isReady ou user changent
  useEffect(() => {
    if (!isReady) return  // attendre l'hydration
    const token = localStorage.getItem('7vh_token')
    if (!token || !user) {
      router.replace('/auth/connexion')
      return
    }
    if (user.role !== 'super_admin') {
      const accueil = { housekeeping: '/menage', restaurant: '/restaurant', comptabilite: '/facturation', technicien: '/maintenance' }
      router.replace(accueil[user.role] || '/dashboard')
    }
  }, [isReady, user, pathname, router])

  // Polling santé backend (légère, 60s)
  useEffect(() => {
    const BACKEND = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace(/\/api\/v\d.*$/, '')
    const token = localStorage.getItem('7vh_token')
    if (!token) return
    const check = () =>
      fetch(`${BACKEND}/health`).then(r => r.json()).then(d => setHealth(d.statut)).catch(() => setHealth('error'))
    check()
    const iv = setInterval(check, 60_000)
    return () => clearInterval(iv)
  }, [])

  // Spinner : !isReady = hydration en cours (résolu en < 100ms au prochain tick)
  //           !user = session invalide (guard redirige vers login)
  if (!isReady || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg-0)] gap-3">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-[10px] text-[var(--text-4)] uppercase tracking-widest">
          {!isReady ? 'Initialisation…' : 'Vérification session…'}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg-0)]">
      {/* Bannière impersonation — z-[9999], affichée si session active */}
      <ImpersonationBanner />

      <PlatformSidebar health={health} />

      {/* Contenu principal — décalé de la sidebar + bannière impersonation */}
      <div className={`ml-60 flex-1 flex flex-col min-h-screen transition-all ${isImpersonating ? 'pt-8' : ''}`}>
        <PlatformTopbar titre={titre} sousTitre={sousTitre} />
        {/* Ring amber sur tout le contenu en mode impersonation */}
        <main className={`flex-1 p-6 overflow-auto ${isImpersonating ? 'ring-2 ring-amber-500/20 ring-inset' : ''}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
