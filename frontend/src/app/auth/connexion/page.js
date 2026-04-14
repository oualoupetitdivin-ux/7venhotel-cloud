'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { authAPI } from '../../lib/api'
import { useAuthStore } from '../../lib/utils'

const COMPTES_DEMO = [
  { email: 'superadmin@demo.com', role: 'Super Admin',   couleur: '#8B5CF6', icone: '⚙' },
  { email: 'manager@demo.com',    role: 'Manager',        couleur: '#3B82F6', icone: '🏨' },
  { email: 'reception@demo.com',  role: 'Réception',      couleur: '#10B981', icone: '🔑' },
  { email: 'housekeeping@demo.com',role: 'Housekeeping',  couleur: '#F59E0B', icone: '🧹' },
  { email: 'restaurant@demo.com', role: 'Restaurant',     couleur: '#F97316', icone: '🍽' },
  { email: 'accounting@demo.com', role: 'Comptabilité',   couleur: '#06B6D4', icone: '💳' },
]

export default function ConnexionPage() {
  const router = useRouter()
  const setSession = useAuthStore(s => s.setSession)
  const [email, setEmail]   = useState('')
  const [mdp, setMdp]       = useState('')
  const [loading, setLoading] = useState(false)
  const [erreur, setErreur]  = useState('')

  useEffect(() => {
    const token = localStorage.getItem('7vh_token')
    if (token) router.replace('/dashboard')
  }, [router])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !mdp) { setErreur('Veuillez remplir tous les champs'); return }
    setLoading(true); setErreur('')
    try {
      const { data } = await authAPI.connexion({ email, mot_de_passe: mdp })
      setSession(data)
      toast.success(`Bienvenue, ${data.utilisateur.prenom} !`)
      const redirects = {
        super_admin:'dashboard', manager:'dashboard', reception:'dashboard',
        housekeeping:'menage', restaurant:'restaurant', comptabilite:'facturation', technicien:'maintenance'
      }
      router.push('/' + (redirects[data.utilisateur.role] || 'dashboard'))
    } catch (err) {
      setErreur(err.response?.data?.erreur || 'Identifiants incorrects')
    } finally { setLoading(false) }
  }

  function remplirDemo(demoEmail) {
    setEmail(demoEmail); setMdp('demo123'); setErreur('')
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
            Plateforme SaaS hôtelière complète pour l'Afrique et le monde. Réservations, housekeeping, restaurant, IA — tout en un.
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

          {/* Comptes démo */}
          <div className="bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl p-3 mb-5">
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-[var(--text-3)] mb-2">🚀 Comptes démo</div>
            <div className="space-y-0.5">
              {COMPTES_DEMO.map(d => (
                <button key={d.email} onClick={() => remplirDemo(d.email)}
                  className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--bg-3)] transition-colors text-left">
                  <span className="text-sm">{d.icone}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: d.couleur }}>{d.role}</div>
                    <div className="text-[10px] text-[var(--text-3)] font-mono truncate">{d.email}</div>
                  </div>
                  <span className="text-[var(--text-4)] text-xs">→</span>
                </button>
              ))}
            </div>
          </div>

          {erreur && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-2 rounded-lg mb-4">
              {erreur}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="form-group">
              <label className="form-label">Adresse email</label>
              <input className="input" type="email" placeholder="email@demo.com"
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

          <p className="text-center mt-4 text-[10.5px] text-[var(--text-3)]">
            Mot de passe démo : <code className="bg-[var(--bg-3)] px-1.5 py-0.5 rounded font-mono">demo123</code>
          </p>
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
