'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { authAPI } from '@/lib/api'
import { useAuthStore, resolvePostLoginDestination } from '@/lib/utils'

export default function ConnexionPage() {
  const router = useRouter()
  const setSession = useAuthStore(s => s.setSession)
  const [email, setEmail]   = useState('')
  const [mdp, setMdp]       = useState('')
  const [loading, setLoading] = useState(false)
  const [erreur, setErreur]  = useState('')

  useEffect(() => {
    try {
      const token = localStorage.getItem('7vh_token')
      const user  = JSON.parse(localStorage.getItem('7vh_user')  || 'null')
      const hotel = JSON.parse(localStorage.getItem('7vh_hotel') || 'null')
      if (token && user) router.replace(resolvePostLoginDestination(user, hotel))
    } catch {
      // localStorage corrompu — rester sur la page de connexion
    }
  }, [router])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !mdp) { setErreur('Veuillez remplir tous les champs'); return }
    setLoading(true); setErreur('')
    try {
      const { data } = await authAPI.connexion({ email, mot_de_passe: mdp })
      setSession(data)
      toast.success(`Bienvenue, ${data.utilisateur.prenom} !`)
      router.push(resolvePostLoginDestination(data.utilisateur, data.hotel))
    } catch (err) {
      setErreur(err.response?.data?.erreur || 'Identifiants incorrects')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex">
      {/* Panneau gauche */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #060810 0%, #0A1628 60%, #0B1525 100%)' }}>
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(ellipse at 25% 45%, rgba(37,99,235,.2) 0%, transparent 55%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,.14) 0%, transparent 45%)'
        }} />
        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-base shadow-lg shadow-blue-500/30">7</div>
          <div>
            <div className="text-sm font-black text-white">7venHotel <span style={{ color: '#60A5FA' }}>Cloud</span></div>
            <div className="text-[9px] text-gray-500 tracking-widest uppercase">Cloud PMS v5</div>
          </div>
        </div>
        {/* Titre hero */}
        <div className="relative z-10">
          <h1 className="text-4xl font-black text-white leading-tight tracking-tight mb-4">
            Gérez votre hôtel<br />avec <span style={{ background: 'linear-gradient(90deg,#60A5FA,#A78BFA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>élégance.</span>
          </h1>
          <p className="text-sm text-gray-400 leading-relaxed max-w-sm">
            Plateforme SaaS hôtelière complète pour l&apos;Afrique et le monde. Réservations, housekeeping, restaurant, IA — tout en un.
          </p>
          <div className="flex gap-2 mt-5 flex-wrap">
            {['🌍 Multi-hôtels','💱 XAF & 11 devises','🤖 Ouwalou AI','🔐 RBAC sécurisé'].map(tag => (
              <span key={tag} className="text-[10px] px-3 py-1 rounded-full text-blue-300 border border-blue-500/25 bg-blue-500/10 font-medium">{tag}</span>
            ))}
          </div>
        </div>
        {/* Stats */}
        <div className="relative z-10 grid grid-cols-3 border border-white/5 rounded-xl overflow-hidden bg-white/5 backdrop-blur-sm">
          {[['142','Chambres'],['87%','Occupation'],['2.4M','XAF/jour']].map(([val, lbl]) => (
            <div key={lbl} className="text-center py-4 border-r border-white/5 last:border-0">
              <div className="text-xl font-black font-mono text-blue-400">{val}</div>
              <div className="text-[10px] text-gray-500 mt-1">{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Panneau droit — formulaire */}
      <div className="w-full lg:w-[440px] flex-shrink-0 flex items-center justify-center p-8 bg-[var(--bg-0)] border-l border-[var(--border-0)]">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-sm">7</div>
            <div className="text-sm font-black"><span className="text-blue-400">7ven</span>Hotel Cloud</div>
          </div>

          <h2 className="text-xl font-black mb-1">Connexion</h2>
          <p className="text-xs text-[var(--text-3)] mb-6">Accédez à votre espace de gestion</p>

          {erreur && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-2 rounded-lg mb-4">
              {erreur}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="form-group">
              <label className="form-label">Adresse email</label>
              <input className="input" type="email" placeholder="votre@email.com"
                value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="form-group">
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Mot de passe</label>
                <a href="#" className="text-[10.5px] text-blue-400">Mot de passe oublié ?</a>
              </div>
              <input className="input" type="password" placeholder="••••••••"
                value={mdp} onChange={e => setMdp(e.target.value)} autoComplete="current-password" />
            </div>
            <button type="submit" disabled={loading}
              className="btn btn-primary btn-lg w-full justify-center mt-2 disabled:opacity-50">
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connexion…
                </span>
              ) : 'Se connecter →'}
            </button>
          </form>

          <div className="flex items-center justify-center gap-3 mt-4 text-[10.5px] text-[var(--text-4)]">
            <a href="/booking" className="hover:text-[var(--text-2)]">Réserver en ligne</a>
            <span>·</span>
            <a href="/client-portal" className="hover:text-[var(--text-2)]">Espace client</a>
          </div>
        </div>
      </div>
    </div>
  )
}
