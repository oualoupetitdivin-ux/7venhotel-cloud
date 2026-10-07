'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// fiscalite.service.js — source fiscale unique (LOT-PMS-02)
//
// SOURCE NORMATIVE : table `taxes` (seule lue par les calculs : réservation, booking,
// restaurant, facturation, pont comptable).
//
// `parametres_hotel.tva_active / tva_taux / taxe_sejour_active / taxe_sejour_montant`
// existent pour l'écran Réglages (frontend/src/app/settings). Ils n'étaient lus par
// aucun calcul : modifier la TVA dans Réglages n'avait aucun effet. Ils deviennent une
// FAÇADE synchronisée dans les deux sens :
//   Réglages → taxes : synchroniserDepuisParametres()
//   taxes → Réglages : refleterDansParametres()
//
// Correspondance :
//   tva_taux (fraction, ex 0.1925) ↔ TVA_HOTEL (hebergement) et TVA_RESTO (restaurant), en %
//   tva_active                     ↔ active de TVA_HOTEL / TVA_RESTO
//   taxe_sejour_montant / _active  ↔ TAXE_SEJOUR (fixe par nuit, hebergement)
// css_active / css_taux : sémantique fiscale non définie (aucune taxe `taxes` équivalente,
// compte comptable inconnu) → NON synchronisés, sans effet sur les calculs (documenté).
// ─────────────────────────────────────────────────────────────────────────────

const TVA = [
  { code: 'TVA_HOTEL', nom: 'TVA Hôtellerie',  s_applique_a: 'hebergement' },
  { code: 'TVA_RESTO', nom: 'TVA Restaurant',  s_applique_a: 'restaurant' },
]

async function upsertTaxe(db, hotelId, code, valeurs, defauts) {
  const existante = await db('taxes').where({ hotel_id: hotelId, code }).first()
  if (existante) return db('taxes').where({ id: existante.id }).update(valeurs)
  return db('taxes').insert({ hotel_id: hotelId, code, incluse_prix: false, ...defauts, ...valeurs })
}

async function synchroniserDepuisParametres(db, hotelId, champs) {
  const faits = []
  if (champs.tva_taux !== undefined || champs.tva_active !== undefined) {
    const valeurs = {}
    if (champs.tva_taux !== undefined && champs.tva_taux !== null) valeurs.valeur = Math.round(Number(champs.tva_taux) * 10000) / 100
    if (champs.tva_active !== undefined) valeurs.active = !!champs.tva_active
    for (const t of TVA) {
      await upsertTaxe(db, hotelId, t.code, valeurs, { nom: t.nom, type_taxe: 'pourcentage', s_applique_a: t.s_applique_a, valeur: valeurs.valeur ?? 0 })
      faits.push(t.code)
    }
  }
  if (champs.taxe_sejour_montant !== undefined || champs.taxe_sejour_active !== undefined) {
    const valeurs = {}
    if (champs.taxe_sejour_montant !== undefined && champs.taxe_sejour_montant !== null) valeurs.valeur = Number(champs.taxe_sejour_montant)
    if (champs.taxe_sejour_active !== undefined) valeurs.active = !!champs.taxe_sejour_active
    await upsertTaxe(db, hotelId, 'TAXE_SEJOUR', valeurs, { nom: 'Taxe de séjour', type_taxe: 'fixe', s_applique_a: 'hebergement', valeur: valeurs.valeur ?? 0 })
    faits.push('TAXE_SEJOUR')
  }
  return faits
}

async function refleterDansParametres(db, hotelId) {
  const taxes = Object.fromEntries((await db('taxes').where({ hotel_id: hotelId })
    .whereIn('code', ['TVA_HOTEL', 'TAXE_SEJOUR'])).map(t => [t.code, t]))
  const maj = {}
  if (taxes.TVA_HOTEL) { maj.tva_taux = Math.round(Number(taxes.TVA_HOTEL.valeur) * 100) / 10000; maj.tva_active = !!taxes.TVA_HOTEL.active }
  if (taxes.TAXE_SEJOUR) { maj.taxe_sejour_montant = Math.round(Number(taxes.TAXE_SEJOUR.valeur)); maj.taxe_sejour_active = !!taxes.TAXE_SEJOUR.active }
  if (!Object.keys(maj).length) return null
  const existe = await db('parametres_hotel').where({ hotel_id: hotelId }).first()
  if (existe) await db('parametres_hotel').where({ hotel_id: hotelId }).update(maj)
  else await db('parametres_hotel').insert({ hotel_id: hotelId, ...maj })
  return maj
}

module.exports = { synchroniserDepuisParametres, refleterDansParametres }
