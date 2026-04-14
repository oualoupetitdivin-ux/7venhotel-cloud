'use client'
import { useState, useEffect } from 'react'
import { portailClientAPI, authAPI } from '../../lib/api'

export default function ClientPortal() {
  const [client, setClient] = useState(null)
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('dashboard')

  useEffect(() => {
    const token = localStorage.getItem('7vh_client_token')
    if (!token) { window.location.href = '/client-portal/connexion'; return }
    charger()
  }, [])

  async function charger() {
    try {
      const [profRes, resRes] = await Promise.allSettled([portailClientAPI.profil(), portailClientAPI.reservations()])
      if (profRes.status === 'fulfilled') setClient(profRes.value.data.client)
      if (resRes.status === 'fulfilled') setReservations(resRes.value.data.reservations || [])
    } catch { window.location.href = '/client-portal/connexion' }
    finally { setLoading(false) }
  }

  const nav = [
    {id:'dashboard',label:'⊞ Tableau de bord'},{id:'reservations',label:'📋 Réservations'},
    {id:'factures',label:'🧾 Factures'},{id:'profil',label:'👤 Profil'},{id:'offres',label:'🎁 Offres'},
  ]

  function logout() {
    localStorage.removeItem('7vh_client_token')
    window.location.href = '/client-portal/connexion'
  }

  if (loading) return <div className="min-h-screen bg-[#060810] flex items-center justify-center"><div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin"/></div>

  return (
    <div className="min-h-screen bg-[#060810] flex">
      {/* Sidebar client */}
      <div className="w-52 bg-[#0B0F1A] border-r border-white/5 flex flex-col">
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
            <span className="text-xs font-bold text-white"><span className="text-blue-400">7ven</span>Hotel</span>
          </div>
          {client && (
            <div className="flex items-center gap-2 p-2 bg-[#111827] rounded-lg">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {(client.prenom?.[0]||'')+(client.nom?.[0]||'')}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{client.prenom} {client.nom}</div>
                <div className="text-[9px] text-amber-400">🏆 {client.niveau_fidelite||'Bronze'}</div>
              </div>
            </div>
          )}
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {nav.map(n => (
            <button key={n.id} onClick={() => setSection(n.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${section===n.id?'bg-blue-500/15 text-blue-400 font-bold':'text-gray-400 hover:text-white hover:bg-white/5'}`}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/5 space-y-1">
          <a href="/booking" className="block w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 px-3 rounded-lg text-center transition-colors">＋ Réserver</a>
          <button onClick={logout} className="w-full text-xs text-gray-500 hover:text-white py-1.5 transition-colors">⎋ Déconnexion</button>
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 p-8">
        {section === 'dashboard' && (
          <div>
            <h1 className="text-xl font-black text-white mb-2">Bonjour, {client?.prenom || 'Client'} 👋</h1>
            <p className="text-sm text-gray-400 mb-6">Hôtel Royal Yaoundé · Espace client</p>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[[client?.nombre_sejours||0,'Séjours','border-blue-500'],[client?.points_fidelite||0,'Points fidélité','border-amber-500'],[(reservations.filter(r=>r.statut==='confirmee').length),'À venir','border-emerald-500'],['Gold','Statut','border-purple-500']].map(([v,l,b]) => (
                <div key={l} className={`bg-[#111827] border border-white/10 border-b-2 ${b} rounded-xl p-4 text-center`}>
                  <div className="text-xl font-black text-white mb-1">{v}</div>
                  <div className="text-[9.5px] text-gray-500 uppercase tracking-wider">{l}</div>
                </div>
              ))}
            </div>
            {/* Check-in en ligne */}
            <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/20 border border-blue-500/20 rounded-2xl p-5 flex items-center gap-4">
              <span className="text-4xl">📲</span>
              <div className="flex-1">
                <div className="text-sm font-bold text-white mb-1">Check-in en ligne disponible</div>
                <div className="text-xs text-gray-400">Évitez la file d'attente à la réception. Disponible 24h avant votre arrivée.</div>
              </div>
              <button className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors">Check-in →</button>
            </div>
          </div>
        )}

        {section === 'reservations' && (
          <div>
            <h1 className="text-xl font-black text-white mb-5">📋 Mes réservations</h1>
            {reservations.length ? reservations.map(r => (
              <div key={r.id} className="bg-[#111827] border border-white/10 rounded-2xl p-5 mb-3 flex items-center gap-4">
                <div className="text-3xl">🛏</div>
                <div className="flex-1">
                  <div className="font-bold text-white">{r.type_chambre || r.numero_chambre || 'Chambre'}</div>
                  <div className="text-xs text-gray-400 mt-0.5">📅 {r.date_arrivee} → {r.date_depart}</div>
                  <span className={`inline-block mt-1 text-[9.5px] font-bold px-2 py-0.5 rounded-full ${r.statut==='confirmee'?'bg-blue-500/20 text-blue-400':r.statut==='arrivee'?'bg-emerald-500/20 text-emerald-400':'bg-gray-500/20 text-gray-400'}`}>{r.statut}</span>
                </div>
                <div className="text-right">
                  <div className="text-white font-black">{(r.total_general||0).toLocaleString('fr-FR')} {r.devise||'XAF'}</div>
                  <div className="text-[9.5px] text-gray-500 mt-0.5">{r.numero_reservation}</div>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-4">📋</div>
                <div className="font-bold mb-2">Aucune réservation</div>
                <a href="/booking" className="text-blue-400 text-sm">Réserver maintenant →</a>
              </div>
            )}
          </div>
        )}

        {section === 'offres' && (
          <div>
            <h1 className="text-xl font-black text-white mb-5">🎁 Offres & Promotions</h1>
            <div className="grid grid-cols-3 gap-4">
              {[
                {titre:'Escapade Week-end',remise:'15%',code:'WEEKEND15',exp:'30 Avr 2026',couleur:'#3B82F6'},
                {titre:'Offre Romantique',  remise:'20%',code:'LOVE20',   exp:'14 Jun 2026',couleur:'#EC4899'},
                {titre:'Tarif Corporate',  remise:'25%',code:'CORP25',   exp:'31 Déc 2026',couleur:'#10B981'},
                {titre:'Réservation Anticipée',remise:'30%',code:'EARLY30',exp:'31 Déc 2026',couleur:'#8B5CF6'},
                {titre:'Gold Member',      remise:'12%',code:'GOLD12',   exp:'31 Déc 2026',couleur:'#F59E0B'},
                {titre:'Famille Heureuse', remise:'10%',code:'FAMILY10', exp:'31 Aoû 2026',couleur:'#06B6D4'},
              ].map(o => (
                <div key={o.code} className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden hover:border-white/20 transition-all">
                  <div className="h-20 flex items-center justify-center relative" style={{background:`linear-gradient(135deg,${o.couleur}22,${o.couleur}44)`}}>
                    <div className="absolute top-2 right-2 text-[10px] font-black text-white px-2 py-0.5 rounded-full" style={{background:o.couleur}}>{o.remise} OFF</div>
                    <div className="text-3xl">🎁</div>
                  </div>
                  <div className="p-4">
                    <div className="font-bold text-white text-sm mb-2">{o.titre}</div>
                    <div className="flex justify-between items-center mb-3">
                      <div className="font-mono text-xs font-bold border border-dashed border-white/20 px-2 py-1 rounded text-gray-300">{o.code}</div>
                      <div className="text-[9.5px] text-gray-500">Exp. {o.exp}</div>
                    </div>
                    <button onClick={() => { sessionStorage.setItem('bk_promo',o.code); window.location.href='/booking' }}
                      className="w-full text-xs font-bold py-2 rounded-lg text-white transition-colors" style={{background:o.couleur}}>
                      Utiliser cette offre →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'profil' && client && (
          <div>
            <h1 className="text-xl font-black text-white mb-5">👤 Mon profil</h1>
            <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 max-w-lg">
              <div className="grid grid-cols-2 gap-4">
                {[['Prénom','prenom'],['Nom','nom'],['Email','email'],['Téléphone','telephone']].map(([l,f]) => (
                  <div key={f}>
                    <label className="text-[10px] text-gray-500 block mb-1 uppercase">{l}</label>
                    <div className="bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-xs text-white">{client[f]||'—'}</div>
                  </div>
                ))}
              </div>
              <button className="mt-4 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">Modifier le profil</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
