'use client'
import { useState, useEffect, useRef } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { aiAPI, analyticsAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'

const SUGGESTIONS = [
  { label: "📊 Occupation", question: "Analyse détaillée du taux d'occupation cette semaine" },
  { label: "💰 RevPAR",     question: "Comment augmenter le RevPAR de l'hôtel ?" },
  { label: "🧹 Ménage",     question: "Performance et délais du staff housekeeping" },
  { label: "🔧 Maintenance",question: "État des tickets maintenance en cours" },
  { label: "📈 Prévisions", question: "Prévisions de recettes pour la semaine prochaine" },
  { label: "⭐ Satisfaction",question: "Analyse de la satisfaction client" },
]

export default function AIPage() {
  const hotel = useAuthStore(s => s.hotel)

  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [alertes, setAlertes]     = useState([])
  const [recos, setRecos]         = useState([])
  const [previsions, setPrevisions] = useState([])
  const [kpis, setKpis]           = useState(null)
  const chatRef = useRef(null)

  const nomHotel = hotel?.nom || 'votre hôtel'

  useEffect(() => {
    chargerDonnees()
    setMessages([{
      role: 'ai',
      content: `**Bonjour ! Je suis Ouwalou**, votre assistant IA pour ${nomHotel}. 🤖\n\nJ'analyse vos données opérationnelles en temps réel pour vous fournir des recommandations actionnables.\n\n**Aujourd'hui, je surveille :**\n• Taux d'occupation et tendances RevPAR\n• Performance housekeeping et délais\n• Tickets maintenance urgents\n• Prévisions revenus\n\nComment puis-je vous aider ?`
    }])
  }, [nomHotel])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  async function chargerDonnees() {
    try {
      const [aRes, rRes, pRes, kpiRes] = await Promise.allSettled([
        aiAPI.alertes(), aiAPI.recommandations(), aiAPI.previsions(),
        analyticsAPI.dashboard()
      ])
      if (aRes.status === 'fulfilled') setAlertes(aRes.value.data.alertes || [])
      if (rRes.status === 'fulfilled') setRecos(rRes.value.data.recommandations || [])
      if (pRes.status === 'fulfilled') setPrevisions(pRes.value.data.previsions || [])
      if (kpiRes.status === 'fulfilled') setKpis(kpiRes.value.data)
    } catch {}
  }

  async function envoyerMessage(texte) {
    const msg = texte || input.trim()
    if (!msg || loading) return
    setInput('')
    const newMessages = [...messages, { role: 'user', content: msg }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const historique = newMessages.slice(-10).map(m => ({
        role: m.role === 'ai' ? 'assistant' : 'user', content: m.content
      }))
      const { data } = await aiAPI.chat({ message: msg, historique })
      setMessages(prev => [...prev, { role: 'ai', content: data.reponse }])
    } catch (err) {
      const msg503 = '⚠️ **Service IA indisponible.** Vérifiez que la clé ANTHROPIC_API_KEY est configurée dans votre fichier `.env`.'
      const msgErr = '❌ Erreur de communication avec Ouwalou. Veuillez réessayer.'
      setMessages(prev => [...prev, { role: 'ai', content: err.response?.status === 503 ? msg503 : msgErr }])
    } finally { setLoading(false) }
  }

  function renderMd(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/•/g, '&bull;')
      .replace(/\n/g, '<br/>')
  }

  const displayAlertes    = alertes
  const displayRecos      = recos
  const displayPrevisions = previsions

  const SEV = {
    critique:    'bg-red-500/10 border border-red-500/25',
    avertissement:'bg-amber-500/10 border border-amber-500/25',
    info:         'bg-blue-500/10 border border-blue-500/25',
  }
  const SEV_TEXT = {
    critique:'text-red-400', avertissement:'text-amber-400', info:'text-blue-400'
  }

  return (
    <AppLayout titre="Ouwalou AI" sousTitre="Assistant hôtelier intelligent">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl shadow-xl shadow-blue-500/30">🤖</div>
        <div>
          <div className="text-lg font-black tracking-tight">Ouwalou AI</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10B981] animate-pulse" />
            <span className="text-[10.5px] text-emerald-400 font-medium">Actif · Analyse temps réel</span>
          </div>
        </div>
        <div className="flex-1" />
        <button onClick={chargerDonnees} className="btn btn-ghost btn-sm">↻ Actualiser</button>
        <button
          onClick={() => aiAPI.analyser('occupation').then(r =>
            setMessages(prev => [...prev, { role: 'ai', content: r.data.analyse }])
          ).catch(() => setMessages(prev => [...prev, { role:'ai', content:'📊 Rapport indisponible — API non configurée' }]))}
          className="btn btn-primary btn-sm"
        >
          📊 Rapport complet
        </button>
      </div>

      {/* KPIs mini — données réelles depuis analytics/dashboard */}
      <div className="grid grid-cols-6 gap-2 mb-5">
        {[
          [kpis ? `${kpis.taux_occupation || 0}%` : '—',         'Occupation',    '#60A5FA'],
          [kpis ? `${kpis.chambres_occupees || 0}/${kpis.chambres_disponibles || 0}` : '—', 'Chambres occ.','#34D399'],
          [kpis ? kpis.arrivees_aujourd_hui || 0 : '—',           'Arrivées',      '#A78BFA'],
          [kpis ? kpis.departs_aujourd_hui || 0 : '—',            'Départs',       '#FBB740'],
          [displayAlertes.filter(a=>a.severite==='critique').length,'Alertes',      '#F87171'],
          [kpis ? kpis.taches_menage_ouvertes || 0 : '—',         'Ménage',        '#22D3EE'],
        ].map(([val, lbl, col]) => (
          <div key={lbl} className="kpi-card text-center">
            <div className="text-[16px] font-black font-mono" style={{ color: col }}>{val}</div>
            <div className="text-[9px] text-[var(--text-3)] font-bold uppercase tracking-wide mt-1">{lbl}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4" style={{ height: '580px' }}>
        {/* CHAT — 2 colonnes */}
        <div className="col-span-2 flex flex-col gap-2">
          {/* Messages */}
          <div ref={chatRef} className="card flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 items-start ${m.role==='user' ? 'flex-row-reverse' : ''}`}>
                {m.role === 'ai' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm flex-shrink-0 shadow-md">🤖</div>
                )}
                <div
                  className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed max-w-[86%] ${
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
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm flex-shrink-0">🤖</div>
                <div className="bg-[var(--bg-3)] border border-[var(--border-1)] rounded-xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                  {[0,1,2].map(n => (
                    <span key={n} className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce" style={{ animationDelay:`${n*0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Suggestions rapides */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 flex-shrink-0">
            {SUGGESTIONS.map(s => (
              <button key={s.label} onClick={() => envoyerMessage(s.question)}
                className="flex-shrink-0 text-[10px] px-2.5 py-1.5 rounded-full border border-[var(--border-2)] bg-[var(--bg-3)] text-[var(--text-2)] hover:border-blue-500 hover:text-blue-400 hover:bg-blue-500/5 transition-all whitespace-nowrap">
                {s.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="card flex items-center gap-2 p-2 flex-shrink-0">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && envoyerMessage()}
              placeholder="Posez une question sur vos opérations… (Entrée pour envoyer)"
              className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text-0)] placeholder:text-[var(--text-4)]"
            />
            <button
              onClick={() => envoyerMessage()}
              disabled={loading || !input.trim()}
              className="btn btn-primary btn-sm disabled:opacity-40"
            >
              Envoyer →
            </button>
          </div>
        </div>

        {/* Panneau latéral — alertes + reco + prévisions */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          {/* Alertes */}
          <div className="card flex-shrink-0">
            <div className="card-header py-2.5">
              <div className="card-title">⚡ Alertes</div>
              <span className="badge badge-red">{displayAlertes.filter(a=>a.severite==='critique').length}</span>
            </div>
            <div className="p-2.5 space-y-1.5">
              {displayAlertes.slice(0,5).map(a => (
                <div key={a.id} className={`border-l-2 rounded-r-lg p-2 text-[10.5px] ${SEV[a.severite] || 'border-l-blue-500'}`}>
                  <div className={`font-bold mb-0.5 ${SEV_TEXT[a.severite] || 'text-blue-400'}`}>{a.titre}</div>
                  <div className="text-[var(--text-2)] line-clamp-1">{a.message}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommandations */}
          <div className="card flex-shrink-0">
            <div className="card-header py-2.5"><div className="card-title">💡 Recommandations</div></div>
            <div className="p-2.5 space-y-1.5">
              {displayRecos.slice(0,4).map(r => (
                <div key={r.id} className="bg-[var(--bg-3)] rounded-lg p-2 text-[10.5px]">
                  <div className="font-bold mb-0.5">{r.titre}</div>
                  <div className="text-[var(--text-2)] line-clamp-2">{r.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Prévisions 7 jours */}
          <div className="card">
            <div className="card-header py-2.5"><div className="card-title">📈 Prévisions 7j</div></div>
            <div className="p-2.5 space-y-1.5">
              {displayPrevisions.map(p => {
                const color = p.taux_occupation_prevu >= 90 ? '#34D399' : p.taux_occupation_prevu >= 80 ? '#60A5FA' : '#FBB740'
                return (
                  <div key={p.date} className="flex items-center gap-2 text-[10px]">
                    <span className="text-[var(--text-3)] w-14 flex-shrink-0">
                      {new Date(p.date).toLocaleDateString('fr-FR',{weekday:'short',day:'2-digit'})}
                    </span>
                    <div className="flex-1 h-1.5 bg-[var(--bg-4)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width:`${p.taux_occupation_prevu}%`, background:color }} />
                    </div>
                    <span className="font-bold w-8 text-right flex-shrink-0" style={{ color }}>{p.taux_occupation_prevu}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
