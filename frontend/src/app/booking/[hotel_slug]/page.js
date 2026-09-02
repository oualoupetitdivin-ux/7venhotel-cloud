'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { bookingAPI } from '@/lib/api'

export default function BookingHotel() {
  const { hotel_slug } = useParams()
  const [hotel,   setHotel]   = useState(null)
  const [erreur,  setErreur]  = useState('')
  const [loading, setLoading] = useState(false)
  const [search,  setSearch]  = useState({ checkin:'', checkout:'', personnes:2 })

  useEffect(() => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    const dayAfter  = new Date(); dayAfter.setDate(dayAfter.getDate() + 3)
    const checkin  = tomorrow.toISOString().split('T')[0]
    const checkout = dayAfter.toISOString().split('T')[0]
    setSearch(s => ({ ...s, checkin, checkout }))

    bookingAPI.disponibilite(hotel_slug, { date_arrivee: checkin, date_depart: checkout })
      .then(({ data }) => setHotel(data.hotel))
      .catch(err => {
        if (err?.response?.status === 404) setErreur('not_found')
        else setErreur('erreur')
      })
  }, [hotel_slug])

  function chercher() {
    setLoading(true)
    sessionStorage.setItem('bk_search', JSON.stringify({
      ...search,
      hotel_slug,
      hotel_nom:   hotel?.nom   || '',
      hotel_ville: hotel?.ville || '',
    }))
    window.location.href = `/booking/${hotel_slug}/resultats`
  }

  if (erreur === 'not_found') return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
      <div className="text-center text-white max-w-sm">
        <div className="text-6xl mb-5">🏨</div>
        <h1 className="text-2xl font-black mb-2">Hôtel introuvable</h1>
        <p className="text-gray-400 text-sm mb-6">
          L&apos;hôtel &laquo;&nbsp;{hotel_slug}&nbsp;&raquo; n&apos;existe pas ou n&apos;est pas actif.
        </p>
        <a href="/" className="text-blue-400 text-sm">← Retour à l&apos;accueil</a>
      </div>
    </div>
  )

  if (erreur === 'erreur') return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
      <div className="text-center text-white">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-gray-400 text-sm">Service momentanément indisponible. Veuillez réessayer.</p>
      </div>
    </div>
  )

  const nomAffiche   = hotel?.nom   || '…'
  const villeAffichee = hotel?.ville || ''

  return (
    <div className="min-h-screen" style={{background:'linear-gradient(160deg,#060810 0%,#0A1628 55%,#0B1525 100%)'}}>
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

      <div className="text-center pt-16 pb-12 px-6 relative">
        <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 30% 50%,rgba(37,99,235,.18),transparent 55%),radial-gradient(ellipse at 75% 20%,rgba(139,92,246,.12),transparent 45%)'}} />
        <div className="relative z-10">
          <div className={`text-[11px] font-bold uppercase tracking-widest text-blue-400 mb-4 transition-opacity ${hotel ? 'opacity-100' : 'opacity-40'}`}>
            ⭐⭐⭐⭐⭐ {nomAffiche}{villeAffichee ? ` · ${villeAffichee}` : ''}
          </div>
          <h1 className="text-5xl font-black text-white leading-tight mb-4" style={{letterSpacing:'-2px'}}>
            Votre séjour<br/>d&apos;<span style={{background:'linear-gradient(90deg,#60A5FA,#A78BFA)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>exception</span><br/>vous attend
          </h1>
          <p className="text-sm text-gray-400 mb-10 max-w-md mx-auto">Réservez directement et profitez des meilleurs tarifs garantis. Annulation flexible incluse.</p>

          <div className="max-w-3xl mx-auto bg-[#111827] border border-white/10 rounded-2xl p-2 flex items-stretch gap-0 shadow-2xl">
            {[
              {label:'📅 Arrivée',  type:'date', field:'checkin'},
              {label:'📅 Départ',   type:'date', field:'checkout'},
            ].map(f => (
              <div key={f.field} className="flex-1 px-4 py-2 border-r border-white/10">
                <div className="text-[8.5px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">{f.label}</div>
                <input type={f.type} value={search[f.field]}
                  onChange={e => setSearch(p => ({...p,[f.field]:e.target.value}))}
                  className="bg-transparent border-none outline-none text-sm font-bold text-white w-full cursor-pointer"
                />
              </div>
            ))}
            <div className="px-4 py-2 border-r border-white/10">
              <div className="text-[8.5px] font-bold uppercase tracking-widest text-gray-500 mb-0.5">👤 Personnes</div>
              <select value={search.personnes} onChange={e => setSearch(p => ({...p,personnes:parseInt(e.target.value)}))}
                className="bg-transparent border-none outline-none text-sm font-bold text-white cursor-pointer">
                {[1,2,3,4,5,6].map(n => <option key={n} value={n} className="bg-gray-900">{n} personne{n>1?'s':''}</option>)}
              </select>
            </div>
            <button onClick={chercher} disabled={loading || !hotel}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors ml-1">
              {loading ? '…' : 'Rechercher →'}
            </button>
          </div>

          <div className="flex justify-center gap-6 mt-5 text-xs text-gray-500">
            {['✓ Meilleur tarif garanti','✓ Annulation flexible 48h','✓ Confirmation après paiement'].map(t => <span key={t}>{t}</span>)}
          </div>
        </div>
      </div>

      <footer className="border-t border-white/5 px-8 py-5 flex justify-between text-[10px] text-gray-600">
        <span>{nomAffiche} · Powered by <strong className="text-gray-500">7venHotel Cloud</strong></span>
        <div className="flex gap-4">
          <a href="#" className="hover:text-gray-400">Confidentialité</a>
          <a href="#" className="hover:text-gray-400">CGV</a>
        </div>
      </footer>
    </div>
  )
}
