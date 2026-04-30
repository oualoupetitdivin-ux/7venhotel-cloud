'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// portail.validator.js
//
// Validation de FORMAT uniquement — aucune règle métier, aucune requête DB.
// Retourne { ok: true } ou { ok: false, erreurs: [{ champ, message }] }
// ─────────────────────────────────────────────────────────────────────────────

const TYPES_SERVICE_VALIDES = ['menage', 'roomservice', 'maintenance', 'autre']

function err(champ, message) { return { champ, message } }

// ── Token QR (format uniquement — pas de validation existence) ────────────────

function validerToken(token) {
  if (!token || typeof token !== 'string')
    return { ok: false, erreurs: [err('token', 'Token manquant')] }

  // 96 caractères hexadécimaux (crypto.randomBytes(48).toString('hex'))
  if (!/^[a-f0-9]{96}$/i.test(token))
    return { ok: false, erreurs: [err('token', 'Format de token invalide')] }

  return { ok: true }
}

// ── Session token (header Authorization) ─────────────────────────────────────

function validerSessionToken(token) {
  if (!token || typeof token !== 'string')
    return { ok: false, erreurs: [err('session', 'Session manquante — accédez d\'abord au portail via le lien QR')] }

  // 64 caractères hexadécimaux (crypto.randomBytes(32).toString('hex'))
  if (!/^[a-f0-9]{64}$/i.test(token))
    return { ok: false, erreurs: [err('session', 'Format de session invalide')] }

  return { ok: true }
}

// ── Message ───────────────────────────────────────────────────────────────────

function validerMessage(body) {
  const erreurs = []

  if (!body || !body.corps?.toString().trim())
    erreurs.push(err('corps', 'Le message ne peut pas être vide'))
  else if (body.corps.trim().length > 2000)
    erreurs.push(err('corps', 'Le message ne peut pas dépasser 2000 caractères'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Demande de service ────────────────────────────────────────────────────────

function validerDemandeService(body) {
  const erreurs = []

  if (!body || !body.type_service)
    erreurs.push(err('type_service', `requis — valeurs acceptées : ${TYPES_SERVICE_VALIDES.join(', ')}`))
  else if (!TYPES_SERVICE_VALIDES.includes(body.type_service))
    erreurs.push(err('type_service', `valeur invalide — acceptées : ${TYPES_SERVICE_VALIDES.join(', ')}`))

  if (body?.description !== undefined && body.description.length > 500)
    erreurs.push(err('description', 'La description ne peut pas dépasser 500 caractères'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Évaluation séjour ─────────────────────────────────────────────────────────

function validerEvaluation(body) {
  const erreurs = []

  if (!body) return { ok: false, erreurs: [err('body', 'Corps de requête manquant')] }

  const note = parseInt(body.note_globale)
  if (!body.note_globale || isNaN(note) || note < 1 || note > 5)
    erreurs.push(err('note_globale', 'requis — entier entre 1 et 5'))

  for (const champ of ['note_proprete', 'note_service', 'note_confort']) {
    if (body[champ] !== undefined && body[champ] !== null) {
      const n = parseInt(body[champ])
      if (isNaN(n) || n < 1 || n > 5)
        erreurs.push(err(champ, 'entier entre 1 et 5'))
    }
  }

  if (body.commentaire !== undefined && body.commentaire !== null) {
    if (typeof body.commentaire !== 'string')
      erreurs.push(err('commentaire', 'doit être une chaîne de caractères'))
    else if (body.commentaire.length > 2000)
      erreurs.push(err('commentaire', 'ne peut pas dépasser 2000 caractères'))
  }

  if (body.recommanderait !== undefined && typeof body.recommanderait !== 'boolean')
    erreurs.push(err('recommanderait', 'doit être true ou false'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

module.exports = {
  validerToken,
  validerSessionToken,
  validerMessage,
  validerDemandeService,
  validerEvaluation,
}
