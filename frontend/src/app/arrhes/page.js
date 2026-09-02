'use client'
import { useState, useEffect, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { arrhesAPI } from '@/lib/api'
import { useAuthStore, fmt, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_META = {
  en_attente: { label: 'En attente',  cls: 'badge-amber',   icon: '⏳' },
  partielle:  { label: 'Partielle',   cls: 'badge-amber',   icon: '◑' },
  complete:   { label: 'Complète',    cls: 'badge-green',   icon: '✅' },
  remboursee: { label: 'Remboursée',  cls: 'badge-blue',    icon: '↩' },
  acquise:    { label: 'Acquise',     cls: 'badge-purple',  icon: '🏦' },
  annulee:    { label: 'Annulée',     cls: 'badge-gray',    icon: '✕' },
}

const MOYENS_PAIEMENT = [
  { val: 'especes',      label: '💵 Espèces' },
  { val: 'mobile_money', label: '📱 Mobile Money' },
  { val: 'virement',     label: '🏦 Virement' },
  { val: 'carte',        label: '💳 Carte' },
]

function BarreStatut({ val, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 0
  return (
    <div className="h-1.5 bg-[var(--bg-3)] rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ── Modal : confirmer paiement ─────────────────────────────────────────────
function ModalConfirmer({ garantie, onClose, onSuccess }) {
  const [form, setForm] = useState({
    montant_recu:       '',
    mode_paiement:      'mobile_money',
    reference_paiement: '',
    notes:              '',
  })
  const [saving, setSaving] = useState(false)
  const solde = Math.max(0, garantie.montant_demande - (garantie.montant_recu || 0))

  async function submit(e) {
    e.preventDefault()
    if (!form.montant_recu || Number(form.montant_recu) <= 0)
      return toast.error('Montant requis')
    try {
      setSaving(true)
      const { data } = await arrhesAPI.confirmer(garantie.id, {
        ...form, montant_recu: Number(form.montant_recu)
      })
      toast.success(data.message)
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-[var(--text-1)]">Confirmer paiement arrhes</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <div className="bg-[var(--bg-3)] rounded-xl p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Réservation</span><span className="font-bold">{garantie.numero_reservation}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Client</span><span>{garantie.nom_client}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Demandé</span><span className="font-bold text-[var(--text-1)]">{fmt(garantie.montant_demande, garantie.devise)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Déjà reçu</span><span className="text-emerald-400">{fmt(garantie.montant_recu || 0, garantie.devise)}</span></div>
          <div className="flex justify-between font-bold"><span className="text-amber-400">Solde restant</span><span className="text-amber-400">{fmt(solde, garantie.devise)}</span></div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="form-label">Montant reçu</label>
            <input type="number" className="input" value={form.montant_recu}
              onChange={e => setForm(f => ({ ...f, montant_recu: e.target.value }))}
              placeholder={`Solde restant : ${solde.toLocaleString('fr-FR')}`} required min="1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Moyen de paiement</label>
              <select className="input" value={form.mode_paiement}
                onChange={e => setForm(f => ({ ...f, mode_paiement: e.target.value }))}>
                {MOYENS_PAIEMENT.map(m => <option key={m.val} value={m.val}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Référence</label>
              <input className="input" value={form.reference_paiement}
                onChange={e => setForm(f => ({ ...f, reference_paiement: e.target.value }))}
                placeholder="N° transaction" />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="input" rows={2} value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : 'Confirmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal : rembourser ─────────────────────────────────────────────────────
function ModalRembourser({ garantie, onClose, onSuccess }) {
  const [motif, setMotif] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    try {
      setSaving(true)
      const { data } = await arrhesAPI.rembourser(garantie.id, { motif })
      toast.success(data.message)
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-[var(--text-1)]">Rembourser les arrhes</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs">
          <div className="font-bold text-amber-400 mb-1">⚠️ Remboursement selon politique d'annulation</div>
          <div className="text-[var(--text-2)]">Le montant sera calculé automatiquement en fonction des jours restants avant l'arrivée et de la politique configurée.</div>
        </div>
        <div className="bg-[var(--bg-3)] rounded-xl p-3 text-xs space-y-1">
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Réservation</span><span className="font-bold">{garantie.numero_reservation}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Arrivée</span><span>{fmtDate(garantie.date_arrivee)}</span></div>
          <div className="flex justify-between"><span className="text-[var(--text-3)]">Arrhes reçues</span><span className="font-bold text-emerald-400">{fmt(garantie.montant_recu, garantie.devise)}</span></div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="form-label">Motif</label>
            <textarea className="input" rows={2} value={motif}
              onChange={e => setMotif(e.target.value)} placeholder="Raison de l'annulation…" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : 'Calculer & Rembourser'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal : configuration arrhes ──────────────────────────────────────────
function ModalConfig({ config, onClose, onSuccess }) {
  const [form, setForm] = useState({
    actives:              config.actives ?? false,
    taux:                 config.taux ?? 30,
    montant_minimum:      config.montant_minimum ?? 10000,
    delai_paiement_jours: config.delai_paiement_jours ?? 3,
    politique_annulation: config.politique_annulation ?? [
      { jours_avant: 14, remboursement_pct: 100 },
      { jours_avant: 7,  remboursement_pct: 50 },
      { jours_avant: 3,  remboursement_pct: 0 },
    ],
  })
  const [saving, setSaving] = useState(false)

  function updatePolitique(i, field, val) {
    setForm(f => ({
      ...f,
      politique_annulation: f.politique_annulation.map((r, ri) =>
        ri === i ? { ...r, [field]: Number(val) } : r
      )
    }))
  }

  function ajouterRegle() {
    setForm(f => ({ ...f, politique_annulation: [...f.politique_annulation, { jours_avant: 1, remboursement_pct: 0 }] }))
  }

  function supprimerRegle(i) {
    setForm(f => ({ ...f, politique_annulation: f.politique_annulation.filter((_, ri) => ri !== i) }))
  }

  async function submit(e) {
    e.preventDefault()
    try {
      setSaving(true)
      await arrhesAPI.updateConfig(form)
      toast.success('Configuration sauvegardée')
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-[var(--text-1)]">⚙️ Configuration des arrhes</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {/* Activation */}
          <div className="flex items-center justify-between p-3 bg-[var(--bg-3)] rounded-xl">
            <div>
              <div className="text-sm font-semibold text-[var(--text-1)]">Arrhes activées</div>
              <div className="text-[10px] text-[var(--text-3)]">Demander des arrhes à chaque réservation</div>
            </div>
            <button type="button"
              onClick={() => setForm(f => ({ ...f, actives: !f.actives }))}
              className={`w-11 h-6 rounded-full transition-colors relative ${form.actives ? 'bg-blue-600' : 'bg-[var(--bg-4)]'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow ${form.actives ? 'left-5.5 left-[22px]' : 'left-0.5'}`}/>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Taux (%)</label>
              <input type="number" className="input" value={form.taux} min="1" max="100"
                onChange={e => setForm(f => ({ ...f, taux: Number(e.target.value) }))} />
              <div className="text-[9px] text-[var(--text-4)] mt-0.5">% du montant total de la réservation</div>
            </div>
            <div>
              <label className="form-label">Montant minimum (XAF)</label>
              <input type="number" className="input" value={form.montant_minimum} min="0"
                onChange={e => setForm(f => ({ ...f, montant_minimum: Number(e.target.value) }))} />
            </div>
          </div>

          <div>
            <label className="form-label">Délai de paiement (jours après réservation)</label>
            <input type="number" className="input" value={form.delai_paiement_jours} min="1" max="30"
              onChange={e => setForm(f => ({ ...f, delai_paiement_jours: Number(e.target.value) }))} />
          </div>

          {/* Politique annulation */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="form-label mb-0">Politique d'annulation</label>
              <button type="button" onClick={ajouterRegle}
                className="text-[10px] text-blue-400 hover:text-blue-300">+ Ajouter règle</button>
            </div>
            <div className="space-y-2">
              {form.politique_annulation
                .slice()
                .sort((a, b) => b.jours_avant - a.jours_avant)
                .map((regle, i) => {
                  const origIdx = form.politique_annulation.findIndex(r => r === regle)
                  return (
                    <div key={i} className="flex items-center gap-2 bg-[var(--bg-3)] rounded-xl px-3 py-2">
                      <div className="text-[10px] text-[var(--text-3)] w-20 flex-shrink-0">≥</div>
                      <input type="number" className="input py-1 text-xs w-16 text-center"
                        value={regle.jours_avant} min="0"
                        onChange={e => updatePolitique(origIdx, 'jours_avant', e.target.value)} />
                      <div className="text-[10px] text-[var(--text-3)]">j → remboursement</div>
                      <input type="number" className="input py-1 text-xs w-16 text-center"
                        value={regle.remboursement_pct} min="0" max="100"
                        onChange={e => updatePolitique(origIdx, 'remboursement_pct', e.target.value)} />
                      <div className="text-[10px] text-[var(--text-3)]">%</div>
                      {form.politique_annulation.length > 1 && (
                        <button type="button" onClick={() => supprimerRegle(origIdx)}
                          className="text-red-400 text-xs ml-auto">✕</button>
                      )}
                    </div>
                  )
                })}
            </div>
            <div className="text-[9px] text-[var(--text-4)] mt-1">
              Règle appliquée : la plus favorable pour le client selon le nombre de jours avant l'arrivée.
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : 'Sauvegarder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Page principale ────────────────────────────────────────────────────────
export default function ArrhesPage() {
  const { user } = useAuthStore()
  const peutAdmin = ['manager', 'super_admin'].includes(user?.role)

  const [garanties, setGaranties] = useState([])
  const [stats,     setStats]     = useState(null)
  const [config,    setConfig]    = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [filtre,    setFiltre]    = useState('')

  const [modalConfirmer,  setModalConfirmer]  = useState(null)
  const [modalRembourser, setModalRembourser] = useState(null)
  const [modalConfig,     setModalConfig]     = useState(false)

  const charger = useCallback(async () => {
    try {
      const [listRes, cfgRes] = await Promise.allSettled([
        arrhesAPI.lister(filtre ? { statut: filtre } : {}),
        arrhesAPI.config(),
      ])
      if (listRes.status === 'fulfilled') {
        setGaranties(listRes.value.data.garanties || [])
        setStats(listRes.value.data.stats || null)
      }
      if (cfgRes.status === 'fulfilled') setConfig(cfgRes.value.data.config)
    } catch { toast.error('Erreur chargement arrhes') }
    finally { setLoading(false) }
  }, [filtre])

  useEffect(() => { charger() }, [charger])

  function onSuccess() {
    setModalConfirmer(null)
    setModalRembourser(null)
    setModalConfig(false)
    charger()
  }

  const FILTRES = [
    ['', 'Toutes'],
    ['en_attente', '⏳ En attente'],
    ['partielle',  '◑ Partielles'],
    ['complete',   '✅ Complètes'],
    ['remboursee', '↩ Remboursées'],
    ['acquise',    '🏦 Acquises'],
  ]

  return (
    <AppLayout titre="Arrhes & Garanties" sousTitre="Suivi des dépôts de réservation">
      <div className="space-y-5">

        {/* KPIs */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="kpi-card">
              <div className="kpi-label">En attente</div>
              <div className={`kpi-value ${Number(stats.en_attente) > 0 ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>
                {stats.en_attente || 0}
              </div>
              {Number(stats.en_retard) > 0 && (
                <div className="text-[9px] text-red-400 mt-0.5">⚠ {stats.en_retard} en retard</div>
              )}
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Reçues complètes</div>
              <div className="kpi-value text-emerald-400">{stats.complete || 0}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total demandé</div>
              <div className="kpi-value text-blue-400">
                {stats.total_demande ? fmt(stats.total_demande, 'XAF') : '—'}
              </div>
              <div className="text-[9px] text-[var(--text-4)] mt-0.5">
                Reçu : {stats.total_recu ? fmt(stats.total_recu, 'XAF') : '—'}
              </div>
              {stats.total_demande > 0 && (
                <BarreStatut val={Number(stats.total_recu)||0} max={Number(stats.total_demande)} color="bg-emerald-500" />
              )}
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Acquises</div>
              <div className="kpi-value text-purple-400">{stats.acquise || 0}</div>
              <div className="text-[9px] text-[var(--text-4)] mt-0.5">conservées par l'hôtel</div>
            </div>
          </div>
        )}

        {/* Config arrhes + filtres */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {FILTRES.map(([val, label]) => (
              <button key={val} onClick={() => setFiltre(val)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${filtre === val ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'border-[var(--border-1)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {peutAdmin && (
            <button onClick={() => setModalConfig(true)} className="btn btn-ghost btn-sm text-xs">
              ⚙️ Config arrhes {config?.actives ? '(actives)' : '(inactives)'}
            </button>
          )}
          <button onClick={charger} className="btn btn-ghost btn-sm text-xs">↻</button>
        </div>

        {/* Tableau */}
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(5)].map((_,i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
          </div>
        ) : garanties.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-5xl mb-4 opacity-20">🔐</div>
            <div className="font-bold text-[var(--text-1)] mb-2">Aucune garantie</div>
            <div className="text-xs text-[var(--text-3)]">
              Les arrhes apparaissent ici lorsqu'elles sont créées depuis une réservation.
            </div>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-1)] text-[var(--text-4)] uppercase text-[9px] tracking-wide">
                    <th className="text-left px-4 py-3">Réservation</th>
                    <th className="text-left px-4 py-3">Client</th>
                    <th className="text-left px-4 py-3">Arrivée</th>
                    <th className="text-center px-4 py-3">Statut</th>
                    <th className="text-right px-4 py-3">Demandé</th>
                    <th className="text-right px-4 py-3">Reçu</th>
                    <th className="text-center px-4 py-3">Échéance</th>
                    <th className="text-center px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {garanties.map(g => {
                    const meta    = STATUT_META[g.statut] || STATUT_META.en_attente
                    const echeance = g.echeance_paiement ? new Date(g.echeance_paiement) : null
                    const enRetard = echeance && echeance < new Date() && ['en_attente','partielle'].includes(g.statut)
                    const pct = g.montant_demande > 0
                      ? Math.round(((g.montant_recu || 0) / g.montant_demande) * 100) : 0

                    return (
                      <tr key={g.id} className="border-b border-[var(--border-1)]/50 hover:bg-[var(--bg-3)]/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-[var(--text-1)]">{g.numero_reservation}</div>
                          <div className="text-[9px] text-[var(--text-4)]">Ch. {g.numero_chambre || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[var(--text-1)]">{g.nom_client || '—'}</div>
                          <div className="text-[9px] text-[var(--text-4)]">{g.tel_client || ''}</div>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-2)]">{fmtDate(g.date_arrivee)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[var(--text-1)]">
                          {fmt(g.montant_demande, g.devise)}
                          <div className="text-[9px] text-[var(--text-4)]">{g.taux_applique}%</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className={`font-bold ${pct >= 100 ? 'text-emerald-400' : pct > 0 ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>
                            {fmt(g.montant_recu || 0, g.devise)}
                          </div>
                          {pct > 0 && pct < 100 && (
                            <div className="text-[9px] text-[var(--text-4)]">{pct}%</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {echeance ? (
                            <span className={`text-[10px] font-mono ${enRetard ? 'text-red-400 font-bold' : 'text-[var(--text-3)]'}`}>
                              {enRetard ? '⚠ ' : ''}{echeance.toLocaleDateString('fr-FR')}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-center flex-wrap">
                            {['en_attente','partielle'].includes(g.statut) && (
                              <button onClick={() => setModalConfirmer(g)}
                                className="btn btn-xs btn-primary text-[9px]">
                                💰 Encaisser
                              </button>
                            )}
                            {['complete','partielle'].includes(g.statut) && peutAdmin && (
                              <button onClick={() => setModalRembourser(g)}
                                className="btn btn-xs btn-ghost text-[9px] text-blue-400">
                                ↩ Rembourser
                              </button>
                            )}
                            {['en_attente','partielle','complete'].includes(g.statut) && peutAdmin && (
                              <button
                                onClick={async () => {
                                  if (!confirm('Marquer les arrhes comme acquises (non remboursables) ?')) return
                                  try {
                                    const { data } = await arrhesAPI.acquerir(g.id, {})
                                    toast.success(data.message); charger()
                                  } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
                                }}
                                className="btn btn-xs btn-ghost text-[9px] text-purple-400">
                                🏦 Acquérir
                              </button>
                            )}
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
      </div>

      {/* Modals */}
      {modalConfirmer  && <ModalConfirmer  garantie={modalConfirmer}  onClose={() => setModalConfirmer(null)}  onSuccess={onSuccess} />}
      {modalRembourser && <ModalRembourser garantie={modalRembourser} onClose={() => setModalRembourser(null)} onSuccess={onSuccess} />}
      {modalConfig && config && <ModalConfig config={config} onClose={() => setModalConfig(false)} onSuccess={onSuccess} />}
    </AppLayout>
  )
}
