'use strict'

const { ValidationError, NotFoundError, ConflictError } = require('../errors')

// ─────────────────────────────────────────────────────────────────────────────
// routes/caisse.route.js
//
// Caisse & clôture journalière — Phase 1, Périmètre B.
// Une seule session ouverte à la fois par hôtel (contrainte DB).
// hotel_id obligatoire sur toute requête.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function caisseRoutes(fastify) {
  const pre         = [fastify.authentifier, fastify.contexteHotel]
  const rolesLecture = fastify.verifierRole(['manager', 'reception', 'comptabilite'])
  const rolesOperer  = fastify.verifierRole(['manager', 'reception'])
  const rolesCloturer = fastify.verifierRole(['manager', 'comptabilite'])

  // Somme des encaissements espèces valides pour la journée de la session.
  async function sommeEncaissementsEspeces(hotelId, session) {
    const [{ total }] = await fastify.db('paiements')
      .where({ hotel_id: hotelId, type_paiement: 'especes', statut: 'valide' })
      .andWhereRaw('DATE(COALESCE(traite_le, cree_le)) = DATE(?)', [session.ouverte_le])
      .sum('montant AS total')
    return parseFloat(total || 0)
  }

  // ── GET /caisse/session-active — session en cours (null si aucune) ─────────
  fastify.get('/session-active', { preHandler: [...pre, rolesLecture] }, async (req, reply) => {
    const session = await fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'ouverte' })
      .first()

    if (!session) return reply.send({ session: null })

    const encaissementsEspeces = await sommeEncaissementsEspeces(req.hotelId, session)
    return reply.send({
      session: {
        ...session,
        encaissements_especes: encaissementsEspeces,
        total_theorique: parseFloat(session.fond_ouverture) + encaissementsEspeces,
      },
    })
  })

  // ── POST /caisse/ouvrir — ouvre une session + mouvement fond_initial ───────
  fastify.post('/ouvrir', { preHandler: [...pre, rolesOperer] }, async (req, reply) => {
    const { fond_ouverture } = req.body
    if (fond_ouverture === undefined || fond_ouverture === null || Number(fond_ouverture) < 0)
      throw new ValidationError([{ champ: 'fond_ouverture', message: 'Le fond de caisse est requis' }])

    const dejaOuverte = await fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'ouverte' })
      .first()
    if (dejaOuverte)
      throw new ConflictError('Une session de caisse est déjà ouverte', 'SESSION_DEJA_OUVERTE')

    const session = await fastify.db.transaction(async (trx) => {
      const [session] = await trx('sessions_caisse').insert({
        hotel_id: req.hotelId,
        tenant_id: req.tenantId,
        fond_ouverture: Number(fond_ouverture),
        ouverte_par: req.user.id,
      }).returning('*')

      await trx('mouvements_caisse').insert({
        session_id: session.id,
        hotel_id: req.hotelId,
        type_mouvement: 'fond_initial',
        montant: Number(fond_ouverture),
        libelle: 'Fond de caisse — ouverture',
        cree_par: req.user.id,
      })

      return session
    })

    req.log.info({ session_id: session.id, hotel_id: req.hotelId, fond_ouverture }, 'Session de caisse ouverte')
    return reply.status(201).send({ message: 'Caisse ouverte', session })
  })

  // ── GET /caisse/encaissements — paiements espèces du jour de la session ────
  fastify.get('/encaissements', { preHandler: [...pre, rolesLecture] }, async (req, reply) => {
    const session = await fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'ouverte' })
      .first()
    if (!session) throw new ConflictError('Aucune session de caisse ouverte', 'SESSION_INEXISTANTE')

    const encaissements = await fastify.db('paiements AS p')
      .leftJoin('folios AS f', 'f.id', 'p.folio_id')
      .leftJoin('clients AS c', 'c.id', 'f.client_id')
      .where({ 'p.hotel_id': req.hotelId, 'p.type_paiement': 'especes', 'p.statut': 'valide' })
      .andWhereRaw('DATE(COALESCE(p.traite_le, p.cree_le)) = DATE(?)', [session.ouverte_le])
      .select(
        'p.*',
        fastify.db.raw('f.numero_folio'),
        fastify.db.raw("COALESCE(c.prenom || ' ' || c.nom, '—') AS nom_client")
      )
      .orderBy('p.traite_le', 'desc')

    return reply.send({ encaissements })
  })

  // ── POST /caisse/mouvement — décaissement / retrait manuel ─────────────────
  fastify.post('/mouvement', { preHandler: [...pre, rolesOperer] }, async (req, reply) => {
    const { type_mouvement, montant, libelle, reference } = req.body

    const erreurs = []
    if (!['decaissement', 'retrait'].includes(type_mouvement))
      erreurs.push({ champ: 'type_mouvement', message: 'type_mouvement doit être decaissement ou retrait' })
    if (montant === undefined || montant === null || Number(montant) <= 0)
      erreurs.push({ champ: 'montant', message: 'Le montant doit être supérieur à 0' })
    if (!libelle) erreurs.push({ champ: 'libelle', message: 'Le libellé est requis' })
    if (erreurs.length) throw new ValidationError(erreurs)

    const session = await fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'ouverte' })
      .first()
    if (!session) throw new ConflictError('Aucune session de caisse ouverte', 'SESSION_INEXISTANTE')

    const [mouvement] = await fastify.db('mouvements_caisse').insert({
      session_id: session.id,
      hotel_id: req.hotelId,
      type_mouvement,
      montant: Number(montant),
      libelle,
      reference: reference || null,
      cree_par: req.user.id,
    }).returning('*')

    req.log.info({ mouvement_id: mouvement.id, session_id: session.id, type_mouvement, montant }, 'Mouvement de caisse enregistré')
    return reply.status(201).send({ message: 'Mouvement enregistré', mouvement })
  })

  // ── POST /caisse/cloturer — clôture avec comptage et calcul d'écart ────────
  fastify.post('/cloturer', { preHandler: [...pre, rolesCloturer] }, async (req, reply) => {
    const { montant_compte, notes } = req.body
    if (montant_compte === undefined || montant_compte === null || Number(montant_compte) < 0)
      throw new ValidationError([{ champ: 'montant_compte', message: 'Le montant compté est requis' }])

    const session = await fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'ouverte' })
      .first()
    if (!session) throw new ConflictError('Aucune session de caisse ouverte', 'SESSION_INEXISTANTE')

    const encaissementsEspeces = await sommeEncaissementsEspeces(req.hotelId, session)
    const montantTheorique     = parseFloat(session.fond_ouverture) + encaissementsEspeces
    const ecart                = Number(montant_compte) - montantTheorique

    const [cloturee] = await fastify.db('sessions_caisse')
      .where({ id: session.id, hotel_id: req.hotelId })
      .update({
        statut: 'cloturee',
        montant_theorique: montantTheorique,
        montant_compte: Number(montant_compte),
        ecart,
        fermee_le: fastify.db.fn.now(),
        fermee_par: req.user.id,
        notes_cloture: notes || null,
      })
      .returning('*')

    req.log.info({ session_id: session.id, hotel_id: req.hotelId, ecart }, 'Session de caisse clôturée')
    return reply.send({ message: 'Caisse clôturée', session: cloturee })
  })

  // ── GET /caisse/historique — sessions clôturées (30 derniers jours) ────────
  fastify.get('/historique', { preHandler: [...pre, rolesLecture] }, async (req, reply) => {
    const { page = 1, limite = 30 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    const query = fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'cloturee' })
      .andWhere('fermee_le', '>=', fastify.db.raw("CURRENT_DATE - INTERVAL '30 days'"))

    const [data, [{ total }]] = await Promise.all([
      query.clone().orderBy('fermee_le', 'desc').limit(parseInt(limite)).offset(offset),
      query.clone().count('id AS total'),
    ])

    return reply.send({ data, pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) } })
  })

  // ── GET /caisse/:id/detail — session + tous ses mouvements ─────────────────
  fastify.get('/:id/detail', { preHandler: [...pre, rolesLecture] }, async (req, reply) => {
    const session = await fastify.db('sessions_caisse')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .first()
    if (!session) throw new NotFoundError('Session de caisse')

    const mouvements = await fastify.db('mouvements_caisse')
      .where({ session_id: session.id, hotel_id: req.hotelId })
      .orderBy('cree_le', 'asc')

    return reply.send({ session, mouvements })
  })
}
