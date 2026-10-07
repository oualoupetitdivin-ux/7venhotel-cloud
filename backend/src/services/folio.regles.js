'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// folio.regles.js — règles métier du folio (LOT-PMS-02)
//
// Source de vérité : lignes_folio (immuables) + get_solde_folio (SQL).
// Aucun compte comptable ici : le folio parle métier, la Finance traduit.
//
// Ventilation d'un folio :
//   ventes  = lignes débit de consommation (hébergement, restaurant, taxes, extras…)
//             − remises (crédit) − corrections de consommations
//   arrhes  = crédits 'arrhes' − débits 'arrhes' (remboursement / acquisition)
//   paye    = crédits 'paiement' − corrections de paiement
//   ventes − arrhes − paye = solde_du (get_solde_folio)
//
// Cycle de vie : ouvert → (checkout) → en_attente si solde ≠ 0, cloture si solde = 0
//                en_attente ⇄ cloture au gré des règlements / corrections. Jamais de retour à 'ouvert'.
// ─────────────────────────────────────────────────────────────────────────────

const c = (v) => Math.round(Number(v || 0) * 100)
const d = (x) => Math.round(x) / 100

const TYPES_REGLEMENT = ['paiement', 'arrhes']

function ventilerLignes(lignes) {
  const parId = Object.fromEntries(lignes.map(l => [l.id, l]))
  let ht = 0, taxes = 0, arrhes = 0, paye = 0
  for (const l of lignes) {
    const m = c(l.montant_total)
    const signe = l.sens === 'debit' ? 1 : -1
    let type = l.type_ligne
    if (type === 'correction') {
      const orig = parId[l.ligne_corrigee_id]
      type = orig ? orig.type_ligne : 'autre'
    }
    if (type === 'paiement')      paye   -= signe * m      // crédit paiement = +paye ; correction (débit) = −paye
    else if (type === 'arrhes')   arrhes -= signe * m
    else if (type === 'taxe')     taxes  += signe * m
    else                          ht     += signe * m      // consommations, remises (crédit)
  }
  const ttc = ht + taxes
  return { ht: d(ht), taxes: d(taxes), ttc: d(ttc), arrhes: d(arrhes), paye: d(paye), du: d(ttc - arrhes - paye) }
}

async function solde(trx, folioId, hotelId) {
  const { rows } = await trx.raw('SELECT solde_du FROM get_solde_folio(?, ?)', [folioId, hotelId])
  return Number(rows[0] ? rows[0].solde_du : 0)
}

// Après checkout : aligne le statut sur le solde (en_attente ⇄ cloture). Ne touche pas un folio 'ouvert'.
async function recalculerStatut(trx, folioId, hotelId, acteurId) {
  const folio = await trx('folios').where({ id: folioId, hotel_id: hotelId }).forUpdate().first()
  if (!folio || folio.statut === 'ouvert') return folio
  const s = await solde(trx, folioId, hotelId)
  const statut = s === 0 ? 'cloture' : 'en_attente'
  const champs = { statut, solde_total: s, mis_a_jour_le: trx.fn.now() }
  if (statut === 'cloture' && folio.statut !== 'cloture') { champs.cloture_le = trx.fn.now(); champs.cloture_par = acteurId || null }
  if (statut === 'en_attente') { champs.cloture_le = null; champs.cloture_par = null }
  const [maj] = await trx('folios').where({ id: folioId, hotel_id: hotelId }).update(champs).returning('*')
  return maj
}

// Checkout : sortie de l'état 'ouvert'
async function fermerAuCheckout(trx, folioId, hotelId, acteurId) {
  const s = await solde(trx, folioId, hotelId)
  const statut = s === 0 ? 'cloture' : 'en_attente'
  const [maj] = await trx('folios').where({ id: folioId, hotel_id: hotelId, statut: 'ouvert' }).update({
    statut, solde_total: s, mis_a_jour_le: trx.fn.now(),
    cloture_le: statut === 'cloture' ? trx.fn.now() : null,
    cloture_par: statut === 'cloture' ? (acteurId || null) : null,
  }).returning('*')
  return maj
}

module.exports = { ventilerLignes, solde, recalculerStatut, fermerAuCheckout, TYPES_REGLEMENT }
