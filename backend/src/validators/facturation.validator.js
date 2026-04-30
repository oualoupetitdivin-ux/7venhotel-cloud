'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// facturation.validator.js — Validation de FORMAT uniquement
// Aucune règle métier, aucune requête DB
// ─────────────────────────────────────────────────────────────────────────────

// Valeurs ENUM type_ligne_ledger (migration_facturation_folio.sql)
const TYPES_LIGNE_MANUELS = [
  'restaurant', 'minibar', 'service', 'telephone',
  'ajustement', 'taxe', 'transfert_folio',
]
// 'nuitee', 'paiement', 'remboursement', 'correction', 'acompte'
// → générés uniquement par le système, jamais par l'API manuelle

// Valeurs ENUM type_paiement (schéma original)
const TYPES_PAIEMENT = ['carte', 'especes', 'chambre', 'virement', 'mobile_money']

// Moyens mobile money (asynchrones)
const MOYENS_ASYNC = ['mobile_money']

function err(champ, message) { return { champ, message } }
function estUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

// ── Ajout de ligne manuelle ───────────────────────────────────────────────────

function validerAjoutLigne(body) {
  const erreurs = []
  if (!body) return { ok: false, erreurs: [err('body', 'Corps manquant')] }

  if (!body.folio_id || !estUUID(body.folio_id))
    erreurs.push(err('folio_id', 'UUID valide requis'))

  if (!body.type_ligne || !TYPES_LIGNE_MANUELS.includes(body.type_ligne))
    erreurs.push(err('type_ligne', `Valeur invalide — acceptées : ${TYPES_LIGNE_MANUELS.join(', ')}`))

  if (body.montant === undefined || body.montant === null) {
    erreurs.push(err('montant', 'requis'))
  } else {
    const m = parseFloat(body.montant)
    if (isNaN(m) || m <= 0)
      erreurs.push(err('montant', 'doit être un nombre strictement positif'))
  }

  if (!body.description || !body.description.toString().trim())
    erreurs.push(err('description', 'requis'))
  else if (body.description.length > 500)
    erreurs.push(err('description', 'max 500 caractères'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Création paiement ─────────────────────────────────────────────────────────

function validerCreationPaiement(body) {
  const erreurs = []
  if (!body) return { ok: false, erreurs: [err('body', 'Corps manquant')] }

  if (!body.folio_id || !estUUID(body.folio_id))
    erreurs.push(err('folio_id', 'UUID valide requis'))

  if (!body.type_paiement || !TYPES_PAIEMENT.includes(body.type_paiement))
    erreurs.push(err('type_paiement', `Valeur invalide — acceptées : ${TYPES_PAIEMENT.join(', ')}`))

  if (body.montant === undefined || body.montant === null) {
    erreurs.push(err('montant', 'requis'))
  } else {
    const m = parseFloat(body.montant)
    if (isNaN(m) || m <= 0)
      erreurs.push(err('montant', 'doit être un nombre strictement positif'))
  }

  // Mobile money : numéro de téléphone obligatoire
  if (body.type_paiement === 'mobile_money') {
    if (!body.numero_telephone || !body.numero_telephone.toString().trim())
      erreurs.push(err('numero_telephone', 'requis pour mobile_money'))
  }

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Confirmation paiement mobile money ───────────────────────────────────────

function validerConfirmationPaiement(body) {
  const erreurs = []
  if (!body) return { ok: false, erreurs: [err('body', 'Corps manquant')] }

  if (!body.paiement_id || !estUUID(body.paiement_id))
    erreurs.push(err('paiement_id', 'UUID valide requis'))

  if (!body.reference_externe || !body.reference_externe.toString().trim())
    erreurs.push(err('reference_externe', 'requis — identifiant de transaction opérateur'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

// ── Correction de ligne ───────────────────────────────────────────────────────

function validerCorrection(body) {
  const erreurs = []
  if (!body) return { ok: false, erreurs: [err('body', 'Corps manquant')] }

  if (!body.ligne_id || !estUUID(body.ligne_id))
    erreurs.push(err('ligne_id', 'UUID de la ligne à corriger requis'))

  if (!body.motif || !body.motif.toString().trim())
    erreurs.push(err('motif', 'motif de correction requis'))
  else if (body.motif.length > 500)
    erreurs.push(err('motif', 'max 500 caractères'))

  return erreurs.length ? { ok: false, erreurs } : { ok: true }
}

module.exports = {
  validerAjoutLigne,
  validerCreationPaiement,
  validerConfirmationPaiement,
  validerCorrection,
  MOYENS_ASYNC,
}
