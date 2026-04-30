'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// reservations.validator.js
//
// Validation de FORMAT uniquement.
// Aucune règle métier, aucune requête DB.
// Retourne { ok: true } ou { ok: false, erreurs: [{ champ, message }] }
// ─────────────────────────────────────────────────────────────────────────────

const SOURCES_VALIDES   = ['online', 'reception', 'telephone', 'ota', 'direct']
const REGIMES_VALIDES   = ['chambre_seule', 'bb', 'demi_pension', 'pension_complete']
const STATUTS_ANNULABLES = ['tentative', 'confirmee']

function err(champ, message) { return { champ, message } }

function estUUID(val) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)
}

function estDateISO(val) {
  if (!val || typeof val !== 'string') return false
  const d = new Date(val)
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(val)
}

// ── Création réservation ──────────────────────────────────────────────────────

function validerCreation(body) {
  const erreurs = []
  if (!body) return { ok: false, erreurs: [err('body', 'Corps de requête manquant')] }

  // Client
  if (!body.client_id)
    erreurs.push(err('client_id', 'requis'))
  else if (!estUUID(body.client_id))
    erreurs.push(err('client_id', 'doit être un UUID valide'))

  // Chambre (optionnelle — réservation sans chambre affectée autorisée)
  if (body.chambre_id !== undefined && body.chambre_id !== null && !estUUID(body.chambre_id))
    erreurs.push(err('chambre_id', 'doit être un UUID valide'))

  // Dates
  if (!body.date_arrivee)
    erreurs.push(err('date_arrivee', 'requis (YYYY-MM-DD)'))
  else if (!estDateISO(body.date_arrivee))
    erreurs.push(err('date_arrivee', 'format invalide (YYYY-MM-DD)'))

  if (!body.date_depart)
    erreurs.push(err('date_depart', 'requis (YYYY-MM-DD)'))
  else if (!estDateISO(body.date_depart))
    erreurs.push(err('date_depart', 'format invalide (YYYY-MM-DD)'))

  // Cohérence dates — vérification format uniquement, pas de règle métier
  if (estDateISO(body.date_arrivee) && estDateISO(body.date_depart)) {
    if (new Date(body.date_depart) <= new Date(body.date_arrivee))
      erreurs.push(err('date_depart', 'doit être postérieure à date_arrivee'))
  }

  // Occupants
  if (body.nombre_adultes !== undefined) {
    const n = parseInt(body.nombre_adultes)
    if (isNaN(n) || n < 1 || n > 20)
      erreurs.push(err('nombre_adultes', 'entier entre 1 et 20'))
  }
  if (body.nombre_enfants !== undefined) {
    const n = parseInt(body.nombre_enfants)
    if (isNaN(n) || n < 0 || n > 20)
      erreurs.push(err('nombre_enfants', 'entier entre 0 et 20'))
  }

  // Source
  if (body.source !== undefined && !SOURCES_VALIDES.includes(body.source))
    erreurs.push(err('source', `valeur invalide — acceptées : ${SOURCES_VALIDES.join(', ')}`))

  // Régime
  if (body.regime_repas !== undefined && !REGIMES_VALIDES.includes(body.regime_repas))
    erreurs.push(err('regime_repas', `valeur invalide — acceptées : ${REGIMES_VALIDES.join(', ')}`))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Check-in ──────────────────────────────────────────────────────────────────

function validerCheckin(params) {
  const erreurs = []
  if (!params.id || !estUUID(params.id))
    erreurs.push(err('id', 'identifiant de réservation invalide'))
  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Check-out ─────────────────────────────────────────────────────────────────

function validerCheckout(params) {
  const erreurs = []
  if (!params.id || !estUUID(params.id))
    erreurs.push(err('id', 'identifiant de réservation invalide'))
  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Annulation ────────────────────────────────────────────────────────────────

function validerAnnulation(body) {
  const erreurs = []
  // La raison est recommandée mais pas bloquante — règle métier dans le service
  if (body && body.raison !== undefined && typeof body.raison !== 'string')
    erreurs.push(err('raison', 'doit être une chaîne de caractères'))
  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

module.exports = {
  validerCreation,
  validerCheckin,
  validerCheckout,
  validerAnnulation,
}
