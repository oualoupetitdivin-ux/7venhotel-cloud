'use client'
import { useState } from 'react'
import { authAPI } from '../../../lib/api'

export default function ClientConnexion() {
  const [email, setEmail] = useState('')
  const [mdp, setMdp]     = useState('')
  const [loading, setLoading] = useState(false)
  const [erreur, setErreur]   = useState('')

  async function connexion(e) {
    e.preventDefault()
    setLoading(true); setErreur('')
    try {
      const { data } = await authAPI.clientConnexion({ email, mot_de_passe: mdp })
      localStorage.setItem('7vh_client_token', data.token)
      window.location.href = '/client-portal'
    } catch { setErreur('Email ou mot de passe incorrect') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-xl font-black mx-auto mb-4">7</div>
          <h2 className="text-xl font-black text-white mb-1">Espace Client</h2>
          <p className="text-sm text-gray-400">Hôtel Royal Yaoundé</p>
        </div>

        <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 mb-3">
          <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-2">🚀 Compte démo</div>
          <button onClick={() => { setEmail('client@demo.com'); setMdp('demo123') }}
            className="w-full flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors text-left">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">SM</div>
            <div>
              <div className="text-[10px] font-bold text-blue-400 uppercase">Client</div>
              <div className="text-[10px] text-gray-400 font-mono">client@demo.com</div>
            </div>
            <span className="ml-auto text-gray-600 text-xs">→</span>
          </button>
        </div>

        <form onSubmit={connexion} className="bg-[#111827] border border-white/10 rounded-2xl p-5 space-y-3">
          {erreur && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg">{erreur}</div>}
          {[['Email','email','email',email,setEmail],['Mot de passe','password','password',mdp,setMdp]].map(([lbl,type,key,val,set]) => (
            <div key={key}>
              <label className="text-[10px] text-gray-500 block mb-1 uppercase">{lbl}</label>
              <input type={type} value={val} onChange={e => set(e.target.value)}
                className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 transition-colors"
              />
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-xl transition-colors">
            {loading ? 'Connexion…' : 'Se connecter →'}
          </button>
        </form>

        <div className="text-center mt-4 space-y-2">
          <div className="text-xs text-gray-500">Pas encore de compte ? <a href="/booking" className="text-blue-400">Réserver en ligne →</a></div>
          <div className="text-xs text-gray-600"><a href="/auth/connexion" className="hover:text-gray-400">Accès équipe hôtel →</a></div>
        </div>
      </div>
    </div>
  )
}
