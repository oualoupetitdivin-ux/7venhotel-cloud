'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// chambres.validator.js
//
// Validation de FORMAT uniquement.
// Aucune règle métier, aucune requête DB.
// Retourne { ok: true } ou { ok: false, erreurs: [{champ, message}] }
// ─────────────────────────────────────────────────────────────────────────────

const STATUTS_VALIDES = [
  'libre_propre', 'occupee', 'sale',
  'nettoyage', 'inspection', 'hors_service', 'maintenance',
]

// ── Helpers internes ──────────────────────────────────────────────────────────

function err(champ, message) {
  return { champ, message }
}

function estEntierPositif(val) {
  return Number.isInteger(Number(val)) && Number(val) >= 0
}

function estDecimalPositif(val) {
  const n = parseFloat(val)
  return !isNaN(n) && n >= 0
}

// ── Règles communes corps chambre ─────────────────────────────────────────────

function validerChampsChambre(body, creation) {
  const erreurs = []

  // numero
  if (creation && !body.numero?.toString().trim())
    erreurs.push(err('numero', 'requis'))
  else if (body.numero !== undefined && !body.numero.toString().trim())
    erreurs.push(err('numero', 'ne peut pas être vide'))

  // etage
  if (creation && body.etage === undefined)
    erreurs.push(err('etage', 'requis'))
  else if (body.etage !== undefined && !estEntierPositif(body.etage))
    erreurs.push(err('etage', 'doit être un entier positif ou nul'))

  // statut
  if (body.statut !== undefined && !STATUTS_VALIDES.includes(body.statut))
    erreurs.push(err('statut', `valeur invalide — acceptés : ${STATUTS_VALIDES.join(', ')}`))

  // superficie_m2
  if (body.superficie_m2 !== undefined && body.superficie_m2 !== null) {
    const s = parseFloat(body.superficie_m2)
    if (isNaN(s) || s <= 0 || s > 9999)
      erreurs.push(err('superficie_m2', 'doit être un nombre entre 0 et 9999'))
  }

  // tarif_specifique
  if (body.tarif_specifique !== undefined && body.tarif_specifique !== null) {
    if (!estDecimalPositif(body.tarif_specifique))
      erreurs.push(err('tarif_specifique', 'doit être un nombre positif ou nul'))
  }

  // lits
  if (body.lits !== undefined && !Array.isArray(body.lits))
    erreurs.push(err('lits', 'doit être un tableau'))

  // caracteristiques
  if (body.caracteristiques !== undefined && !Array.isArray(body.caracteristiques))
    erreurs.push(err('caracteristiques', 'doit être un tableau'))

  return erreurs
}

// ── Exports ───────────────────────────────────────────────────────────────────

function validerCreation(body) {
  const erreurs = validerChampsChambre(body, true)
  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

function validerModification(body) {
  if (!body || !Object.keys(body).length)
    return { ok: false, erreurs: [err('body', 'au moins un champ est requis')] }

  const erreurs = validerChampsChambre(body, false)
  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

function validerDisponibilite(query) {
  const erreurs = []
  const { date_arrivee, date_depart } = query

  if (!date_arrivee) erreurs.push(err('date_arrivee', 'requis (YYYY-MM-DD)'))
  if (!date_depart)  erreurs.push(err('date_depart',  'requis (YYYY-MM-DD)'))
  if (erreurs.length) return { ok: false, erreurs }

  const dA = new Date(date_arrivee)
  const dD = new Date(date_depart)

  if (isNaN(dA.getTime())) erreurs.push(err('date_arrivee', 'format invalide (YYYY-MM-DD)'))
  if (isNaN(dD.getTime())) erreurs.push(err('date_depart',  'format invalide (YYYY-MM-DD)'))
  if (erreurs.length) return { ok: false, erreurs }

  if (dD <= dA)
    erreurs.push(err('date_depart', 'doit être postérieure à date_arrivee'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

function validerChangementStatut(body) {
  const erreurs = []

  if (!body || (body.statut === undefined && body.hors_service === undefined))
    return { ok: false, erreurs: [err('body', '"statut" ou "hors_service" requis')] }

  if (body.statut !== undefined && !STATUTS_VALIDES.includes(body.statut))
    erreurs.push(err('statut', `valeur invalide — acceptés : ${STATUTS_VALIDES.join(', ')}`))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

module.exports = {
  validerCreation,
  validerModification,
  validerDisponibilite,
  validerChangementStatut,
}
