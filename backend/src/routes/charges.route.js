'use strict'

const { ValidationError, NotFoundError, ConflictError } = require('../errors')

// ─────────────────────────────────────────────────────────────────────────────
// routes/charges.route.js
//
// Charges opérationnelles (sorties d'argent) — Phase 1, Périmètre B.
// hotel_id obligatoire sur toute requête. Rôles autorisés : manager, comptabilite.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function chargesRoutes(fastify) {
  const pre       = [fastify.authentifier, fastify.contexteHotel]
  const rolesTous = fastify.verifierRole(['manager', 'comptabilite'])

  // ── GET /charges/categories — liste des catégories ────────────────────────
  fastify.get('/categories', { preHandler: [...pre, rolesTous] }, async (req, reply) => {
    const categories = await fastify.db('categories_charges')
      .where({ hotel_id: req.hotelId })
      .orderBy('ordre')
    return reply.send({ categories })
  })

  // ── POST /charges/categories — créer une catégorie ─────────────────────────
  fastify.post('/categories', {
    preHandler: [...pre, fastify.verifierRole(['manager'])],
  }, async (req, reply) => {
    const { nom, icone, ordre } = req.body
    if (!nom) throw new ValidationError([{ champ: 'nom', message: 'Le nom est requis' }])

    const [categorie] = await fastify.db('categories_charges').insert({
      hotel_id: req.hotelId, nom, icone: icone || null, ordre: ordre ?? 0,
    }).returning('*')
    return reply.status(201).send({ message: 'Catégorie créée', categorie })
  })

  // ── GET /charges — liste avec filtres + totaux par catégorie ──────────────
  fastify.get('/', { preHandler: [...pre, rolesTous] }, async (req, reply) => {
    const { categorie_id, statut, debut, fin, page = 1, limite = 50 } = req.query

    let query = fastify.db('charges AS c')
      .leftJoin('categories_charges AS cat', 'cat.id', 'c.categorie_id')
      .where({ 'c.hotel_id': req.hotelId })

    if (categorie_id) query = query.andWhere({ 'c.categorie_id': categorie_id })
    if (statut)       query = query.andWhere({ 'c.statut': statut })
    if (debut)        query = query.andWhere('c.date_charge', '>=', debut)
    if (fin)          query = query.andWhere('c.date_charge', '<=', fin)

    const offset = (parseInt(page) - 1) * parseInt(limite)

    const [data, [{ total }], totauxParCategorie] = await Promise.all([
      query.clone()
        .select('c.*', 'cat.nom AS categorie_nom', 'cat.icone AS categorie_icone')
        .orderBy('c.date_charge', 'desc')
        .limit(parseInt(limite)).offset(offset),
      query.clone().count('c.id AS total'),
      query.clone()
        .groupBy('cat.id', 'cat.nom', 'cat.icone')
        .select('cat.id AS categorie_id', 'cat.nom AS categorie_nom', 'cat.icone AS categorie_icone')
        .sum('c.montant AS total_montant'),
    ])

    return reply.send({
      data,
      pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) },
      totaux_par_categorie: totauxParCategorie.map(t => ({ ...t, total_montant: parseFloat(t.total_montant || 0) })),
    })
  })

  // ── GET /charges/totaux — SUM par catégorie + solde P&L pour une période ──
  fastify.get('/totaux', { preHandler: [...pre, rolesTous] }, async (req, reply) => {
    const maintenant = new Date()
    const debutDuMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1).toISOString().slice(0, 10)
    const aujourdhui   = maintenant.toISOString().slice(0, 10)

    const dateDebut = req.query.debut || debutDuMois
    const dateFin   = req.query.fin   || aujourdhui

    const [parCategorie, [{ total_charges }], [{ total_encaissements }]] = await Promise.all([
      fastify.db('charges AS c')
        .leftJoin('categories_charges AS cat', 'cat.id', 'c.categorie_id')
        .where({ 'c.hotel_id': req.hotelId })
        .andWhere('c.date_charge', '>=', dateDebut)
        .andWhere('c.date_charge', '<=', dateFin)
        .groupBy('cat.id', 'cat.nom', 'cat.icone')
        .select('cat.id AS categorie_id', 'cat.nom AS categorie_nom', 'cat.icone AS categorie_icone')
        .sum('c.montant AS total_montant'),

      fastify.db('charges')
        .where({ hotel_id: req.hotelId })
        .andWhere('date_charge', '>=', dateDebut)
        .andWhere('date_charge', '<=', dateFin)
        .sum('montant AS total_charges')
        .then(rows => [{ total_charges: rows[0]?.total_charges || 0 }]),

      fastify.db('paiements')
        .where({ hotel_id: req.hotelId, statut: 'valide' })
        .andWhereRaw('DATE(COALESCE(traite_le, cree_le)) >= ?', [dateDebut])
        .andWhereRaw('DATE(COALESCE(traite_le, cree_le)) <= ?', [dateFin])
        .sum('montant AS total_encaissements')
        .then(rows => [{ total_encaissements: rows[0]?.total_encaissements || 0 }]),
    ])

    const charges       = parseFloat(total_charges || 0)
    const encaissements = parseFloat(total_encaissements || 0)

    return reply.send({
      par_categorie: parCategorie.map(t => ({ ...t, total_montant: parseFloat(t.total_montant || 0) })),
      total_charges: charges,
      total_encaissements: encaissements,
      solde_pl: encaissements - charges,
    })
  })

  // ── POST /charges — créer une charge ───────────────────────────────────────
  fastify.post('/', { preHandler: [...pre, rolesTous] }, async (req, reply) => {
    const { categorie_id, libelle, montant, devise, date_charge, piece_jointe_url, notes } = req.body

    const erreurs = []
    if (!libelle) erreurs.push({ champ: 'libelle', message: 'Le libellé est requis' })
    if (montant === undefined || montant === null || Number(montant) <= 0)
      erreurs.push({ champ: 'montant', message: 'Le montant doit être supérieur à 0' })
    if (erreurs.length) throw new ValidationError(erreurs)

    const insertData = {
      hotel_id: req.hotelId,
      tenant_id: req.tenantId,
      categorie_id: categorie_id || null,
      libelle,
      montant: Number(montant),
      devise: devise || 'XAF',
      piece_jointe_url: piece_jointe_url || null,
      notes: notes || null,
      cree_par: req.user.id,
    }
    if (date_charge) insertData.date_charge = date_charge

    const [charge] = await fastify.db('charges').insert(insertData).returning('*')

    req.log.info({ charge_id: charge.id, hotel_id: req.hotelId, montant: charge.montant }, 'Charge créée')
    return reply.status(201).send({ message: 'Charge créée', charge })
  })

  // ── PUT /charges/:id — modifier (sauf si payee) ─────────────────────────────
  fastify.put('/:id', { preHandler: [...pre, rolesTous] }, async (req, reply) => {
    const existante = await fastify.db('charges').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!existante) throw new NotFoundError('Charge')
    if (existante.statut === 'payee')
      throw new ConflictError('Impossible de modifier une charge déjà payée', 'CHARGE_PAYEE')

    const CHAMPS = ['categorie_id', 'libelle', 'montant', 'devise', 'date_charge', 'piece_jointe_url', 'notes']
    const updateData = { mis_a_jour_le: fastify.db.fn.now() }
    for (const k of CHAMPS) {
      if (req.body[k] !== undefined) updateData[k] = req.body[k]
    }

    const [charge] = await fastify.db('charges')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updateData)
      .returning('*')

    return reply.send({ message: 'Charge mise à jour', charge })
  })

  // ── PUT /charges/:id/valider — statut = validee ─────────────────────────────
  fastify.put('/:id/valider', {
    preHandler: [...pre, rolesTous],
  }, async (req, reply) => {
    const existante = await fastify.db('charges').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!existante) throw new NotFoundError('Charge')
    if (existante.statut !== 'saisie')
      throw new ConflictError('Seule une charge en saisie peut être validée', 'STATUT_INVALIDE')

    const [charge] = await fastify.db('charges')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ statut: 'validee', validee_par: req.user.id, mis_a_jour_le: fastify.db.fn.now() })
      .returning('*')

    req.log.info({ charge_id: charge.id, hotel_id: req.hotelId }, 'Charge validée')
    return reply.send({ message: 'Charge validée', charge })
  })

  // ── DELETE /charges/:id — supprimer (sauf si validee/payee) ────────────────
  fastify.delete('/:id', { preHandler: [...pre, rolesTous] }, async (req, reply) => {
    const existante = await fastify.db('charges').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!existante) throw new NotFoundError('Charge')
    if (['validee', 'payee'].includes(existante.statut))
      throw new ConflictError('Impossible de supprimer une charge validée ou payée', 'CHARGE_VERROUILLEE')

    await fastify.db('charges').where({ id: req.params.id, hotel_id: req.hotelId }).delete()
    return reply.send({ message: 'Charge supprimée' })
  })
}
