'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams }   from 'next/navigation'
import Link            from 'next/link'
import AppLayout       from '@/components/layout/AppLayout'
import PortailModal    from '@/components/PortailModal'
import { reservationsAPI, facturationAPI, arrhesAPI, API_ORIGIN } from '@/lib/api'
import { fmt, fmtDate, fmtDateTime, STATUT_RESERVATION_COULEUR } from '@/lib/utils'
import toast           from 'react-hot-toast'

const STATUT_LABEL = {
  tentative:          'Tentative',
  confirmee:          'Confirmée',
  arrivee:            'En séjour',
  depart_aujourd_hui: "Départ aujourd'hui",
  annulee:            'Annulée',
  no_show:            'No show',
  terminee:           'Terminée',
}

const TYPES_PAIEMENT = [
  { val: 'especes',      label: '💵 Espèces' },
  { val: 'carte',        label: '💳 Carte bancaire' },
  { val: 'virement',     label: '🏦 Virement' },
  { val: 'mobile_money', label: '📱 Mobile Money' },
]

const STATUT_PAY = {
  valide:     { label: 'Validé',     cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  en_attente: { label: 'En attente', cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
  annule:     { label: 'Annulé',     cls: 'bg-[var(--bg-4)] text-[var(--text-4)] border border-[var(--border-1)]' },
}


export default function DetailReservation() {
  const { id } = useParams()

  const [res,        setRes]        = useState(null)
  const [folio,      setFolio]      = useState(null)
  const [folioErr,   setFolioErr]   = useState(null)
  const [paiements,  setPaiements]  = useState([])
  const [facture,    setFacture]    = useState(null)    // facture associée (après checkout)
  const [garantie,   setGarantie]   = useState(null)   // arrhes liées
  const [loading,    setLoading]    = useState(true)
  const [portail,    setPortail]    = useState(null)    // { url_portail } après check-in

  const [payForm, setPayForm]   = useState({ type_paiement: 'especes', montant: '', telephone: '' })
  const [paying,  setPaying]    = useState(false)
  const [confirmingPay, setConfirmingPay] = useState(null)

  const [checkoutConfirm, setCheckoutConfirm] = useState(false)
  const [checkingOut,     setCheckingOut]     = useState(false)
  const [arrhesModal,     setArrhesModal]     = useState(false)
  const [arrhesForm,      setArrhesForm]      = useState({ montant: '', mode_paiement: 'especes' })
  const [arrhesCreating,  setArrhesCreating]  = useState(false)

  const chargerPaiements = useCallback(async (folioId) => {
    try {
      const { data } = await facturationAPI.paiementsFolio(folioId)
      setPaiements(data.paiements || [])
    } catch {}
  }, [])

  const charger = useCallback(async () => {
    setLoading(true)
    setFolioErr(null)

    let resData = null
    try {
      const { data: r } = await reservationsAPI.obtenir(id)
      resData = r.reservation ?? r
      setRes(resData)
    } catch {
      toast.error('Réservation introuvable')
      setLoading(false)
      return
    }

    // Folio
    try {
      const { data: f } = await facturationAPI.folioReservation(id)
      setFolio(f)
      if (f?.folio?.id) {
        const solde = f.solde?.solde_du ?? 0
        if (solde > 0) {
          setPayForm(p => ({ ...p, montant: String(Math.round(solde)) }))
        } else {
          setPayForm(p => ({ ...p, montant: '' }))
        }
        await chargerPaiements(f.folio.id)
      }
    } catch (err) {
      const code = err?.response?.status
      const msg  = err?.response?.data?.erreur || err?.message
      setFolioErr(code === 403
        ? 'Accès au folio non autorisé (permission facturation.lire requise)'
        : code === 404
          ? 'Aucun folio associé à cette réservation'
          : `Folio indisponible (${code || 'réseau'}) — ${msg}`)
      setFolio(null)
    }

    // Facture (disponible après checkout)
    try {
      const { data: fData } = await facturationAPI.factureParReservation(id)
      setFacture(fData.facture || null)
    } catch {}

    // Garantie arrhes
    try {
      const { data: gData } = await arrhesAPI.parReservation(id)
      setGarantie(gData.garantie || null)
    } catch {}

    setLoading(false)
  }, [id, chargerPaiements])

  useEffect(() => { charger() }, [charger])

  async function confirmer() {
    if (!window.confirm('Confirmer manuellement cette réservation ?')) return
    try { await reservationsAPI.confirmer(id); toast.success('Réservation confirmée'); charger() }
    catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur') }
  }

  async function annuler() {
    const motif = window.prompt("Motif d'annulation (obligatoire) :")
    if (!motif?.trim()) return
    try { await reservationsAPI.annuler(id, { motif: motif.trim() }); toast.success('Réservation annulée'); charger() }
    catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur') }
  }

  async function checkin() {
    const ok = window.confirm(
      `Check-in — ${res.nom_client || 'Client'}\n` +
      `Ch. ${res.numero_chambre || '?'} · Arrivée ${fmtDate(res.date_arrivee)} · Départ ${fmtDate(res.date_depart)}\n\n` +
      `Confirmer le check-in ?`
    )
    if (!ok) return
    try {
      const { data } = await reservationsAPI.checkin(id)
      toast.success('Check-in effectué !')
      if (data?.token_portail) setPortail({ url: `${window.location.origin}/room-portal/${data.token_portail}` })
      await charger()
    }
    catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur check-in') }
  }

  async function executerCheckout() {
    setCheckingOut(true)
    try {
      await reservationsAPI.checkout(id)
      toast.success('Check-out effectué ! Facture générée.')
      setCheckoutConfirm(false)
      await charger()
    }
    catch (err) { toast.error(err?.response?.data?.erreur || 'Erreur check-out') }
    finally { setCheckingOut(false) }
  }

  async function creerArrhes(e) {
    e.preventDefault()
    setArrhesCreating(true)
    try {
      const payload = {
        reservation_id: id,
        mode_paiement: arrhesForm.mode_paiement,
        ...(arrhesForm.montant ? { montant_personnalise: parseFloat(arrhesForm.montant) } : {}),
      }
      await arrhesAPI.creer(payload)
      toast.success('Demande d\'arrhes créée !')
      setArrhesModal(false)
      setArrhesForm({ montant: '', mode_paiement: 'especes' })
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur création arrhes')
    } finally { setArrhesCreating(false) }
  }

  async function confirmerMobileMoney(paiementId) {
    if (confirmingPay) return
    setConfirmingPay(paiementId)
    try {
      await facturationAPI.confirmerPaiement({ paiement_id: paiementId })
      toast.success('Paiement Mobile Money confirmé !')
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || 'Erreur confirmation paiement')
    } finally { setConfirmingPay(null) }
  }

  async function encaisser(e) {
    e.preventDefault()
    const montant = parseFloat(payForm.montant)
    if (!montant || montant <= 0) return toast.error('Montant invalide')
    if (payForm.type_paiement === 'mobile_money' && !payForm.telephone?.trim())
      return toast.error('Numéro de téléphone requis pour Mobile Money')
    if (!folio?.folio?.id) return toast.error('Folio non chargé — rechargez la page')

    const payload = {
      folio_id:      folio.folio.id,
      type_paiement: payForm.type_paiement,
      montant,
      devise:        folio.folio.devise || 'XAF',
      ...(payForm.type_paiement === 'mobile_money' && payForm.telephone
        ? { numero_telephone: payForm.telephone.trim() } : {}),
    }

    try {
      setPaying(true)
      await facturationAPI.paiement(payload)
      if (payForm.type_paiement === 'mobile_money') {
        toast('📱 Paiement initié — en attente de confirmation opérateur', { icon: '⏳', duration: 5000 })
      } else {
        toast.success('✅ Paiement enregistré')
      }
      await charger()
    } catch (err) {
      toast.error(err?.response?.data?.erreur || "Erreur lors de l'encaissement")
    } finally { setPaying(false) }
  }

  async function telechargerFacture() {
    if (!facture?.id) return
    try {
      const token   = localStorage.getItem('7vh_token')
      const hotelId = localStorage.getItem('7vh_hotel_id')
      const url = `${API_ORIGIN}/api/v1/facturation/factures/${facture.id}/pdf`
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Hotel-ID': hotelId || '',
        }
      })
      if (!res.ok) { toast.error('PDF indisponible'); return }
      const blob   = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `${facture.numero_facture}.pdf`
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch { toast.error('Téléchargement PDF impossible') }
  }

  // ── États de chargement ────────────────────────────────────────────────────

  if (loading) return (
    <AppLayout titre="Réservation" sousTitre="Chargement…">
      <div className="space-y-4">
        <div className="skeleton h-24 rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          <div className="skeleton h-64 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    </AppLayout>
  )

  if (!res) return (
    <AppLayout titre="Réservation" sousTitre="Introuvable">
      <div className="text-center py-16 text-[var(--text-3)]">
        <div className="text-4xl mb-3">📋</div>
        <div className="mb-3">Réservation introuvable</div>
        <Link href="/reservations" className="text-blue-400 text-sm">← Retour à la liste</Link>
      </div>
    </AppLayout>
  )

  const peutConfirmer = res.statut === 'tentative'
  const peutAnnuler   = res.statut === 'tentative' || res.statut === 'confirmee'
  const peutCheckin   = res.statut === 'confirmee'
  const peutCheckout  = res.statut === 'arrivee' || res.statut === 'depart_aujourd_hui'

  const soldeDu  = folio?.solde?.solde_du ?? 0
  const devFolio = folio?.folio?.devise || res.devise || 'XAF'

  const peutEncaisser = !['annulee', 'no_show'].includes(res.statut) &&
    (res.statut !== 'terminee' || soldeDu > 0)

  return (
    <AppLayout titre={res.numero_reservation || 'Réservation'} sousTitre="Détail du séjour">

      {/* Modale portail chambre après check-in */}
      {portail && (
        <PortailModal urlPortail={portail.url} onClose={() => setPortail(null)} />
      )}

      {/* Modale confirmation check-out */}
      {checkoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !checkingOut && setCheckoutConfirm(false)}>
          <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="card-header border-b border-[var(--border-1)]">
              <div className="card-title">Confirmer le check-out</div>
              <button onClick={() => setCheckoutConfirm(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] text-xl leading-none">×</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-sm text-[var(--text-1)]">
                <span className="font-bold">{res.numero_reservation}</span> — {res.nom_client || ''}
              </div>
              {soldeDu > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg px-3 py-2 text-xs font-bold">
                  ⚠ Solde impayé : {fmt(soldeDu, devFolio)}
                </div>
              )}
              <div className="text-xs text-[var(--text-3)]">
                Le check-out est irréversible. La facture sera générée automatiquement.
              </div>
            </div>
            <div className="border-t border-[var(--border-1)] px-4 py-3 flex gap-2 justify-end">
              <button onClick={() => setCheckoutConfirm(false)} disabled={checkingOut}
                className="btn btn-ghost btn-sm">Annuler</button>
              <button onClick={executerCheckout} disabled={checkingOut}
                className="btn btn-primary btn-sm">
                {checkingOut ? 'En cours…' : 'Confirmer le check-out →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale création arrhes */}
      {arrhesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !arrhesCreating && setArrhesModal(false)}>
          <div className="card w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="card-header border-b border-[var(--border-1)]">
              <div className="card-title">🔐 Demande d'arrhes</div>
              <button onClick={() => setArrhesModal(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)] text-xl leading-none">×</button>
            </div>
            <form onSubmit={creerArrhes} className="p-4 space-y-3">
              <div className="text-xs text-[var(--text-3)]">
                Réservation : <span className="font-bold text-[var(--text-1)]">{res.numero_reservation}</span>
                {res.total_general && <span> · Total : {fmt(res.total_general, res.devise || 'XAF')}</span>}
              </div>
              <div>
                <label className="form-label">Montant demandé (laisser vide = % configuré)</label>
                <input className="input" type="number" min="0" step="500"
                  placeholder="ex: 25000"
                  value={arrhesForm.montant}
                  onChange={e => setArrhesForm(f => ({ ...f, montant: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Mode de paiement attendu</label>
                <select className="input" value={arrhesForm.mode_paiement}
                  onChange={e => setArrhesForm(f => ({ ...f, mode_paiement: e.target.value }))}>
                  <option value="especes">💵 Espèces</option>
                  <option value="carte">💳 Carte bancaire</option>
                  <option value="virement">🏦 Virement</option>
                  <option value="mobile_money">📱 Mobile Money</option>
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setArrhesModal(false)} disabled={arrhesCreating}
                  className="btn btn-ghost btn-sm">Annuler</button>
                <button type="submit" disabled={arrhesCreating} className="btn btn-primary btn-sm">
                  {arrhesCreating ? 'Création…' : '+ Créer la demande'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="space-y-5 max-w-4xl">

        {/* Barre d'actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link href="/reservations" className="text-sm text-[var(--text-3)] hover:text-[var(--text-1)]">
            ← Toutes les réservations
          </Link>
          <div className="flex gap-2 flex-wrap">
            {peutConfirmer && <button onClick={confirmer} className="btn btn-primary btn-sm">✓ Confirmer</button>}
            {peutCheckin   && <button onClick={checkin}   className="btn btn-primary btn-sm">Check-in →</button>}
            {peutCheckout  && <button onClick={() => setCheckoutConfirm(true)} className="btn btn-ghost btn-sm">Check-out →</button>}
            {peutAnnuler   && <button onClick={annuler}   className="btn btn-danger btn-sm">✕ Annuler</button>}
            {facture?.id   && (
              <button onClick={telechargerFacture} className="btn btn-ghost btn-sm">
                🧾 Télécharger la facture
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">

          {/* ── Colonne principale ── */}
          <div className="col-span-2 space-y-5">

            {/* Infos réservation */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Réservation</div>
                <span className={`badge ${STATUT_RESERVATION_COULEUR[res.statut] || 'badge-gray'}`}>
                  {STATUT_LABEL[res.statut] || res.statut}
                </span>
              </div>
              <div className="p-4 grid grid-cols-2 gap-4 text-sm">
                {[
                  ['N° Réservation', <span key="nr" className="font-mono font-bold text-blue-400">{res.numero_reservation}</span>],
                  ['Source', res.source === 'ota' ? '🌐 OTA' : res.source === 'online' ? '🌐 En ligne' : `🏨 ${res.source || 'Réception'}`],
                  ['Arrivée', fmtDate(res.date_arrivee)],
                  ['Départ',  fmtDate(res.date_depart)],
                  ['Nuits',   res.nombre_nuits || '—'],
                  ['Créée le', fmtDate(res.cree_le)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-xs text-[var(--text-3)] mb-0.5">{l}</div>
                    <div className="font-medium text-[var(--text-1)]">{v}</div>
                  </div>
                ))}
                {res.notes_internes && (
                  <div className="col-span-2">
                    <div className="text-xs text-[var(--text-3)] mb-0.5">Notes internes</div>
                    <div className="text-[var(--text-2)] text-xs italic">{res.notes_internes}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Chambre */}
            <div className="card">
              <div className="card-header"><div className="card-title">🛏 Chambre</div></div>
              <div className="p-4 grid grid-cols-2 gap-4 text-sm">
                {[
                  ['Numéro', res.numero_chambre ? `Ch. ${res.numero_chambre}` : '—'],
                  ['Type',   res.type_chambre || '—'],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-xs text-[var(--text-3)] mb-0.5">{l}</div>
                    <div className="font-medium text-[var(--text-1)]">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Facture (après checkout) */}
            {facture && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">🧾 Facture</div>
                  <span className="badge badge-green">Émise</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-mono font-bold text-blue-400 text-sm">{facture.numero_facture}</div>
                    <div className="text-xs text-[var(--text-3)] mt-0.5">
                      Total TTC : {fmt(facture.montant_ttc, facture.devise)}
                      {facture.montant_taxes > 0 && ` · Dont taxes : ${fmt(facture.montant_taxes, facture.devise)}`}
                    </div>
                  </div>
                  <button onClick={telechargerFacture} className="btn btn-primary btn-sm">
                    ↓ PDF
                  </button>
                </div>
              </div>
            )}

            {/* ── Folio + Encaissement ── */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">💳 Folio & Encaissement</div>
                {folio?.folio && (
                  <span className={`badge ${folio.folio.statut === 'cloture' ? 'badge-gray' : 'badge-blue'}`}>
                    {folio.folio.statut === 'cloture' ? 'Clôturé' : 'Ouvert'}
                  </span>
                )}
              </div>

              {folioErr && (
                <div className="mx-4 my-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  ⚠ {folioErr}
                </div>
              )}

              {folio?.lignes?.length > 0 && (
                <div className="border-b border-[var(--border-1)] overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-1)]">
                        <th className="text-left px-4 py-2 text-[var(--text-3)]">Description</th>
                        <th className="text-right px-4 py-2 text-[var(--text-3)]">Montant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {folio.lignes.map(l => (
                        <tr key={l.id} className="border-b border-[var(--border-1)] last:border-0">
                          <td className="px-4 py-2 text-[var(--text-2)]">{l.description}</td>
                          <td className={`px-4 py-2 text-right font-medium ${l.sens === 'credit' ? 'text-emerald-400' : 'text-[var(--text-1)]'}`}>
                            {l.sens === 'credit' ? '−' : ''}{fmt(l.montant, devFolio)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {folio?.solde && (
                <div className="px-4 py-3 border-b border-[var(--border-1)] flex justify-between items-center">
                  <span className="text-sm font-bold text-[var(--text-2)]">Solde dû</span>
                  <span className={`text-sm font-black ${soldeDu > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {fmt(soldeDu, devFolio)}
                    {soldeDu <= 0 && <span className="ml-2 text-[10px] font-normal">✓ Soldé</span>}
                  </span>
                </div>
              )}

              {paiements.length > 0 && (
                <div className="border-b border-[var(--border-1)]">
                  <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-4)]">
                    Paiements enregistrés
                  </div>
                  {paiements.map(p => {
                    const sp = STATUT_PAY[p.statut] || { label: p.statut, cls: 'bg-[var(--bg-4)] text-[var(--text-3)]' }
                    return (
                      <div key={p.id} className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-0)] last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-[var(--text-1)]">
                            {TYPES_PAIEMENT.find(t => t.val === p.type_paiement)?.label || p.type_paiement}
                          </div>
                          <div className="text-[10px] text-[var(--text-4)]">{fmtDateTime(p.cree_le)}</div>
                          {p.numero_telephone && <div className="text-[10px] text-[var(--text-4)]">📱 {p.numero_telephone}</div>}
                        </div>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${sp.cls}`}>{sp.label}</span>
                        <span className="text-xs font-bold text-[var(--text-1)] tabular-nums">{fmt(p.montant, devFolio)}</span>
                        {p.type_paiement === 'mobile_money' && p.statut === 'en_attente' && (
                          <button
                            onClick={() => confirmerMobileMoney(p.id)}
                            disabled={confirmingPay === p.id}
                            className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors">
                            {confirmingPay === p.id ? '…' : '✓ Confirmer réception'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {peutEncaisser && folio?.folio?.id && folio.folio.statut !== 'cloture' && soldeDu > 0 && (
                <form onSubmit={encaisser} className="p-4 space-y-3 border-t border-[var(--border-1)]">
                  <div className="text-xs font-bold text-[var(--text-1)] mb-3">Encaisser un paiement</div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Type</label>
                      <select className="input text-xs" value={payForm.type_paiement}
                        onChange={e => setPayForm(p => ({ ...p, type_paiement: e.target.value, telephone: '' }))}>
                        {TYPES_PAIEMENT.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">
                        Montant ({devFolio})
                        {soldeDu > 0 && <span className="ml-1 text-amber-400 font-normal"> — dû : {fmt(soldeDu, devFolio)}</span>}
                      </label>
                      <input type="number" className="input text-xs" step="1" min="1"
                        value={payForm.montant}
                        onChange={e => setPayForm(p => ({ ...p, montant: e.target.value }))}
                        placeholder={soldeDu > 0 ? String(Math.round(soldeDu)) : 'Montant'} />
                    </div>
                  </div>

                  {payForm.type_paiement === 'mobile_money' && (
                    <div>
                      <label className="form-label">Numéro de téléphone *</label>
                      <input type="tel" className="input text-xs" placeholder="6XXXXXXXX"
                        value={payForm.telephone}
                        onChange={e => setPayForm(p => ({ ...p, telephone: e.target.value }))} />
                      <div className="mt-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[10px] text-amber-400">
                        ⏳ Le paiement Mobile Money sera marqué <strong>en attente</strong> jusqu&apos;à confirmation de l&apos;opérateur.
                      </div>
                    </div>
                  )}

                  <button type="submit"
                    disabled={paying || !payForm.montant || parseFloat(payForm.montant) <= 0}
                    className="btn btn-primary btn-sm">
                    {paying ? 'Enregistrement…' : '✓ Encaisser'}
                  </button>
                </form>
              )}

              {!folio && !folioErr && (
                <div className="p-6 text-center text-xs text-[var(--text-4)]">Chargement du folio…</div>
              )}
            </div>
          </div>

          {/* ── Colonne latérale ── */}
          <div className="space-y-5">

            {/* Client */}
            <div className="card">
              <div className="card-header"><div className="card-title">👤 Client</div></div>
              <div className="p-4 space-y-3 text-sm">
                <div>
                  <div className="font-bold text-[var(--text-1)] text-base">{res.nom_client || '—'}</div>
                  {res.email_client     && <div className="text-xs text-[var(--text-3)]">{res.email_client}</div>}
                  {res.telephone_client && <div className="text-xs text-[var(--text-3)]">{res.telephone_client}</div>}
                </div>
                {res.client_id && (
                  <Link href={`/clients/${res.client_id}`} className="btn btn-ghost btn-xs w-full justify-center">
                    Voir la fiche client →
                  </Link>
                )}
              </div>
            </div>

            {/* Montant */}
            <div className="card">
              <div className="card-header"><div className="card-title">💰 Montant</div></div>
              <div className="p-4 space-y-2">
                <div>
                  <div className="text-[10px] text-[var(--text-4)] mb-0.5">Total réservation TTC</div>
                  <div className="text-2xl font-black text-[var(--text-1)]">{fmt(res.total_general, res.devise)}</div>
                </div>
                {folio?.solde && (
                  <div className={`mt-3 px-3 py-2 rounded-lg text-sm font-bold ${
                    soldeDu > 0
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                      : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  }`}>
                    {soldeDu > 0 ? `Reste dû : ${fmt(soldeDu, devFolio)}` : '✓ Entièrement soldé'}
                  </div>
                )}
              </div>
            </div>

            {/* Arrhes & Garantie */}
            {garantie ? (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">🔐 Arrhes</div>
                  <span className={`badge ${
                    garantie.statut === 'complete'   ? 'badge-green'  :
                    garantie.statut === 'partielle'  ? 'badge-amber'  :
                    garantie.statut === 'acquise'    ? 'badge-purple' :
                    garantie.statut === 'remboursee' ? 'badge-blue'   :
                    garantie.statut === 'annulee'    ? 'badge-gray'   : 'badge-amber'
                  }`}>
                    {{ en_attente:'En attente', partielle:'Partielle', complete:'Complète',
                       remboursee:'Remboursée', acquise:'Acquise', annulee:'Annulée' }[garantie.statut] || garantie.statut}
                  </span>
                </div>
                <div className="p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-3)]">Demandé</span>
                    <span className="font-bold text-[var(--text-1)]">{fmt(garantie.montant_demande, garantie.devise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-3)]">Reçu</span>
                    <span className={`font-bold ${garantie.montant_recu >= garantie.montant_demande ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {fmt(garantie.montant_recu || 0, garantie.devise)}
                    </span>
                  </div>
                  {garantie.echeance_paiement && (
                    <div className="flex justify-between">
                      <span className="text-[var(--text-3)]">Échéance</span>
                      <span className={new Date(garantie.echeance_paiement) < new Date() && ['en_attente','partielle'].includes(garantie.statut) ? 'text-red-400 font-bold' : 'text-[var(--text-2)]'}>
                        {new Date(garantie.echeance_paiement).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                  )}
                  <div className="h-1.5 bg-[var(--bg-3)] rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.round(((garantie.montant_recu||0)/garantie.montant_demande)*100))}%` }} />
                  </div>
                  <Link href="/arrhes" className="btn btn-ghost btn-xs w-full justify-center mt-1">
                    Gérer → Module Arrhes
                  </Link>
                </div>
              </div>
            ) : !['annulee','no_show','terminee'].includes(res?.statut) && (
              <div className="card">
                <div className="card-header"><div className="card-title">🔐 Arrhes</div></div>
                <div className="p-4 text-center">
                  <div className="text-xs text-[var(--text-3)] mb-2">Aucune demande d'arrhes</div>
                  <button onClick={() => setArrhesModal(true)} className="btn btn-ghost btn-xs">
                    + Créer une demande
                  </button>
                </div>
              </div>
            )}

            {/* Portail chambre (si en séjour et token disponible) */}
            {(res.statut === 'arrivee' || res.statut === 'depart_aujourd_hui') && (
              <div className="card">
                <div className="card-header"><div className="card-title">📱 Portail chambre</div></div>
                <div className="p-4 text-center space-y-3">
                  <div className="text-xs text-[var(--text-3)]">
                    Le QR code a été affiché au check-in. Pour le réafficher :
                  </div>
                  <button
                    onClick={() => res.qr_token && setPortail({ url: `${window.location.origin}/room-portal/${res.qr_token}` })}
                    className="btn btn-ghost btn-xs w-full">
                    ↻ Réafficher le lien portail
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
