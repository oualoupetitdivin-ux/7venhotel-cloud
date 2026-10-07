'use strict'

// ══════════════════════════════════════════════════════════════════════════════
// EtatsEngine — Bilan & Compte de résultat SYSCOHADA (LOT-OHADA-01)
//
// Source UNIQUE des montants : v_balance (écritures validées). Aucun chiffre codé.
// Le classement compte → rubrique vient de rubriques_etats (référentiel produit
// versionné, plus long préfixe gagnant).
//
// Règles de classement :
//   classe 1        → passif  (C − D)
//   classes 2, 3    → actif   (D − C ; amortissements/dépréciations viennent en déduction)
//   classes 4, 5    → selon le solde : débiteur → actif, créditeur → passif
//   classes 6 à 8   → compte de résultat (charges : 6, 81, 83, 85, 87, 89 ; produits : 7, 82, 84, 86, 88)
//   classe 9        → exclue (hors bilan / analytique)
// Résultat de l'exercice non encore affecté = produits − charges → rubrique CJ du passif.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto')
const { AccountingError, versCentimes, versNombre, isoDate, resoudreExercice } = require('./accounting.engine')

const CHARGES_HAO  = ['81', '83', '85', '87', '89']

function estCharge(numero) {
  return numero[0] === '6' || CHARGES_HAO.some(p => numero.startsWith(p))
}

function trouverRubrique(rubriques, etat, numero) {
  let meilleure = null, longueur = 0
  for (const r of rubriques) {
    if (r.etat !== etat) continue
    for (const p of r.prefixes) {
      if (numero.startsWith(p) && p.length > longueur) { meilleure = r; longueur = p.length }
    }
  }
  return meilleure
}

function nouvelleSection(rubriques, etat) {
  const map = new Map()
  for (const r of rubriques.filter(x => x.etat === etat).sort((a, b) => a.ordre - b.ordre)) {
    map.set(r.code, { code: r.code, libelle: r.libelle, montant: 0, comptes: [] })
  }
  map.set('ZZ', { code: 'ZZ', libelle: 'Comptes non classés', montant: 0, comptes: [] })
  return map
}

function ajouter(section, code, compte, montant) {
  const r = section.get(code)
  r.montant += montant
  r.comptes.push({ numero: compte.compte_numero, libelle: compte.compte_libelle, montant })
}

function figer(section) {
  let total = 0
  const rubriques = []
  for (const r of section.values()) {
    total += r.montant
    if (r.comptes.length === 0) continue
    rubriques.push({ code: r.code, libelle: r.libelle, montant: versNombre(r.montant),
                     comptes: r.comptes.map(c => ({ ...c, montant: versNombre(c.montant) })) })
  }
  return { rubriques, total: versNombre(total), _total: total }
}

async function calculerEtats(db, { tenantId, hotelId, exerciceId }) {
  const ex = await resoudreExercice(db, { tenantId, hotelId, exerciceId })

  const rubriques = await db('rubriques_etats').select('*')
  if (rubriques.length === 0) {
    throw new AccountingError('RUBRIQUES_ABSENTES', 'Référentiel des rubriques non chargé (scripts/seed-plan-comptable.js)', 503)
  }
  const version = rubriques[0].version

  const soldes = await db('v_balance')
    .where({ tenant_id: tenantId, hotel_id: hotelId, exercice_id: ex.id })
    .whereBetween('classe', [1, 8])
    .orderBy('compte_numero')
    .select('compte_numero', 'compte_libelle', 'classe', 'total_debit', 'total_credit')

  const actif    = nouvelleSection(rubriques, 'bilan_actif')
  const passif   = nouvelleSection(rubriques, 'bilan_passif')
  const charges  = nouvelleSection(rubriques, 'resultat_charges')
  const produits = nouvelleSection(rubriques, 'resultat_produits')
  const nonClasses = []
  let totalD = 0, totalC = 0

  const placer = (section, etat, compte, montant) => {
    const r = trouverRubrique(rubriques, etat, compte.compte_numero)
    if (!r) nonClasses.push({ compte: compte.compte_numero, etat })
    ajouter(section, r ? r.code : 'ZZ', compte, montant)
  }

  for (const s of soldes) {
    const d = versCentimes(s.total_debit), c = versCentimes(s.total_credit)
    totalD += d; totalC += c
    const solde = d - c
    if (solde === 0) continue
    const n = s.compte_numero, cl = Number(s.classe)
    if (cl === 1)                 placer(passif, 'bilan_passif', s, -solde)
    else if (cl === 2 || cl === 3) placer(actif, 'bilan_actif', s, solde)
    else if (cl === 4 || cl === 5) {
      if (solde > 0) placer(actif, 'bilan_actif', s, solde)
      else           placer(passif, 'bilan_passif', s, -solde)
    } else if (estCharge(n))      placer(charges, 'resultat_charges', s, solde)
    else                          placer(produits, 'resultat_produits', s, -solde)
  }

  const cr = { produits: figer(produits), charges: figer(charges) }
  const resultat = cr.produits._total - cr.charges._total

  // Résultat non affecté → rubrique CJ du passif (ligne calculée, traçable)
  if (resultat !== 0) {
    const cj = passif.get('CJ') || passif.get('ZZ')
    cj.montant += resultat
    cj.comptes.push({ numero: null, libelle: 'Résultat de l\'exercice (produits − charges)', montant: resultat })
  }
  const bilan = { actif: figer(actif), passif: figer(passif) }
  const ecartBilan = bilan.actif._total - bilan.passif._total

  for (const x of [bilan.actif, bilan.passif, cr.produits, cr.charges]) delete x._total

  return {
    exercice: { id: ex.id, annee: ex.annee, statut: ex.statut, date_debut: isoDate(ex.date_debut), date_fin: isoDate(ex.date_fin) },
    bilan: { ...bilan, equilibre: ecartBilan === 0, ecart: versNombre(ecartBilan) },
    compte_resultat: { ...cr, resultat: versNombre(resultat), nature: resultat >= 0 ? 'benefice' : 'perte' },
    controles: {
      balance_equilibree: totalD === totalC,
      bilan_equilibre:    ecartBilan === 0,
      comptes_non_classes: nonClasses,
      nb_comptes_mouvementes: soldes.length,
    },
    source: 'v_balance — écritures validées uniquement',
    referentiel_rubriques: version,
  }
}

async function genererEtats(db, { tenantId, hotelId, exerciceId, userId, persister = false }) {
  const donnees = await calculerEtats(db, { tenantId, hotelId, exerciceId })
  if (!persister) return { id: null, ...donnees }

  const empreinte = crypto.createHash('sha256').update(JSON.stringify(donnees)).digest('hex')
  const jour = isoDate(new Date())
  const arrete = donnees.exercice.date_fin < jour ? donnees.exercice.date_fin : jour
  const [row] = await db('etats_financiers').insert({
    tenant_id: tenantId, hotel_id: hotelId, exercice_id: donnees.exercice.id,
    type_etat: 'complet', date_arrete: arrete, donnees: JSON.stringify(donnees),
    empreinte, genere_par: userId || null,
  }).returning(['id', 'genere_le'])
  return { id: row.id, genere_le: row.genere_le, empreinte, ...donnees }
}

module.exports = { calculerEtats, genererEtats }
