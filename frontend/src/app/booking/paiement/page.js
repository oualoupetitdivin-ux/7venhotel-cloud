'use client'
import { useState, useEffect } from 'react'
import { bookingAPI } from '../../../lib/api'

export default function BookingPaiement() {
  const [chambre, setChambre] = useState(null)
  const [search, setSearch]   = useState({})
  const [client, setClient]   = useState({ prenom:'', nom:'', email:'', telephone:'', creer_compte:true })
  const [paiement, setPaiement] = useState('carte')
  const [loading, setLoading]  = useState(false)
  const [erreur, setErreur]    = useState('')

  useEffect(() => {
    setChambre(JSON.parse(sessionStorage.getItem('bk_chambre') || 'null'))
    setSearch(JSON.parse(sessionStorage.getItem('bk_search') || '{}'))
  }, [])

  async function confirmer() {
    if (!client.prenom || !client.nom || !client.email) { setErreur('Veuillez remplir vos coordonnées'); return }
    setLoading(true); setErreur('')
    try {
      const { data } = await bookingAPI.reserver({
        hotel_slug: 'hotel-royal-yaounde',
        client: { prenom:client.prenom, nom:client.nom, email:client.email, telephone:client.telephone },
        chambre_id: chambre?.id || '00000000-0000-0000-0000-000000000000',
        date_arrivee: search.checkin, date_depart: search.checkout,
        tarif_nuit: chambre?.tarif_base || 0, total: chambre?.total || 0, paiement
      })
      sessionStorage.setItem('bk_confirmation', JSON.stringify({ ref: data.numero, client, chambre, total: chambre?.total }))
      if (data.token_client) localStorage.setItem('7vh_client_token', data.token_client)
      window.location.href = '/booking/confirmation'
    } catch {
      setErreur('Erreur lors de la réservation. Veuillez réessayer.')
    } finally { setLoading(false) }
  }

  if (!chambre) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center">
      <div className="text-center text-white">
        <div className="text-4xl mb-4">🛏</div>
        <div className="text-lg font-bold mb-3">Aucune chambre sélectionnée</div>
        <a href="/booking" className="text-blue-400 text-sm">← Retour à la recherche</a>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#060810]">
      <nav className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <a href="/booking/resultats" className="text-sm text-blue-400">← Retour</a>
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
        <div className="text-xs text-gray-500">🔒 Paiement sécurisé</div>
      </nav>

      {/* Wizard */}
      <div className="flex justify-center gap-2 py-4 border-b border-white/5">
        {['✓ Chambre','→ Paiement','3. Confirmation'].map((s,i) => (
          <div key={s} className={`flex items-center gap-1 text-xs ${i===1?'text-blue-400 font-bold':i===0?'text-emerald-400':' text-gray-600'}`}>
            {s}{i<2&&<span className="text-gray-700 mx-1">›</span>}
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-5 gap-6">
        <div className="col-span-3 space-y-5">
          {/* Coordonnées */}
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black">1</span>Vos coordonnées</h3>
            {erreur && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg mb-3">{erreur}</div>}
            <div className="grid grid-cols-2 gap-3">
              {[['Prénom *','prenom','text'],['Nom *','nom','text'],['Email *','email','email'],['Téléphone','telephone','tel']].map(([lbl,field,type]) => (
                <div key={field}>
                  <label className="text-[10.5px] text-gray-500 block mb-1">{lbl}</label>
                  <input type={type} value={client[field]} onChange={e => setClient(p => ({...p,[field]:e.target.value}))}
                    className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 transition-colors"
                    placeholder={lbl.replace(' *','')}
                  />
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={client.creer_compte} onChange={e => setClient(p => ({...p,creer_compte:e.target.checked}))} className="rounded" />
              <span className="text-xs text-gray-400">Créer un compte client (accès réservations & factures)</span>
            </label>
          </div>

          {/* Paiement */}
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black">2</span>Mode de paiement</h3>
            <div className="space-y-2">
              {[['carte','💳','Carte bancaire','Visa · Mastercard · Amex'],['mobile','📱','Mobile Money','MTN MoMo · Orange Money'],['hotel','🏨','À l'arrivée','Paiement à la réception']].map(([val,ico,lbl,sub]) => (
                <label key={val} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${paiement===val?'border-blue-500 bg-blue-500/10':'border-white/10 hover:border-white/20'}`}>
                  <input type="radio" name="paiement" value={val} checked={paiement===val} onChange={() => setPaiement(val)} className="hidden" />
                  <span className="text-xl">{ico}</span>
                  <div><div className="text-sm font-bold text-white">{lbl}</div><div className="text-[9.5px] text-gray-400">{sub}</div></div>
                </label>
              ))}
            </div>
          </div>

          <button onClick={confirmer} disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-3.5 rounded-xl transition-colors">
            {loading ? '⏳ Traitement…' : `🔒 Confirmer et réserver — ${(chambre.total||0).toLocaleString('fr-FR')} XAF`}
          </button>
        </div>

        {/* Récap */}
        <div className="col-span-2">
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 sticky top-4">
            <div className="text-center py-4 text-5xl mb-3">🛏</div>
            <div className="font-black text-white text-center text-lg mb-1">{chambre.type}</div>
            <div className="text-xs text-gray-400 text-center mb-4">Hôtel Royal Yaoundé</div>
            <div className="space-y-2 text-xs border-t border-white/5 pt-4">
              {[['Arrivée',search.checkin],['Départ',search.checkout],['Durée',`${chambre.nights||1} nuit${chambre.nights>1?'s':''}`]].map(([l,v]) => (
                <div key={l} className="flex justify-between"><span className="text-gray-400">{l}</span><span className="text-white font-medium">{v||'—'}</span></div>
              ))}
              <div className="flex justify-between font-black text-sm border-t border-white/10 pt-2 mt-2">
                <span className="text-white">Total</span>
                <span className="text-blue-400">{(chambre.total||0).toLocaleString('fr-FR')} XAF</span>
              </div>
            </div>
            <div className="text-[9.5px] text-gray-500 text-center mt-3">✓ Annulation gratuite jusqu&apos;à 48h avant</div>
          </div>
        </div>
      </div>
    </div>
  )
}
