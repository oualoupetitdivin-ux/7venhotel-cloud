// Utilitaires de l'interface Finance OHADA — présentation uniquement.
// Toute la logique comptable reste dans le moteur backend (accounting.engine) : rien n'est recalculé
// ici hormis des agrégats d'affichage (sommes de soldes de la balance renvoyée par l'API).

// Montant comptable : 2 décimales maximum (les montants OHADA ne sont pas arrondis au franc)
export function montant(v) {
  const n = Number(v || 0)
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function dateFr(d) {
  if (!d) return '—'
  const s = String(d).slice(0, 10)
  const [a, m, j] = s.split('-')
  return a && m && j ? `${j}/${m}/${a}` : s
}

// Droits Finance (alignés sur role_permissions : finance.lire / finance.ecriture / finance.cloture).
// Le backend reste juge : l'interface masque seulement les actions non autorisées.
export function droitsFinance(role) {
  return {
    lire:     ['super_admin', 'manager', 'comptabilite'].includes(role),
    ecrire:   ['super_admin', 'comptabilite'].includes(role),
    cloturer: role === 'super_admin',
  }
}

// Exercice par défaut : l'exercice ouvert le plus récent, sinon le plus récent
export function exerciceParDefaut(exercices = []) {
  return exercices.find(e => e.statut === 'ouvert') || exercices[0] || null
}

export function periodeCourante(exercice, aujourdHui = new Date().toISOString().slice(0, 10)) {
  return exercice?.periodes?.find(p => p.date_debut <= aujourdHui && p.date_fin >= aujourdHui) || null
}

// Solde net d'un ensemble de lignes de balance (débit − crédit), filtre sur le numéro de compte
export function soldeNet(lignes = [], filtre) {
  return lignes.filter(l => filtre(String(l.compte)))
    .reduce((s, l) => s + Number(l.total_debit || 0) - Number(l.total_credit || 0), 0)
}

// Erreur API lisible (format { erreur, code } des routes Finance)
export function messageErreur(err, defaut = 'Erreur de chargement') {
  const d = err?.response?.data
  if (d?.code === 'EXERCICE_INTROUVABLE') return 'Aucun exercice comptable : dossier non initialisé pour cet hôtel.'
  return d?.erreur || defaut
}

// Export CSV côté navigateur des données affichées (séparateur ; — Excel FR)
export function telechargerCSV(nomFichier, entetes, lignes) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const contenu = '﻿' + [entetes.map(esc).join(';'), ...lignes.map(l => l.map(esc).join(';'))].join('\n')
  telechargerBlob(new Blob([contenu], { type: 'text/csv;charset=utf-8' }), nomFichier)
}

export function telechargerBlob(blob, nomFichier) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nomFichier
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const STATUT_ECRITURE = {
  validee:   { label: 'Validée',   classe: 'badge-green' },
  brouillon: { label: 'Brouillon', classe: 'badge-amber' },
}

export const STATUT_EXERCICE = {
  ouvert:  { label: 'Ouvert',  classe: 'badge-green' },
  cloture: { label: 'Clôturé', classe: 'badge-gray' },
}

export const STATUT_PERIODE = {
  ouverte:   { label: 'Ouverte',   classe: 'badge-green' },
  cloturee:  { label: 'Clôturée',  classe: 'badge-gray' },
}
