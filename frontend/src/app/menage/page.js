'use client'
import { useState, useEffect, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { menageAPI, chambresAPI } from '@/lib/api'
import { useAuthStore } from '@/lib/utils'
import toast from 'react-hot-toast'

const TYPE_LABEL = {
  nettoyage_depart: 'Départ',
  nettoyage_sejour: 'Séjour',
  inspection:       'Inspection',
  recouverture:     'Recouverture',
}

const PRIORITE_COULEUR = {
  urgente: 'badge-red',
  haute:   'badge-orange',
  normale: 'badge-blue',
  basse:   'badge-gray',
}

const COLONNES = [
  { statut: 'ouverte',  titre: 'À faire',  couleur: 'bg-amber-500/10 border-amber-500/30 text-amber-400',  next: 'en_cours',  nextLabel: 'Prendre en charge' },
  { statut: 'assignee', titre: 'Assignée', couleur: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400', next: 'en_cours', nextLabel: 'Commencer' },
  { statut: 'en_cours', titre: 'En cours', couleur: 'bg-blue-500/10 border-blue-500/30 text-blue-400',      next: 'terminee', nextLabel: 'Terminer' },
  { statut: 'terminee', titre: 'Terminée', couleur: 'bg-green-500/10 border-green-500/30 text-green-400',   next: 'validee',  nextLabel: 'Valider ✓' },
  { statut: 'validee',  titre: 'Validée',  couleur: 'bg-purple-500/10 border-purple-500/30 text-purple-400', next: null,      nextLabel: null },
]

const FORM_VIDE = { chambre_id: '', type_tache: 'nettoyage_sejour', priorite: 'normale', description: '' }

function duree(min) {
  if (min == null || isNaN(min)) return null
  const m = Math.round(min)
  if (m < 60) return `${m}min`
  return `${Math.floor(m/60)}h${(m%60).toString().padStart(2,'0')}`
}

function alerteMin(min, seuil) {
  if (min == null) return ''
  const m = Math.round(min)
  if (m > seuil * 1.5) return 'text-red-400'
  if (m > seuil) return 'text-amber-400'
  return 'text-emerald-400'
}

function TacheCard({ t, col, peutModifier, peutAssigner, agents, onStatut, onAssigner }) {
  const [menuAgent, setMenuAgent] = useState(false)
  const minCreation = Math.round(t.minutes_depuis_creation || 0)
  const minEnCours  = t.minutes_en_cours != null ? Math.round(t.minutes_en_cours) : null

  return (
    <div className="bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl p-3 hover:border-blue-500/40 transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-bold text-sm text-[var(--text-1)]">Ch. {t.numero_chambre || '—'}</div>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full badge ${PRIORITE_COULEUR[t.priorite] || 'badge-gray'}`}>
          {t.priorite}
        </span>
      </div>

      <div className="text-[10px] text-[var(--text-3)] mb-1">
        {TYPE_LABEL[t.type_tache] || t.type_tache}
      </div>

      {t.nom_agent && (
        <div className="text-[10px] text-blue-400 mb-1">👤 {t.nom_agent}</div>
      )}

      {t.description && (
        <div className="text-[10px] text-[var(--text-2)] mb-2 line-clamp-2">{t.description}</div>
      )}

      {/* Timing info */}
      <div className="flex items-center gap-2 mb-2 text-[9px]">
        {col.statut === 'en_cours' && minEnCours != null && (
          <span className={`font-mono font-bold ${alerteMin(minEnCours, 30)}`}>
            ⏱ {duree(minEnCours)} en cours
          </span>
        )}
        {(col.statut === 'ouverte' || col.statut === 'assignee') && (
          <span className={`font-mono ${alerteMin(minCreation, 20)}`}>
            ⏳ {duree(minCreation)} d'attente
          </span>
        )}
        {col.statut === 'terminee' && t.duree_minutes && (
          <span className="text-emerald-400 font-mono">✓ {duree(t.duree_minutes)}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1">
        {col.next && peutModifier && (
          <button
            onClick={() => onStatut(t.id, col.next)}
            className="flex-1 text-[10px] font-semibold py-1 rounded-lg bg-[var(--bg-3)] hover:bg-blue-500/20 text-[var(--text-2)] hover:text-blue-400 transition-colors">
            {col.nextLabel} →
          </button>
        )}
        {(col.statut === 'ouverte') && peutAssigner && agents.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setMenuAgent(v => !v)}
              className="text-[10px] px-2 py-1 rounded-lg bg-[var(--bg-3)] hover:bg-indigo-500/20 text-indigo-400 transition-colors">
              👤+
            </button>
            {menuAgent && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg-2)] border border-[var(--border-1)] rounded-xl shadow-xl min-w-[140px]">
                {agents.map(a => (
                  <button key={a.id}
                    onClick={() => { onAssigner(t.id, a.id); setMenuAgent(false) }}
                    className="w-full text-left px-3 py-2 text-[10px] text-[var(--text-2)] hover:bg-[var(--bg-3)] hover:text-white transition-colors first:rounded-t-xl last:rounded-b-xl">
                    {a.prenom} {a.nom}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiMini({ label, value, color = 'text-white', sub }) {
  return (
    <div className="kpi-card text-center">
      <div className={`text-2xl font-black mb-0.5 ${color}`}>{value ?? '—'}</div>
      <div className="text-[9.5px] text-[var(--text-3)] uppercase tracking-wide">{label}</div>
      {sub && <div className="text-[9px] text-[var(--text-4)] mt-0.5">{sub}</div>}
    </div>
  )
}

export default function MenagePage() {
  const { user } = useAuthStore()
  const peutCreer    = ['manager', 'super_admin', 'housekeeping'].includes(user?.role)
  const peutModifier = ['manager', 'super_admin', 'housekeeping'].includes(user?.role)
  const peutAssigner = ['manager', 'super_admin'].includes(user?.role)

  const [onglet,   setOnglet]   = useState('kanban')
  const [kanban,   setKanban]   = useState({ ouverte:[], assignee:[], en_cours:[], terminee:[], validee:[] })
  const [chambres, setChambres] = useState([])
  const [agents,   setAgents]   = useState([])
  const [perf,     setPerf]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form,     setForm]     = useState(FORM_VIDE)
  const [saving,   setSaving]   = useState(false)
  const [datePerf, setDatePerf] = useState(new Date().toISOString().slice(0,10))
  const [now,      setNow]      = useState(Date.now())

  // Tick toutes les minutes pour actualiser les timers
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  const chargerKanban = useCallback(async () => {
    try {
      const res = await menageAPI.kanban()
      setKanban(res.data.kanban || { ouverte:[], assignee:[], en_cours:[], terminee:[], validee:[] })
    } catch { /* silencieux */ }
  }, [])

  const chargerPerf = useCallback(async (date) => {
    try {
      const res = await menageAPI.performance(date)
      setPerf(res.data)
    } catch { toast.error('Erreur performance') }
  }, [])

  const chargerAgents = useCallback(async () => {
    try {
      const res = await menageAPI.agents()
      setAgents(res.data.agents || [])
    } catch { /* silencieux */ }
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        const [chRes] = await Promise.allSettled([chambresAPI.lister()])
        if (chRes.status === 'fulfilled') setChambres(chRes.value.data.donnees || [])
        await Promise.all([chargerKanban(), chargerAgents()])
      } finally { setLoading(false) }
    }
    init()
  }, [chargerKanban, chargerAgents])

  useEffect(() => {
    if (onglet === 'performance') chargerPerf(datePerf)
  }, [onglet, datePerf, chargerPerf])

  // Auto-refresh kanban toutes les 30s
  useEffect(() => {
    if (onglet !== 'kanban') return
    const t = setInterval(chargerKanban, 30000)
    return () => clearInterval(t)
  }, [onglet, chargerKanban])

  async function changerStatut(id, statut) {
    try {
      await menageAPI.changerStatut(id, { statut })
      toast.success('Statut mis à jour')
      await chargerKanban()
      if (onglet === 'equipe') chargerAgents()
    } catch { toast.error('Erreur mise à jour') }
  }

  async function assigner(tacheId, agentId) {
    try {
      await menageAPI.assigner(tacheId, { utilisateur_id: agentId })
      toast.success('Agent assigné')
      chargerKanban()
    } catch { toast.error('Erreur assignation') }
  }

  async function creerTache(e) {
    e.preventDefault()
    if (!form.chambre_id) return toast.error('Sélectionner une chambre')
    try {
      setSaving(true)
      await menageAPI.creerTache({ ...form, date_tache: new Date().toISOString().slice(0,10) })
      toast.success('Tâche créée')
      setShowForm(false)
      setForm(FORM_VIDE)
      chargerKanban()
    } catch { toast.error('Erreur création') }
    finally { setSaving(false) }
  }

  const totalTaches = Object.values(kanban).reduce((s, arr) => s + arr.length, 0)
  const stats = {
    aFaire:   (kanban.ouverte?.length  || 0) + (kanban.assignee?.length || 0),
    enCours:  kanban.en_cours?.length  || 0,
    terminees:(kanban.terminee?.length || 0) + (kanban.validee?.length  || 0),
  }

  return (
    <AppLayout titre="Housekeeping" sousTitre="Pilotage ménage & équipes">
      <div className="space-y-5">

        {/* KPIs strip */}
        <div className="grid grid-cols-4 gap-3">
          <KpiMini label="À traiter" value={stats.aFaire} color={stats.aFaire > 5 ? 'text-amber-400' : 'text-white'} />
          <KpiMini label="En cours" value={stats.enCours} color="text-blue-400" />
          <KpiMini label="Terminées" value={stats.terminees} color="text-emerald-400" />
          <KpiMini label="Agents" value={agents.length} color="text-indigo-400"
            sub={agents.length ? `${agents.filter(a => a.charge.en_cours > 0).length} actifs` : null} />
        </div>

        {/* Onglets */}
        <div className="flex gap-1 border-b border-[var(--border-1)]">
          {[['kanban','🗂 Kanban'],['performance','📊 Performance'],['equipe','👥 Équipe']].map(([k,l]) => (
            <button key={k} onClick={() => setOnglet(k)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${onglet===k ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
              {l}
            </button>
          ))}
          <div className="flex-1"/>
          <div className="flex items-center gap-2 pb-1">
            {peutCreer && (
              <button onClick={() => setShowForm(true)} className="btn btn-primary btn-sm text-xs">+ Nouvelle tâche</button>
            )}
            <button onClick={chargerKanban} className="btn btn-ghost btn-sm text-xs">↻</button>
          </div>
        </div>

        {/* Modal création */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="card w-full max-w-md p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-[var(--text-1)]">Nouvelle tâche ménage</h3>
                <button onClick={() => setShowForm(false)} className="text-[var(--text-3)] text-xl">×</button>
              </div>
              <form onSubmit={creerTache} className="space-y-3">
                <div>
                  <label className="form-label">Chambre</label>
                  <select className="input" value={form.chambre_id}
                    onChange={e => setForm(f => ({ ...f, chambre_id: e.target.value }))} required>
                    <option value="">Sélectionner…</option>
                    {chambres.map(c => (
                      <option key={c.id} value={c.id}>
                        Ch. {c.numero} — {c.statut}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Type</label>
                    <select className="input" value={form.type_tache}
                      onChange={e => setForm(f => ({ ...f, type_tache: e.target.value }))}>
                      <option value="nettoyage_sejour">Nettoyage Séjour</option>
                      <option value="nettoyage_depart">Nettoyage Départ</option>
                      <option value="inspection">Inspection</option>
                      <option value="recouverture">Recouverture</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Priorité</label>
                    <select className="input" value={form.priorite}
                      onChange={e => setForm(f => ({ ...f, priorite: e.target.value }))}>
                      <option value="urgente">🔴 Urgente</option>
                      <option value="haute">🟠 Haute</option>
                      <option value="normale">🔵 Normale</option>
                      <option value="basse">⚪ Basse</option>
                    </select>
                  </div>
                </div>
                {peutAssigner && agents.length > 0 && (
                  <div>
                    <label className="form-label">Assigner à (optionnel)</label>
                    <select className="input" value={form.assignee_a || ''}
                      onChange={e => setForm(f => ({ ...f, assignee_a: e.target.value || undefined }))}>
                      <option value="">Non assignée</option>
                      {agents.map(a => (
                        <option key={a.id} value={a.id}>{a.prenom} {a.nom}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="form-label">Instructions</label>
                  <textarea className="input" rows={2} value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Instructions pour l'agent…" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost flex-1">Annuler</button>
                  <button type="submit" disabled={saving} className="btn btn-primary flex-1">{saving ? '…' : 'Créer'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ─── KANBAN ─────────────────────────────────────────────────────── */}
        {onglet === 'kanban' && (
          loading ? (
            <div className="flex gap-3 p-2">
              {[...Array(4)].map((_,i) => <div key={i} className="skeleton flex-1 h-48 rounded-xl" />)}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {COLONNES.map(col => (
                <div key={col.statut} className="flex-1 min-w-[190px]">
                  <div className={`flex items-center justify-between mb-3 px-3 py-2 rounded-xl border ${col.couleur}`}>
                    <span className="text-xs font-bold">{col.titre}</span>
                    <span className="text-xs opacity-70 font-mono">{kanban[col.statut]?.length || 0}</span>
                  </div>
                  <div className="space-y-2">
                    {(kanban[col.statut] || []).map(t => (
                      <TacheCard key={t.id} t={t} col={col}
                        peutModifier={peutModifier} peutAssigner={peutAssigner}
                        agents={agents} onStatut={changerStatut} onAssigner={assigner} />
                    ))}
                    {(!kanban[col.statut] || kanban[col.statut].length === 0) && (
                      <div className="text-center text-[10px] text-[var(--text-4)] py-6 border border-dashed border-[var(--border-1)] rounded-xl">
                        Aucune tâche
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ─── PERFORMANCE ─────────────────────────────────────────────── */}
        {onglet === 'performance' && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <label className="text-xs text-[var(--text-3)]">Date :</label>
              <input type="date" value={datePerf}
                onChange={e => setDatePerf(e.target.value)}
                className="input text-xs py-1 px-2 w-auto" />
            </div>

            {!perf ? (
              <div className="p-3 space-y-2">
                {[...Array(3)].map((_,i) => <div key={i} className="skeleton h-8 rounded-lg" />)}
              </div>
            ) : (
              <>
                {/* KPIs globaux */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="kpi-card">
                    <div className="kpi-label">Tâches du jour</div>
                    <div className="kpi-value">{perf.stats?.total || 0}</div>
                    <div className="text-[9px] text-[var(--text-4)] mt-1">
                      {perf.stats?.terminees || 0} terminées · {perf.stats?.en_cours || 0} en cours
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Temps réponse moyen</div>
                    <div className={`kpi-value ${perf.stats?.avg_reponse_min > 30 ? 'text-red-400' : perf.stats?.avg_reponse_min > 15 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {duree(perf.stats?.avg_reponse_min) || '—'}
                    </div>
                    <div className="text-[9px] text-[var(--text-4)] mt-1">
                      Déclaration → prise en charge
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Temps nettoyage moyen</div>
                    <div className={`kpi-value ${perf.stats?.avg_nettoyage_min > 45 ? 'text-red-400' : perf.stats?.avg_nettoyage_min > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {duree(perf.stats?.avg_nettoyage_min) || '—'}
                    </div>
                    <div className="text-[9px] text-[var(--text-4)] mt-1">
                      Min {duree(perf.stats?.min_nettoyage_min) || '—'} · Max {duree(perf.stats?.max_nettoyage_min) || '—'}
                    </div>
                  </div>
                  <div className="kpi-card">
                    <div className="kpi-label">Temps total moyen</div>
                    <div className="kpi-value text-purple-400">
                      {duree(perf.stats?.avg_total_min) || '—'}
                    </div>
                    <div className="text-[9px] text-[var(--text-4)] mt-1">
                      Déclaration → remise en disponibilité
                    </div>
                  </div>
                </div>

                {/* Taux complétion */}
                {perf.stats?.total > 0 && (
                  <div className="card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-bold text-[var(--text-1)]">Taux de complétion</div>
                      <div className="text-sm font-black text-emerald-400">
                        {Math.round((perf.stats.terminees / perf.stats.total) * 100)}%
                      </div>
                    </div>
                    <div className="h-2 bg-[var(--bg-3)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-700"
                        style={{ width: `${Math.round((perf.stats.terminees / perf.stats.total) * 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-[var(--text-4)] mt-1">
                      <span>{perf.stats.terminees} terminées</span>
                      <span>{perf.stats.total} total</span>
                    </div>
                  </div>
                )}

                {/* Breakdown par agent */}
                {perf.parAgent?.length > 0 && (
                  <div className="card p-4">
                    <div className="text-sm font-bold text-[var(--text-1)] mb-3">Performance par agent</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[var(--text-4)] uppercase text-[9px] tracking-wide border-b border-[var(--border-1)]">
                            <th className="text-left pb-2">Agent</th>
                            <th className="text-center pb-2">Tâches</th>
                            <th className="text-center pb-2">Terminées</th>
                            <th className="text-center pb-2">En cours</th>
                            <th className="text-center pb-2">Réponse moy.</th>
                            <th className="text-center pb-2">Nettoyage moy.</th>
                            <th className="text-center pb-2">Efficacité</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perf.parAgent.map((a, i) => {
                            const taux = a.taches_total > 0 ? Math.round((a.taches_terminees / a.taches_total) * 100) : 0
                            return (
                              <tr key={a.agent_id || i} className="border-b border-[var(--border-1)]/50">
                                <td className="py-2.5 font-semibold text-[var(--text-1)]">{a.nom_agent}</td>
                                <td className="text-center py-2.5 text-[var(--text-2)]">{a.taches_total}</td>
                                <td className="text-center py-2.5 text-emerald-400 font-semibold">{a.taches_terminees}</td>
                                <td className="text-center py-2.5 text-blue-400">{a.en_cours || 0}</td>
                                <td className={`text-center py-2.5 font-mono ${alerteMin(a.avg_reponse_min, 20)}`}>
                                  {duree(a.avg_reponse_min) || '—'}
                                </td>
                                <td className={`text-center py-2.5 font-mono ${alerteMin(a.avg_nettoyage_min, 35)}`}>
                                  {duree(a.avg_nettoyage_min) || '—'}
                                </td>
                                <td className="text-center py-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <div className="flex-1 h-1.5 bg-[var(--bg-3)] rounded-full overflow-hidden">
                                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${taux}%` }} />
                                    </div>
                                    <span className={`text-[9px] font-bold ${taux >= 80 ? 'text-emerald-400' : taux >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                                      {taux}%
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Trend 7 jours */}
                {perf.trend?.length > 0 && (
                  <div className="card p-4">
                    <div className="text-sm font-bold text-[var(--text-1)] mb-3">Tendance 7 jours</div>
                    <div className="flex items-end gap-2 h-20">
                      {perf.trend.map((jour, i) => {
                        const max = Math.max(...perf.trend.map(j => j.total || 0), 1)
                        const pct = Math.round(((jour.total || 0) / max) * 100)
                        const pctT = jour.total > 0 ? Math.round(((jour.terminees || 0) / jour.total) * 100) : 0
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div className="text-[8px] text-[var(--text-4)] font-mono">{duree(jour.avg_nettoyage) || '—'}</div>
                            <div className="w-full relative flex flex-col justify-end" style={{ height: '48px' }}>
                              <div className="w-full bg-[var(--bg-3)] rounded-t" style={{ height: `${pct}%` }}>
                                <div className="w-full bg-emerald-500/60 rounded-t" style={{ height: `${pctT}%` }} />
                              </div>
                            </div>
                            <div className="text-[8px] text-[var(--text-4)]">
                              {new Date(jour.date_tache).toLocaleDateString('fr-FR', { weekday: 'short' })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex gap-3 mt-2 text-[9px] text-[var(--text-4)]">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--bg-3)] inline-block"/>Total</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/60 inline-block"/>Terminées</span>
                    </div>
                  </div>
                )}

                {(!perf.stats?.total) && (
                  <div className="card p-10 text-center text-[var(--text-3)]">
                    <div className="text-4xl mb-3">📭</div>
                    <div className="font-semibold">Aucune tâche pour cette date</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── ÉQUIPE ─────────────────────────────────────────────────── */}
        {onglet === 'equipe' && (
          <div className="space-y-4">
            {agents.length === 0 ? (
              <div className="card p-10 text-center text-[var(--text-3)]">
                <div className="text-4xl mb-3">👥</div>
                <div className="font-semibold mb-2">Aucun agent housekeeping</div>
                <div className="text-xs">Créez des comptes avec le rôle &quot;housekeeping&quot; pour les voir ici.</div>
              </div>
            ) : (
              agents.map(a => {
                const taux = a.charge.total > 0
                  ? Math.round((a.charge.terminees / a.charge.total) * 100) : 0
                return (
                  <div key={a.id} className="card p-4">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                        {(a.prenom?.[0]||'')+(a.nom?.[0]||'')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-[var(--text-1)]">{a.prenom} {a.nom}</div>
                        <div className="text-[10px] text-[var(--text-3)]">{a.email}</div>
                      </div>
                      <div className="flex gap-4 text-center">
                        <div>
                          <div className="text-sm font-black text-[var(--text-1)]">{a.charge.total}</div>
                          <div className="text-[9px] text-[var(--text-4)]">tâches</div>
                        </div>
                        <div>
                          <div className={`text-sm font-black ${a.charge.en_cours > 0 ? 'text-blue-400' : 'text-[var(--text-3)]'}`}>
                            {a.charge.en_cours}
                          </div>
                          <div className="text-[9px] text-[var(--text-4)]">en cours</div>
                        </div>
                        <div>
                          <div className="text-sm font-black text-emerald-400">{a.charge.terminees}</div>
                          <div className="text-[9px] text-[var(--text-4)]">terminées</div>
                        </div>
                        <div>
                          <div className={`text-sm font-black ${a.charge.avg_nettoyage ? alerteMin(a.charge.avg_nettoyage, 35) : 'text-[var(--text-3)]'}`}>
                            {duree(a.charge.avg_nettoyage) || '—'}
                          </div>
                          <div className="text-[9px] text-[var(--text-4)]">moy.</div>
                        </div>
                      </div>
                    </div>
                    {a.charge.total > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-[9px] text-[var(--text-4)] mb-1">
                          <span>Progression du jour</span>
                          <span className={taux >= 80 ? 'text-emerald-400' : taux >= 50 ? 'text-amber-400' : 'text-red-400'}>{taux}%</span>
                        </div>
                        <div className="h-2 bg-[var(--bg-3)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${taux >= 80 ? 'bg-emerald-500' : taux >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${taux}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
