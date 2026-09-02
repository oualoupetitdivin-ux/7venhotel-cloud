'use client'
import { useState, useEffect, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { caisseAPI } from '@/lib/api'
import { useAuthStore, fmt, fmtDateTime } from '@/lib/utils'
import toast from 'react-hot-toast'

const TYPE_MOUVEMENT_META = {
  fond_initial:  { label: 'Fond initial',  cls: 'badge-blue',  icon: '🏦', signe: 1 },
  encaissement:  { label: 'Encaissement',  cls: 'badge-green', icon: '💰', signe: 1 },
  decaissement:  { label: 'Décaissement',  cls: 'badge-amber', icon: '↘',  signe: -1 },
  retrait:       { label: 'Retrait',       cls: 'badge-red',   icon: '↗',  signe: -1 },
}

// ── Modal : ouvrir la caisse ─────────────────────────────────────────────────
function ModalOuvrir({ onClose, onSuccess }) {
  const [fond, setFond] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (fond === '' || Number(fond) < 0) return toast.error('Fond de caisse requis')
    try {
      setSaving(true)
      const { data } = await caisseAPI.ouvrir({ fond_ouverture: Number(fond) })
      toast.success(data.message)
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box max-w-sm">
        <div className="modal-header">
          <h3 className="font-bold text-[var(--text-1)]">Ouvrir la caisse</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-3">
            <div>
              <label className="form-label">Fond de caisse (XAF)</label>
              <input type="number" className="input" value={fond} min="0" autoFocus
                onChange={e => setFond(e.target.value)} placeholder="Montant remis en début de journée" required />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : 'Ouvrir la caisse'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal : décaissement / retrait ───────────────────────────────────────────
function ModalMouvement({ onClose, onSuccess }) {
  const [form, setForm] = useState({ type_mouvement: 'decaissement', montant: '', libelle: '', reference: '' })
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.montant || Number(form.montant) <= 0) return toast.error('Montant requis')
    if (!form.libelle.trim()) return toast.error('Libellé requis')
    try {
      setSaving(true)
      const { data } = await caisseAPI.mouvement({ ...form, montant: Number(form.montant) })
      toast.success(data.message)
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box max-w-sm">
        <div className="modal-header">
          <h3 className="font-bold text-[var(--text-1)]">Décaissement / Retrait</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-3">
            <div>
              <label className="form-label">Type</label>
              <select className="input" value={form.type_mouvement}
                onChange={e => setForm(f => ({ ...f, type_mouvement: e.target.value }))}>
                <option value="decaissement">↘ Décaissement (dépense caisse)</option>
                <option value="retrait">↗ Retrait (transfert hors caisse)</option>
              </select>
            </div>
            <div>
              <label className="form-label">Montant (XAF)</label>
              <input type="number" className="input" value={form.montant} min="1"
                onChange={e => setForm(f => ({ ...f, montant: e.target.value }))} required />
            </div>
            <div>
              <label className="form-label">Libellé</label>
              <input className="input" value={form.libelle}
                onChange={e => setForm(f => ({ ...f, libelle: e.target.value }))}
                placeholder="Ex : Achat fournitures bureau" required />
            </div>
            <div>
              <label className="form-label">Référence (optionnel)</label>
              <input className="input" value={form.reference}
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal : clôturer la caisse ───────────────────────────────────────────────
function ModalCloturer({ session, encaissementsEspeces, onClose, onSuccess }) {
  const theorique = Number(session.fond_ouverture) + encaissementsEspeces
  const [montantCompte, setMontantCompte] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const ecart = montantCompte !== '' ? Number(montantCompte) - theorique : null
  const ecartCls = ecart === null ? '' : ecart === 0 ? 'text-emerald-400' : Math.abs(ecart) <= 500 ? 'text-amber-400' : 'text-red-400'

  async function submit(e) {
    e.preventDefault()
    if (montantCompte === '' || Number(montantCompte) < 0) return toast.error('Montant compté requis')
    try {
      setSaving(true)
      const { data } = await caisseAPI.cloturer({ montant_compte: Number(montantCompte), notes })
      toast.success(data.message)
      onSuccess()
    } catch (e) { toast.error(e?.response?.data?.erreur || 'Erreur') }
    finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box max-w-md">
        <div className="modal-header">
          <h3 className="font-bold text-[var(--text-1)]">Clôturer la caisse</h3>
          <button onClick={onClose} className="text-[var(--text-3)] text-xl">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-3">
            <div className="bg-[var(--bg-3)] rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-[var(--text-3)]">Fond initial</span><span>{fmt(session.fond_ouverture, 'XAF')}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-3)]">Encaissements espèces</span><span className="text-emerald-400">{fmt(encaissementsEspeces, 'XAF')}</span></div>
              <div className="flex justify-between font-bold"><span className="text-[var(--text-1)]">Total théorique</span><span className="text-[var(--text-1)]">{fmt(theorique, 'XAF')}</span></div>
            </div>
            <div>
              <label className="form-label">Montant compté (XAF)</label>
              <input type="number" className="input" value={montantCompte} min="0" autoFocus
                onChange={e => setMontantCompte(e.target.value)} required />
            </div>
            {ecart !== null && (
              <div className={`text-xs font-bold ${ecartCls}`}>
                Écart : {ecart > 0 ? '+' : ''}{fmt(ecart, 'XAF')}
                {ecart === 0 && ' — caisse juste ✅'}
                {ecart !== 0 && Math.abs(ecart) <= 500 && ' — écart mineur'}
                {Math.abs(ecart) > 500 && ' — écart à justifier'}
              </div>
            )}
            <div>
              <label className="form-label">Notes de clôture</label>
              <textarea className="input" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder="Justification de l'écart, remarques…" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">Annuler</button>
            <button type="submit" disabled={saving} className="btn btn-primary flex-1">
              {saving ? '…' : 'Clôturer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Onglet historique ────────────────────────────────────────────────────────
function OngletHistorique() {
  const [historique, setHistorique] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    caisseAPI.historique().then(({ data }) => setHistorique(data.data || []))
      .catch(() => toast.error('Erreur chargement historique'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
  if (historique.length === 0) return (
    <div className="card p-12 text-center">
      <div className="text-5xl mb-4 opacity-20">🗂</div>
      <div className="font-bold text-[var(--text-1)] mb-2">Aucune clôture</div>
      <div className="text-xs text-[var(--text-3)]">Les sessions clôturées apparaîtront ici (30 derniers jours).</div>
    </div>
  )

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-base w-full text-xs">
          <thead>
            <tr>
              <th>Ouverte le</th><th>Clôturée le</th><th className="text-right">Fond</th>
              <th className="text-right">Théorique</th><th className="text-right">Compté</th>
              <th className="text-right">Écart</th>
            </tr>
          </thead>
          <tbody>
            {historique.map(s => {
              const ecart = Number(s.ecart || 0)
              const ecartCls = ecart === 0 ? 'text-emerald-400' : Math.abs(ecart) <= 500 ? 'text-amber-400' : 'text-red-400'
              return (
                <tr key={s.id}>
                  <td>{fmtDateTime(s.ouverte_le)}</td>
                  <td>{fmtDateTime(s.fermee_le)}</td>
                  <td className="text-right">{fmt(s.fond_ouverture, 'XAF')}</td>
                  <td className="text-right">{fmt(s.montant_theorique, 'XAF')}</td>
                  <td className="text-right">{fmt(s.montant_compte, 'XAF')}</td>
                  <td className={`text-right font-bold ${ecartCls}`}>{ecart > 0 ? '+' : ''}{fmt(ecart, 'XAF')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page principale ────────────────────────────────────────────────────────
export default function CaissePage() {
  const { user } = useAuthStore()
  const accesAutorise = ['manager', 'reception', 'comptabilite'].includes(user?.role)
  const peutOuvrirOuMouvementer = ['manager', 'reception'].includes(user?.role)
  const peutCloturer = ['manager', 'comptabilite'].includes(user?.role)

  const [session, setSession]     = useState(undefined) // undefined = chargement, null = aucune
  const [mouvements, setMouvements] = useState([])
  const [loading, setLoading]     = useState(true)
  const [onglet, setOnglet]       = useState('session')

  const [modalOuvrir, setModalOuvrir]     = useState(false)
  const [modalMouvement, setModalMouvement] = useState(false)
  const [modalCloturer, setModalCloturer] = useState(false)

  const charger = useCallback(async () => {
    try {
      const { data } = await caisseAPI.sessionActive()
      setSession(data.session)
      if (data.session) {
        const detail = await caisseAPI.detail(data.session.id)
        setMouvements(detail.data.mouvements || [])
      } else {
        setMouvements([])
      }
    } catch { toast.error('Erreur chargement caisse') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (accesAutorise) charger() }, [charger, accesAutorise])

  function onSuccess() {
    setModalOuvrir(false)
    setModalMouvement(false)
    setModalCloturer(false)
    charger()
  }

  if (!accesAutorise) {
    return (
      <AppLayout titre="Caisse" sousTitre="Caisse & clôture journalière">
        <div className="card p-12 text-center">
          <div className="text-5xl mb-4 opacity-20">🚫</div>
          <div className="font-bold text-[var(--text-1)] mb-2">Accès refusé</div>
          <div className="text-xs text-[var(--text-3)]">Ce module est réservé aux rôles manager, réception et comptabilité.</div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout titre="Caisse" sousTitre="Caisse & clôture journalière">
      <div className="space-y-5">

        <div className="flex gap-1">
          <button onClick={() => setOnglet('session')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${onglet === 'session' ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'border-[var(--border-1)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
            Session en cours
          </button>
          <button onClick={() => setOnglet('historique')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${onglet === 'historique' ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'border-[var(--border-1)] text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
            Historique
          </button>
        </div>

        {onglet === 'historique' ? <OngletHistorique /> : (
          loading ? (
            <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}</div>
          ) : !session ? (
            <div className="card p-12 text-center space-y-4">
              <div className="text-5xl mb-2 opacity-20">💵</div>
              <div className="font-bold text-[var(--text-1)]">Aucune session de caisse ouverte</div>
              <div className="text-xs text-[var(--text-3)]">Ouvrez la caisse pour démarrer la journée.</div>
              {peutOuvrirOuMouvementer && (
                <button onClick={() => setModalOuvrir(true)} className="btn btn-primary btn-lg">Ouvrir la caisse</button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="kpi-card">
                  <div className="kpi-label">Fond initial</div>
                  <div className="kpi-value text-blue-400">{fmt(session.fond_ouverture, 'XAF')}</div>
                  <div className="text-[9px] text-[var(--text-4)] mt-0.5">Ouverte {fmtDateTime(session.ouverte_le)}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Encaissements espèces</div>
                  <div className="kpi-value text-emerald-400">{fmt(session.encaissements_especes, 'XAF')}</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Total théorique</div>
                  <div className="kpi-value text-[var(--text-0)]">{fmt(session.total_theorique, 'XAF')}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex-1" />
                <button onClick={charger} className="btn btn-ghost btn-sm text-xs">↻</button>
                {peutOuvrirOuMouvementer && (
                  <button onClick={() => setModalMouvement(true)} className="btn btn-ghost btn-sm text-xs">↘ Décaissement / Retrait</button>
                )}
                {peutCloturer && (
                  <button onClick={() => setModalCloturer(true)} className="btn btn-danger btn-sm text-xs">Clôturer la caisse</button>
                )}
              </div>

              {mouvements.length === 0 ? (
                <div className="card p-8 text-center text-xs text-[var(--text-3)]">Aucun mouvement enregistré pour cette session.</div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table-base w-full text-xs">
                      <thead>
                        <tr>
                          <th>Heure</th><th>Type</th><th>Libellé</th><th className="text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mouvements.map(m => {
                          const meta = TYPE_MOUVEMENT_META[m.type_mouvement] || TYPE_MOUVEMENT_META.decaissement
                          return (
                            <tr key={m.id}>
                              <td>{fmtDateTime(m.cree_le)}</td>
                              <td><span className={`badge ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                              <td>{m.libelle || '—'}{m.reference ? ` (${m.reference})` : ''}</td>
                              <td className={`text-right font-bold ${meta.signe > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {meta.signe > 0 ? '+' : '-'}{fmt(m.montant, 'XAF')}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>

      {modalOuvrir && <ModalOuvrir onClose={() => setModalOuvrir(false)} onSuccess={onSuccess} />}
      {modalMouvement && <ModalMouvement onClose={() => setModalMouvement(false)} onSuccess={onSuccess} />}
      {modalCloturer && session && (
        <ModalCloturer session={session} encaissementsEspeces={session.encaissements_especes}
          onClose={() => setModalCloturer(false)} onSuccess={onSuccess} />
      )}
    </AppLayout>
  )
}
