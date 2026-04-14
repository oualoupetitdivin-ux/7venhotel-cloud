'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '../../lib/utils'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function AppLayout({ children, titre, sousTitre }) {
  const router = useRouter()
  const { user, init } = useAuthStore()

  useEffect(() => {
    init()
    const token = localStorage.getItem('7vh_token')
    if (!token) router.replace('/auth/connexion')
  }, [router, init])

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-0)]">
        <div className="w-6 h-6 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="ml-60 flex-1 flex flex-col min-h-screen">
        <Topbar titre={titre} sousTitre={sousTitre} />
        <main className="flex-1 p-6">
          {children}
        </main>
        {/* Boutons flottants */}
        <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-40">
          <a href="/ai" title="Ouwalou AI"
            className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-base shadow-lg shadow-blue-500/30 hover:scale-110 transition-transform cursor-pointer">
            🤖
          </a>
          <a href="/aide" title="Centre d'aide"
            className="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center text-white text-base shadow-lg shadow-purple-500/30 hover:scale-110 transition-transform cursor-pointer">
            ❓
          </a>
        </div>
      </div>
    </div>
  )
}
