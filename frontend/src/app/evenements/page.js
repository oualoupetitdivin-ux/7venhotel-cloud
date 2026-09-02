'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { evenementsAPI } from '@/lib/api'
import { useAuthStore, fmt, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

const STATUT_LABEL = { demande: 'Demande', confirme: 'Confirmé', en_cours: 'En cours', termine: 'Terminé', annule: 'Annulé' }
const STATUT_BADGE = { demande: 'badge-amber', confirme: 'badge-blue', en_cours: 'badge-green', termine: 'badge-gray', annule: 'badge-red' }
const STATUT_PILL  = {
  demande:  'bg-amber-500/25 text-amber-300 border border-amber-500/40',
  confirme: 'bg-blue-500/25 text-blue-300 border border-blue-500/40',
  en_cours: 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40',
  termine:  'bg-gray-500/15 text-gray-400 border border-gray-500/30',
  annule:   'bg-red-500/20 text-red-400 border border-red-500/30',
}
const TYPE_LABEL    = { conference: '🎤 Conférence', mariage: '💍 Mariage', seminaire: '📊 Séminaire', reception: '🥂 Réception', autre: '🎪 Autre' }
const FORMULE_LABEL = { demi_journee: 'Demi-journée', journee: 'Journée' }
const STATUTS_ORDRE = ['demande', 'confirme', 'en_cours', 'termine', 'annule']
const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const JOURS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim']

const EVENEMENT_VIDE = {
  salle_id: '', type_evenement: 'seminaire', titre: '',
  nom_organisateur: '', telephone_organisateur: '', email_organisateur: '',
  date_debut: '', date_fin: '', heure_debut: '', heure_fin: '',
  nombre_participants: '', formule: 'journee',
  montant_ht: '', montant_ttc: '', acompte: '', statut: 'demande', notes: '',
}

function debutDuMoisISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function finDuMoisISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

// ── Grille calendrier ────────────────────────────────────────────────────────
function buildGrid(year, month) {
  const first = new Date(year, month, 1)
  const dow   = (first.getDay() + 6) % 7   // Monday = 0
  const start = new Date(year, month, 1 - dow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
}

function evtsJour(day, events) {
  const iso = day.toISOString().slice(0, 10)
  return events.filter(e => {
    const debut = e.date_debut?.slice(0, 10) || ''
    const fin   = e.date_fin?.slice(0, 10)   || debut
    return iso >= debut && iso <= fin
  })
}

// ── Panneau détail (partagé liste + calendrier) ──────────────────────────────
function PanneauDetail({ detail, peutGerer, changingStatut, prochainesActions, changerStatutRapide, ouvrirEdition }) {
  if (!detail) return (
    <div className="card p-5 col-span-2 flex items-center justify-center text-xs text-[var(--text-3)]">
      <div className="text-center"><div className="text-3xl mb-2 opacity-20">📋</div>Sélectionnez un événement</div>
    </div>
  )
  return (
    <div className="card p-5 col-span-2 overflow-y-auto max-h-[640px]">
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="card-title">{detail.titre}</div>
            <div className="text-[10.5px] text-[var(--text-3)] mt-0.5">
              {detail.numero_evenement} · {TYPE_LABEL[detail.type_evenement] || detail.type_evenement || '—'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`badge ${STATUT_BADGE[detail.statut]}`}>{STATUT_LABEL[detail.statut]}</span>
            {peutGerer && (
              <button onClick={() => ouvrirEdition(detail)} className="btn btn-xs btn-ghost">✎ Modifier</button>
            )}
          </div>
        </div>

        {peutGerer && prochainesActions(detail.statut).length > 0 && (
          <div className="flex gap-2">
            {prochainesActions(detail.statut).map(a => (
              <button key={a.statut} disabled={changingStatut}
                onClick={() => changerStatutRapide(detail.id, a.statut)}
                className={`btn btn-sm ${a.danger ? 'btn-danger' : 'btn-primary'}`}>
                {a.label}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><div className="text-[var(--text-3)] mb-0.5">Organisateur</div><div>{detail.nom_organisateur}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Client hôtel</div><div>{detail.nom_client || '—'}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Téléphone</div><div>{detail.telephone_organisateur || '—'}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Email</div><div>{detail.email_organisateur || '—'}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Salle</div><div>{detail.nom_salle || '—'}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Participants</div><div>{detail.nombre_participants ?? 0}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Dates</div><div>{fmtDate(detail.date_debut)} → {fmtDate(detail.date_fin)}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Horaires</div><div>{detail.heure_debut?.slice(0,5) || '—'} – {detail.heure_fin?.slice(0,5) || '—'}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Formule</div><div>{FORMULE_LABEL[detail.formule] || detail.formule}</div></div>
        </div>

        <div className="bg-[var(--bg-3)] rounded-xl p-3 grid grid-cols-2 gap-3 text-xs">
          <div><div className="text-[var(--text-3)] mb-0.5">Montant HT</div><div className="font-semibold">{fmt(detail.montant_ht, 'XAF')}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Montant TTC</div><div className="font-bold text-[var(--text-1)]">{fmt(detail.montant_ttc, 'XAF')}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Acompte reçu</div><div className="font-semibold text-emerald-400">{fmt(detail.acompte, 'XAF')}</div></div>
          <div><div className="text-[var(--text-3)] mb-0.5">Solde restant</div>
            <div className={`font-bold ${Number(detail.solde_restant) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {fmt(detail.solde_restant, 'XAF')}
            </div>
          </div>
        </div>

        {detail.notes && (
          <div>
            <div className="text-[var(--text-3)] mb-1 text-xs">Notes</div>
            <div className="text-xs bg-[var(--bg-3)] rounded-lg p-3 whitespace-pre-wrap">{detail.notes}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Vue Calendrier ────────────────────────────────────────────────────────────
function VueCalendrier({ calMois, setCalMois, calEvts, loadingCal, selectedId, onSelectEvent }) {
  const year  = calMois.getFullYear()
  const month = calMois.getMonth()
  const days  = buildGrid(year, month)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="card col-span-2 overflow-hidden">
      {/* Navigation mois */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-0)]">
        <button
          onClick={() => setCalMois(new Date(year, month - 1, 1))}
          className="btn btn-ghost btn-sm w-8 h-8 p-0 flex items-center justify-center text-base">‹</button>
        <span className="font-bold text-sm text-[var(--text-1)]">{MOIS_FR[month]} {year}</span>
        <button
          onClick={() => setCalMois(new Date(year, month + 1, 1))}
          className="btn btn-ghost btn-sm w-8 h-8 p-0 flex items-center justify-center text-base">›</button>
      </div>

      {loadingCal ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* En-têtes jours */}
          <div className="grid grid-cols-7 border-b border-[var(--border-0)]">
            {JOURS_FR.map(j => (
              <div key={j} className="text-center text-[9.5px] font-bold text-[var(--text-3)] py-2 uppercase tracking-wider">{j}</div>
            ))}
          </div>

          {/* Grille 6 semaines */}
          <div className="grid grid-cols-7" style={{ gridAutoRows: '1fr' }}>
            {days.map((day, i) => {
              const iso           = day.toISOString().slice(0, 10)
              const isThisMonth   = day.getMonth() === month
              const isToday       = iso === today
              const evts          = evtsJour(day, calEvts)
              const MAX_VISIBLE   = 3

              return (
                <div key={i}
                  className={`min-h-[82px] p-1.5 border-b border-r border-[var(--border-0)] last:border-r-0
                    ${!isThisMonth ? 'opacity-35' : ''}`}>
                  {/* Numéro du jour */}
                  <div className={`text-[10px] font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-blue-500 text-white' : 'text-[var(--text-3)]'}`}>
                    {day.getDate()}
                  </div>

                  {/* Pills événements */}
                  <div className="space-y-0.5">
                    {evts.slice(0, MAX_VISIBLE).map(e => (
                      <button key={e.id} onClick={() => onSelectEvent(e.id)}
                        title={e.titre}
                        className={`w-full text-left text-[8.5px] font-medium px-1.5 py-[2px] rounded truncate transition-all
                          ${selectedId === e.id
                            ? 'ring-1 ring-blue-400 opacity-100'
                            : 'opacity-75 hover:opacity-100'}
                          ${STATUT_PILL[e.statut] || 'bg-gray-500/20 text-gray-400'}`}>
                        {e.titre}
                      </button>
                    ))}
                    {evts.length > MAX_VISIBLE && (
                      <div className="text-[8.5px] text-[var(--text-3)] pl-1 font-medium">
                        +{evts.length - MAX_VISIBLE} autre{evts.length - MAX_VISIBLE > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Légende */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border-0)] flex-wrap">
            {Object.entries(STATUT_LABEL).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm border ${STATUT_PILL[k]}`} />
                <span className="text-[9.5px] text-[var(--text-3)]">{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function EvenementsPage() {
  const { user } = useAuthStore()
  const peutGerer = ['manager', 'super_admin'].includes(user?.role)

  // État liste
  const [evenements, setEvenements] = useState([])
  const [salles,     setSalles]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreDebut,  setFiltreDebut]  = useState('')
  const [filtreFin,    setFiltreFin]    = useState('')

  // État calendrier
  const [vue,        setVue]        = useState('liste')
  const [calMois,    setCalMois]    = useState(new Date())
  const [calEvts,    setCalEvts]    = useState([])
  const [loadingCal, setLoadingCal] = useState(false)

  // État modal
  const [showModal,      setShowModal]      = useState(false)
  const [form,           setForm]           = useState(EVENEMENT_VIDE)
  const [editingId,      setEditingId]      = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [changingStatut, setChangingStatut] = useState(false)

  const charger = useCallback(async () => {
    try {
      setLoading(true)
      const [evR, sallesR] = await Promise.allSettled([
        evenementsAPI.lister({
          ...(filtreStatut ? { statut: filtreStatut } : {}),
          ...(filtreDebut  ? { date_debut: filtreDebut } : {}),
          ...(filtreFin    ? { date_fin: filtreFin }    : {}),
          limite: 200,
        }),
        evenementsAPI.salles(),
      ])
      if (evR.status === 'fulfilled') {
        const liste = evR.value.data.data || []
        setEvenements(liste)
        if (!selectedId && liste.length) setSelectedId(liste[0].id)
      }
      if (sallesR.status === 'fulfilled') setSalles(sallesR.value.data.salles || [])
    } catch { toast.error('Erreur chargement événements') }
    finally { setLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtreStatut, filtreDebut, filtreFin])

  const chargerCalendrier = useCallback(async () => {
    const year  = calMois.getFullYear()
    const month = calMois.getMonth()
    const days  = buildGrid(year, month)
    const debut = days[0].toISOString().slice(0, 10)
    const fin   = days[41].toISOString().slice(0, 10)
    try {
      setLoadingCal(true)
      const res = await evenementsAPI.calendrier({ debut, fin })
      setCalEvts(res.data.evenements || [])
    } catch { toast.error('Erreur chargement calendrier') }
    finally { setLoadingCal(false) }
  }, [calMois])

  useEffect(() => { charger() }, [charger])

  useEffect(() => {
    if (vue === 'calendrier') chargerCalendrier()
  }, [vue, chargerCalendrier])

  const detail = useMemo(() => {
    const src = vue === 'calendrier' ? calEvts : evenements
    return src.find(e => e.id === selectedId) || null
  }, [vue, evenements, calEvts, selectedId])

  const kpis = useMemo(() => {
    const debutMois = debutDuMoisISO(), finMois = finDuMoisISO()
    const duMois = evenements.filter(e => e.date_debut?.slice(0, 10) >= debutMois && e.date_debut?.slice(0, 10) <= finMois)
    return {
      evenementsMois: duMois.length,
      caMois:         duMois.filter(e => e.statut !== 'annule').reduce((s, e) => s + Number(e.montant_ttc || 0), 0),
      acomptesMois:   duMois.reduce((s, e) => s + Number(e.acompte || 0), 0),
      enAttente:      evenements.filter(e => e.statut === 'demande').length,
    }
  }, [evenements])

  function ouvrirNouveau() { setEditingId(null); setForm(EVENEMENT_VIDE); setShowModal(true) }
  function ouvrirEdition(e) {
    setEditingId(e.id)
    setForm({
      salle_id: e.salle_id || '', type_evenement: e.type_evenement || 'autre', titre: e.titre || '',
      nom_organisateur: e.nom_organisateur || '', telephone_organisateur: e.telephone_organisateur || '',
      email_organisateur: e.email_organisateur || '',
      date_debut: e.date_debut?.slice(0, 10) || '', date_fin: e.date_fin?.slice(0, 10) || '',
      heure_debut: e.heure_debut?.slice(0, 5) || '', heure_fin: e.heure_fin?.slice(0, 5) || '',
      nombre_participants: e.nombre_participants ?? '', formule: e.formule || 'journee',
      montant_ht: e.montant_ht ?? '', montant_ttc: e.montant_ttc ?? '', acompte: e.acompte ?? '',
      statut: e.statut || 'demande', notes: e.notes || '',
    })
    setShowModal(true)
  }

  function appliquerTarifSalle(salleId, formule) {
    const salle = salles.find(s => s.id === salleId)
    if (!salle) return
    const prix = formule === 'demi_journee' ? salle.prix_demi_journee : salle.prix_journee
    if (prix == null) return
    setForm(f => ({ ...f, montant_ht: prix, montant_ttc: f.montant_ttc || prix }))
  }
  function onChangeSalle(salleId) { setForm(f => ({ ...f, salle_id: salleId })); appliquerTarifSalle(salleId, form.formule) }
  function onChangeFormule(formule) { setForm(f => ({ ...f, formule })); appliquerTarifSalle(form.salle_id, formule) }

  function prochainesActions(statut) {
    if (statut === 'demande')  return [{ statut: 'confirme', label: '✓ Confirmer' }, { statut: 'annule', label: '✕ Annuler', danger: true }]
    if (statut === 'confirme') return [{ statut: 'en_cours', label: '▶ Démarrer' }, { statut: 'annule', label: '✕ Annuler', danger: true }]
    if (statut === 'en_cours') return [{ statut: 'termine', label: '✅ Terminer' }]
    return []
  }

  async function changerStatutRapide(evenementId, nouveauStatut) {
    try {
      setChangingStatut(true)
      await evenementsAPI.modifier(evenementId, { statut: nouveauStatut })
      toast.success(`Statut mis à jour — ${STATUT_LABEL[nouveauStatut]}`)
      if (vue === 'calendrier') { await chargerCalendrier() }
      else { await charger() }
    } catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur changement de statut') }
    finally { setChangingStatut(false) }
  }

  async function soumettre(e) {
    e.preventDefault()
    if (!form.titre.trim() || !form.nom_organisateur.trim() || !form.date_debut || !form.date_fin)
      return toast.error('Titre, organisateur et dates sont requis')
    const payload = {
      ...form,
      salle_id: form.salle_id || null,
      nombre_participants: form.nombre_participants === '' ? 0 : Number(form.nombre_participants),
      montant_ht:  form.montant_ht  === '' ? undefined : Number(form.montant_ht),
      montant_ttc: form.montant_ttc === '' ? undefined : Number(form.montant_ttc),
      acompte:     form.acompte     === '' ? 0 : Number(form.acompte),
      heure_debut: form.heure_debut || null,
      heure_fin:   form.heure_fin   || null,
    }
    try {
      setSaving(true)
      if (editingId) { await evenementsAPI.modifier(editingId, payload); toast.success('Événement mis à jour') }
      else           { await evenementsAPI.creer(payload);               toast.success('Événement créé') }
      setShowModal(false)
      charger()
      if (vue === 'calendrier') chargerCalendrier()
    } catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur enregistrement') }
    finally { setSaving(false) }
  }

  function handleSelectEvent(id) {
    setSelectedId(id)
    // Sync cross-view: if the event exists in the other list, keep it selected
  }

  return (
    <AppLayout titre="Événements" sousTitre="Séminaires, mariages & réceptions">
      <div className="space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="kpi-card">
            <div className="kpi-label">Événements du mois</div>
            <div className="kpi-value">{kpis.evenementsMois}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">CA événementiel du mois</div>
            <div className="kpi-value text-emerald-400">{fmt(kpis.caMois, 'XAF')}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Acomptes encaissés</div>
            <div className="kpi-value text-blue-400">{fmt(kpis.acomptesMois, 'XAF')}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">En attente de confirmation</div>
            <div className={`kpi-value ${kpis.enAttente > 0 ? 'text-amber-400' : 'text-[var(--text-3)]'}`}>{kpis.enAttente}</div>
          </div>
        </div>

        {/* Barre filtres + vue */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle vue */}
            <div className="flex rounded-lg border border-[var(--border-1)] overflow-hidden">
              <button onClick={() => setVue('liste')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${vue === 'liste' ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
                ☰ Liste
              </button>
              <button onClick={() => setVue('calendrier')}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-[var(--border-1)] ${vue === 'calendrier' ? 'bg-blue-500/20 text-blue-400' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'}`}>
                📅 Calendrier
              </button>
            </div>

            {/* Filtres statut — liste uniquement */}
            {vue === 'liste' && (
              <>
                <span className="w-px h-5 bg-[var(--border-1)]" />
                {['', ...STATUTS_ORDRE].map(s => (
                  <button key={s} onClick={() => setFiltreStatut(s)}
                    className={`btn btn-sm ${filtreStatut === s ? 'btn-primary' : 'btn-ghost'}`}>
                    {s ? STATUT_LABEL[s] : 'Tous'}
                  </button>
                ))}
                <span className="w-px h-5 bg-[var(--border-1)]" />
                <input type="date" className="input w-auto text-xs" value={filtreDebut}
                  onChange={e => setFiltreDebut(e.target.value)} title="À partir de" />
                <span className="text-[var(--text-4)] text-xs">→</span>
                <input type="date" className="input w-auto text-xs" value={filtreFin}
                  onChange={e => setFiltreFin(e.target.value)} title="Jusqu'à" />
                {(filtreDebut || filtreFin) && (
                  <button onClick={() => { setFiltreDebut(''); setFiltreFin('') }} className="btn btn-ghost btn-xs">✕ Période</button>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={vue === 'liste' ? charger : chargerCalendrier} className="btn btn-ghost btn-sm">↻</button>
            {peutGerer && (
              <button onClick={ouvrirNouveau} className="btn btn-primary btn-sm">＋ Nouvel événement</button>
            )}
          </div>
        </div>

        {/* Contenu : liste ou calendrier */}
        {vue === 'liste' ? (
          <div className="grid grid-cols-3 gap-4">
            {/* Liste */}
            <div className="card overflow-hidden col-span-1">
              {loading ? (
                <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
              ) : evenements.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-3)]">
                  <div className="text-3xl mb-2">🎪</div>
                  <div className="font-semibold">Aucun événement</div>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-0)] max-h-[640px] overflow-y-auto">
                  {evenements.map(e => (
                    <button key={e.id} onClick={() => handleSelectEvent(e.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-[var(--bg-3)] transition-colors ${selectedId === e.id ? 'bg-[var(--bg-3)]' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold text-[var(--text-0)] truncate">{e.titre}</div>
                        <span className={`badge ${STATUT_BADGE[e.statut]} flex-shrink-0`}>{STATUT_LABEL[e.statut]}</span>
                      </div>
                      <div className="text-[10.5px] text-[var(--text-3)] mt-0.5">{fmtDate(e.date_debut)} · {e.nom_salle || 'Salle non assignée'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Détail */}
            <PanneauDetail
              detail={detail}
              peutGerer={peutGerer}
              changingStatut={changingStatut}
              prochainesActions={prochainesActions}
              changerStatutRapide={changerStatutRapide}
              ouvrirEdition={ouvrirEdition}
            />
          </div>
        ) : (
          /* Vue calendrier */
          <div className="grid grid-cols-3 gap-4">
            <VueCalendrier
              calMois={calMois}
              setCalMois={setCalMois}
              calEvts={calEvts}
              loadingCal={loadingCal}
              selectedId={selectedId}
              onSelectEvent={handleSelectEvent}
            />
            <PanneauDetail
              detail={detail}
              peutGerer={peutGerer}
              changingStatut={changingStatut}
              prochainesActions={prochainesActions}
              changerStatutRapide={changerStatutRapide}
              ouvrirEdition={ouvrirEdition}
            />
          </div>
        )}
      </div>

      {/* Modal création/édition */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="card-title">{editingId ? "Modifier l'événement" : 'Nouvel événement'}</div>
              <button onClick={() => setShowModal(false)} className="btn btn-ghost btn-xs">✕</button>
            </div>
            <form onSubmit={soumettre}>
              <div className="modal-body grid grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
                <div className="col-span-2">
                  <label className="form-label">Titre *</label>
                  <input className="input" required value={form.titre}
                    onChange={e => setForm({ ...form, titre: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Type d'événement</label>
                  <select className="input" value={form.type_evenement}
                    onChange={e => setForm({ ...form, type_evenement: e.target.value })}>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Salle</label>
                  <select className="input" value={form.salle_id} onChange={e => onChangeSalle(e.target.value)}>
                    <option value="">— Aucune —</option>
                    {salles.map(s => <option key={s.id} value={s.id}>{s.nom} (cap. {s.capacite})</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Nom organisateur *</label>
                  <input className="input" required value={form.nom_organisateur}
                    onChange={e => setForm({ ...form, nom_organisateur: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Téléphone organisateur</label>
                  <input className="input" value={form.telephone_organisateur}
                    onChange={e => setForm({ ...form, telephone_organisateur: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="form-label">Email organisateur</label>
                  <input type="email" className="input" value={form.email_organisateur}
                    onChange={e => setForm({ ...form, email_organisateur: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Date début *</label>
                  <input type="date" className="input" required value={form.date_debut}
                    onChange={e => setForm({ ...form, date_debut: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Date fin *</label>
                  <input type="date" className="input" required value={form.date_fin}
                    onChange={e => setForm({ ...form, date_fin: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Heure début</label>
                  <input type="time" className="input" value={form.heure_debut}
                    onChange={e => setForm({ ...form, heure_debut: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Heure fin</label>
                  <input type="time" className="input" value={form.heure_fin}
                    onChange={e => setForm({ ...form, heure_fin: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Participants</label>
                  <input type="number" min="0" className="input" value={form.nombre_participants}
                    onChange={e => setForm({ ...form, nombre_participants: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Formule</label>
                  <select className="input" value={form.formule} onChange={e => onChangeFormule(e.target.value)}>
                    {Object.entries(FORMULE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Montant HT (XAF)</label>
                  <input type="number" min="0" className="input" value={form.montant_ht}
                    onChange={e => setForm({ ...form, montant_ht: e.target.value })}
                    placeholder="Auto depuis la salle" />
                </div>
                <div>
                  <label className="form-label">Montant TTC (XAF)</label>
                  <input type="number" min="0" className="input" value={form.montant_ttc}
                    onChange={e => setForm({ ...form, montant_ttc: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Acompte (XAF)</label>
                  <input type="number" min="0" className="input" value={form.acompte}
                    onChange={e => setForm({ ...form, acompte: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Statut</label>
                  <select className="input" value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value })}>
                    {STATUTS_ORDRE.map(s => <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="form-label">Notes</label>
                  <textarea className="input h-20 resize-none" value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? '…' : editingId ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
