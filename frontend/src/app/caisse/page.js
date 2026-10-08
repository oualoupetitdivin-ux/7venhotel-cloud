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

// Rubriques du théorique telles que calculées par le backend (GET /caisse/session-active →
// detail_theorique) : la clôture compare le compté à CE théorique. Le recalcul local
// « fond + encaissements » ignorait les décaissements → écart fantôme (ex. Heliconia 08/10 : +2 000).
function rubriquesTheorique(d = {}) {
  return [
    ['Fond initial',                   Number(d.fond_ouverture || 0),               1],
    ['Encaissements espèces',          Number(d.encaissements_paiements || 0),      1],
    ['Arrhes reçues en espèces',       Number(d.encaissements_arrhes || 0),         1],
    ['Décaissements / retraits',       Number(d.sorties_mouvements || 0),          -1],
    ['Remboursements d\'arrhes',       Number(d.remboursements_arrhes || 0),       -1],
    ['Paiements espèces annulés',      Number(d.contre_passations_paiements || 0), -1],
  ].filter(([label, m], i) => i < 2 || m !== 0)
}

const echapper = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const MODES = { especes: 'Espèces', carte: 'Carte bancaire', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque', cinetpay: 'CinetPay', autre: 'Autre' }

// ── Impression de la journée de caisse (navigateur → imprimante ou PDF) ──────
// La fenêtre est ouverte AVANT l'appel API (sinon bloquée comme popup), puis remplie.
async function imprimerJournee(sessionId) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return toast.error('Autorisez les fenêtres pop-up pour imprimer')
  w.document.write('<p style="font-family:sans-serif;padding:24px">Préparation de la journée de caisse…</p>')
  try {
    const { data: j } = await caisseAPI.journee(sessionId)
    const s = j.session
    const f = (m) => echapper(fmt(m, 'XAF'))
    const dt = (d) => d ? echapper(new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '—'
    const ligne = (cells, cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td${i === cells.length - 1 ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`
    const rub = rubriquesTheorique(j.detail_theorique)
    const encaiss = [...j.encaissements.map(e => ({ ...e, libelle: `${e.nom_client}${e.numero_folio ? ' · ' + e.numero_folio : ''}` })),
                     ...j.arrhes.map(a => ({ ...a, libelle: `Arrhes${a.numero_folio ? ' · ' + a.numero_folio : ''}` }))]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
    const ecart = s.statut === 'cloturee' ? Number(s.ecart) : null
    w.document.open()
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Journée de caisse — ${echapper(s.hotel_nom)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px;font-size:12px}
  h1{font-size:18px;margin:0} h2{font-size:13px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#444}
  .meta{color:#555;margin-top:4px} table{width:100%;border-collapse:collapse} td,th{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left}
  th{font-size:11px;color:#555;background:#f4f4f4} .r{text-align:right;white-space:nowrap} .tot td{font-weight:bold;border-top:2px solid #111}
  .neg{color:#b00020} .box{display:flex;gap:12px;margin-top:10px} .box div{flex:1;border:1px solid #ccc;border-radius:6px;padding:8px}
  .box b{display:block;font-size:15px;margin-top:3px} .sig{display:flex;gap:40px;margin-top:40px} .sig div{flex:1;border-top:1px solid #999;padding-top:4px;color:#555}
  .noprint{margin-bottom:16px} @media print{.noprint{display:none} body{margin:12mm}}
</style></head><body>
<div class="noprint"><button onclick="window.print()">🖨 Imprimer / Enregistrer en PDF</button></div>
<h1>Journée de caisse — ${echapper(s.hotel_nom)}</h1>
<div class="meta">Ouverte le ${dt(s.ouverte_le)}${s.ouverte_par_nom ? ' par ' + echapper(s.ouverte_par_nom) : ''} ·
${s.statut === 'cloturee' ? `Clôturée le ${dt(s.fermee_le)}${s.fermee_par_nom ? ' par ' + echapper(s.fermee_par_nom) : ''}` : `<b>Session en cours</b> (situation au ${dt(j.fin)})`}</div>
<div class="box"><div>Théorique espèces<b>${f(j.theorique)}</b></div>
<div>Compté<b>${s.statut === 'cloturee' ? f(s.montant_compte) : '—'}</b></div>
<div>Écart<b class="${ecart ? 'neg' : ''}">${ecart === null ? '—' : (ecart > 0 ? '+' : '') + f(ecart)}</b></div>
<div>Total encaissé (tous modes)<b>${f(j.total_encaisse)}</b></div></div>
<h2>Calcul du théorique espèces</h2><table>
${rub.map(([l, m, signe]) => ligne([echapper(l), (signe < 0 ? '−' : '+') + ' ' + f(m)], signe < 0 ? 'neg' : '')).join('')}
${ligne(['Total théorique', f(j.theorique)], 'tot')}</table>
<h2>Encaissements par mode</h2><table><tr><th>Mode</th><th class="r">Montant</th></tr>
${Object.entries(j.par_mode).map(([m, v]) => ligne([echapper(MODES[m] || m), f(v)])).join('') || ligne(['Aucun encaissement', '—'])}
${ligne(['Total', f(j.total_encaisse)], 'tot')}</table>
<h2>Détail des encaissements</h2><table><tr><th>Date</th><th>Mode</th><th>Client / folio</th><th class="r">Montant</th></tr>
${encaiss.map(e => ligne([dt(e.date), echapper(MODES[e.type_paiement] || e.type_paiement), echapper(e.libelle), f(e.montant)])).join('') || ligne(['—', '', 'Aucun encaissement', '—'])}</table>
${j.en_attente?.length ? `<h2>Paiements en attente de confirmation (non comptés)</h2><table><tr><th>Date</th><th>Mode</th><th>Folio</th><th class="r">Montant</th></tr>
${j.en_attente.map(e => ligne([dt(e.date), echapper(MODES[e.type_paiement] || e.type_paiement), echapper(e.numero_folio || '—'), f(e.montant)])).join('')}</table>` : ''}
<h2>Mouvements de caisse</h2><table><tr><th>Date</th><th>Type</th><th>Libellé</th><th class="r">Montant</th></tr>
${j.mouvements.map(m => { const meta = TYPE_MOUVEMENT_META[m.type_mouvement] || TYPE_MOUVEMENT_META.decaissement
  return ligne([dt(m.cree_le), echapper(meta.label), echapper(m.libelle || '—') + (m.reference ? ' (' + echapper(m.reference) + ')' : ''), (meta.signe > 0 ? '+' : '−') + ' ' + f(m.montant)], meta.signe < 0 ? 'neg' : '') }).join('')}</table>
${s.notes_cloture ? `<h2>Notes de clôture</h2><div>${echapper(s.notes_cloture)}</div>` : ''}
<div class="sig"><div>Caissier</div><div>Responsable</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`)
    w.document.close()
  } catch (e) {
    w.close()
    toast.error(e?.response?.data?.erreur || 'Impossible de préparer la journée de caisse')
  }
}

// ── Modal : clôturer la caisse ───────────────────────────────────────────────
function ModalCloturer({ session, onClose, onSuccess }) {
  const theorique = Number(session.total_theorique)
  const rubriques = rubriquesTheorique(session.detail_theorique)
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
              {rubriques.map(([label, montant, signe]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-[var(--text-3)]">{label}</span>
                  <span className={signe < 0 ? 'text-red-400' : label === 'Fond initial' ? '' : 'text-emerald-400'}>{signe < 0 ? '−' : ''}{fmt(montant, 'XAF')}</span>
                </div>
              ))}
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
              <th className="text-right">Écart</th><th></th>
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
                  <td className="text-right"><button onClick={() => imprimerJournee(s.id)} className="btn btn-ghost btn-xs" title="Imprimer la journée">🖨</button></td>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                  <div className="kpi-label">Sorties espèces</div>
                  <div className="kpi-value text-red-400">−{fmt((session.detail_theorique?.sorties_mouvements || 0) + (session.detail_theorique?.remboursements_arrhes || 0) + (session.detail_theorique?.contre_passations_paiements || 0), 'XAF')}</div>
                  <div className="text-[9px] text-[var(--text-4)] mt-0.5">Décaissements, retraits, remboursements</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">Total théorique</div>
                  <div className="kpi-value text-[var(--text-0)]">{fmt(session.total_theorique, 'XAF')}</div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex-1" />
                <button onClick={charger} className="btn btn-ghost btn-sm text-xs">↻</button>
                <button onClick={() => imprimerJournee(session.id)} className="btn btn-ghost btn-sm text-xs">🖨 Imprimer la journée</button>
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
        <ModalCloturer session={session}
          onClose={() => setModalCloturer(false)} onSuccess={onSuccess} />
      )}
    </AppLayout>
  )
}
