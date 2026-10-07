'use strict'

// ══════════════════════════════════════════════════════════════════════════════
// AccountingEngine — Finance OHADA (LOT-OHADA-01)
//
// EVENT → IDENTIFICATION TYPE → MAPPING → CALCUL LIGNES → ÉQUILIBRE → ÉCRITURE → AUDIT
//
// Double barrière :
//   • moteur  : contrôle équilibre / comptes / période AVANT insertion (erreurs métier lisibles)
//   • base    : triggers 014/018 (équilibre à la validation, immutabilité, périodes closes,
//               cohérence tenant/hôtel) — impossible à contourner par SQL direct.
//
// Toutes les fonctions prennent `db` (knex OU transaction knex) et un contexte
// { tenantId, hotelId } qui provient TOUJOURS du serveur (contexteHotel), jamais du client.
//
// Hors périmètre (LOT-PMS-02) : aucun hook PMS n'appelle encore ce moteur.
// ══════════════════════════════════════════════════════════════════════════════

const fp = require('fastify-plugin')

class AccountingError extends Error {
  constructor(code, message, statusCode = 422, details = undefined) {
    super(message)
    this.code       = code
    this.statusCode = statusCode
    this.details    = details
  }
}

const EVENEMENTS = [
  'HEBERGEMENT', 'RESTAURANT', 'ROOM_SERVICE', 'PAIEMENT', 'CAISSE_DECAISSEMENT',
  'CAISSE_APPORT', 'CHARGE', 'ACHAT', 'ARRHES', 'ANNULATION', 'AVOIR',
  // LOT-PMS-01 (migration 019)
  'SERVICE_ANNEXE', 'TAXE_SEJOUR', 'ARRHES_IMPUTATION', 'ARRHES_REMBOURSEMENT', 'ARRHES_ACQUISES', 'ECART_CAISSE',
]

// Configuration initiale produit — modifiable ensuite par hôtel (tables 011 / 015)
const JOURNAUX_DEFAUT = [
  { code: 'VE', libelle: 'Journal des ventes',        type_journal: 'VE' },
  { code: 'AC', libelle: 'Journal des achats',        type_journal: 'AC' },
  { code: 'BQ', libelle: 'Journal de banque',         type_journal: 'BQ', compte_contrepartie_defaut: '521' },
  { code: 'MM', libelle: 'Journal Mobile Money',      type_journal: 'BQ', compte_contrepartie_defaut: '552' },
  { code: 'CA', libelle: 'Journal de caisse',         type_journal: 'CA', compte_contrepartie_defaut: '571' },
  { code: 'OD', libelle: 'Opérations diverses',       type_journal: 'OD' },
  { code: 'AN', libelle: 'À-nouveaux',                type_journal: 'AN' },
]

const MAPPINGS_DEFAUT = [
  { evenement_type: 'HEBERGEMENT',  libelle: 'Vente hébergement (TTC)',      journal: 'VE', debit: '411',   credit: '70611', taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'credit' },
  { evenement_type: 'RESTAURANT',   libelle: 'Vente restauration (TTC)',     journal: 'VE', debit: '411',   credit: '70612', taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'credit' },
  { evenement_type: 'ROOM_SERVICE', libelle: 'Vente room service (TTC)',     journal: 'VE', debit: '411',   credit: '70613', taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'credit' },
  { evenement_type: 'AVOIR',        libelle: 'Avoir client hébergement',     journal: 'VE', debit: '70611', credit: '411',   taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'debit' },
  { evenement_type: 'PAIEMENT',     libelle: 'Encaissement banque / carte',  journal: 'BQ', debit: '521',   credit: '411',   priorite: 0 },
  { evenement_type: 'PAIEMENT',     libelle: 'Encaissement espèces',         journal: 'CA', debit: '571',   credit: '411',   priorite: 10, conditions: { mode_paiement: 'especes' } },
  { evenement_type: 'PAIEMENT',     libelle: 'Encaissement Mobile Money',    journal: 'MM', debit: '552',   credit: '411',   priorite: 20, conditions: { mode_paiement: 'mobile_money' } },
  { evenement_type: 'ARRHES',       libelle: 'Arrhes reçues (banque)',       journal: 'BQ', debit: '521',   credit: '419',   priorite: 0 },
  { evenement_type: 'ARRHES',       libelle: 'Arrhes reçues (espèces)',      journal: 'CA', debit: '571',   credit: '419',   priorite: 10, conditions: { mode_paiement: 'especes' } },
  { evenement_type: 'ARRHES',       libelle: 'Arrhes reçues (Mobile Money)', journal: 'MM', debit: '552',   credit: '419',   priorite: 20, conditions: { mode_paiement: 'mobile_money' } },
  { evenement_type: 'CAISSE_DECAISSEMENT', libelle: 'Sortie de caisse (virement de fonds)', journal: 'CA', debit: '585', credit: '571' },
  { evenement_type: 'CAISSE_APPORT',       libelle: 'Apport en caisse (virement de fonds)', journal: 'CA', debit: '571', credit: '585' },
  { evenement_type: 'CHARGE',       libelle: 'Charge d\'exploitation',       journal: 'AC', debit: '638',   credit: '401' },
  { evenement_type: 'ACHAT',        libelle: 'Achat marchandises (HT + TVA)', journal: 'AC', debit: '601',  credit: '401',   taxe: '4452', mode_taxe: 'en_sus', cote_taxe: 'debit' },
  // LOT-PMS-01 — événements PMS réels (migration 019)
  { evenement_type: 'SERVICE_ANNEXE', libelle: 'Services annexes (spa, blanchisserie, transport...)', journal: 'VE', debit: '411', credit: '706', taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'credit' },
  { evenement_type: 'TAXE_SEJOUR',  libelle: 'Taxe de séjour collectée',     journal: 'VE', debit: '411',   credit: '447' },
  { evenement_type: 'ARRHES_IMPUTATION',    libelle: 'Imputation des arrhes sur facture', journal: 'OD', debit: '419', credit: '411' },
  { evenement_type: 'ARRHES_REMBOURSEMENT', libelle: 'Remboursement arrhes (banque)',      journal: 'BQ', debit: '419', credit: '521', priorite: 0 },
  { evenement_type: 'ARRHES_REMBOURSEMENT', libelle: 'Remboursement arrhes (espèces)',     journal: 'CA', debit: '419', credit: '571', priorite: 10, conditions: { mode_paiement: 'especes' } },
  { evenement_type: 'ARRHES_REMBOURSEMENT', libelle: 'Remboursement arrhes (Mobile Money)', journal: 'MM', debit: '419', credit: '552', priorite: 20, conditions: { mode_paiement: 'mobile_money' } },
  { evenement_type: 'ARRHES_ACQUISES',      libelle: 'Arrhes acquises à l\'hôtel',        journal: 'OD', debit: '419', credit: '758' },
  { evenement_type: 'ECART_CAISSE', libelle: 'Manquant de caisse',           journal: 'CA', debit: '658',   credit: '571',   priorite: 10, conditions: { sens: 'manquant' } },
  { evenement_type: 'ECART_CAISSE', libelle: 'Excédent de caisse',           journal: 'CA', debit: '571',   credit: '758',   priorite: 20, conditions: { sens: 'excedent' } },
  { evenement_type: 'AVOIR',        libelle: 'Avoir restauration',           journal: 'VE', debit: '70612', credit: '411',   taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'debit', priorite: 10, conditions: { categorie: 'RESTAURANT' } },
  { evenement_type: 'AVOIR',        libelle: 'Avoir room service',           journal: 'VE', debit: '70613', credit: '411',   taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'debit', priorite: 20, conditions: { categorie: 'ROOM_SERVICE' } },
  { evenement_type: 'AVOIR',        libelle: 'Avoir services annexes',       journal: 'VE', debit: '706',   credit: '411',   taxe: '4432', mode_taxe: 'incluse', cote_taxe: 'debit', priorite: 30, conditions: { categorie: 'SERVICE_ANNEXE' } },
  { evenement_type: 'AVOIR',        libelle: 'Avoir TVA facturée',           journal: 'VE', debit: '4432',  credit: '411',   priorite: 40, conditions: { categorie: 'TVA' } },
  { evenement_type: 'AVOIR',        libelle: 'Avoir taxe de séjour',         journal: 'VE', debit: '447',   credit: '411',   priorite: 50, conditions: { categorie: 'TAXE_SEJOUR' } },
]

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août',
              'Septembre', 'Octobre', 'Novembre', 'Décembre']

// ── Utilitaires ──────────────────────────────────────────────────────────────

// Montants manipulés en centimes entiers (aucune erreur d'arrondi flottant)
function versCentimes(v, champ = 'montant') {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) throw new AccountingError('MONTANT_INVALIDE', `${champ} invalide`)
  const c = Math.round(n * 100)
  if (Math.abs(n * 100 - c) > 1e-6) throw new AccountingError('MONTANT_INVALIDE', `${champ} : 2 décimales maximum`)
  if (!Number.isSafeInteger(c)) throw new AccountingError('MONTANT_INVALIDE', `${champ} hors limites`)
  return c
}
const versDecimal = (c) => (c / 100).toFixed(2)
const versNombre  = (c) => Math.round(c) / 100

const pad = (n) => String(n).padStart(2, '0')
function isoDate(d) {
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return String(d).slice(0, 10)
}
function aujourdhui() { return isoDate(new Date()) }
function validerDate(d, champ = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) || Number.isNaN(Date.parse(d))) {
    throw new AccountingError('DATE_INVALIDE', `${champ} attendue au format AAAA-MM-JJ`)
  }
  return d
}

async function avecTransaction(db, fn) {
  return db.isTransaction ? fn(db) : db.transaction(fn)
}

// Traduit les erreurs PostgreSQL (triggers 014/018, contraintes) en erreurs métier
function traduireErreurPg(err) {
  if (err instanceof AccountingError) return err
  if (err && err.code === 'P0001') {
    const code = String(err.message).split(':')[0].trim()
    const conflit = /IMMUABLE|CLOTUREE|IRREVERSIBLE|^CLOTURE_/.test(code)
    return new AccountingError(code, err.message, conflit ? 409 : 422)
  }
  if (err && err.code === '23505') return new AccountingError('DOUBLON', err.detail || err.message, 409)
  if (err && err.code === '23503') return new AccountingError('REFERENCE_INVALIDE', err.detail || err.message, 422)
  if (err && err.code === '23514') return new AccountingError('CONTRAINTE_VIOLEE', err.constraint || err.message, 422)
  return err
}

async function journaliserAudit(db, { event, tenantId, hotelId, userId, type, id, valeurs }) {
  await db('logs_audit').insert({
    tenant_id:         tenantId,
    hotel_id:          hotelId,
    utilisateur_id:    userId || null,
    action:            event,
    module:            'finance',
    ressource_type:    type,
    ressource_id:      id,
    nouvelles_valeurs: JSON.stringify(valeurs || {}),
  })
}

// ── Exercices / périodes ─────────────────────────────────────────────────────

async function creerExercice(db, { tenantId, hotelId, annee, userId }) {
  return avecTransaction(db, async (trx) => {
    const existant = await trx('exercices_comptables').where({ tenant_id: tenantId, hotel_id: hotelId, annee }).first()
    if (existant) return existant

    const cfg  = await trx('config_fiscale').where({ tenant_id: tenantId, hotel_id: hotelId }).first()
    const mois = cfg ? cfg.exercice_fiscal_debut_mois : 1
    const debut = new Date(Date.UTC(annee, mois - 1, 1))
    const fin   = new Date(Date.UTC(annee, mois - 1 + 12, 0))
    const iso   = (d) => d.toISOString().slice(0, 10)

    const [ex] = await trx('exercices_comptables').insert({
      tenant_id: tenantId, hotel_id: hotelId, annee,
      date_debut: iso(debut), date_fin: iso(fin),
      libelle: `Exercice ${annee}`, cree_par: userId || null,
    }).returning('*')

    const periodes = []
    for (let i = 0; i < 12; i++) {
      const pd = new Date(Date.UTC(annee, mois - 1 + i, 1))
      const pf = new Date(Date.UTC(annee, mois + i, 0))
      periodes.push({
        exercice_id: ex.id, tenant_id: tenantId, hotel_id: hotelId, numero: i + 1,
        libelle: `${MOIS[pd.getUTCMonth()]} ${pd.getUTCFullYear()}`,
        date_debut: iso(pd), date_fin: iso(pf),
      })
    }
    await trx('periodes_comptables').insert(periodes)
    return ex
  })
}

async function resoudreExercice(db, { tenantId, hotelId, exerciceId }) {
  const q = db('exercices_comptables').where({ tenant_id: tenantId, hotel_id: hotelId })
  let ex
  if (exerciceId) {
    ex = await q.clone().where({ id: exerciceId }).first()
  } else {
    const jour = aujourdhui()
    ex = await q.clone().where('date_debut', '<=', jour).andWhere('date_fin', '>=', jour).first()
      || await q.clone().where({ statut: 'ouvert' }).orderBy('annee', 'desc').first()
      || await q.clone().orderBy('annee', 'desc').first()
  }
  if (!ex) throw new AccountingError('EXERCICE_INTROUVABLE', 'Aucun exercice comptable pour cet hôtel', 404)
  return ex
}

async function resoudrePeriode(db, { tenantId, hotelId, date }) {
  const p = await db('periodes_comptables AS p')
    .join('exercices_comptables AS e', 'e.id', 'p.exercice_id')
    .where({ 'p.tenant_id': tenantId, 'p.hotel_id': hotelId })
    .where('p.date_debut', '<=', date).andWhere('p.date_fin', '>=', date)
    .select('p.*', 'e.statut AS exercice_statut', 'e.annee')
    .first()
  if (!p) throw new AccountingError('PERIODE_INTROUVABLE', `Aucune période comptable ne couvre le ${date}`)
  if (p.statut !== 'ouverte' || p.exercice_statut !== 'ouvert') {
    throw new AccountingError('PERIODE_CLOTUREE', `La période ${p.libelle} est clôturée`, 409)
  }
  return p
}

// Numéro de pièce séquentiel par journal et par exercice (verrou de ligne → pas de doublon)
async function prochainNumero(db, { tenantId, hotelId, journalCode, annee }) {
  const { rows } = await db.raw(`
    INSERT INTO regles_numerotation (tenant_id, hotel_id, type_piece, prefixe, sequence_annee, sequence_courante)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT (tenant_id, hotel_id, type_piece) DO UPDATE SET
      sequence_courante = CASE WHEN regles_numerotation.sequence_annee = EXCLUDED.sequence_annee
                               THEN regles_numerotation.sequence_courante + 1 ELSE 1 END,
      sequence_annee = EXCLUDED.sequence_annee
    RETURNING prefixe, sequence_courante`, [tenantId, hotelId, journalCode, journalCode, annee])
  const { prefixe, sequence_courante } = rows[0]
  return `${prefixe || journalCode}${annee}-${String(sequence_courante).padStart(6, '0')}`
}

// ── Initialisation du dossier comptable d'un hôtel (idempotent) ──────────────

async function initialiserDossier(db, { tenantId, hotelId, annee, userId }) {
  return avecTransaction(db, async (trx) => {
    const hotel = await trx('hotels').where({ id: hotelId, tenant_id: tenantId }).first()
    if (!hotel) throw new AccountingError('HOTEL_HORS_PERIMETRE', 'Hôtel hors tenant', 403)

    const nbRef = await trx('plan_comptable_referentiel').count('* AS n').first()
    if (Number(nbRef.n) === 0) {
      throw new AccountingError('REFERENTIEL_ABSENT', 'Référentiel non chargé : exécuter scripts/seed-plan-comptable.js', 503)
    }

    await trx('config_fiscale')
      .insert({ tenant_id: tenantId, hotel_id: hotelId, pays: hotel.pays || 'Cameroun' })
      .onConflict(['tenant_id', 'hotel_id']).ignore()

    const comptes = await trx.raw(`
      INSERT INTO comptes_syscohada (tenant_id, hotel_id, numero, libelle, classe, nature, sens_normal, collectif, referentiel_numero)
      SELECT ?, ?, numero, libelle, classe, nature, sens_normal, collectif, numero FROM plan_comptable_referentiel
      ON CONFLICT (tenant_id, hotel_id, numero) DO NOTHING`, [tenantId, hotelId])

    await trx('journaux_comptables')
      .insert(JOURNAUX_DEFAUT.map(j => ({ tenant_id: tenantId, hotel_id: hotelId, ...j })))
      .onConflict(['tenant_id', 'hotel_id', 'code']).ignore()

    const idsComptes  = Object.fromEntries((await trx('comptes_syscohada')
      .where({ tenant_id: tenantId, hotel_id: hotelId }).select('id', 'numero')).map(c => [c.numero, c.id]))
    const idsJournaux = Object.fromEntries((await trx('journaux_comptables')
      .where({ tenant_id: tenantId, hotel_id: hotelId }).select('id', 'code')).map(j => [j.code, j.id]))

    let mappings = 0
    for (const m of MAPPINGS_DEFAUT) {
      if (!idsComptes[m.debit] || !idsComptes[m.credit] || (m.taxe && !idsComptes[m.taxe])) continue
      const r = await trx('mappings_comptables').insert({
        tenant_id: tenantId, hotel_id: hotelId,
        evenement_type:   m.evenement_type,
        libelle:          m.libelle,
        journal_id:       idsJournaux[m.journal],
        compte_debit_id:  idsComptes[m.debit],
        compte_credit_id: idsComptes[m.credit],
        compte_taxe_id:   m.taxe ? idsComptes[m.taxe] : null,
        mode_taxe:        m.mode_taxe || 'aucune',
        cote_taxe:        m.cote_taxe || null,
        conditions:       JSON.stringify(m.conditions || {}),
        priorite:         m.priorite || 0,
      }).onConflict(['tenant_id', 'hotel_id', 'evenement_type', 'priorite']).ignore().returning('id')
      mappings += r.length
    }

    const exercice = await creerExercice(trx, { tenantId, hotelId, annee, userId })

    await journaliserAudit(trx, {
      event: 'FINANCE_DOSSIER_INITIALISE', tenantId, hotelId, userId,
      type: 'exercice_comptable', id: exercice.id, valeurs: { annee, comptes_crees: comptes.rowCount, mappings_crees: mappings },
    })
    return { exercice_id: exercice.id, annee: exercice.annee, comptes_crees: comptes.rowCount, mappings_crees: mappings }
  })
}

// ── Écritures ────────────────────────────────────────────────────────────────

async function chargerEcriture(db, { tenantId, hotelId, ecritureId }) {
  const e = await db('ecritures_comptables AS e')
    .join('journaux_comptables AS j', 'j.id', 'e.journal_id')
    .where({ 'e.id': ecritureId, 'e.tenant_id': tenantId, 'e.hotel_id': hotelId })
    .select('e.*', 'j.code AS journal_code', db.raw('e.date_ecriture::text AS date_ecriture'))
    .first()
  if (!e) throw new AccountingError('ECRITURE_INTROUVABLE', 'Écriture introuvable', 404)
  e.lignes = await db('lignes_ecriture AS l')
    .join('comptes_syscohada AS c', 'c.id', 'l.compte_id')
    .where({ 'l.ecriture_id': ecritureId })
    .orderBy('l.numero_ligne')
    .select('l.numero_ligne', 'l.compte_numero', 'c.libelle AS compte_libelle', 'l.tiers_id', 'l.libelle', 'l.debit', 'l.credit')
  const contre = await db('ecritures_comptables')
    .where({ ecriture_origine_id: ecritureId, source: 'contre_ecriture' })
    .select('id', 'numero_piece').first()
  e.contre_ecriture = contre || null
  return e
}

/**
 * Passe une écriture équilibrée.
 * lignes : [{ compte: '411' | compte_id, debit, credit, libelle?, tiers_id? }]
 */
async function passerEcriture(db, p) {
  const { tenantId, hotelId, userId } = p
  const date   = validerDate(p.date || aujourdhui())
  const source = p.source || 'manuelle'
  if (!p.libelle || !String(p.libelle).trim()) throw new AccountingError('LIBELLE_REQUIS', 'Libellé requis')
  if (!Array.isArray(p.lignes) || p.lignes.length < 2) {
    throw new AccountingError('ECRITURE_INCOMPLETE', 'Au moins 2 lignes sont requises')
  }

  // 1. Contrôle d'équilibre côté moteur (avant toute écriture en base)
  let totalD = 0, totalC = 0
  const lignes = p.lignes.map((l, i) => {
    const d = versCentimes(l.debit,  `ligne ${i + 1} débit`)
    const c = versCentimes(l.credit, `ligne ${i + 1} crédit`)
    if (d < 0 || c < 0) throw new AccountingError('MONTANT_INVALIDE', `ligne ${i + 1} : montant négatif`)
    if ((d > 0) === (c > 0)) throw new AccountingError('LIGNE_INVALIDE', `ligne ${i + 1} : exactement un débit OU un crédit positif`)
    totalD += d; totalC += c
    return { ...l, d, c }
  })
  if (totalD !== totalC) {
    throw new AccountingError('ECRITURE_DESEQUILIBREE',
      `Écriture déséquilibrée : débit ${versDecimal(totalD)} ≠ crédit ${versDecimal(totalC)}`, 422,
      { total_debit: versNombre(totalD), total_credit: versNombre(totalC) })
  }

  try {
    return await avecTransaction(db, async (trx) => {
      // 2. Idempotence (rejeu d'un même événement métier)
      if (p.cle_idempotence) {
        const deja = await trx('ecritures_comptables').where({ hotel_id: hotelId, cle_idempotence: p.cle_idempotence }).first()
        if (deja) {
          if (deja.tenant_id !== tenantId) throw new AccountingError('HOTEL_HORS_PERIMETRE', 'Conflit de périmètre', 403)
          return { ...(await chargerEcriture(trx, { tenantId, hotelId, ecritureId: deja.id })), rejeu: true }
        }
      }

      // 3. Période ouverte + journal + comptes du périmètre
      const periode = await resoudrePeriode(trx, { tenantId, hotelId, date })
      const jq = trx('journaux_comptables').where({ tenant_id: tenantId, hotel_id: hotelId, actif: true })
      const journal = p.journalId ? await jq.where({ id: p.journalId }).first() : await jq.where({ code: p.journalCode }).first()
      if (!journal) throw new AccountingError('JOURNAL_INCONNU', `Journal ${p.journalCode || p.journalId} inconnu ou inactif`)

      const numeros = lignes.filter(l => !l.compte_id).map(l => String(l.compte))
      const comptes = numeros.length
        ? await trx('comptes_syscohada').where({ tenant_id: tenantId, hotel_id: hotelId, actif: true }).whereIn('numero', numeros).select('id', 'numero')
        : []
      const parNumero = Object.fromEntries(comptes.map(c => [c.numero, c.id]))
      const inconnus  = numeros.filter(n => !parNumero[n])
      if (inconnus.length) throw new AccountingError('COMPTE_INCONNU', `Compte(s) inconnu(s) ou inactif(s) : ${[...new Set(inconnus)].join(', ')}`)

      // 4. En-tête (brouillon) → lignes → validation (contrôlée par trigger)
      const numero_piece = await prochainNumero(trx, { tenantId, hotelId, journalCode: journal.code, annee: periode.annee })
      const [ecr] = await trx('ecritures_comptables').insert({
        tenant_id: tenantId, hotel_id: hotelId,
        exercice_id: periode.exercice_id, periode_id: periode.id, journal_id: journal.id,
        numero_piece, date_ecriture: date, libelle: String(p.libelle).slice(0, 255),
        statut: 'brouillon', source,
        evenement_type: p.evenement_type || null,
        reference_type: p.reference_type || null,
        reference_id:   p.reference_id != null ? String(p.reference_id) : null,
        cle_idempotence: p.cle_idempotence || null,
        ecriture_origine_id: p.ecriture_origine_id || null,
        cree_par: userId || null,
      }).returning(['id'])

      await trx('lignes_ecriture').insert(lignes.map((l, i) => ({
        ecriture_id: ecr.id, tenant_id: tenantId, hotel_id: hotelId, numero_ligne: i + 1,
        compte_id: l.compte_id || parNumero[String(l.compte)], compte_numero: String(l.compte || ''),
        tiers_id: l.tiers_id || null, libelle: l.libelle ? String(l.libelle).slice(0, 255) : null,
        debit: versDecimal(l.d), credit: versDecimal(l.c),
      })))

      if (p.valider !== false) {
        await trx('ecritures_comptables').where({ id: ecr.id }).update({ statut: 'validee', validee_par: userId || null })
      }

      // 5. Audit (même transaction : pas d'écriture sans trace)
      await journaliserAudit(trx, {
        event: p.valider === false ? 'FINANCE_ECRITURE_BROUILLON' : 'FINANCE_ECRITURE_VALIDEE',
        tenantId, hotelId, userId, type: 'ecriture_comptable', id: ecr.id,
        valeurs: { numero_piece, journal: journal.code, source, total: versDecimal(totalD),
                   evenement_type: p.evenement_type || null, ecriture_origine_id: p.ecriture_origine_id || null },
      })
      return chargerEcriture(trx, { tenantId, hotelId, ecritureId: ecr.id })
    })
  } catch (err) {
    throw traduireErreurPg(err)
  }
}

async function contreEcriture(db, { tenantId, hotelId, userId, ecritureId, motif, date }) {
  if (!motif || !String(motif).trim()) throw new AccountingError('MOTIF_REQUIS', 'Motif de contre-passation requis')
  return avecTransaction(db, async (trx) => {
    const origine = await trx('ecritures_comptables')
      .where({ id: ecritureId, tenant_id: tenantId, hotel_id: hotelId }).forUpdate().first()
    if (!origine) throw new AccountingError('ECRITURE_INTROUVABLE', 'Écriture introuvable', 404)
    if (origine.statut !== 'validee') throw new AccountingError('ECRITURE_NON_VALIDEE', 'Seule une écriture validée se contre-passe', 409)
    if (origine.source === 'contre_ecriture') throw new AccountingError('CONTRE_PASSATION_INTERDITE', 'Une contre-écriture ne se contre-passe pas', 409)
    const deja = await trx('ecritures_comptables').where({ ecriture_origine_id: ecritureId, source: 'contre_ecriture' }).first()
    if (deja) throw new AccountingError('DEJA_CONTRE_PASSEE', `Déjà contre-passée par ${deja.numero_piece}`, 409)

    const lignes = await trx('lignes_ecriture').where({ ecriture_id: ecritureId }).orderBy('numero_ligne')
    return passerEcriture(trx, {
      tenantId, hotelId, userId,
      date: date || aujourdhui(),
      journalId: origine.journal_id,
      libelle: `Contre-passation ${origine.numero_piece} — ${String(motif).trim()}`,
      source: 'contre_ecriture',
      ecriture_origine_id: origine.id,
      evenement_type: origine.evenement_type,
      reference_type: origine.reference_type,
      reference_id: origine.reference_id,
      lignes: lignes.map(l => ({ compte_id: l.compte_id, compte: l.compte_numero, tiers_id: l.tiers_id,
                                 libelle: l.libelle, debit: l.credit, credit: l.debit })),
    })
  }).catch(err => { throw traduireErreurPg(err) })
}

// ── Moteur d'événements (mapping configurable) ───────────────────────────────

function conditionsSatisfaites(conditions, attributs) {
  return Object.entries(conditions || {}).every(([k, v]) => attributs[k] !== undefined && String(attributs[k]) === String(v))
}

async function comptabiliserEvenement(db, p) {
  const { tenantId, hotelId, userId } = p
  const type = String(p.type || '').toUpperCase()
  const attributs = p.attributs || {}
  if (!EVENEMENTS.includes(type)) throw new AccountingError('EVENEMENT_INCONNU', `Type d'événement inconnu : ${p.type}`)

  // Annulation = contre-passation de l'écriture d'origine (jamais de modification)
  if (type === 'ANNULATION') {
    if (!attributs.ecriture_id) throw new AccountingError('ECRITURE_ORIGINE_REQUISE', 'attributs.ecriture_id requis pour ANNULATION')
    return { ecriture: await contreEcriture(db, { tenantId, hotelId, userId, ecritureId: attributs.ecriture_id, motif: p.libelle || 'Annulation', date: p.date }) }
  }

  const ttcOuHt = versCentimes(p.montant)
  if (ttcOuHt <= 0) throw new AccountingError('MONTANT_INVALIDE', 'Le montant doit être strictement positif')

  const candidats = await db('mappings_comptables AS m')
    .join('journaux_comptables AS j', 'j.id', 'm.journal_id')
    .join('comptes_syscohada AS cd', 'cd.id', 'm.compte_debit_id')
    .join('comptes_syscohada AS cc', 'cc.id', 'm.compte_credit_id')
    .leftJoin('comptes_syscohada AS ct', 'ct.id', 'm.compte_taxe_id')
    .where({ 'm.tenant_id': tenantId, 'm.hotel_id': hotelId, 'm.evenement_type': type, 'm.actif': true })
    .orderBy('m.priorite', 'desc')
    .select('m.*', 'j.code AS journal_code', 'cd.numero AS debit_numero', 'cc.numero AS credit_numero', 'ct.numero AS taxe_numero')
  const mapping = candidats.find(m => conditionsSatisfaites(m.conditions, attributs))
  if (!mapping) throw new AccountingError('MAPPING_INTROUVABLE', `Aucun mapping actif pour ${type} avec ces conditions`)

  let ht = ttcOuHt, tva = 0, ttc = ttcOuHt, taux = 0
  const taxeExplicite = p.montant_taxe !== undefined && p.montant_taxe !== null
  if (taxeExplicite) {
    // LOT-PMS-01 — La pièce métier (facture PMS) est la source de vérité fiscale :
    // montant = HT, montant_taxe = taxe réellement facturée. Le moteur ne recalcule rien.
    tva = versCentimes(p.montant_taxe, 'montant_taxe')
    if (tva < 0) throw new AccountingError('MONTANT_INVALIDE', 'montant_taxe négatif')
    if (tva > 0 && mapping.mode_taxe === 'aucune') {
      throw new AccountingError('TAXE_NON_MAPPEE', `Le mapping ${mapping.libelle} ne définit pas de compte de taxe`)
    }
    ttc = ht + tva
    taux = ht > 0 ? Math.round(tva * 10000 / ht) / 100 : 0
  } else if (mapping.mode_taxe !== 'aucune') {
    if (mapping.taux_taxe !== null && mapping.taux_taxe !== undefined) {
      taux = Number(mapping.taux_taxe)
    } else {
      const cfg = await db('config_fiscale').where({ tenant_id: tenantId, hotel_id: hotelId }).first()
      if (!cfg) throw new AccountingError('CONFIG_FISCALE_ABSENTE', 'Configuration fiscale absente')
      taux = Number(cfg.taux_tva_normal)
    }
    const bp = Math.round(taux * 100)            // taux en points de base (19,25 % → 1925)
    if (mapping.mode_taxe === 'incluse') {
      ht  = Math.round(ttcOuHt * 10000 / (10000 + bp))
      tva = ttcOuHt - ht
    } else {
      tva = Math.round(ttcOuHt * bp / 10000)
      ttc = ttcOuHt + tva
    }
  }

  const lib = p.libelle || mapping.libelle
  const lignes = []
  if (mapping.mode_taxe === 'aucune' || tva === 0) {
    const montant = mapping.mode_taxe === 'aucune' ? ttcOuHt : ttc
    lignes.push({ compte: mapping.debit_numero,  debit: versDecimal(montant), libelle: lib, tiers_id: p.tiers_id })
    lignes.push({ compte: mapping.credit_numero, credit: versDecimal(montant), libelle: lib })
  } else if (mapping.cote_taxe === 'credit') {
    lignes.push({ compte: mapping.debit_numero,  debit:  versDecimal(ttc), libelle: lib, tiers_id: p.tiers_id })
    lignes.push({ compte: mapping.credit_numero, credit: versDecimal(ht),  libelle: lib })
    lignes.push({ compte: mapping.taxe_numero,   credit: versDecimal(tva), libelle: `TVA ${taux} %` })
  } else {
    lignes.push({ compte: mapping.debit_numero,  debit:  versDecimal(ht),  libelle: lib })
    lignes.push({ compte: mapping.taxe_numero,   debit:  versDecimal(tva), libelle: `TVA ${taux} %` })
    lignes.push({ compte: mapping.credit_numero, credit: versDecimal(ttc), libelle: lib, tiers_id: p.tiers_id })
  }

  const cle = p.cle_idempotence
    || (p.reference_type && p.reference_id ? `${type}:${p.reference_type}:${p.reference_id}` : null)

  const ecriture = await passerEcriture(db, {
    tenantId, hotelId, userId, date: p.date, journalCode: mapping.journal_code,
    libelle: lib, source: 'moteur', evenement_type: type,
    reference_type: p.reference_type, reference_id: p.reference_id, cle_idempotence: cle,
    lignes,
  })
  return {
    ecriture,
    mapping: { id: mapping.id, libelle: mapping.libelle, journal: mapping.journal_code },
    calcul:  { mode_taxe: mapping.mode_taxe, taux, ht: versNombre(ht), tva: versNombre(tva), ttc: versNombre(mapping.mode_taxe === 'aucune' ? ttcOuHt : ttc) },
  }
}

// ── Grand Livre / Balance ────────────────────────────────────────────────────

async function grandLivre(db, { tenantId, hotelId, exerciceId, compte, dateDebut, dateFin }) {
  const ex = await resoudreExercice(db, { tenantId, hotelId, exerciceId })
  if (dateDebut) validerDate(dateDebut, 'date_debut')
  if (dateFin)   validerDate(dateFin, 'date_fin')

  const q = db('v_lignes_validees')
    .where({ tenant_id: tenantId, hotel_id: hotelId, exercice_id: ex.id })
    .orderBy([{ column: 'compte_numero' }, { column: 'date_ecriture' }, { column: 'numero_piece' }, { column: 'numero_ligne' }])
    .select('compte_numero', 'compte_libelle', db.raw('date_ecriture::text AS date_ecriture'), 'journal_code',
            'numero_piece', 'ecriture_id', 'libelle_ecriture', 'libelle_ligne', 'source', 'reference_type',
            'reference_id', 'debit', 'credit')
  if (compte) q.where('compte_numero', 'like', `${String(compte).replace(/[^0-9]/g, '')}%`)
  if (dateFin) q.where('date_ecriture', '<=', dateFin)
  const rows = await q

  const comptes = new Map()
  let totD = 0, totC = 0
  for (const r of rows) {
    if (!comptes.has(r.compte_numero)) {
      comptes.set(r.compte_numero, { numero: r.compte_numero, libelle: r.compte_libelle, ouverture: 0, solde: 0, d: 0, c: 0, lignes: [] })
    }
    const acc = comptes.get(r.compte_numero)
    const d = versCentimes(r.debit), c = versCentimes(r.credit)
    acc.solde += d - c
    if (dateDebut && r.date_ecriture < dateDebut) { acc.ouverture += d - c; continue }
    acc.d += d; acc.c += c; totD += d; totC += c
    acc.lignes.push({
      date: r.date_ecriture, journal: r.journal_code, piece: r.numero_piece, ecriture_id: r.ecriture_id,
      libelle: r.libelle_ligne || r.libelle_ecriture, source: r.source,
      reference: r.reference_type ? `${r.reference_type}:${r.reference_id}` : null,
      debit: versNombre(d), credit: versNombre(c), solde: versNombre(acc.solde),
    })
  }
  return {
    exercice: { id: ex.id, annee: ex.annee },
    filtres: { compte: compte || null, date_debut: dateDebut || null, date_fin: dateFin || null },
    comptes: [...comptes.values()].map(a => ({
      numero: a.numero, libelle: a.libelle, solde_ouverture: versNombre(a.ouverture),
      total_debit: versNombre(a.d), total_credit: versNombre(a.c), solde_cloture: versNombre(a.solde), lignes: a.lignes,
    })),
    totaux: { debit: versNombre(totD), credit: versNombre(totC) },
  }
}

async function balance(db, { tenantId, hotelId, exerciceId, dateFin }) {
  const ex = await resoudreExercice(db, { tenantId, hotelId, exerciceId })
  const q = db('v_lignes_validees')
    .where({ tenant_id: tenantId, hotel_id: hotelId, exercice_id: ex.id })
    .groupBy('compte_numero', 'compte_libelle', 'classe')
    .orderBy('compte_numero')
    .select('compte_numero', 'compte_libelle', 'classe',
            db.raw('SUM(debit) AS total_debit'), db.raw('SUM(credit) AS total_credit'))
  if (dateFin) q.where('date_ecriture', '<=', validerDate(dateFin, 'date_fin'))
  const rows = await q

  const t = { d: 0, c: 0, sd: 0, sc: 0 }
  const lignes = rows.map(r => {
    const d = versCentimes(r.total_debit), c = versCentimes(r.total_credit)
    const sd = Math.max(d - c, 0), sc = Math.max(c - d, 0)
    t.d += d; t.c += c; t.sd += sd; t.sc += sc
    return { compte: r.compte_numero, libelle: r.compte_libelle, classe: r.classe,
             total_debit: versNombre(d), total_credit: versNombre(c),
             solde_debiteur: versNombre(sd), solde_crediteur: versNombre(sc) }
  })
  return {
    exercice: { id: ex.id, annee: ex.annee, statut: ex.statut },
    date_fin: dateFin || null,
    lignes,
    totaux: { total_debit: versNombre(t.d), total_credit: versNombre(t.c),
              solde_debiteur: versNombre(t.sd), solde_crediteur: versNombre(t.sc) },
    equilibre: t.d === t.c && t.sd === t.sc,
  }
}

// ── Clôture ──────────────────────────────────────────────────────────────────

async function cloturerPeriode(db, { tenantId, hotelId, userId, periodeId }) {
  return avecTransaction(db, async (trx) => {
    const periode = await trx('periodes_comptables')
      .where({ id: periodeId, tenant_id: tenantId, hotel_id: hotelId }).forUpdate().first()
    if (!periode) throw new AccountingError('PERIODE_INTROUVABLE', 'Période introuvable', 404)
    if (periode.statut === 'cloturee') throw new AccountingError('PERIODE_DEJA_CLOTUREE', `${periode.libelle} déjà clôturée`, 409)

    const brouillons = await trx('ecritures_comptables').where({ periode_id: periodeId, statut: 'brouillon' }).count('* AS n').first()
    const anterieures = await trx('periodes_comptables')
      .where({ exercice_id: periode.exercice_id }).where('numero', '<', periode.numero).whereNot({ statut: 'cloturee' })
      .count('* AS n').first()
    const tot = await trx('ecritures_comptables').where({ periode_id: periodeId, statut: 'validee' })
      .select(trx.raw('COUNT(*) AS n'), trx.raw('COALESCE(SUM(total_debit),0) AS d'), trx.raw('COALESCE(SUM(total_credit),0) AS c')).first()
    const d = versCentimes(tot.d), c = versCentimes(tot.c)

    const controles = {
      aucun_brouillon:          Number(brouillons.n) === 0,
      periodes_anterieures_closes: Number(anterieures.n) === 0,
      equilibre_periode:        d === c,
      nb_ecritures:             Number(tot.n),
      total_debit:              versNombre(d),
      total_credit:             versNombre(c),
    }
    if (!controles.aucun_brouillon || !controles.periodes_anterieures_closes || !controles.equilibre_periode) {
      throw new AccountingError('CLOTURE_CONTROLES_ECHEC', 'Contrôles de clôture non satisfaits', 409, controles)
    }

    try {
      await trx('periodes_comptables').where({ id: periodeId }).update({ statut: 'cloturee', cloture_par: userId || null })
      const [cl] = await trx('clotures_comptables').insert({
        tenant_id: tenantId, hotel_id: hotelId, exercice_id: periode.exercice_id, periode_id: periodeId,
        type_cloture: 'periode', controles: JSON.stringify(controles),
        total_debit: versDecimal(d), total_credit: versDecimal(c), cloture_par: userId || null,
      }).returning('id')
      await journaliserAudit(trx, { event: 'FINANCE_PERIODE_CLOTUREE', tenantId, hotelId, userId,
        type: 'periode_comptable', id: periodeId, valeurs: { libelle: periode.libelle, ...controles } })
      return { cloture_id: cl.id, periode: { id: periodeId, libelle: periode.libelle, statut: 'cloturee' }, controles }
    } catch (err) { throw traduireErreurPg(err) }
  })
}

async function cloturerExercice(db, { tenantId, hotelId, userId, exerciceId }) {
  const etats = require('./etats.engine')
  return avecTransaction(db, async (trx) => {
    const ex = await trx('exercices_comptables').where({ id: exerciceId, tenant_id: tenantId, hotel_id: hotelId }).forUpdate().first()
    if (!ex) throw new AccountingError('EXERCICE_INTROUVABLE', 'Exercice introuvable', 404)
    if (ex.statut === 'cloture') throw new AccountingError('EXERCICE_DEJA_CLOTURE', `Exercice ${ex.annee} déjà clôturé`, 409)

    const brouillons = await trx('ecritures_comptables').where({ exercice_id: ex.id, statut: 'brouillon' }).count('* AS n').first()
    const bal = await balance(trx, { tenantId, hotelId, exerciceId: ex.id })
    const controles = { aucun_brouillon: Number(brouillons.n) === 0, balance_equilibree: bal.equilibre }
    if (!controles.aucun_brouillon || !controles.balance_equilibree) {
      throw new AccountingError('CLOTURE_CONTROLES_ECHEC', 'Contrôles de clôture d\'exercice non satisfaits', 409, controles)
    }

    // 1. Clôture séquentielle des périodes encore ouvertes (chacune contrôlée)
    const ouvertes = await trx('periodes_comptables').where({ exercice_id: ex.id, statut: 'ouverte' }).orderBy('numero')
    for (const p of ouvertes) await cloturerPeriode(trx, { tenantId, hotelId, userId, periodeId: p.id })

    // 2. États financiers définitifs (snapshot immuable)
    const etat = await etats.genererEtats(trx, { tenantId, hotelId, exerciceId: ex.id, userId, persister: true })

    // 3. Exercice suivant + à-nouveaux (classes 1-5, résultat → 131 / 139)
    const suivant = await creerExercice(trx, { tenantId, hotelId, annee: ex.annee + 1, userId })
    if (suivant.statut !== 'ouvert') throw new AccountingError('EXERCICE_SUIVANT_CLOTURE', 'Exercice suivant déjà clôturé', 409)

    let resultat = 0
    const lignesAN = []
    for (const l of bal.lignes) {
      const s = versCentimes(l.total_debit) - versCentimes(l.total_credit)
      if (s === 0) continue
      if (l.classe >= 6 && l.classe <= 8) { resultat += s; continue }
      if (l.classe > 5) continue
      lignesAN.push({ compte: l.compte, libelle: `À-nouveau ${l.libelle}`, debit: s > 0 ? versDecimal(s) : 0, credit: s < 0 ? versDecimal(-s) : 0 })
    }
    // resultat = Σ(D − C) des comptes de gestion : < 0 bénéfice (131, crédit) ; > 0 perte (139, débit)
    if (resultat < 0) lignesAN.push({ compte: '131', libelle: 'Résultat net : bénéfice', credit: versDecimal(-resultat) })
    if (resultat > 0) lignesAN.push({ compte: '139', libelle: 'Résultat net : perte', debit: versDecimal(resultat) })

    let an = null
    if (lignesAN.length >= 2) {
      an = await passerEcriture(trx, {
        tenantId, hotelId, userId, date: isoDate(suivant.date_debut), journalCode: 'AN',
        libelle: `À-nouveaux exercice ${suivant.annee} (clôture ${ex.annee})`, source: 'a_nouveau',
        reference_type: 'exercice', reference_id: ex.id, cle_idempotence: `AN:${ex.id}`, lignes: lignesAN,
      })
    }

    // 4. Verrouillage de l'exercice (trigger : toutes périodes closes)
    try {
      await trx('exercices_comptables').where({ id: ex.id }).update({ statut: 'cloture', cloture_par: userId || null })
      const [cl] = await trx('clotures_comptables').insert({
        tenant_id: tenantId, hotel_id: hotelId, exercice_id: ex.id, type_cloture: 'exercice',
        controles: JSON.stringify({ ...controles, etat_financier_id: etat.id }),
        total_debit: versDecimal(versCentimes(bal.totaux.total_debit)), total_credit: versDecimal(versCentimes(bal.totaux.total_credit)),
        resultat: versDecimal(-resultat), exercice_suivant_id: suivant.id, ecriture_a_nouveau_id: an ? an.id : null,
        cloture_par: userId || null,
      }).returning('id')
      await journaliserAudit(trx, { event: 'FINANCE_EXERCICE_CLOTURE', tenantId, hotelId, userId,
        type: 'exercice_comptable', id: ex.id, valeurs: { annee: ex.annee, resultat: versDecimal(-resultat), exercice_suivant: suivant.annee } })
      return {
        cloture_id: cl.id,
        exercice: { id: ex.id, annee: ex.annee, statut: 'cloture' },
        resultat: versNombre(-resultat),
        etat_financier_id: etat.id,
        exercice_suivant: { id: suivant.id, annee: suivant.annee },
        ecriture_a_nouveau: an ? { id: an.id, numero_piece: an.numero_piece } : null,
        controles,
      }
    } catch (err) { throw traduireErreurPg(err) }
  })
}

// ── Contexte (ECA) ───────────────────────────────────────────────────────────

async function contexteComptable(db, { tenantId, hotelId }) {
  let ex
  try { ex = await resoudreExercice(db, { tenantId, hotelId }) } catch { ex = null }
  if (!ex) return { initialise: false, exercice: null, periode_courante: null }
  const jour = aujourdhui()
  const periode = await db('periodes_comptables')
    .where({ exercice_id: ex.id }).where('date_debut', '<=', jour).andWhere('date_fin', '>=', jour)
    .select('id', 'numero', 'libelle', 'statut').first()
  return {
    initialise: true,
    exercice: { id: ex.id, annee: ex.annee, statut: ex.statut, date_debut: isoDate(ex.date_debut), date_fin: isoDate(ex.date_fin) },
    periode_courante: periode || null,
  }
}

// ── Plugin Fastify ───────────────────────────────────────────────────────────

const api = {
  AccountingError, EVENEMENTS, JOURNAUX_DEFAUT, MAPPINGS_DEFAUT,
  versCentimes, versNombre, isoDate, traduireErreurPg,
  initialiserDossier, creerExercice, resoudreExercice, resoudrePeriode,
  passerEcriture, chargerEcriture, contreEcriture, comptabiliserEvenement,
  grandLivre, balance, cloturerPeriode, cloturerExercice, contexteComptable,
}

async function accountingEnginePlugin(fastify) {
  // Méthodes liées à fastify.db — ctx { tenantId, hotelId } fourni par la route
  const lie = { ...api }
  for (const k of ['initialiserDossier', 'creerExercice', 'resoudreExercice', 'passerEcriture', 'chargerEcriture',
                   'contreEcriture', 'comptabiliserEvenement', 'grandLivre', 'balance', 'cloturerPeriode',
                   'cloturerExercice', 'contexteComptable']) {
    lie[k] = (p) => api[k](fastify.db, p)
  }
  fastify.decorate('accounting', lie)
}

module.exports = Object.assign(fp(accountingEnginePlugin, { name: 'accounting-engine' }), api)
