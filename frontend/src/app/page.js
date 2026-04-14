'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('7vh_token')
    const user  = JSON.parse(localStorage.getItem('7vh_user') || 'null')

    if (token && user) {
      const redirects = {
        super_admin:  '/dashboard',
        manager:      '/dashboard',
        reception:    '/dashboard',
        housekeeping: '/menage',
        restaurant:   '/restaurant',
        comptabilite: '/facturation',
        technicien:   '/maintenance'
      }
      router.replace(redirects[user.role] || '/dashboard')
    } else {
      router.replace('/auth/connexion')
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-0)]">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-xl font-black mx-auto mb-4 shadow-lg shadow-blue-500/30">
          7
        </div>
        <div className="text-sm font-bold text-[var(--text-2)]">Chargement…</div>
        <div className="mt-3 w-6 h-6 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin mx-auto" />
      </div>
    </div>
  )
}
