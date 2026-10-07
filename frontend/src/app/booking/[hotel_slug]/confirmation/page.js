'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

// LOT-GUEST-01 — NEXT_PUBLIC_API_URL contient déjà /api/v1 (cf. lib/api.js).
// L'ancien préfixe `${API_URL}/api/v1/...` produisait /api/v1/api/v1/... → 404.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

// LOT-GUEST-01 — l'affichage suit l'ÉTAT SERVEUR (paiement + réservation PMS).
// Le mode sandbox (CinetPay non configuré) n'est JAMAIS présenté comme un paiement réussi :
// la réservation reste « en attente » tant que l'hôtel ne l'a pas confirmée.
export default function BookingConfirmation() {
  const { hotel_slug }  = useParams()
  const searchParams    = useSearchParams()
  const [conf, setConf] = useState(null)
  const [statut, setStatut] = useState(null)      // réponse /paiement-online/statut
  const [chargement, setChargement] = useState(true)
  const [erreurStatut, setErreurStatut] = useState(null)

  const tx = searchParams.get('tx')

  useEffect(() => {
    try { setConf(JSON.parse(sessionStorage.getItem('bk_confirmation') || 'null')) } catch { setConf(null) }
    if (!tx) { setChargement(false); return }
    fetch(`${API_URL}/paiement-online/statut/${encodeURIComponent(tx)}`)
      .then(async r => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error(d?.erreur || 'Transaction introuvable')
        return d
      })
      .then(d => setStatut(d))
      .catch(err => setErreurStatut(err.message))
      .finally(() => setChargement(false))
  }, [tx])

  const sandbox   = !!statut?.sandbox
  const confirmee = ['confirmee', 'arrivee', 'terminee'].includes(statut?.statut_reservation)
  const estReussi = !sandbox && statut?.statut === 'reussi' && confirmee
  const estEchoue = statut?.statut === 'echoue' || statut?.statut_reservation === 'annulee'
  const reference = statut?.numero_reservation || conf?.ref

  if (!conf && !tx) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
      <div className="text-white text-center">
        <div className="text-4xl mb-4">📋</div>
        <p className="text-gray-400 text-sm mb-4">Aucune réservation trouvée.</p>
        <a href={`/booking/${hotel_slug}`} className="text-blue-400 text-sm">← Nouvelle réservation</a>
      </div>
    </div>
  )

  if (chargement) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin"/>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">

        <div className="bg-[#111827] border border-white/10 rounded-3xl p-8 text-center mb-5" data-testid="statut-reservation">
          {estReussi ? (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-emerald-500/30">✓</div>
              <h1 className="text-2xl font-black text-white mb-2">Réservation confirmée !</h1>
              <p className="text-sm text-gray-400 mb-5">Votre paiement a été validé par l&apos;hôtel.</p>
            </>
          ) : estEchoue ? (
            <>
              <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-red-500/30">✕</div>
              <h1 className="text-2xl font-black text-white mb-2">
                {statut?.statut_reservation === 'annulee' ? 'Réservation expirée' : 'Paiement échoué'}
              </h1>
              <p className="text-sm text-gray-400 mb-5">
                {statut?.statut_reservation === 'annulee'
                  ? 'Le paiement n\'a pas été reçu dans le délai : la chambre a été libérée.'
                  : 'Le paiement n\'a pas pu être validé. Veuillez recommencer votre réservation.'}
              </p>
              <a href={`/booking/${hotel_slug}`}
                className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-6 py-2.5 rounded-xl transition-colors">
                Nouvelle réservation
              </a>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-amber-500/30">⏳</div>
              <h1 className="text-2xl font-black text-white mb-2">Réservation enregistrée — en attente</h1>
              {sandbox ? (
                <p className="text-sm text-amber-300 mb-2" data-testid="mention-sandbox">
                  Paiement en ligne non activé sur cet environnement (mode simulation) : aucun montant n&apos;a été débité.
                  Votre réservation sera confirmée par l&apos;hôtel.
                </p>
              ) : (
                <p className="text-sm text-gray-400 mb-2">
                  Votre réservation est enregistrée. Elle sera confirmée dès que le paiement aura été validé.
                </p>
              )}
              {erreurStatut && <p className="text-xs text-red-400 mb-2">Statut indisponible : {erreurStatut}</p>}
            </>
          )}

          {reference && (
            <div className="bg-[#1A2235] rounded-2xl px-5 py-3 inline-block mb-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Référence</div>
              <div className="text-xl font-black font-mono text-blue-400">{reference}</div>
            </div>
          )}
          {statut && (
            <p className="text-[9.5px] text-gray-600 mt-3">
              Paiement : {statut.statut} · Réservation : {statut.statut_reservation || '—'}
            </p>
          )}
        </div>

        {conf && (
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 mb-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Client',  `${conf.client?.prenom || ''} ${conf.client?.nom || ''}`],
                ['Chambre', conf.chambre?.type || '—'],
                ['Arrivée', conf.checkin || '—'],
                ['Départ',  conf.checkout || '—'],
                ['Total',   `${Number(statut?.montant || conf.total || 0).toLocaleString('fr-FR')} XAF`],
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="text-[9.5px] text-gray-500 uppercase mb-0.5">{l}</div>
                  <div className="text-white font-bold">{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {conf?.checkin_en_ligne_url && !estEchoue && (
          <div className="bg-[#111827] border border-blue-500/25 rounded-2xl p-5 mb-5">
            <div className="text-xs font-bold text-blue-400 mb-1">🛎 Check-in en ligne</div>
            <div className="text-[10px] text-gray-400 mb-3">
              Gagnez du temps à l&apos;arrivée : complétez vos informations dès que la réservation est confirmée.
            </div>
            <a href={conf.checkin_en_ligne_url} data-testid="lien-checkin"
              className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-xl">
              Faire mon check-in en ligne →
            </a>
          </div>
        )}

        {!estEchoue && (
          <div className="flex gap-3">
            <a href="/client-portal/connexion" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-3 rounded-xl text-center transition-colors">
              Accéder à mon espace →
            </a>
            <a href={`/booking/${hotel_slug}`} className="flex-1 border border-white/10 text-gray-400 hover:text-white text-sm font-medium py-3 rounded-xl text-center transition-colors">
              Nouvelle réservation
            </a>
          </div>
        )}
        {conf?.client?.email && (
          <p className="text-[10px] text-gray-500 text-center mt-4">
            Espace client : connectez-vous avec {conf.client.email} et le mot de passe choisi lors de la réservation.
          </p>
        )}
      </div>
    </div>
  )
}
