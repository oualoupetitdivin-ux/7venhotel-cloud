'use strict'

// ══════════════════════════════════════════════════════════════════════════════
// Routes Finance OHADA (LOT-OHADA-01) — préfixe /api/v1/finance
//
// RBAC (permissions LOT-RBAC-01) :
//   finance.lire     → consultation (journaux, plan, écritures, GL, balance, états, export)
//   finance.ecriture → écritures manuelles, événements moteur, contre-écritures, journaux
//   finance.cloture  → clôtures, initialisation du dossier, paramétrage du mapping
//
// tenant_id / hotel_id proviennent EXCLUSIVEMENT de contexteHotel (jamais du corps).
// Aucune route PUT/DELETE sur les écritures : correction = contre-écriture.
// ══════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto')
const moteur = require('../engines/accounting.engine')
const etats  = require('../engines/etats.engine')

const { AccountingError, traduireErreurPg } = moteur
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(v, champ) {
  if (v !== undefined && v !== null && v !== '' && !UUID.test(String(v))) {
    throw new AccountingError('PARAMETRE_INVALIDE', `${champ} : UUID invalide`, 400)
  }
  return v || undefined
}

module.exports = async function financeRoutes(fastify) {
  const db  = fastify.db
  const pre = [fastify.authentifier, fastify.contexteHotel]
  const lire     = { preHandler: [...pre, fastify.verifierPermission('finance.lire')] }
  const ecrire   = { preHandler: [...pre, fastify.verifierPermission('finance.ecriture')] }
  const cloturer = { preHandler: [...pre, fastify.verifierPermission('finance.cloture')] }

  const ctx = (req) => ({ tenantId: req.tenantId, hotelId: req.hotelId, userId: req.user.id })

  const gerer = (fn) => async (req, reply) => {
    try {
      const res = await fn(req, reply)
      if (!reply.sent) return reply.send(res)
    } catch (err) {
      const e = traduireErreurPg(err)
      if (e instanceof AccountingError) {
        return reply.status(e.statusCode).send({ erreur: e.message, code: e.code, details: e.details })
      }
      throw err
    }
  }

  // ── Initialisation du dossier comptable ─────────────────────────────────────
  fastify.post('/initialisation', cloturer, gerer(async (req, reply) => {
    const annee = parseInt((req.body || {}).annee || new Date().getFullYear(), 10)
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new AccountingError('PARAMETRE_INVALIDE', 'annee invalide', 400)
    const r = await moteur.initialiserDossier(db, { ...ctx(req), annee })
    reply.status(201)
    return r
  }))

  // ── Journaux ────────────────────────────────────────────────────────────────
  fastify.get('/journaux', lire, gerer(async (req) => {
    const { code, exercice_id } = req.query
    const journaux = await db('journaux_comptables')
      .where({ tenant_id: req.tenantId, hotel_id: req.hotelId }).orderBy('code')
      .select('id', 'code', 'libelle', 'type_journal', 'compte_contrepartie_defaut', 'actif')
    if (!code) return { journaux }

    const journal = journaux.find(j => j.code === String(code).toUpperCase())
    if (!journal) throw new AccountingError('JOURNAL_INCONNU', `Journal ${code} inconnu`, 404)
    const ex = await moteur.resoudreExercice(db, { tenantId: req.tenantId, hotelId: req.hotelId, exerciceId: uuid(exercice_id, 'exercice_id') })
    const ecritures = await db('ecritures_comptables')
      .where({ tenant_id: req.tenantId, hotel_id: req.hotelId, journal_id: journal.id, exercice_id: ex.id })
      .orderBy([{ column: 'date_ecriture' }, { column: 'numero_piece' }])
      .select('id', 'numero_piece', db.raw('date_ecriture::text AS date_ecriture'), 'libelle', 'statut', 'source',
              'total_debit', 'total_credit', 'ecriture_origine_id')
    return { journal, exercice: { id: ex.id, annee: ex.annee }, ecritures }
  }))

  fastify.post('/journaux', ecrire, gerer(async (req, reply) => {
    const { code, libelle, type_journal, compte_contrepartie_defaut } = req.body || {}
    if (!code || !libelle || !type_journal) throw new AccountingError('CHAMPS_REQUIS', 'code, libelle et type_journal requis', 400)
    const [j] = await db('journaux_comptables').insert({
      tenant_id: req.tenantId, hotel_id: req.hotelId, code: String(code).toUpperCase(), libelle,
      type_journal, compte_contrepartie_defaut: compte_contrepartie_defaut || null,
    }).returning(['id', 'code', 'libelle', 'type_journal', 'actif'])
    await fastify.audit.log({ event: 'FINANCE_JOURNAL_CREE', actor: { id: req.user.id, ip: req.ip },
      target: { type: 'journal_comptable', id: j.id }, new_state: j, tenant_id: req.tenantId, hotel_id: req.hotelId,
      correlation_id: req.correlationId })
    reply.status(201)
    return { journal: j }
  }))

  // ── Plan comptable / exercices / mapping ────────────────────────────────────
  fastify.get('/plan-comptable', lire, gerer(async (req) => {
    const q = db('comptes_syscohada').where({ tenant_id: req.tenantId, hotel_id: req.hotelId }).orderBy('numero')
      .select('id', 'numero', 'libelle', 'classe', 'nature', 'sens_normal', 'collectif', 'referentiel_numero', 'actif')
    if (req.query.classe) q.where({ classe: parseInt(req.query.classe, 10) || 0 })
    return { comptes: await q }
  }))

  fastify.get('/exercices', lire, gerer(async (req) => {
    const exercices = await db('exercices_comptables').where({ tenant_id: req.tenantId, hotel_id: req.hotelId })
      .orderBy('annee', 'desc')
      .select('id', 'annee', 'statut', 'libelle', 'devise', db.raw('date_debut::text AS date_debut'), db.raw('date_fin::text AS date_fin'))
    const periodes = exercices.length ? await db('periodes_comptables').whereIn('exercice_id', exercices.map(e => e.id))
      .orderBy('numero').select('id', 'exercice_id', 'numero', 'libelle', 'statut',
        db.raw('date_debut::text AS date_debut'), db.raw('date_fin::text AS date_fin')) : []
    return { exercices: exercices.map(e => ({ ...e, periodes: periodes.filter(p => p.exercice_id === e.id) })) }
  }))

  fastify.get('/mappings', lire, gerer(async (req) => {
    const mappings = await db('mappings_comptables AS m')
      .join('journaux_comptables AS j', 'j.id', 'm.journal_id')
      .join('comptes_syscohada AS cd', 'cd.id', 'm.compte_debit_id')
      .join('comptes_syscohada AS cc', 'cc.id', 'm.compte_credit_id')
      .leftJoin('comptes_syscohada AS ct', 'ct.id', 'm.compte_taxe_id')
      .where({ 'm.tenant_id': req.tenantId, 'm.hotel_id': req.hotelId })
      .orderBy([{ column: 'm.evenement_type' }, { column: 'm.priorite', order: 'desc' }])
      .select('m.id', 'm.evenement_type', 'm.libelle', 'j.code AS journal', 'cd.numero AS compte_debit',
              'cc.numero AS compte_credit', 'ct.numero AS compte_taxe', 'm.mode_taxe', 'm.cote_taxe',
              'm.taux_taxe', 'm.conditions', 'm.priorite', 'm.actif')
    return { mappings }
  }))

  // Upsert d'une règle de mapping (clé : evenement_type + priorite)
  fastify.put('/mappings', cloturer, gerer(async (req) => {
    const b = req.body || {}
    if (!b.evenement_type || !b.journal || !b.compte_debit || !b.compte_credit) {
      throw new AccountingError('CHAMPS_REQUIS', 'evenement_type, journal, compte_debit, compte_credit requis', 400)
    }
    const scope = { tenant_id: req.tenantId, hotel_id: req.hotelId }
    const journal = await db('journaux_comptables').where({ ...scope, code: b.journal }).first()
    const numeros = [b.compte_debit, b.compte_credit, b.compte_taxe].filter(Boolean).map(String)
    const comptes = Object.fromEntries((await db('comptes_syscohada').where(scope).whereIn('numero', numeros)
      .select('id', 'numero')).map(c => [c.numero, c.id]))
    if (!journal) throw new AccountingError('JOURNAL_INCONNU', `Journal ${b.journal} inconnu`)
    const manquants = numeros.filter(n => !comptes[n])
    if (manquants.length) throw new AccountingError('COMPTE_INCONNU', `Compte(s) inconnu(s) : ${manquants.join(', ')}`)

    const ligne = {
      ...scope, evenement_type: String(b.evenement_type).toUpperCase(), libelle: b.libelle || b.evenement_type,
      journal_id: journal.id, compte_debit_id: comptes[b.compte_debit], compte_credit_id: comptes[b.compte_credit],
      compte_taxe_id: b.compte_taxe ? comptes[b.compte_taxe] : null, mode_taxe: b.mode_taxe || 'aucune',
      cote_taxe: b.cote_taxe || null, taux_taxe: b.taux_taxe ?? null, conditions: JSON.stringify(b.conditions || {}),
      priorite: parseInt(b.priorite || 0, 10), actif: b.actif !== false, mis_a_jour_le: db.fn.now(),
    }
    const [m] = await db('mappings_comptables').insert(ligne)
      .onConflict(['tenant_id', 'hotel_id', 'evenement_type', 'priorite']).merge().returning('*')
    await fastify.audit.log({ event: 'FINANCE_MAPPING_MODIFIE', actor: { id: req.user.id, ip: req.ip },
      target: { type: 'mapping_comptable', id: m.id }, new_state: b, tenant_id: req.tenantId, hotel_id: req.hotelId,
      correlation_id: req.correlationId })
    return { mapping: m }
  }))

  // ── Écritures ───────────────────────────────────────────────────────────────
  fastify.get('/ecritures', lire, gerer(async (req) => {
    const { exercice_id, journal, statut, source } = req.query
    const limit  = Math.min(parseInt(req.query.limit || 100, 10) || 100, 500)
    const offset = Math.max(parseInt(req.query.offset || 0, 10) || 0, 0)
    const q = db('ecritures_comptables AS e').join('journaux_comptables AS j', 'j.id', 'e.journal_id')
      .where({ 'e.tenant_id': req.tenantId, 'e.hotel_id': req.hotelId })
      .orderBy([{ column: 'e.date_ecriture', order: 'desc' }, { column: 'e.numero_piece', order: 'desc' }])
      .limit(limit).offset(offset)
      .select('e.id', 'e.numero_piece', db.raw('e.date_ecriture::text AS date_ecriture'), 'j.code AS journal',
              'e.libelle', 'e.statut', 'e.source', 'e.evenement_type', 'e.reference_type', 'e.reference_id',
              'e.total_debit', 'e.total_credit', 'e.ecriture_origine_id')
    if (exercice_id) q.where('e.exercice_id', uuid(exercice_id, 'exercice_id'))
    if (journal) q.where('j.code', String(journal).toUpperCase())
    if (statut)  q.where('e.statut', statut)
    if (source)  q.where('e.source', source)
    return { ecritures: await q, limit, offset }
  }))

  fastify.get('/ecritures/:id', lire, gerer(async (req) => {
    return { ecriture: await moteur.chargerEcriture(db, { ...ctx(req), ecritureId: uuid(req.params.id, 'id') }) }
  }))

  fastify.post('/ecritures', ecrire, gerer(async (req, reply) => {
    const b = req.body || {}
    if (!b.journal) throw new AccountingError('CHAMPS_REQUIS', 'journal requis', 400)
    if (String(b.journal).toUpperCase() === 'AN') {
      throw new AccountingError('JOURNAL_RESERVE', 'Le journal AN est réservé aux à-nouveaux de clôture', 422)
    }
    const ecriture = await moteur.passerEcriture(db, {
      ...ctx(req), journalCode: String(b.journal).toUpperCase(), date: b.date, libelle: b.libelle,
      lignes: b.lignes, source: 'manuelle', valider: b.valider !== false,
      reference_type: b.reference_type, reference_id: b.reference_id,
    })
    reply.status(201)
    return { ecriture }
  }))

  fastify.post('/ecritures/:id/valider', ecrire, gerer(async (req) => {
    const id = uuid(req.params.id, 'id')
    await db.transaction(async (trx) => {
      const n = await trx('ecritures_comptables')
        .where({ id, tenant_id: req.tenantId, hotel_id: req.hotelId, statut: 'brouillon' })
        .update({ statut: 'validee', validee_par: req.user.id })
      if (n === 0) throw new AccountingError('ECRITURE_NON_VALIDABLE', 'Écriture introuvable ou déjà validée', 409)
      await trx('logs_audit').insert({ tenant_id: req.tenantId, hotel_id: req.hotelId, utilisateur_id: req.user.id,
        action: 'FINANCE_ECRITURE_VALIDEE', module: 'finance', ressource_type: 'ecriture_comptable', ressource_id: id,
        nouvelles_valeurs: JSON.stringify({ validation: 'brouillon→validee' }) })
    })
    return { ecriture: await moteur.chargerEcriture(db, { ...ctx(req), ecritureId: id }) }
  }))

  fastify.post('/ecritures/:id/contre-ecriture', ecrire, gerer(async (req, reply) => {
    const b = req.body || {}
    const ecriture = await moteur.contreEcriture(db, { ...ctx(req), ecritureId: uuid(req.params.id, 'id'), motif: b.motif, date: b.date })
    reply.status(201)
    return { ecriture }
  }))

  // ── Moteur d'événements (appel manuel — hooks PMS en LOT-PMS-02) ────────────
  fastify.post('/evenements', ecrire, gerer(async (req, reply) => {
    const b = req.body || {}
    const r = await moteur.comptabiliserEvenement(db, {
      ...ctx(req), type: b.type, montant: b.montant, date: b.date, attributs: b.attributs, libelle: b.libelle,
      reference_type: b.reference_type, reference_id: b.reference_id, cle_idempotence: b.cle_idempotence,
      tiers_id: uuid(b.tiers_id, 'tiers_id'),
    })
    reply.status(r.ecriture && r.ecriture.rejeu ? 200 : 201)
    return r
  }))

  // ── Rejeu / rattrapage d'un événement PMS (LOT-PMS-01) ──────────────────────
  // Idempotent : rejouer un objet déjà comptabilisé ne crée aucune écriture.
  fastify.post('/pms/rejouer', ecrire, gerer(async (req) => {
    const pont = require('../services/comptabilite.bridge')
    const { source, id } = req.body || {}
    if (!pont.SOURCES[source]) {
      throw new AccountingError('PARAMETRE_INVALIDE', `source invalide (${Object.keys(pont.SOURCES).join(', ')})`, 400)
    }
    uuid(id, 'id')
    if (!id) throw new AccountingError('CHAMPS_REQUIS', 'id requis', 400)
    return pont.SOURCES[source](db, { id, hotelId: req.hotelId, userId: req.user.id })
  }))

  // ── Grand Livre / Balance / États / Contrôle ────────────────────────────────
  fastify.get('/grand-livre', lire, gerer(async (req) => moteur.grandLivre(db, {
    ...ctx(req), exerciceId: uuid(req.query.exercice_id, 'exercice_id'), compte: req.query.compte,
    dateDebut: req.query.date_debut, dateFin: req.query.date_fin,
  })))

  fastify.get('/balance', lire, gerer(async (req) => moteur.balance(db, {
    ...ctx(req), exerciceId: uuid(req.query.exercice_id, 'exercice_id'), dateFin: req.query.date_fin,
  })))

  fastify.get('/etats', lire, gerer(async (req) => {
    const donnees = await etats.calculerEtats(db, { ...ctx(req), exerciceId: uuid(req.query.exercice_id, 'exercice_id') })
    const historique = await db('etats_financiers')
      .where({ tenant_id: req.tenantId, hotel_id: req.hotelId, exercice_id: donnees.exercice.id })
      .orderBy('genere_le', 'desc').select('id', 'type_etat', db.raw('date_arrete::text AS date_arrete'), 'empreinte', 'genere_le')
    return { ...donnees, snapshots: historique }
  }))

  fastify.get('/controle', lire, gerer(async (req) => ({
    exercices: await db('v_controle_equilibre').where({ tenant_id: req.tenantId, hotel_id: req.hotelId })
      .select('exercice_id', 'nb_ecritures', 'total_debit', 'total_credit', 'ecart'),
  })))

  // ── Clôture ─────────────────────────────────────────────────────────────────
  fastify.post('/cloture', cloturer, gerer(async (req) => {
    const b = req.body || {}
    if (b.type === 'periode') {
      if (!b.periode_id) throw new AccountingError('CHAMPS_REQUIS', 'periode_id requis', 400)
      return moteur.cloturerPeriode(db, { ...ctx(req), periodeId: uuid(b.periode_id, 'periode_id') })
    }
    if (b.type === 'exercice') {
      if (!b.exercice_id) throw new AccountingError('CHAMPS_REQUIS', 'exercice_id requis', 400)
      return moteur.cloturerExercice(db, { ...ctx(req), exerciceId: uuid(b.exercice_id, 'exercice_id') })
    }
    throw new AccountingError('PARAMETRE_INVALIDE', "type doit valoir 'periode' ou 'exercice'", 400)
  }))

  // ── Export structuré (consommation future : Ouwalou Analytics) ──────────────
  fastify.get('/export', lire, gerer(async (req, reply) => {
    const ex = await moteur.resoudreExercice(db, { tenantId: req.tenantId, hotelId: req.hotelId, exerciceId: uuid(req.query.exercice_id, 'exercice_id') })
    const scope = { tenant_id: req.tenantId, hotel_id: req.hotelId }
    const lignes = await db('v_lignes_validees').where({ ...scope, exercice_id: ex.id })
      .orderBy([{ column: 'date_ecriture' }, { column: 'numero_piece' }, { column: 'numero_ligne' }])
      .select('ecriture_id', 'numero_piece', db.raw('date_ecriture::text AS date_ecriture'), 'journal_code',
              'libelle_ecriture', 'source', 'evenement_type', 'reference_type', 'reference_id', 'ecriture_origine_id',
              'numero_ligne', 'compte_numero', 'compte_libelle', 'tiers_id', 'libelle_ligne', 'debit', 'credit')

    if (req.query.format === 'csv') {
      const esc = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
      const entete = 'JournalCode;EcritureNum;EcritureDate;CompteNum;CompteLib;TiersId;Libelle;Debit;Credit;Source;Reference;EcritureOrigine'
      const corps = lignes.map(l => [l.journal_code, l.numero_piece, l.date_ecriture, l.compte_numero, l.compte_libelle,
        l.tiers_id, l.libelle_ligne || l.libelle_ecriture, l.debit, l.credit, l.source,
        l.reference_type ? `${l.reference_type}:${l.reference_id}` : '', l.ecriture_origine_id].map(esc).join(';'))
      return reply.header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="ecritures_${ex.annee}.csv"`)
        .send([entete, ...corps].join('\n'))
    }

    const ecritures = new Map()
    for (const l of lignes) {
      if (!ecritures.has(l.ecriture_id)) {
        ecritures.set(l.ecriture_id, { id: l.ecriture_id, numero_piece: l.numero_piece, date: l.date_ecriture,
          journal: l.journal_code, libelle: l.libelle_ecriture, source: l.source, evenement_type: l.evenement_type,
          reference: l.reference_type ? { type: l.reference_type, id: l.reference_id } : null,
          ecriture_origine_id: l.ecriture_origine_id, lignes: [] })
      }
      ecritures.get(l.ecriture_id).lignes.push({ compte: l.compte_numero, tiers_id: l.tiers_id,
        libelle: l.libelle_ligne, debit: Number(l.debit), credit: Number(l.credit) })
    }
    const bal = await moteur.balance(db, { tenantId: req.tenantId, hotelId: req.hotelId, exerciceId: ex.id })
    const contenu = {
      format: '7venhotel.finance.export', version: '1.0', referentiel: 'SYSCOHADA',
      perimetre: { tenant_id: req.tenantId, hotel_id: req.hotelId },
      exercice: { id: ex.id, annee: ex.annee, statut: ex.statut, devise: ex.devise },
      plan_comptable: await db('comptes_syscohada').where(scope).orderBy('numero').select('numero', 'libelle', 'classe', 'nature'),
      journaux: await db('journaux_comptables').where(scope).orderBy('code').select('code', 'libelle', 'type_journal'),
      ecritures: [...ecritures.values()],
      balance: { lignes: bal.lignes, totaux: bal.totaux, equilibre: bal.equilibre },
    }
    return {
      ...contenu,
      genere_le: new Date().toISOString(),
      empreinte: crypto.createHash('sha256').update(JSON.stringify(contenu)).digest('hex'),
    }
  }))
}
