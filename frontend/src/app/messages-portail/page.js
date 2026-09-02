'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { portailInboxAPI } from '@/lib/api'
import toast from 'react-hot-toast'

// ─────────────────────────────────────────────────────────────────────────────
// messages-portail/page.js
//
// Inbox réception — messages envoyés par les clients via le portail.
// Layout deux colonnes : liste conversations (gauche) + fil de messages (droite).
// Polling auto toutes les 30s pour les nouvelles conversations.
// ─────────────────────────────────────────────────────────────────────────────

function BulleMessage({ msg }) {
  const estStaff = msg.expediteur_type === 'staff' || msg.expediteur_type === 'reception'
  const heure    = msg.cree_le ? new Date(msg.cree_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
  const jour     = msg.cree_le ? new Date(msg.cree_le).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : ''

  return (
    <div className={`flex mb-3 ${estStaff ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] ${estStaff ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          estStaff
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-[var(--bg-3)] text-[var(--text-0)] border border-[var(--border-1)] rounded-bl-sm'
        }`}>
          {msg.corps}
        </div>
        <div className="text-[9.5px] text-[var(--text-4)] mt-1 px-1">
          {jour} {heure}
          {estStaff && <span className="ml-1 text-blue-400">· Réception</span>}
        </div>
      </div>
    </div>
  )
}

function CarteConversation({ conv, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl transition-colors border mb-1 ${
        active
          ? 'bg-blue-500/10 border-blue-500/30'
          : 'hover:bg-[var(--bg-3)] border-transparent hover:border-[var(--border-1)]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {(conv.nom_client || 'C').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[11.5px] font-bold text-[var(--text-0)] truncate">{conv.nom_client}</span>
            {conv.messages_non_lus > 0 && (
              <span className="ml-1 flex-shrink-0 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1">
                {conv.messages_non_lus}
              </span>
            )}
          </div>
          <div className="text-[10px] text-[var(--text-3)] mb-1">
            Ch. {conv.numero_chambre || '—'} · {conv.numero_reservation}
          </div>
          <div className="text-[10.5px] text-[var(--text-3)] truncate">{conv.dernier_message || '…'}</div>
        </div>
      </div>
    </button>
  )
}

export default function MessagesPortailPage() {
  const [conversations, setConversations]       = useState([])
  const [convActive, setConvActive]             = useState(null)
  const [messages, setMessages]                 = useState([])
  const [loadingConvs, setLoadingConvs]         = useState(true)
  const [loadingMessages, setLoadingMessages]   = useState(false)
  const [reponse, setReponse]                   = useState('')
  const [envoi, setEnvoi]                       = useState(false)
  const [recherche, setRecherche]               = useState('')
  const [appels, setAppels]                     = useState([])
  const filRef      = useRef(null)
  const pollingRef  = useRef(null)
  const appelsRef   = useRef(null)

  // ── Charger les conversations ───────────────────────────────────────────────
  const chargerConversations = useCallback(async (silencieux = false) => {
    if (!silencieux) setLoadingConvs(true)
    try {
      const { data } = await portailInboxAPI.inbox()
      setConversations(data.conversations || [])
    } catch {
      if (!silencieux) toast.error('Impossible de charger les conversations')
    } finally {
      if (!silencieux) setLoadingConvs(false)
    }
  }, [])

  // ── Charger les appels réception ────────────────────────────────────────────
  const chargerAppels = useCallback(async () => {
    try {
      const { data } = await portailInboxAPI.appels()
      setAppels(data.appels || [])
    } catch {
      // silencieux — alertes non critiques
    }
  }, [])

  // ── Polling 30s conversations + 15s appels ──────────────────────────────────
  useEffect(() => {
    chargerConversations()
    chargerAppels()
    pollingRef.current  = setInterval(() => chargerConversations(true), 30_000)
    appelsRef.current   = setInterval(chargerAppels, 15_000)
    return () => {
      clearInterval(pollingRef.current)
      clearInterval(appelsRef.current)
    }
  }, [chargerConversations, chargerAppels])

  // ── Scroll en bas du fil ────────────────────────────────────────────────────
  useEffect(() => {
    if (filRef.current) {
      filRef.current.scrollTop = filRef.current.scrollHeight
    }
  }, [messages])

  // ── Sélectionner une conversation ──────────────────────────────────────────
  async function ouvrirConversation(conv) {
    setConvActive(conv)
    setMessages([])
    setLoadingMessages(true)
    try {
      const { data } = await portailInboxAPI.messages(conv.reservation_id)
      setMessages(data.messages || [])
      // Mettre à jour le badge non-lus localement
      setConversations(cs => cs.map(c =>
        c.reservation_id === conv.reservation_id ? { ...c, messages_non_lus: 0 } : c
      ))
    } catch {
      toast.error('Impossible de charger les messages')
    } finally {
      setLoadingMessages(false)
    }
  }

  // ── Envoyer une réponse ────────────────────────────────────────────────────
  async function envoyerReponse(e) {
    e.preventDefault()
    if (!reponse.trim() || !convActive) return
    setEnvoi(true)
    try {
      const { data } = await portailInboxAPI.reply(convActive.reservation_id, reponse.trim())
      setMessages(ms => [...ms, data.message])
      setReponse('')
      // Rafraîchir les conversations en arrière-plan
      chargerConversations(true)
    } catch {
      toast.error('Envoi échoué, réessayez')
    } finally {
      setEnvoi(false)
    }
  }

  const convsFiltrees = conversations.filter(c =>
    !recherche ||
    c.nom_client?.toLowerCase().includes(recherche.toLowerCase()) ||
    c.numero_chambre?.includes(recherche) ||
    c.numero_reservation?.toLowerCase().includes(recherche.toLowerCase())
  )

  const totalNonLus = conversations.reduce((s, c) => s + (c.messages_non_lus || 0), 0)

  return (
    <AppLayout titre="Messages portail" sousTitre={totalNonLus > 0 ? `${totalNonLus} message${totalNonLus > 1 ? 's' : ''} non lu${totalNonLus > 1 ? 's' : ''}` : 'Messagerie clients'}>
      <div className="flex gap-0 h-[calc(100vh-120px)] rounded-2xl overflow-hidden border border-[var(--border-1)]">

        {/* ── Colonne gauche : liste conversations ─────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-r border-[var(--border-1)] flex flex-col bg-[var(--bg-1)]">
          <div className="p-3 border-b border-[var(--border-1)]">
            <input
              type="text"
              placeholder="Rechercher client, chambre…"
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              className="w-full bg-[var(--bg-3)] border border-[var(--border-1)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-0)] outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {appels.length > 0 && (
              <div className="bg-red-900/40 border border-red-500/50 rounded-xl p-3 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="animate-pulse text-lg">📞</span>
                  <span className="font-bold text-red-300 text-sm">
                    {appels.length} appel{appels.length > 1 ? 's' : ''} en attente
                  </span>
                </div>
                <div className="space-y-1">
                  {appels.map(a => (
                    <div key={a.id} className="flex items-center justify-between text-xs text-gray-300">
                      <span>Chambre {a.numero_chambre} · {new Date(a.cree_le).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</span>
                      <button
                        onClick={async () => {
                          await portailInboxAPI.traiterAppel(a.id)
                          chargerAppels()
                        }}
                        className="px-2 py-0.5 bg-red-700 hover:bg-red-600 rounded text-white ml-3">
                        Traité ✓
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {loadingConvs ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
              </div>
            ) : convsFiltrees.length === 0 ? (
              <div className="text-center py-10 text-[var(--text-4)]">
                <div className="text-3xl mb-2">📭</div>
                <div className="text-xs">Aucune conversation</div>
              </div>
            ) : (
              convsFiltrees.map(conv => (
                <CarteConversation
                  key={conv.reservation_id}
                  conv={conv}
                  active={convActive?.reservation_id === conv.reservation_id}
                  onClick={() => ouvrirConversation(conv)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Colonne droite : fil de messages ─────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-[var(--bg-0)]">
          {!convActive ? (
            <div className="flex-1 flex items-center justify-center text-[var(--text-4)]">
              <div className="text-center">
                <div className="text-5xl mb-4">💬</div>
                <div className="text-sm font-bold text-[var(--text-2)] mb-1">Sélectionnez une conversation</div>
                <div className="text-xs text-[var(--text-4)]">Les messages clients apparaissent ici en temps réel</div>
              </div>
            </div>
          ) : (
            <>
              {/* En-tête conversation */}
              <div className="px-5 py-3 border-b border-[var(--border-1)] bg-[var(--bg-1)] flex items-center justify-between flex-shrink-0">
                <div>
                  <div className="text-sm font-bold text-[var(--text-0)]">{convActive.nom_client}</div>
                  <div className="text-[10px] text-[var(--text-3)]">
                    Ch. {convActive.numero_chambre || '—'} · {convActive.numero_reservation}
                    {convActive.statut_reservation && (
                      <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${convActive.statut_reservation === 'arrivee' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                        {convActive.statut_reservation}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => chargerConversations(true).then(() => ouvrirConversation(convActive))}
                  className="text-[var(--text-4)] hover:text-[var(--text-0)] transition-colors text-xs px-2 py-1 rounded border border-[var(--border-1)] hover:border-[var(--border-2)]"
                  title="Rafraîchir"
                >
                  ↻
                </button>
              </div>

              {/* Fil de messages */}
              <div ref={filRef} className="flex-1 overflow-y-auto px-5 py-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-4)] text-xs">Aucun message dans cette conversation</div>
                ) : (
                  messages.map(msg => <BulleMessage key={msg.id} msg={msg} />)
                )}
              </div>

              {/* Zone de réponse */}
              <form onSubmit={envoyerReponse} className="p-3 border-t border-[var(--border-1)] bg-[var(--bg-1)] flex-shrink-0">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={reponse}
                    onChange={e => setReponse(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyerReponse(e) } }}
                    placeholder="Répondre au client… (Entrée pour envoyer, Maj+Entrée pour saut de ligne)"
                    rows={2}
                    maxLength={2000}
                    className="flex-1 bg-[var(--bg-3)] border border-[var(--border-1)] rounded-xl px-3 py-2 text-sm text-[var(--text-0)] outline-none focus:border-blue-500 transition-colors resize-none"
                  />
                  <button
                    type="submit"
                    disabled={envoi || !reponse.trim()}
                    className="btn btn-primary flex-shrink-0 h-10 px-4 disabled:opacity-50"
                  >
                    {envoi ? '…' : 'Répondre →'}
                  </button>
                </div>
                {reponse.length > 1800 && (
                  <div className="text-[9.5px] text-amber-400 mt-1 px-1">{2000 - reponse.length} caractères restants</div>
                )}
              </form>
            </>
          )}
        </div>

      </div>
    </AppLayout>
  )
}
