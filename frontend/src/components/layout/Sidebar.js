'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '../../lib/utils'
import { authAPI } from '../../lib/api'
import toast from 'react-hot-toast'

const MENUS_PAR_ROLE = {
  super_admin: [
    { groupe: 'Plateforme', items: [
      { key: '/dashboard',  icone: '⊞', label: 'Tableau de bord' },
      { key: '/tenants',    icone: '🏢', label: 'Tenants' },
      { key: '/staff',      icone: '👥', label: 'Personnel' },
      { key: '/analytics',  icone: '📊', label: 'Analytique' },
      { key: '/settings',   icone: '⚙', label: 'Paramètres' },
      { key: '/ai',         icone: '🤖', label: 'Ouwalou AI' },
    ]}
  ],
  manager: [
    { groupe: 'Opérations', items: [
      { key: '/dashboard',    icone: '⊞', label: 'Tableau de bord' },
      { key: '/reservations', icone: '📋', label: 'Réservations', badge: 'new' },
      { key: '/timeline',     icone: '▦', label: 'Planning' },
      { key: '/chambres',     icone: '🛏', label: 'Chambres' },
      { key: '/menage',       icone: '🧹', label: 'Ménage' },
      { key: '/restaurant',   icone: '🍽', label: 'Restaurant' },
      { key: '/cuisine',      icone: '🔥', label: 'Cuisine KDS' },
      { key: '/maintenance',  icone: '🔧', label: 'Maintenance' },
    ]},
    { groupe: 'Business', items: [
      { key: '/clients',    icone: '👥', label: 'Clients' },
      { key: '/facturation',icone: '💳', label: 'Facturation' },
      { key: '/analytics',  icone: '📊', label: 'Analytique' },
    ]},
    { groupe: 'IA & Config', items: [
      { key: '/ai',       icone: '🤖', label: 'Ouwalou AI' },
      { key: '/staff',    icone: '👤', label: 'Personnel' },
      { key: '/settings', icone: '⚙', label: 'Paramètres' },
    ]}
  ],
  reception: [
    { groupe: 'Réception', items: [
      { key: '/dashboard',    icone: '⊞', label: 'Tableau de bord' },
      { key: '/reservations', icone: '📋', label: 'Réservations' },
      { key: '/timeline',     icone: '▦', label: 'Planning' },
      { key: '/clients',      icone: '👥', label: 'Clients' },
    ]}
  ],
  housekeeping: [
    { groupe: 'Housekeeping', items: [
      { key: '/menage',      icone: '🧹', label: 'Kanban Chambres' },
      { key: '/chambres',    icone: '🛏', label: 'Statut Chambres' },
    ]}
  ],
  restaurant: [
    { groupe: 'Restaurant & Bar', items: [
      { key: '/restaurant', icone: '🍽', label: 'POS' },
      { key: '/cuisine',    icone: '🔥', label: 'Cuisine KDS' },
    ]}
  ],
  comptabilite: [
    { groupe: 'Finance', items: [
      { key: '/facturation', icone: '💳', label: 'Facturation' },
      { key: '/analytics',   icone: '📊', label: 'Analytique' },
    ]}
  ],
  technicien: [
    { groupe: 'Maintenance', items: [
      { key: '/maintenance', icone: '🔧', label: 'Maintenance' },
      { key: '/chambres',    icone: '🛏', label: 'Chambres' },
    ]}
  ]
}

const ROLE_COULEURS = {
  super_admin:  'from-purple-600 to-indigo-600',
  manager:      'from-blue-600 to-cyan-600',
  reception:    'from-emerald-600 to-teal-600',
  housekeeping: 'from-amber-600 to-orange-600',
  restaurant:   'from-orange-600 to-red-600',
  comptabilite: 'from-cyan-600 to-sky-600',
  technicien:   'from-slate-600 to-gray-600',
}

export default function Sidebar() {
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, hotel, logout } = useAuthStore()
  const menus = MENUS_PAR_ROLE[user?.role] || MENUS_PAR_ROLE.manager

  async function handleLogout() {
    try { await authAPI.deconnexion() } catch {}
    logout()
    router.replace('/auth/connexion')
    toast.success('Déconnecté')
  }

  const initials = user ? (user.prenom?.[0] || '') + (user.nom?.[0] || '') : '?'
  const gradient = ROLE_COULEURS[user?.role] || 'from-blue-600 to-purple-600'

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[var(--border-0)] flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0 shadow-md shadow-blue-500/25">7</div>
        <div>
          <div className="text-[12.5px] font-black leading-tight"><span className="text-blue-400">7ven</span>Hotel</div>
          <div className="text-[8.5px] text-[var(--text-4)] tracking-widest">Cloud PMS v5</div>
        </div>
      </div>

      {/* Sélecteur hôtel */}
      {hotel && (
        <button className="mx-2 mt-2 mb-1 px-2.5 py-2 bg-[var(--bg-3)] border border-[var(--border-1)] rounded-lg cursor-pointer hover:border-[var(--border-2)] transition-all w-[calc(100%-16px)] text-left flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_#10B981] flex-shrink-0" />
          <span className="text-[11px] font-semibold truncate text-[var(--text-0)]">{hotel.nom}</span>
          <span className="ml-auto text-[var(--text-4)] text-[10px]">▾</span>
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {menus.map(groupe => (
          <div key={groupe.groupe}>
            <div className="text-[8.5px] font-bold uppercase tracking-[0.1em] text-[var(--text-4)] px-2 mb-1.5">{groupe.groupe}</div>
            <div className="space-y-0.5">
              {groupe.items.map(item => {
                const active = pathname === item.key || pathname.startsWith(item.key + '/')
                return (
                  <Link key={item.key} href={item.key}
                    className={`sidebar-nav-item ${active ? 'active' : ''}`}>
                    <span className="text-sm opacity-75 w-4 text-center flex-shrink-0">{item.icone}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge === 'new' && (
                      <span className="text-[8px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded-full">3</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer utilisateur */}
      <div className="border-t border-[var(--border-0)] p-2 flex-shrink-0">
        <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--bg-3)] transition-colors cursor-pointer">
          <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold truncate">{user?.prenom} {user?.nom}</div>
            <div className="text-[9.5px] text-[var(--text-3)] truncate">{hotel?.nom || 'Plateforme'}</div>
          </div>
        </div>
        <div className="flex gap-1 mt-1">
          <Link href="/settings" className="btn btn-ghost btn-xs flex-1 justify-center">⚙</Link>
          <button onClick={handleLogout} className="btn btn-ghost btn-xs flex-1">⎋ Déco</button>
        </div>
      </div>
    </aside>
  )
}
