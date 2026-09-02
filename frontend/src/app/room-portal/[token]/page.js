'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'
const PORTAIL_TOKEN_KEY = '7vh_portail_session'

async function portailFetch(sessionToken, method, path, body) {
  const res = await fetch(`${API_BASE}/portail${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(new Error(err.erreur || 'Erreur portail'), {
      status: res.status,
      code:   err.code,
    })
  }
  return res.json()
}

function fmtHeure(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

const STATUT_DEMANDE = {
  nouvelle:       { bg:'bg-amber-500/20',   text:'text-amber-400',   label:'En attente' },
  en_cours:       { bg:'bg-blue-500/20',    text:'text-blue-400',    label:'En cours'   },
  traitee:        { bg:'bg-emerald-500/20', text:'text-emerald-400', label:'Traitée'    },
  annulee:        { bg:'bg-red-500/20',     text:'text-red-400',     label:'Annulée'    },
}

function BadgeStatut({ statut }) {
  const s = STATUT_DEMANDE[statut] || STATUT_DEMANDE.nouvelle
  return (
    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

export default function RoomPortal() {
  const { token } = useParams()

  const [session,      setSession]      = useState(null)
  const [sessionToken, setSessionToken] = useState(null)
  const [messages,     setMessages]     = useState([])
  const [demandes,     setDemandes]     = useState([])
  const [section,      setSection]      = useState('accueil')
  const [loading,      setLoading]      = useState(true)
  const [invalid,      setInvalid]      = useState(false)
  const [erreurMsg,    setErreurMsg]    = useState(null)

  const [msgText,    setMsgText]    = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const [feedback,   setFeedback]   = useState(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (token === 'demo') {
      setSession({
        numero_chambre: '401', nom_client: 'Émilie Rousseau',
        date_depart: '2026-12-31', telephone_hotel: '+237 222 123 456',
        nom_hotel: '7venHotel', ville_hotel: 'Kribi',
        tarif_nuit: 35000, total_hebergement: 105000, total_general: 105000,
        nombre_nuits: 3, devise: 'XAF',
      })
      setLoading(false)
      return
    }
    initialiserSession()
  }, [token])

  useEffect(() => {
    if (section === 'msg') {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }, [messages, section])

  async function initialiserSession() {
    try {
      // Étape 1 — Échange token QR → session_token (retry ×3)
      let session_token = null
      let lastErr = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const initRes = await fetch(`${API_BASE}/portail/${encodeURIComponent(token)}`)
          if (initRes.ok) {
            const body = await initRes.json()
            if (body.session_token) { session_token = body.session_token; break }
          }
          lastErr = new Error(`HTTP ${initRes.status}`)
        } catch (err) { lastErr = err }
        if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt))
      }
      if (!session_token) {
        setErreurMsg('QR invalide ou expiré')
        setInvalid(true)
        return
      }

      setSessionToken(session_token)
      try { localStorage.setItem(PORTAIL_TOKEN_KEY, session_token) } catch {}

      // Étape 2 — Charger le contexte (retry ×3)
      let contexte = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          contexte = await portailFetch(session_token, 'GET', '/context')
          break
        } catch (err) {
          if (attempt < 3) await new Promise(r => setTimeout(r, 400 * attempt))
        }
      }
      if (!contexte) {
        setErreurMsg('Erreur de chargement — réessayez')
        setInvalid(true)
        return
      }

      const r = contexte.reservation
      setSession({
        numero_chambre:    r.numero_chambre,
        nom_client:        r.nom_client,
        date_depart:       r.date_depart,
        telephone_hotel:   r.telephone_hotel,
        nom_hotel:         r.nom_hotel,
        ville_hotel:       r.ville_hotel,
        statut:            r.statut,
        tarif_nuit:        r.tarif_nuit,
        total_hebergement: r.total_hebergement,
        total_general:     r.total_general,
        nombre_nuits:      r.nombre_nuits,
        devise:            r.devise || 'XAF',
      })
      setMessages(contexte.messages || [])
      setDemandes(contexte.demandes_service || [])
    } finally {
      setLoading(false)
    }
  }

  async function envoyerMessage() {
    if (!msgText.trim() || msgSending || !sessionToken) return
    setMsgSending(true)
    try {
      await portailFetch(sessionToken, 'POST', '/messages', { corps: msgText.trim() })
      setMessages(prev => [...prev, {
        expediteur_type: 'client',
        corps: msgText.trim(),
        cree_le: new Date().toISOString(),
      }])
      setMsgText('')
    } catch (err) {
      afficherFeedback('err', err.message || 'Erreur d\'envoi — réessayez')
    } finally {
      setMsgSending(false)
    }
  }

  async function demanderService(typeService, description) {
    if (!sessionToken) return
    try {
      await portailFetch(sessionToken, 'POST', '/services', { type_service: typeService, description })
      setDemandes(prev => [{
        type_service: typeService,
        description,
        statut: 'nouvelle',
        cree_le: new Date().toISOString(),
      }, ...prev])
      afficherFeedback('ok', 'Demande envoyée ✓ Notre équipe intervient rapidement.')
    } catch (err) {
      afficherFeedback('err', err.message || 'Erreur — réessayez')
    }
  }

  function afficherFeedback(type, texte) {
    setFeedback({ type, texte })
    setTimeout(() => setFeedback(null), 4000)
  }

  function formatMontant(n) {
    if (!n) return '—'
    return Number(n).toLocaleString('fr-FR') + ' ' + (session?.devise || 'XAF')
  }

  if (loading) return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin"/>
    </div>
  )

  if (invalid) return (
    <div className="min-h-screen bg-[#060810] flex flex-col items-center justify-center text-center p-6">
      <div className="text-5xl mb-4">🔒</div>
      <h2 className="text-xl font-black text-white mb-2">
        {erreurMsg === 'Erreur de chargement — réessayez' ? 'Erreur de chargement' : 'Accès expiré'}
      </h2>
      <p className="text-sm text-gray-400 max-w-sm mb-6">
        {erreurMsg || 'Ce QR code n\'est plus valide. Le portail chambre est désactivé après le départ.'}
      </p>
      {erreurMsg === 'Erreur de chargement — réessayez'
        ? <button onClick={() => { setInvalid(false); setLoading(true); initialiserSession() }}
            className="bg-blue-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">Réessayer →</button>
        : <a href="/booking" className="bg-blue-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">Réserver un séjour →</a>
      }
    </div>
  )

  const villeHotel = session?.ville_hotel || 'Alentours'
  const badgeMsg = messages.filter(m => m.expediteur_type === 'reception').length

  const SERVICES = [
    { id:'food',  icone:'🍽', titre:'Room Service', sub:'Repas & boissons'  },
    { id:'hk',   icone:'🧹', titre:'Ménage',        sub:'Nettoyage & linge' },
    { id:'msg',  icone:'💬', titre:'Réception',     sub:'Messagerie directe', badge: badgeMsg > 0 ? badgeMsg : null },
    { id:'reco', icone:'🗺', titre: villeHotel,     sub:'Recommandations'  },
    { id:'folio',icone:'📋', titre:'Mon folio',     sub:'Mes consommations' },
  ]

  const DEMANDES_RAPIDES = [
    { type:'serviettes',     icone:'🛁', label:'Serviettes supplémentaires' },
    { type:'oreillers',      icone:'🛏', label:'Oreillers supplémentaires'  },
    { type:'glacons',        icone:'🧊', label:'Glaçons'                    },
    { type:'taxi',           icone:'🚕', label:'Commander un taxi'           },
    { type:'premiers_soins', icone:'💊', label:'Trousse premiers soins'      },
  ]

  return (
    <div style={{minHeight:'100vh', background:'linear-gradient(160deg,#060810,#0D1829)'}}>

      {/* Header sticky */}
      <div className="sticky top-0 z-10 bg-black/50 backdrop-blur-xl border-b border-white/5 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-xs">7</div>
          <div>
            <div className="text-xs font-bold text-white"><span className="text-blue-400">7ven</span>Hotel</div>
            <div className="text-[9px] text-gray-500">Portail Chambre</div>
          </div>
        </div>
        <a href={`tel:${(session?.telephone_hotel || '').replace(/\s/g,'')}`}
          className="text-xs text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg">
          📞 Réception
        </a>
      </div>

      {/* Toast feedback */}
      {feedback && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl
          ${feedback.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {feedback.texte}
        </div>
      )}

      <div style={{maxWidth:440, margin:'0 auto', padding:'20px 16px'}}>

        {/* Carte séjour */}
        <div className="text-center mb-7 p-5 rounded-2xl border border-blue-500/20" style={{background:'rgba(59,130,246,.08)'}}>
          <div className="inline-flex items-center gap-2 bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold px-4 py-1.5 rounded-full mb-3">
            🛏 Chambre {session?.numero_chambre}
          </div>
          <h2 className="text-lg font-black text-white mb-1">
            Bienvenue, {session?.nom_client?.split(' ')[0] || 'Client'} !
          </h2>
          <p className="text-xs text-gray-400">Départ prévu : {session?.date_depart}</p>
        </div>

        {/* ── Accueil ─────────────────────────────────────────────────────────── */}
        {section === 'accueil' && (
          <>
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-3">Services</div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {SERVICES.map(s => (
                <button key={s.id} onClick={() => setSection(s.id)}
                  className="relative bg-[#111827] border border-white/10 rounded-2xl p-5 flex flex-col items-center text-center hover:border-blue-500/40 transition-all">
                  <div className="text-3xl mb-2">{s.icone}</div>
                  <div className="text-sm font-bold text-white">{s.titre}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{s.sub}</div>
                  {s.badge && (
                    <span className="absolute top-2 right-2 min-w-[18px] h-[18px] bg-blue-500 rounded-full text-[8px] font-black text-white flex items-center justify-center px-0.5">
                      {s.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-3">Demandes rapides</div>
            <div className="bg-[#111827] border border-white/10 rounded-2xl overflow-hidden">
              {DEMANDES_RAPIDES.map((r, i, arr) => (
                <button key={r.type}
                  onClick={() => demanderService(r.type, r.label)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors ${i < arr.length - 1 ? 'border-b border-white/5' : ''}`}>
                  <span className="text-lg">{r.icone}</span>
                  <span className="text-xs text-gray-300">{r.label}</span>
                  <span className="ml-auto text-gray-600">›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Room Service ─────────────────────────────────────────────────────── */}
        {section === 'food' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-1">🍽 Room Service</h3>
            <div className="text-[9.5px] text-gray-500 text-center mb-4">⏱ Livraison en ~30 minutes</div>
            {[
              { icone:'☕', nom:'Café ou thé',         prix:800   },
              { icone:'🥐', nom:'Viennoiseries ×3',    prix:2800  },
              { icone:'🍳', nom:'Omelette du chef',    prix:3500  },
              { icone:'🥪', nom:'Club sandwich',       prix:4800  },
              { icone:'🥩', nom:'Entrecôte grillée',   prix:18500 },
              { icone:'🍊', nom:'Jus de fruits frais', prix:1800  },
              { icone:'💧', nom:'Eau minérale ×2',     prix:1200  },
            ].map(item => (
              <div key={item.nom} className="bg-[#111827] border border-white/10 rounded-xl p-3.5 mb-2 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{item.icone} {item.nom}</div>
                  <div className="text-[10px] text-blue-400 mt-0.5">
                    {item.prix.toLocaleString('fr-FR')} {session?.devise || 'XAF'}
                  </div>
                </div>
                <button
                  onClick={() => demanderService('room_service', `${item.icone} ${item.nom} — ${item.prix.toLocaleString('fr-FR')} ${session?.devise || 'XAF'}`)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
                  Commander
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Messagerie ───────────────────────────────────────────────────────── */}
        {section === 'msg' && (
          <div className="flex flex-col" style={{height:'calc(100vh - 200px)'}}>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1 flex-shrink-0">← Retour</button>
            <div className="flex-1 bg-[#111827] border border-white/10 rounded-2xl p-4 overflow-y-auto flex flex-col gap-3">
              {messages.length === 0 && (
                <div className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs flex-shrink-0">7</div>
                  <div className="bg-[#1A2235] rounded-xl p-3 text-xs text-gray-300 max-w-[85%]">
                    Bonjour ! Je suis disponible 24h/24 pour vous aider. 😊
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.expediteur_type === 'client' ? 'justify-end' : 'justify-start'}`}>
                  {m.expediteur_type !== 'client' && (
                    <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs flex-shrink-0">7</div>
                  )}
                  <div className={`rounded-xl p-3 text-xs max-w-[75%] ${m.expediteur_type === 'client' ? 'bg-blue-600 text-white' : 'bg-[#1A2235] text-gray-300'}`}>
                    <div>{m.corps}</div>
                    <div className={`text-[9px] mt-1 ${m.expediteur_type === 'client' ? 'text-blue-200' : 'text-gray-500'}`}>
                      {fmtHeure(m.cree_le)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef}/>
            </div>
            <div className="flex gap-2 mt-3 flex-shrink-0">
              <input
                className="flex-1 bg-[#111827] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-blue-500 transition-colors"
                placeholder="Votre message…"
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && envoyerMessage()}
              />
              <button
                onClick={envoyerMessage}
                disabled={msgSending || !msgText.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors">
                {msgSending ? '…' : 'Envoyer'}
              </button>
            </div>
          </div>
        )}

        {/* ── Ménage ───────────────────────────────────────────────────────────── */}
        {section === 'hk' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-4">🧹 Service Ménage</h3>
            {[
              { type:'menage_complet', icone:'🧹', label:'Ménage complet',      duree:'~45 minutes'   },
              { type:'faire_lit',      icone:'🛏', label:'Faire le lit',        duree:'~10 minutes'   },
              { type:'serviettes',     icone:'🛁', label:'Serviettes fraîches', duree:'~5 minutes'    },
              { type:'turndown',       icone:'🌙', label:'Couverture soir',      duree:'Service turndown' },
            ].map(s => (
              <button key={s.type}
                onClick={() => demanderService(s.type, s.label)}
                className="w-full bg-[#111827] border border-white/10 rounded-xl p-4 mb-2 flex items-center gap-3 hover:border-blue-500/40 transition-all text-left">
                <span className="text-2xl">{s.icone}</span>
                <div className="flex-1">
                  <div className="text-xs font-bold text-white">{s.label}</div>
                  <div className="text-[10px] text-gray-400">{s.duree}</div>
                </div>
                <span className="text-gray-600">›</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Recommandations ──────────────────────────────────────────────────── */}
        {section === 'reco' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-1">🗺 {villeHotel}</h3>
            <p className="text-[10px] text-gray-500 mb-4">Suggestions de l'équipe {session?.nom_hotel}</p>
            {[
              { cat:'🍽 Restaurants', items:['Chez le Pêcheur — Fruits de mer ★★★★★','La Côte Camerounaise — Cuisine locale ★★★★','Brasserie du Port — Poissons grillés ★★★★'] },
              { cat:'🏖 Plages & Nature', items:['Grande Plage de Kribi','Chutes de la Lobé — Cascade unique en Afrique','Réserve naturelle de Campo-Ma\'an'] },
              { cat:'🛍 Artisanat', items:['Marché artisanal de Kribi','Village de pêcheurs Bassa — Souvenirs','Sculptures et bijoux traditionnels'] },
            ].map(g => (
              <div key={g.cat} className="mb-4">
                <div className="text-xs font-bold text-white mb-2">{g.cat}</div>
                {g.items.map(item => (
                  <div key={item} className="bg-[#111827] border border-white/10 rounded-lg px-3 py-2.5 mb-1.5 text-xs text-gray-300">{item}</div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Folio ────────────────────────────────────────────────────────────── */}
        {section === 'folio' && (
          <div>
            <button onClick={() => setSection('accueil')} className="text-xs text-blue-400 mb-4 flex items-center gap-1">← Retour</button>
            <h3 className="text-base font-black text-white mb-4">📋 Mon Folio</h3>

            {/* Résumé hébergement */}
            <div className="bg-[#111827] border border-white/10 rounded-xl p-4 mb-4">
              <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-3">Récapitulatif séjour</div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-gray-400">
                  Hébergement ({session?.nombre_nuits || '—'} nuit{session?.nombre_nuits > 1 ? 's' : ''})
                </span>
                <span className="text-white font-bold">{formatMontant(session?.total_hebergement)}</span>
              </div>
              {demandes.some(d => d.type_service === 'room_service') && (
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-gray-400">Room Service</span>
                  <span className="text-white font-bold">
                    {demandes.filter(d => d.type_service === 'room_service').length} commande(s)
                  </span>
                </div>
              )}
              <div className="border-t border-white/10 mt-3 pt-3 flex justify-between">
                <span className="text-sm font-black text-white">Total estimé</span>
                <span className="text-sm font-black text-blue-400">{formatMontant(session?.total_general)}</span>
              </div>
            </div>

            {/* Historique demandes */}
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-500 mb-3">Historique des demandes</div>
            {demandes.length === 0 ? (
              <div className="text-center text-gray-500 text-xs py-8 bg-[#111827] border border-white/10 rounded-xl">
                Aucune demande enregistrée
              </div>
            ) : demandes.map((d, i) => (
              <div key={i} className="bg-[#111827] border border-white/10 rounded-xl p-3.5 mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white truncate pr-2">
                    {d.description || d.type_service}
                  </span>
                  <BadgeStatut statut={d.statut} />
                </div>
                <div className="text-[10px] text-gray-500">
                  {fmtDate(d.cree_le)} à {fmtHeure(d.cree_le)}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Bouton d'appel réception — flottant, visible partout */}
      {session && (
        <button
          onClick={() => demanderService('appel_reception', 'Appel depuis la chambre')}
          title="Appeler la réception"
          className="fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full bg-red-600 hover:bg-red-700
                     active:scale-95 transition-all shadow-2xl flex items-center justify-center text-2xl">
          📞
        </button>
      )}
    </div>
  )
}
