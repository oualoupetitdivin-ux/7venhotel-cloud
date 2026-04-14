'use client'
import { useState } from 'react'
import { bookingAPI } from '../../lib/api'

export default function BookingHome() {
  const [search, setSearch] = useState({ checkin:'', checkout:'', personnes:2 })
  const [loading, setLoading] = useState(false)
  const hotel = { nom:'Hôtel Royal Yaoundé', ville:'Yaoundé, Cameroun', etoiles:5 }

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1)
  const dayAfter  = new Date(); dayAfter.setDate(dayAfter.getDate()+3)
  if (!search.checkin)  search.checkin  = tomorrow.toISOString().split('T')[0]
  if (!search.checkout) search.checkout = dayAfter.toISOString().split('T')[0]

  async function chercher() {
    setLoading(true)
    sessionStorage.setItem('bk_search', JSON.stringify(search))
    window.location.href = '/booking/resultats'
  }

  return (
    <div className="min-h-screen" style={{background:'linear-gradient(160deg,#060810 0%,#0A1628 55%,#0B1525 100%)'}}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-sm">7</div>
          <span className="text-sm font-black text-white"><span className="text-blue-400">7ven</span>Hotel</span>
        </div>
        <div className="flex gap-2">
          <a href="/client-portal" className="text-xs text-gray-400 px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-colors">Mon espace</a>
          <a href="/auth/connexion" className="text-xs text-white px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors">Accès PMS</a>
        </div>
      </nav>

      {/* Hero */}
      <div className="text-center pt-16 pb-12 px-6 relative">
        <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 30% 50%,rgba(37,99,235,.18),transparent 55%),radial-gradient(ellipse at 75% 20%,rgba(139,92,246,.12),transparent 45%)'}} />
        <div className="relative z-10">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-400 mb-4">
            {'⭐'.repeat(hotel.etoiles)} {hotel.nom} · {hotel.ville}
          </div>
          <h1 className="text-5xl font-black text-white leading-tight mb-4" style={{letterSpacing:'-2px'}}>
            Votre séjour<br/>d&apos;<span style={{background:'linear-gradient(90deg,#60A5FA,#A78BFA)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>exception</span><br/>vous attend
          </h1>
          <p className="text-sm text-gray-400 mb-10 max-w-md mx-auto">Réservez directement et profitez des meilleurs tarifs garantis. Annulation flexible incluse.</p>

          {/* Barre de recherche */}
          <div className="max-w-3xl mx-auto bg-[#111827] border border-white/10 rounded-2xl p-2 flex items-stretch gap-0 shadow-2xl">
            {[
              {label:'📅 Arrivée', type:'date', field:'checkin'},
              {label:'📅 Départ', type:'date', field:'checkout'},
            ].map(f => (
              <div key={f.field} className="flex-1 px-4 py-2 border-r border-white/10">
                <div className="text-[8.5px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">{f.label}</div>
                <input type={f.type} value={search[f.field]}
                  onChange={e => setSearch(p => ({...p, [f.field]:e.target.value}))}
                  className="bg-transparent border-none outline-none text-sm font-bold text-white w-full cursor-pointer"
                />
              </div>
            ))}
            <div className="px-4 py-2 border-r border-white/10">
              <div className="text-[8.5px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">👤 Personnes</div>
              <select value={search.personnes} onChange={e => setSearch(p => ({...p, personnes:parseInt(e.target.value)}))}
                className="bg-transparent border-none outline-none text-sm font-bold text-white cursor-pointer">
                {[1,2,3,4,5,6].map(n => <option key={n} value={n} className="bg-gray-900">{n} personne{n>1?'s':''}</option>)}
              </select>
            </div>
            <button onClick={chercher} disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-colors ml-1">
              {loading ? '…' : 'Rechercher →'}
            </button>
          </div>

          <div className="flex justify-center gap-6 mt-5 text-xs text-gray-500">
            {['✓ Meilleur tarif garanti','✓ Annulation flexible 48h','✓ Confirmation instantanée'].map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
      </div>

      {/* Types de chambres */}
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-black text-white text-center mb-8">Nos chambres & suites</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            {nom:'Standard',    prix:'22 000',emoji:'🛏',size:'18m²',view:'Jardin'},
            {nom:'Deluxe',      prix:'38 000',emoji:'✨',size:'32m²',view:'Piscine'},
            {nom:'Junior Suite',prix:'55 000',emoji:'🌅',size:'45m²',view:'Panorama'},
            {nom:'Suite Royale',prix:'98 000',emoji:'👑',size:'72m²',view:'Yaoundé 360°'},
            {nom:'Supérieure',  prix:'28 000',emoji:'🏨',size:'24m²',view:'Rue'},
            {nom:'Suite Présidentielle',prix:'150 000',emoji:'🏆',size:'110m²',view:'Tout Yaoundé'},
          ].map(r => (
            <div key={r.nom} className="bg-[#111827] border border-white/10 rounded-xl overflow-hidden hover:border-blue-500/50 transition-all cursor-pointer group" onClick={chercher}>
              <div className="h-32 flex items-center justify-center text-5xl bg-gradient-to-br from-gray-800 to-gray-900 group-hover:from-blue-900/30">{r.emoji}</div>
              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-white text-sm">{r.nom}</div>
                  <div className="text-right">
                    <div className="text-blue-400 font-black text-sm">dès {r.prix} XAF</div>
                    <div className="text-[9px] text-gray-500">/ nuit</div>
                  </div>
                </div>
                <div className="flex gap-3 text-[10.5px] text-gray-400">
                  <span>📐 {r.size}</span><span>🏔 {r.view}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-8 py-5 flex justify-between text-[10px] text-gray-600">
        <span>© 2026 Hôtel Royal Yaoundé · Powered by <strong className="text-gray-500">7venHotel Cloud</strong></span>
        <div className="flex gap-4">
          <a href="#" className="hover:text-gray-400">Confidentialité</a>
          <a href="#" className="hover:text-gray-400">CGV</a>
          <a href="#" className="hover:text-gray-400">Contact</a>
        </div>
      </footer>
    </div>
  )
}
