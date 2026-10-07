'use client'
// Gabarit des écrans Finance OHADA : AppLayout + navigation par onglets.
// Liens sans préchargement (prefetch={false}) : chaque écran Finance est un chunk chargé à la demande.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import AppLayout from '@/components/layout/AppLayout'

const ONGLETS = [
  { href: '/finance',                label: 'Tableau de bord' },
  { href: '/finance/ecritures',      label: 'Écritures' },
  { href: '/finance/grand-livre',    label: 'Grand Livre' },
  { href: '/finance/balance',        label: 'Balance' },
  { href: '/finance/etats',          label: 'États financiers' },
  { href: '/finance/journaux',       label: 'Journaux' },
  { href: '/finance/plan-comptable', label: 'Plan comptable' },
  { href: '/finance/tiers',          label: 'Tiers' },
  { href: '/finance/mapping',        label: 'Mapping PMS' },
  { href: '/finance/exercices',      label: 'Exercices' },
  { href: '/finance/cloture',        label: 'Clôture' },
]

export default function FinanceLayout({ titre, sousTitre, actions, children }) {
  const pathname = usePathname()
  return (
    <AppLayout titre={titre} sousTitre={sousTitre || 'Comptabilité OHADA — SYSCOHADA révisé'}>
      <div className="space-y-4">
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border-1)] -mt-1" aria-label="Finance">
          {ONGLETS.map(o => {
            const actif = o.href === '/finance' ? pathname === '/finance' : pathname.startsWith(o.href)
            return (
              <Link key={o.href} href={o.href} prefetch={false}
                className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${actif ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
                {o.label}
              </Link>
            )
          })}
        </nav>
        {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        {children}
      </div>
    </AppLayout>
  )
}

export function Etat({ chargement, erreur, vide, children }) {
  if (chargement) return <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
  if (erreur) return <div className="card p-6 text-sm text-amber-400">{erreur}</div>
  if (vide) return <div className="card p-8 text-center text-xs text-[var(--text-3)]">{vide}</div>
  return children
}

export function Kpi({ libelle, valeur, sous, couleur = 'text-[var(--text-0)]' }) {
  return (
    <div className="kpi-card">
      <div className="text-[9.5px] uppercase tracking-wide text-[var(--text-3)] mb-1">{libelle}</div>
      <div className={`text-lg font-black font-mono ${couleur}`}>{valeur}</div>
      {sous && <div className="text-[10px] text-[var(--text-3)] mt-0.5">{sous}</div>}
    </div>
  )
}
