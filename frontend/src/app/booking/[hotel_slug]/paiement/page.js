'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { bookingAPI } from '@/lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function BookingPaiement() {
  const { hotel_slug } = useParams()
  const [chambre,    setChambre]    = useState(null)
  const [search,     setSearch]     = useState({})
  const [hotelNom,   setHotelNom]   = useState('')
  const [client,     setClient]     = useState({ prenom: '', nom: '', email: '', telephone: '' })
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmMdp, setConfirmMdp] = useState('')
  const [loading,    setLoading]    = useState(false)
  const [erreur,     setErreur]     = useState('')

  useEffect(() => {
    const ch = JSON.parse(sessionStorage.getItem('bk_chambre') || 'null')
    const s  = JSON.parse(sessionStorage.getItem('bk_search')  || '{}')
    setChambre(ch)
    setSearch(s)
    setHotelNom(s.hotel_nom || '')
    if (s.telephone) setClient(c => ({ ...c, telephone: s.telephone }))
  }, [hotel_slug])

  async function lancerPaiement(e) {
    e?.preventDefault()
    if (!client.prenom || !client.nom || !client.email) {
      setErreur('Veuillez remplir vos coordonnées (prénom, nom, email)')
      return
    }
    if (!motDePasse || motDePasse.length < 6) {
      setErreur('Mot de passe : 6 caractères minimum')
      return
    }
    if (motDePasse !== confirmMdp) {
      setErreur('Les mots de passe ne correspondent pas')
      return
    }

    setLoading(true)
    setErreur('')

    try {
      // Étape 1 : créer la réservation (statut tentative) + compte client
      const { data: resa } = await bookingAPI.reserver({
        hotel_slug,
        client: {
          prenom:       client.prenom,
          nom:          client.nom,
          email:        client.email,
          telephone:    client.telephone,
          mot_de_passe: motDePasse,
        },
        chambre_id:    chambre?.id || '00000000-0000-0000-0000-000000000000',
        date_arrivee:  search.checkin,
        date_depart:   search.checkout,
        type_paiement: 'cinetpay',
      })

      // Stocker le token client pour l'espace client
      if (resa.token_client) localStorage.setItem('7vh_client_token', resa.token_client)

      // Étape 2 : initier le paiement CinetPay
      const res = await fetch(`${API_URL}/api/v1/paiement-online/init`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservation_id:   resa.id,
          montant:          resa.montant || chambre?.total,
          nom_client:       client.nom,
          prenom_client:    client.prenom,
          email_client:     client.email,
          telephone_client: client.telephone,
          hotel_slug,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.erreur || 'Erreur lors de l\'initiation du paiement')

      // Sauvegarder pour la page confirmation
      sessionStorage.setItem('bk_confirmation', JSON.stringify({
        ref:          resa.numero,
        statut:       'en_attente',
        transaction_id: data.transaction_id,
        client,
        chambre,
        total:        resa.montant || chambre?.total,
        checkin:      search.checkin,
        checkout:     search.checkout,
        identifiants: { email: client.email, motDePasse },
      }))

      if (data.sandbox) {
        // Mode développement : simuler le succès, aller à la confirmation
        window.location.href = `/booking/${hotel_slug}/confirmation?tx=${data.transaction_id}&sandbox=true`
      } else {
        // Production : rediriger vers la page CinetPay
        window.location.href = data.payment_url
      }
    } catch (err) {
      const msg = err?.response?.data?.erreur || err?.message || 'Erreur lors du paiement. Veuillez réessayer.'
      setErreur(msg)
      setLoading(false)
    }
  }

  if (!chambre) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center">
      <div className="text-center text-white">
        <div className="text-4xl mb-4">🛏</div>
        <div className="text-lg font-bold mb-3">Aucune chambre sélectionnée</div>
        <a href={`/booking/${hotel_slug}`} className="text-blue-400 text-sm">← Retour à la recherche</a>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#060810]">
      <nav className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <a href={`/booking/${hotel_slug}/resultats`} className="text-sm text-blue-400">← Retour</a>
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
        <div className="text-xs text-gray-500">🔒 Paiement sécurisé</div>
      </nav>

      <div className="flex justify-center gap-2 py-4 border-b border-white/5">
        {['✓ Chambre', '→ Paiement', '3. Confirmation'].map((s, i) => (
          <div key={s} className={`flex items-center gap-1 text-xs ${i === 1 ? 'text-blue-400 font-bold' : i === 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
            {s}{i < 2 && <span className="text-gray-700 mx-1">›</span>}
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-5 gap-6">
        <div className="col-span-3 space-y-5">

          {/* Coordonnées client */}
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black">1</span>
              Vos coordonnées
            </h3>
            {erreur && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg mb-3">
                {erreur}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {[['Prénom *', 'prenom', 'text'], ['Nom *', 'nom', 'text'], ['Email *', 'email', 'email'], ['Téléphone', 'telephone', 'tel']].map(([lbl, field, type]) => (
                <div key={field}>
                  <label className="text-[10.5px] text-gray-500 block mb-1">{lbl}</label>
                  <input
                    type={type}
                    value={client[field]}
                    onChange={e => setClient(p => ({ ...p, [field]: e.target.value }))}
                    className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 transition-colors"
                    placeholder={lbl.replace(' *', '')}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="text-[10.5px] text-gray-500 mb-2">Créez votre mot de passe pour accéder à votre espace client</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10.5px] text-gray-500 block mb-1">Mot de passe *</label>
                  <input
                    type="password"
                    value={motDePasse}
                    onChange={e => setMotDePasse(e.target.value)}
                    className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 transition-colors"
                    placeholder="6 caractères minimum"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] text-gray-500 block mb-1">Confirmer *</label>
                  <input
                    type="password"
                    value={confirmMdp}
                    onChange={e => setConfirmMdp(e.target.value)}
                    className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 transition-colors"
                    placeholder="Répéter le mot de passe"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Paiement CinetPay */}
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black">2</span>
              Paiement sécurisé
            </h3>

            {/* Moyens de paiement disponibles */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { icon: '📱', label: 'MTN MoMo',     sub: 'Mobile Money' },
                { icon: '🟠', label: 'Orange Money',  sub: 'Mobile Money' },
                { icon: '💳', label: 'Visa / Mastercard', sub: 'Carte bancaire' },
              ].map(m => (
                <div key={m.label} className="flex flex-col items-center gap-1 p-2.5 rounded-xl border border-white/10 bg-white/5">
                  <span className="text-xl">{m.icon}</span>
                  <span className="text-[9px] text-white font-medium text-center leading-tight">{m.label}</span>
                  <span className="text-[8px] text-gray-500">{m.sub}</span>
                </div>
              ))}
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 mb-3">
              <p className="text-[9.5px] text-blue-300 leading-relaxed">
                Vous serez redirigé vers la plateforme sécurisée CinetPay pour finaliser votre paiement.
                Choisissez votre moyen de paiement préféré parmi ceux disponibles.
              </p>
            </div>

            <p className="text-[9px] text-gray-500">
              Votre numéro de téléphone (champ ci-dessus) sera pré-rempli pour le paiement Mobile Money.
            </p>
          </div>

          <button
            onClick={lancerPaiement}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading
              ? <><span className="animate-spin">⏳</span> Traitement…</>
              : <>Procéder au paiement — {(chambre.total || 0).toLocaleString('fr-FR')} XAF →</>
            }
          </button>

          <p className="text-center text-[9px] text-gray-600">
            Paiement sécurisé par CinetPay · SSL 256-bit
          </p>
        </div>

        {/* Récapitulatif */}
        <div className="col-span-2">
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 sticky top-4">
            <div className="text-center py-4 text-5xl mb-3">🛏</div>
            <div className="font-black text-white text-center text-lg mb-1">{chambre.type}</div>
            <div className="text-xs text-gray-400 text-center mb-4">{hotelNom}</div>
            <div className="space-y-2 text-xs border-t border-white/5 pt-4">
              {[
                ['Arrivée',  search.checkin],
                ['Départ',   search.checkout],
                ['Durée',    `${chambre.nights || 1} nuit${chambre.nights > 1 ? 's' : ''}`],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between">
                  <span className="text-gray-400">{l}</span>
                  <span className="text-white font-medium">{v || '—'}</span>
                </div>
              ))}
              <div className="flex justify-between font-black text-sm border-t border-white/10 pt-2 mt-2">
                <span className="text-white">Total</span>
                <span className="text-blue-400">{(chambre.total || 0).toLocaleString('fr-FR')} XAF</span>
              </div>
            </div>
            <div className="text-[9.5px] text-gray-500 text-center mt-3">✓ Annulation gratuite jusqu&apos;à 48h avant</div>
          </div>
        </div>
      </div>
    </div>
  )
}
