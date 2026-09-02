'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { bookingAPI, API_ORIGIN } from '@/lib/api'

function calculerTotalClient(tarifNuit, nuits, taxes) {
  const totalHT = tarifNuit * nuits
  let totalTaxes = 0
  const detail = []
  for (const t of taxes) {
    const montant = t.type_taxe === 'pourcentage'
      ? Math.round(totalHT * (t.valeur / 100))
      : Math.round(t.valeur * nuits)
    totalTaxes += montant
    detail.push({ nom: t.nom, montant })
  }
  return { totalHT, totalTaxes, total: totalHT + totalTaxes, detail }
}

// Construit la liste complète des photos d'une chambre (room_photos + type_photos)
function getPhotos(ch) {
  const roomPhotos = (ch.room_photos || []).map(u => API_ORIGIN + u)
  const typePhotos = (ch.type_photos || []).map(u => API_ORIGIN + u)
  // Déduplique : les type_photos complètent si pas de room_photos
  return roomPhotos.length > 0 ? roomPhotos : typePhotos
}

// Lightbox plein écran
function Lightbox({ photos, index, onClose, onPrev, onNext, onGoTo }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowLeft')  onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Photo principale */}
      <img
        src={photos[index]}
        alt={`Photo ${index + 1}`}
        className="max-h-[85vh] max-w-[90vw] object-contain select-none rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      />

      {/* Fermer */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg transition-colors"
      >✕</button>

      {/* Compteur */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium bg-black/40 px-3 py-1 rounded-full">
        {index + 1} / {photos.length}
      </div>

      {/* Précédent */}
      {photos.length > 1 && (
        <button
          onClick={e => { e.stopPropagation(); onPrev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center text-xl transition-colors"
        >‹</button>
      )}

      {/* Suivant */}
      {photos.length > 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNext() }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center text-xl transition-colors"
        >›</button>
      )}

      {/* Miniatures */}
      {photos.length > 1 && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2"
          onClick={e => e.stopPropagation()}
        >
          {photos.map((p, i) => (
            <button
              key={i}
              onClick={() => onGoTo(i)}
              className={`w-12 h-8 rounded overflow-hidden border-2 transition-all ${i === index ? 'border-white scale-110' : 'border-white/20 opacity-50 hover:opacity-80'}`}
            >
              <img src={p} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Vignette photo interactive sur la carte
function PhotoCell({ photos, onOpenLightbox }) {
  const [hover, setHover] = useState(false)

  if (photos.length === 0) {
    return (
      <div className="w-48 h-44 bg-gradient-to-br from-[#111827] to-[#1a2235] flex flex-col items-center justify-center text-5xl flex-shrink-0 gap-2">
        <span>🛏</span>
        <span className="text-[9px] text-gray-600">Photo bientôt</span>
      </div>
    )
  }

  return (
    <div
      className="w-48 h-44 flex-shrink-0 overflow-hidden relative cursor-zoom-in group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpenLightbox(0)}
    >
      <img src={photos[0]} alt="chambre" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />

      {/* Overlay hover */}
      <div className={`absolute inset-0 bg-black/30 flex items-center justify-center transition-opacity duration-200 ${hover ? 'opacity-100' : 'opacity-0'}`}>
        <div className="text-white text-xs font-bold flex flex-col items-center gap-1">
          <span className="text-2xl">🔍</span>
          <span>{photos.length > 1 ? `${photos.length} photos` : 'Voir'}</span>
        </div>
      </div>

      {/* Badge compteur si plusieurs photos */}
      {photos.length > 1 && (
        <div className="absolute bottom-2 right-2 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
          <span>🖼</span>{photos.length}
        </div>
      )}
    </div>
  )
}

export default function BookingResultats() {
  const { hotel_slug } = useParams()
  const [chambres, setChambres] = useState([])
  const [taxes,    setTaxes]    = useState([])
  const [search,   setSearch]   = useState({})
  const [loading,  setLoading]  = useState(true)
  const [erreur,   setErreur]   = useState('')
  const [nights,   setNights]   = useState(1)
  const [hotelNom, setHotelNom] = useState('')

  // Lightbox state
  const [lightbox, setLightbox] = useState(null) // { photos: [], index: 0 }

  const closeLightbox = useCallback(() => setLightbox(null), [])
  const prevPhoto  = useCallback(() => setLightbox(l => l ? { ...l, index: (l.index - 1 + l.photos.length) % l.photos.length } : null), [])
  const nextPhoto  = useCallback(() => setLightbox(l => l ? { ...l, index: (l.index + 1) % l.photos.length } : null), [])
  const gotoPhoto  = useCallback((i) => setLightbox(l => l ? { ...l, index: i } : null), [])

  useEffect(() => {
    const s = JSON.parse(sessionStorage.getItem('bk_search') || '{}')
    setSearch(s)
    setHotelNom(s.hotel_nom || '')
    const n = s.checkin && s.checkout
      ? Math.max(1, Math.round((new Date(s.checkout) - new Date(s.checkin)) / 86400000))
      : 1
    setNights(n)
    charger(s, n)
  }, [hotel_slug])

  async function charger(s, n) {
    setErreur('')
    try {
      const { data } = await bookingAPI.disponibilite(hotel_slug, {
        date_arrivee: s.checkin, date_depart: s.checkout,
      })
      setChambres(data.chambres || [])
      setTaxes(data.taxes || [])
      if (data.hotel?.nom) setHotelNom(data.hotel.nom)
    } catch {
      setErreur('Service momentanément indisponible. Veuillez réessayer.')
      setChambres([])
      setTaxes([])
    } finally { setLoading(false) }
  }

  function selectionner(ch) {
    const { total, totalHT, totalTaxes, detail } = calculerTotalClient(ch.tarif_base, nights, taxes)
    sessionStorage.setItem('bk_chambre', JSON.stringify({
      ...ch, nights, total, totalHT, totalTaxes, detailTaxes: detail,
    }))
    window.location.href = `/booking/${hotel_slug}/paiement`
  }

  return (
    <div className="min-h-screen bg-[#060810]">
      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={closeLightbox}
          onPrev={prevPhoto}
          onNext={nextPhoto}
          onGoTo={gotoPhoto}
        />
      )}

      <nav className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <a href={`/booking/${hotel_slug}`} className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
          <span className="text-xs font-black text-white"><span className="text-blue-400">7ven</span>Hotel</span>
        </a>
        <div className="text-xs text-gray-400">
          {hotelNom && <span className="text-gray-500 mr-2">{hotelNom} ·</span>}
          {search.checkin} → {search.checkout} · {nights} nuit{nights>1?'s':''} · {search.personnes} pers.
        </div>
        <a href={`/booking/${hotel_slug}`} className="text-xs text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg">✏ Modifier</a>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-xl font-black text-white">Chambres disponibles</h1>
          <span className="text-sm text-gray-400">{chambres.length} chambre{chambres.length!==1?'s':''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" /></div>
        ) : erreur ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <div className="text-white font-bold mb-2">Erreur de connexion</div>
            <div className="text-gray-400 text-sm mb-4">{erreur}</div>
            <button onClick={() => charger(search, nights)} className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-xl">
              Réessayer
            </button>
          </div>
        ) : chambres.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="text-5xl mb-4">📅</div>
            <div className="text-white font-bold text-lg mb-2">Aucune chambre disponible</div>
            <div className="text-gray-400 text-sm mb-4">Toutes nos chambres sont occupées pour les dates sélectionnées.</div>
            <a href={`/booking/${hotel_slug}`} className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-5 py-2 rounded-xl">
              Modifier les dates
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {chambres.map(ch => {
              const { totalHT, totalTaxes, total, detail } = calculerTotalClient(ch.tarif_base, nights, taxes)
              const photos = getPhotos(ch)
              return (
                <div key={ch.id} className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden hover:border-blue-500/40 transition-all">
                  <div className="flex">
                    <PhotoCell
                      photos={photos}
                      onOpenLightbox={(i) => setLightbox({ photos, index: i })}
                    />
                    <div className="flex-1 p-5">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-white text-lg">{ch.type}</span>
                            {ch.numero && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20 font-bold">
                                Chambre {ch.numero}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">{ch.description}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-blue-400 font-black text-xl">{(ch.tarif_base||0).toLocaleString('fr-FR')} XAF</div>
                          <div className="text-[9px] text-gray-500">/ nuit · HT</div>
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
                          <span className="text-[10px] text-gray-500 ml-1">TTC · {nights} nuit{nights>1?'s':''}</span>
                          {detail.length > 0 && (
                            <div className="text-[9px] text-gray-600 mt-0.5">
                              HT {totalHT.toLocaleString('fr-FR')} + taxes {totalTaxes.toLocaleString('fr-FR')} XAF
                            </div>
                          )}
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
