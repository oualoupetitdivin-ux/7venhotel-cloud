'use client'
import { useState, useEffect } from 'react'
import { bookingAPI, chambresAPI } from '../../../lib/api'

export default function BookingResultats() {
  const [chambres, setChambres] = useState([])
  const [search, setSearch]     = useState({})
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    const s = JSON.parse(sessionStorage.getItem('bk_search') || '{}')
    setSearch(s)
    const nights = s.checkin && s.checkout ? Math.max(1, Math.round((new Date(s.checkout)-new Date(s.checkin))/86400000)) : 1
    setNights(nights)
    charger(s, nights)
  }, [])

  const [nights, setNights] = useState(1)

  async function charger(s, n) {
    try {
      const { data } = await bookingAPI.disponibilite('hotel-royal-yaounde', {
        date_arrivee: s.checkin, date_depart: s.checkout
      })
      setChambres(data.chambres || CHAMBRES_DEMO)
    } catch { setChambres(CHAMBRES_DEMO) }
    finally { setLoading(false) }
  }

  const CHAMBRES_DEMO = [
    { id:'1', type:'Standard',     tarif_base:22000, description:'Chambre confortable 18m²', capacite_adultes:2, superficie_m2:18, amenagements:['WiFi','Clim','TV'] },
    { id:'2', type:'Supérieure',   tarif_base:28000, description:'Chambre spacieuse 24m²',  capacite_adultes:2, superficie_m2:24, amenagements:['WiFi','Clim','TV','Mini-bar'] },
    { id:'3', type:'Deluxe',       tarif_base:38000, description:'Vue piscine & balcon',    capacite_adultes:2, superficie_m2:32, amenagements:['WiFi','Clim','TV','Mini-bar','Balcon'] },
    { id:'4', type:'Junior Suite', tarif_base:55000, description:'Suite avec salon',        capacite_adultes:3, superficie_m2:45, amenagements:['WiFi','Clim','TV','Mini-bar','Jacuzzi','Salon'] },
    { id:'5', type:'Suite Royale', tarif_base:98000, description:'Yaoundé 360° · 2 ch.',   capacite_adultes:4, superficie_m2:72, amenagements:['WiFi','Clim','TV','Mini-bar','Jacuzzi','Butler'] },
  ]

  function selectionner(ch) {
    sessionStorage.setItem('bk_chambre', JSON.stringify({ ...ch, nights, total: Math.round(ch.tarif_base * nights * 1.1) }))
    window.location.href = '/booking/paiement'
  }

  return (
    <div className="min-h-screen bg-[#060810]">
      <nav className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <a href="/booking" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
          <span className="text-xs font-black text-white"><span className="text-blue-400">7ven</span>Hotel</span>
        </a>
        <div className="text-xs text-gray-400">{search.checkin} → {search.checkout} · {nights} nuit{nights>1?'s':''} · {search.personnes} pers.</div>
        <a href="/booking" className="text-xs text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg">✏ Modifier</a>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-black text-white">Chambres disponibles</h1>
          <span className="text-sm text-gray-400">{chambres.length} chambre{chambres.length!==1?'s':''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {chambres.map(ch => {
              const total = Math.round(ch.tarif_base * nights * 1.1)
              return (
                <div key={ch.id} className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden hover:border-blue-500/40 transition-all">
                  <div className="flex">
                    <div className="w-48 h-44 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center text-5xl flex-shrink-0">🛏</div>
                    <div className="flex-1 p-5">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-black text-white text-lg">{ch.type}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{ch.description}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-blue-400 font-black text-xl">{(ch.tarif_base||0).toLocaleString('fr-FR')} XAF</div>
                          <div className="text-[9px] text-gray-500">/ nuit · taxes incluses</div>
                        </div>
                      </div>
                      <div className="flex gap-4 text-xs text-gray-400 mb-3">
                        <span>📐 {ch.superficie_m2}m²</span>
                        <span>👤 {ch.capacite_adultes} pers. max</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap mb-4">
                        {(ch.amenagements||[]).slice(0,6).map(a => (
                          <span key={a} className="text-[9.5px] px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/5">✓ {a}</span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-white font-black text-lg">{total.toLocaleString('fr-FR')} XAF</span>
                          <span className="text-[10px] text-gray-500 ml-1">total {nights} nuit{nights>1?'s':''}</span>
                        </div>
                        <button onClick={() => selectionner(ch)} className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors">
                          Réserver →
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
