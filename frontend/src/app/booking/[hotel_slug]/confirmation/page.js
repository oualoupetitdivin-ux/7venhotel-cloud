'use client'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function BookingConfirmation() {
  const { hotel_slug }  = useParams()
  const searchParams    = useSearchParams()
  const [conf, setConf] = useState(null)
  const [paiementStatut, setPaiementStatut] = useState(null) // 'reussi' | 'echoue' | 'en_attente' | 'sandbox'

  useEffect(() => {
    // Charger les données de la réservation depuis sessionStorage
    const stored = JSON.parse(sessionStorage.getItem('bk_confirmation') || 'null')
    setConf(stored)

    // Vérifier le statut CinetPay si query param ?tx est présent
    const tx      = searchParams.get('tx')
    const sandbox = searchParams.get('sandbox')

    if (tx && sandbox) {
      // Mode sandbox : paiement simulé
      setPaiementStatut('sandbox')
    } else if (tx) {
      // Production : interroger l'API pour le statut réel
      fetch(`${API_URL}/api/v1/paiement-online/statut/${tx}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.statut) setPaiementStatut(d.statut)
        })
        .catch(() => {/* silencieux — on affichera l'état stored */})
    }
  }, [hotel_slug, searchParams])

  // Déterminer l'état d'affichage
  const txParam      = searchParams.get('tx')
  const sandboxParam = searchParams.get('sandbox')
  const viaCinetPay  = !!txParam

  // Statut effectif pour l'affichage
  const statutEffectif = viaCinetPay
    ? (paiementStatut || 'en_attente')
    : (conf?.statut || 'en_attente')

  const estReussi    = statutEffectif === 'reussi' || statutEffectif === 'sandbox' || statutEffectif === 'confirmee'
  const estEchoue    = statutEffectif === 'echoue'
  const enAttente    = !estReussi && !estEchoue

  // Fallback si aucune donnée en session (accès direct par URL CinetPay return)
  if (!conf && !txParam) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center">
      <div className="text-white text-center">
        <div className="text-4xl mb-4">📋</div>
        <p className="text-gray-400 text-sm mb-4">Aucune réservation trouvée.</p>
        <a href={`/booking/${hotel_slug}`} className="text-blue-400 text-sm">← Nouvelle réservation</a>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Carte statut paiement */}
        <div className="bg-[#111827] border border-white/10 rounded-3xl p-8 text-center mb-5">
          {estReussi ? (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-emerald-500/30">✓</div>
              <h1 className="text-2xl font-black text-white mb-2">
                {sandboxParam ? 'Paiement simulé (sandbox)' : 'Réservation confirmée !'}
              </h1>
              <p className="text-sm text-gray-400 mb-5">
                {sandboxParam
                  ? 'Mode développement — le paiement CinetPay sera actif en production.'
                  : 'Votre paiement a été validé. Un email de confirmation vous a été envoyé.'}
              </p>
            </>
          ) : estEchoue ? (
            <>
              <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-red-500/30">✕</div>
              <h1 className="text-2xl font-black text-white mb-2">Paiement échoué</h1>
              <p className="text-sm text-gray-400 mb-5">
                Le paiement n&apos;a pas pu être validé. Veuillez réessayer ou choisir un autre moyen de paiement.
              </p>
              <a
                href={`/booking/${hotel_slug}/paiement`}
                className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-6 py-2.5 rounded-xl transition-colors"
              >
                Réessayer le paiement
              </a>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-500 flex items-center justify-center text-3xl mx-auto mb-5 shadow-xl shadow-amber-500/30">⏳</div>
              <h1 className="text-2xl font-black text-white mb-2">Paiement en cours de traitement</h1>
              <p className="text-sm text-gray-400 mb-2">
                Votre réservation est enregistrée. Finalisez le paiement sur la plateforme CinetPay pour confirmer.
              </p>
              <p className="text-xs text-amber-400 mb-5">
                La confirmation vous sera envoyée par email dès que le paiement sera validé.
              </p>
            </>
          )}

          {/* Référence */}
          {(conf?.ref || txParam) && (
            <div className="bg-[#1A2235] rounded-2xl px-5 py-3 inline-block mb-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">
                {txParam ? 'Transaction' : 'Référence'}
              </div>
              <div className="text-xl font-black font-mono text-blue-400">
                {conf?.ref || txParam}
              </div>
            </div>
          )}

          {enAttente && !estEchoue && (
            <p className="text-[9.5px] text-gray-600 mt-3">
              Statut : en attente de confirmation CinetPay
            </p>
          )}
        </div>

        {/* Détails réservation (si disponibles via sessionStorage) */}
        {conf && (
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5 mb-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Client',  `${conf.client?.prenom || ''} ${conf.client?.nom || ''}`],
                ['Chambre', conf.chambre?.type || '—'],
                ['Arrivée', conf.checkin || '—'],
                ['Départ',  conf.checkout || '—'],
                ['Total',   `${(conf.total || 0).toLocaleString('fr-FR')} XAF`],
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="text-[9.5px] text-gray-500 uppercase mb-0.5">{l}</div>
                  <div className="text-white font-bold">{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Identifiants espace client */}
        {conf?.identifiants && (
          <div className="bg-[#111827] border border-emerald-500/25 rounded-2xl p-5 mb-5">
            <div className="text-xs font-bold text-emerald-400 mb-1">🔐 Vos identifiants de connexion</div>
            <div className="text-[9.5px] text-gray-500 mb-3">Notez-les pour accéder à votre espace client depuis n&apos;importe quel appareil.</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center py-1.5 border-b border-white/5">
                <span className="text-[9.5px] text-gray-500 uppercase tracking-wide">Email</span>
                <span className="text-white text-xs font-mono">{conf.identifiants.email}</span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-[9.5px] text-gray-500 uppercase tracking-wide">Mot de passe</span>
                <span className="text-white text-xs font-mono">{conf.identifiants.motDePasse}</span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
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
      </div>
    </div>
  )
}
