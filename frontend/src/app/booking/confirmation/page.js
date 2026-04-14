'use client'
import { useEffect, useState } from 'react'

export default function BookingConfirmation() {
  const [conf, setConf] = useState(null)
  useEffect(() => { setConf(JSON.parse(sessionStorage.getItem('bk_confirmation') || 'null')) }, [])

  if (!conf) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center">
      <div className="text-white text-center">
        <div className="text-4xl mb-4">✅</div>
        <a href="/booking" className="text-blue-400 text-sm">← Nouvelle réservation</a>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="bg-[#111827] border border-white/10 rounded-3xl p-8 text-center mb-5">
          <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-emerald-500/30">✓</div>
          <h1 className="text-2xl font-black text-white mb-2">Réservation confirmée !</h1>
          <p className="text-sm text-gray-400 mb-5">Un email de confirmation vous a été envoyé.</p>
          <div className="bg-[#1A2235] rounded-2xl px-5 py-3 inline-block mb-2">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Référence</div>
            <div className="text-2xl font-black font-mono text-blue-400">{conf.ref || 'RES-XXX'}</div>
          </div>
        </div>

        <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 mb-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {[['Client', `${conf.client?.prenom||''} ${conf.client?.nom||''}`],
              ['Chambre',conf.chambre?.type||'—'],['Arrivée',conf.chambre?.checkin||'—'],
              ['Départ',conf.chambre?.checkout||'—'],['Total',`${(conf.total||0).toLocaleString('fr-FR')} XAF`]
            ].map(([l,v]) => (
              <div key={l}><div className="text-[9.5px] text-gray-500 uppercase mb-0.5">{l}</div><div className="text-white font-bold">{v}</div></div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <a href="/client-portal" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-3 rounded-xl text-center transition-colors">Accéder à mon espace →</a>
          <a href="/booking" className="flex-1 border border-white/10 text-gray-400 hover:text-white text-sm font-medium py-3 rounded-xl text-center transition-colors">Nouvelle réservation</a>
        </div>
      </div>
    </div>
  )
}
