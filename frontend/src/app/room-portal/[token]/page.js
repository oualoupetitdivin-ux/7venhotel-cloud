'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

export default function RoomPortal() {
  const { token } = useParams()
  const [session, setSession]   = useState(null)
  const [section, setSection]   = useState('accueil')
  const [loading, setLoading]   = useState(true)
  const [invalid, setInvalid]   = useState(false)

  useEffect(() => {
    verifierToken()
  }, [token])

  async function verifierToken() {
    if (token === 'demo') {
      setSession({ numero_chambre:'401', nom_client:'Émilie Rousseau', date_depart:'2026-04-16', hotel_id:'demo' })
      setLoading(false); return
    }
    try {
      const { default: api } = await import('../../../lib/api')
      const { data } = await api.default.get(`/api/v1/portail/${token}`)
      setSession(data.session)
    } catch { setInvalid(true) }
    finally { setLoading(false) }
  }

  if (loading) return <div className="min-h-screen bg-[#060810] flex items-center justify-center"><div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin"/></div>

  if (invalid) return (
    <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center text-center p-6">
      <div className="text-5xl mb-4">🔒</div>
      <h2 className="text-xl font-black text-white mb-2">Accès expiré</h2>
      <p className="text-sm text-gray-400 max-w-sm mb-6">Ce QR code n'est plus valide. Le portail chambre est désactivé après le départ.</p>
      <a href="/booking" className="bg-blue-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">Réserver un séjour →</a>
    </div>
  )

  const SERVICES = [
    {id:'food',icone:'🍽',titre:'Room Service',sub:'Repas & boissons'},
    {id:'hk',icone:'🧹',titre:'Ménage',sub:'Nettoyage & serviettes'},
    {id:'msg',icone:'💬',titre:'Réception',sub:'Messagerie directe'},
    {id:'reco',icone:'🗺',titre:'Yaoundé',sub:'Recommandations'},
  ]

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(160deg,#060810,#0D1829)'}}>
      <div className="sticky top-0 z-10 bg-black/50 backdrop-blur-xl border-b border-white/5 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
          <div>
            <div className="text-xs font-bold text-white"><span className="text-blue-400">7ven</span>Hotel</div>
            <div className="text-[9px] text-gray-500">Portail Chambre</div>
          </div>
        </div>
        <button onClick={() => alert('Réception : +237 222 123 456')} className="text-xs text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg">📞 Réception</button>
      </div>

      <div style={{maxWidth:440,margin:'0 auto',padding:'20px 16px'}}>
        <div className="text-center mb-7 p-5 rounded-2xl border border-blue-500/20" style={{background:'rgba(59,130,246,.08)'}}>
          <div className="inline-flex items-center gap-2 bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold px-4 py-1.5 rounded-full mb-3">🛏 Chambre {session?.numero_chambre}</div>
          <h2 className="text-lg font-black text-white mb-1">Bienvenue, {session?.nom_client?.split(' ')[0] || 'Client'} !</h2>
          <p className="text-xs text-gray-400">Départ prévu : {session?.date_depart}</p>
        </div>

        {section === 'accueil' && (
          <>
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-3">Services</div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {SERVICES.map(s => (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className="bg-[#111827] border border-white/10 rounded-2xl p-5 flex flex-col items-center text-center hover:border-blue-500/40 transition-all">
                  <div className="text-3xl mb-2">{s.icone}</div>
                  <div className="text-sm font-bold text-white">{s.titre}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{s.sub}</div>
                </button>
              ))}
            </div>

            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-3">Demandes rapides</div>
            <div className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden">
              {['🛁 Serviettes supplémentaires','🛏 Oreillers supplémentaires','🧊 Glaçons','🚕 Commander un taxi','💊 Trousse premiers soins'].map((r,i,arr) => (
                <button key={r} onClick={() => alert(`Demande envoyée : ${r.slice(2)} ✓`)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors ${i<arr.length-1?'border-b border-white/5':''}`}>
                  <span className="text-lg">{r.slice(0,2)}</span>
                  <span className="text-xs text-gray-300">{r.slice(2)}</span>
                  <span className="ml-auto text-gray-600">›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {section === 'food' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-4">🍽 Room Service</h3>
            <div className="text-[9.5px] text-gray-500 text-center mb-4">⏱ Livraison en ~30 minutes</div>
            {[['☕ Café ou thé','800 XAF'],['🥐 Viennoiseries ×3','2 800 XAF'],['🍳 Omelette du chef','3 500 XAF'],['🥪 Club sandwich','4 800 XAF'],['🥩 Entrecôte grillée','18 500 XAF'],['🍊 Jus de fruits frais','1 800 XAF'],['💧 Eau minérale ×2','1 200 XAF']].map(([n,p]) => (
              <div key={n} className="bg-[#111827] border border-white/10 rounded-xl p-3.5 mb-2 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{n}</div>
                  <div className="text-[10px] text-blue-400 mt-0.5">{p}</div>
                </div>
                <button onClick={() => alert(`${n} commandé ! Livraison ~30min 🍽`)} className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">Commander</button>
              </div>
            ))}
          </div>
        )}

        {section === 'msg' && (
          <div className="flex flex-col" style={{height:'calc(100vh - 200px)'}}>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1 flex-shrink-0">← Retour</button>
            <div className="flex-1 bg-[#111827] border border-white/10 rounded-2xl p-4 overflow-y-auto">
              <div className="flex gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs flex-shrink-0">7</div>
                <div className="bg-[#1A2235] rounded-xl p-3 text-xs text-gray-300">Bonjour ! Je suis disponible 24h/24 pour vous aider. 😊</div>
              </div>
            </div>
            <div className="flex gap-2 mt-3 flex-shrink-0">
              <input className="flex-1 bg-[#111827] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 transition-colors" placeholder="Votre message…" />
              <button className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-xl">Envoyer</button>
            </div>
          </div>
        )}

        {section === 'hk' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-4">🧹 Service Ménage</h3>
            {[['🧹 Ménage complet','~45 minutes'],['🛏 Faire le lit','~10 minutes'],['🛁 Serviettes fraîches','~5 minutes'],['🌙 Couverture soir','Service turndown']].map(([s,d]) => (
              <button key={s} onClick={() => alert(`Demande envoyée : ${s} ✓`)} className="w-full bg-[#111827] border border-white/10 rounded-xl p-4 mb-2 flex items-center gap-3 hover:border-blue-500/40 transition-all text-left">
                <span className="text-2xl">{s.slice(0,2)}</span>
                <div><div className="text-xs font-bold text-white">{s.slice(2)}</div><div className="text-[10px] text-gray-400">{d}</div></div>
                <span className="ml-auto text-gray-600">›</span>
              </button>
            ))}
          </div>
        )}

        {section === 'reco' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-4">🗺 Yaoundé</h3>
            {[
              {cat:'🍽 Restaurants',items:['Mets & Vins — Gastronomique ★★★★★','Le Palais des Saveurs — Camerounais ★★★★★','Chez Laure — Fruits de mer ★★★★']},
              {cat:'🏛 Culture',items:['Musée National du Cameroun','Mont Fébé — Panorama 360°','Palais des Congrès']},
              {cat:'🛍 Shopping',items:['Marché Central — Artisanat','Mall Oasis — Boutiques','Village Artisanal Mvog-Ada']},
            ].map(g => (
              <div key={g.cat} className="mb-4">
                <div className="text-xs font-bold text-white mb-2">{g.cat}</div>
                {g.items.map(i => (
                  <div key={i} className="bg-[#111827] border border-white/10 rounded-lg px-3 py-2.5 mb-1.5 text-xs text-gray-300">{i}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
