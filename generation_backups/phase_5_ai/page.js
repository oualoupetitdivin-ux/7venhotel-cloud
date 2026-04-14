'use client'
import { useState, useEffect, useRef } from 'react'
import AppLayout from '../../components/layout/AppLayout'
import { aiAPI, analyticsAPI } from '../../lib/api'

const SUGGESTIONS = [
  { label: "📊 Occupation", question: "Analyse détaillée du taux d'occupation cette semaine" },
  { label: "💰 RevPAR",     question: "Comment augmenter le RevPAR de l'hôtel ?" },
  { label: "🧹 Ménage",     question: "Performance et délais du staff housekeeping" },
  { label: "🔧 Maintenance",question: "État des tickets maintenance en cours" },
  { label: "📈 Prévisions", question: "Prévisions de recettes pour la semaine prochaine" },
  { label: "⭐ Satisfaction",question: "Analyse de la satisfaction client" },
]

export default function AIPage() {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [alertes, setAlertes]     = useState([])
  const [recos, setRecos]         = useState([])
  const [previsions, setPrevisions] = useState([])
  const chatRef = useRef(null)

  useEffect(() => {
    chargerDonnees()
    setMessages([{
      role: 'ai',
      content: `**Bonjour ! Je suis Ouwalou**, votre assistant IA pour l'Hôtel Royal Yaoundé. 🤖\n\nJ'analyse vos données opérationnelles en temps réel pour vous fournir des recommandations actionnables.\n\n**Aujourd'hui, je surveille :**\n• Taux d'occupation et tendances RevPAR\n• Performance housekeeping et délais\n• Tickets maintenance urgents\n• Prévisions revenus\n\nComment puis-je vous aider ?`
    }])
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages])

  async function chargerDonnees() {
    try {
      const [aRes, rRes, pRes] = await Promise.allSettled([
        aiAPI.alertes(), aiAPI.recommandations(), aiAPI.previsions()
      ])
      if (aRes.status === 'fulfilled') setAlertes(aRes.value.data.alertes || [])
      if (rRes.status === 'fulfilled') setRecos(rRes.value.data.recommandations || [])
      if (pRes.status === 'fulfilled') setPrevisions(pRes.value.data.previsions || [])
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

  // Données de démo si API pas encore disponible
  const ALERTES_DEMO = [
    { id:'1', titre:'Chambre 304 — Clim hors service', message:'Client VIP affecté · Ticket TKT-001', severite:'critique' },
    { id:'2', titre:'8 chambres sales à 15h00', message:'Risque retard check-in', severite:'avertissement' },
    { id:'3', titre:'Occupation +4% vs semaine passée', message:'RevPAR en hausse', severite:'info' },
  ]
  const RECOS_DEMO = [
    { id:'1', titre:'💰 Hausser tarif week-end', description:'Occupation Sam 97% — Opportunité +8 000 XAF/nuit' },
    { id:'2', titre:'🧹 Optimiser planning HK', description:'Fatou D. 24min vs Moussa T. 31min — Rééquilibrer' },
    { id:'3', titre:'🍽 Booster room service soir', description:'Room service < 5% CA — Promouvoir 19h–22h' },
  ]
  const PREVISIONS_DEMO = [
    { date:'2026-04-14', taux_occupation_prevu:82, adr_prevu:25000 },
    { date:'2026-04-15', taux_occupation_prevu:79, adr_prevu:24500 },
    { date:'2026-04-16', taux_occupation_prevu:85, adr_prevu:27000 },
    { date:'2026-04-17', taux_occupation_prevu:88, adr_prevu:28500 },
    { date:'2026-04-18', taux_occupation_prevu:95, adr_prevu:32000 },
    { date:'2026-04-19', taux_occupation_prevu:98, adr_prevu:35000 },
    { date:'2026-04-20', taux_occupation_prevu:91, adr_prevu:29000 },
  ]

  const displayAlertes   = alertes.length   ? alertes   : ALERTES_DEMO
  const displayRecos     = recos.length     ? recos     : RECOS_DEMO
  const displayPrevisions = previsions.length ? previsions : PREVISIONS_DEMO

  const SEV = {
    critique:    'border-l-red-500 bg-red-500/5',
    avertissement:'border-l-amber-500 bg-amber-500/5',
    info:         'border-l-blue-500 bg-blue-500/5',
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

      {/* KPIs mini */}
      <div className="grid grid-cols-6 gap-2 mb-5">
        {[
          ['87%',   'Occupation',    'border-blue-500',   '#60A5FA'],
          ['23 055','RevPAR XAF',    'border-emerald-500','#34D399'],
          ['28 min','Moy. ménage',   'border-amber-500',  '#FBB740'],
          [displayAlertes.filter(a=>a.severite==='critique').length, 'Alertes', 'border-red-500', '#F87171'],
          ['91%',   'Productivité',  'border-purple-500', '#A78BFA'],
          ['4.8★',  'Satisfaction',  'border-cyan-500',   '#22D3EE'],
        ].map(([val, lbl, brd, col]) => (
          <div key={lbl} className={`card p-3 border-b-2 ${brd} text-center`}>
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
