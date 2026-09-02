'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { aiAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'

const SUGGESTIONS = [
  { label: '📊 Occupation',  question: "Analyse du taux d'occupation cette semaine" },
  { label: '💰 RevPAR',      question: 'Comment améliorer le RevPAR de l\'hôtel ?' },
  { label: '🧹 Ménage',      question: 'Performance du housekeeping aujourd\'hui' },
  { label: '🔧 Maintenance', question: 'Tickets maintenance en cours' },
  { label: '📈 Prévisions',  question: 'Prévisions de recettes pour la semaine prochaine' },
]

function renderMd(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/•/g, '&bull;')
    .replace(/\n/g, '<br/>')
}

export default function OuwaloDrawer({ open, onClose }) {
  const hotel    = useAuthStore(s => s.hotel)
  const nomHotel = hotel?.nom || 'votre hôtel'

  const [messages, setMessages] = useState([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const chatRef     = useRef(null)
  const inputRef    = useRef(null)
  const initialized = useRef(false)

  useEffect(() => {
    if (open && !initialized.current) {
      initialized.current = true
      setMessages([{
        role: 'ai',
        content: `**Bonjour !** Je suis Ouwalou, votre assistant IA pour ${nomHotel}.\n\nPosez-moi n'importe quelle question sur vos opérations hôtelières.`,
      }])
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 250)
  }, [open, nomHotel])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  const envoyerMessage = useCallback(async (texte) => {
    const msg = (texte || input).trim()
    if (!msg || loading) return
    setInput('')
    const newMsgs = [...messages, { role: 'user', content: msg }]
    setMessages(newMsgs)
    setLoading(true)
    try {
      const historique = newMsgs.slice(-10).map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user', content: m.content,
      }))
      const { data } = await aiAPI.chat({ message: msg, historique })
      setMessages(prev => [...prev, { role: 'ai', content: data.reponse }])
    } catch (err) {
      const status = err?.response?.status
      let errMsg = '❌ Erreur de connexion. Réessayez.'
      if (status === 401 || status === 403)
        errMsg = '🔒 Session expirée. **Reconnectez-vous** pour utiliser l\'assistant.'
      else if (status === 503)
        errMsg = '⚠️ **Service IA temporairement indisponible.** Vérifiez la clé ANTHROPIC_API_KEY.'
      setMessages(prev => [...prev, { role: 'ai', content: errMsg }])
    } finally { setLoading(false) }
  }, [messages, input, loading])

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyerMessage() }
    if (e.key === 'Escape') onClose()
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-label="Ouwalou AI"
        className="fixed top-0 right-0 bottom-0 z-50 w-[420px] max-w-full flex flex-col bg-[var(--bg-1)] border-l border-[var(--border-1)] shadow-2xl"
        style={{
          transform:  open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-1)] flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-base shadow-lg shadow-blue-500/30 flex-shrink-0">
            🤖
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-[var(--text-1)]">Ouwalou AI</div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_#10B981] animate-pulse flex-shrink-0" />
              <span className="text-[9px] text-emerald-400">Actif · {nomHotel}</span>
            </div>
          </div>
          <a
            href="/ai"
            className="text-[10px] text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-blue-500/10 transition-colors whitespace-nowrap flex-shrink-0"
          >
            Vue complète →
          </a>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-[var(--bg-3)] text-[var(--text-3)] hover:text-[var(--text-1)] flex items-center justify-center text-sm transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Messages */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 items-start ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {m.role === 'ai' && (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs flex-shrink-0 shadow-md">
                  🤖
                </div>
              )}
              <div
                className={`rounded-xl px-3 py-2 text-xs leading-relaxed max-w-[85%] ${
                  m.role === 'user'
                    ? 'bg-blue-500 text-white rounded-tr-sm'
                    : 'bg-[var(--bg-3)] border border-[var(--border-1)] text-[var(--text-1)] rounded-tl-sm'
                }`}
                dangerouslySetInnerHTML={{ __html: renderMd(m.content) }}
              />
            </div>
          ))}
          {loading && (
            <div className="flex gap-2 items-start">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs flex-shrink-0">🤖</div>
              <div className="bg-[var(--bg-3)] border border-[var(--border-1)] rounded-xl rounded-tl-sm px-3 py-2.5 flex gap-1.5 items-center">
                {[0, 1, 2].map(n => (
                  <span
                    key={n}
                    className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce"
                    style={{ animationDelay: `${n * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Suggestions rapides */}
        <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto flex-shrink-0 scrollbar-none">
          {SUGGESTIONS.map(s => (
            <button
              key={s.label}
              onClick={() => envoyerMessage(s.question)}
              className="flex-shrink-0 text-[9.5px] px-2 py-1 rounded-full border border-[var(--border-2)] bg-[var(--bg-3)] text-[var(--text-2)] hover:border-blue-500 hover:text-blue-400 hover:bg-blue-500/5 transition-all whitespace-nowrap"
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="px-4 pb-4 flex-shrink-0">
          <div className="flex items-end gap-2 bg-[var(--bg-3)] border border-[var(--border-1)] rounded-xl px-3 py-2 focus-within:border-blue-500 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              placeholder="Posez votre question…"
              className="flex-1 bg-transparent text-xs text-[var(--text-1)] placeholder-[var(--text-4)] outline-none resize-none leading-relaxed"
              style={{ maxHeight: 80 }}
            />
            <button
              onClick={() => envoyerMessage()}
              disabled={!input.trim() || loading}
              className="w-7 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-white text-sm transition-colors flex-shrink-0 mb-0.5"
            >
              ↑
            </button>
          </div>
          <div className="text-[9px] text-[var(--text-4)] mt-1.5 text-center">
            Entrée pour envoyer · Maj+Entrée pour saut de ligne
          </div>
        </div>
      </div>
    </>
  )
}
