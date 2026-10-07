'use strict'

const comptabilite = require('../services/comptabilite.bridge')

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

  // ── Montant théorique d'une session (LOT-PMS-02) ────────────────────────────
  // Théorique = fond d'ouverture
  //           + encaissements espèces DE LA SESSION (paiements valides, arrhes espèces reçues)
  //           − sorties d'espèces DE LA SESSION (décaissements, retraits, remboursements d'arrhes
  //             espèces, contre-passations de paiements espèces)
  // Fenêtre = [ouverte_le (horodatage réel) ; clôture (ou maintenant)]. Auparavant : paiements de la
  // journée calendaire uniquement, décaissements ignorés → écart faux.
  async function calculerTheorique(hotelId, session, jusqua = null) {
    const db  = fastify.db
    const fin = jusqua || session.fermee_le || new Date()
    const dansSession = (col) => db.raw(`${col} >= ? AND ${col} <= ?`, [session.ouverte_le, fin])

    const [{ total: paiements }] = await db('paiements')
      .where({ hotel_id: hotelId, type_paiement: 'especes', statut: 'valide' })
      .andWhere(dansSession('COALESCE(confirme_le, traite_le, cree_le)'))
      .sum('montant AS total')

    const [{ total: contrePassations }] = await db('lignes_folio AS corr')
      .join('lignes_folio AS orig', 'orig.id', 'corr.ligne_corrigee_id')
      .join('paiements AS p', db.raw('p.id = orig.reference_id'))
      .where({ 'corr.hotel_id': hotelId, 'corr.type_ligne': 'correction', 'corr.sens': 'debit',
               'orig.type_ligne': 'paiement', 'p.type_paiement': 'especes' })
      .andWhere(dansSession('corr.cree_le'))
      .sum('corr.montant_total AS total')

    const arrhes = await db('lignes_folio')
      .where({ hotel_id: hotelId, type_ligne: 'arrhes' })
      .andWhereRaw("metadata->>'mode_paiement' = 'especes'")
      .andWhere(dansSession('cree_le'))
      .select(db.raw("COALESCE(SUM(montant_total) FILTER (WHERE sens = 'credit'), 0) AS recues"),
              db.raw("COALESCE(SUM(montant_total) FILTER (WHERE sens = 'debit' AND metadata->>'nature' = 'remboursement'), 0) AS remboursees"))
      .first()

    const [{ total: sorties }] = await db('mouvements_caisse')
      .where({ session_id: session.id, hotel_id: hotelId })
      .whereIn('type_mouvement', ['decaissement', 'retrait'])
      .sum('montant AS total')

    const n = (v) => parseFloat(v || 0)
    const detail = {
      fond_ouverture:             n(session.fond_ouverture),
      encaissements_paiements:    n(paiements),
      encaissements_arrhes:       n(arrhes.recues),
      sorties_mouvements:         n(sorties),
      remboursements_arrhes:      n(arrhes.remboursees),
      contre_passations_paiements: n(contrePassations),
    }
    const theorique = detail.fond_ouverture + detail.encaissements_paiements + detail.encaissements_arrhes
      - detail.sorties_mouvements - detail.remboursements_arrhes - detail.contre_passations_paiements
    return { theorique: Math.round(theorique * 100) / 100, encaissements: detail.encaissements_paiements + detail.encaissements_arrhes, detail }
  }

  // ── GET /caisse/session-active — session en cours (null si aucune) ─────────
  fastify.get('/session-active', { preHandler: [...pre, rolesLecture] }, async (req, reply) => {
    const session = await fastify.db('sessions_caisse')
      .where({ hotel_id: req.hotelId, statut: 'ouverte' })
      .first()

    if (!session) return reply.send({ session: null })

    const calcul = await calculerTheorique(req.hotelId, session)
    return reply.send({
      session: {
        ...session,
        encaissements_especes: calcul.encaissements,
        total_theorique: calcul.theorique,
        detail_theorique: calcul.detail,
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
      // LOT-PMS-02 — encaissements DE LA SESSION (et non de la journée calendaire)
      .andWhereRaw('COALESCE(p.confirme_le, p.traite_le, p.cree_le) >= ?', [session.ouverte_le])
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
    await comptabilite.publier(fastify.db, { source: 'mouvement_caisse', id: mouvement.id, hotelId: req.hotelId, userId: req.user.id, log: req.log })
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

    // Un seul instant de référence : le théorique couvre exactement [ouverture ; fermee_le]
    const instantCloture   = new Date()
    const calcul           = await calculerTheorique(req.hotelId, session, instantCloture)
    const montantTheorique = calcul.theorique
    const ecart            = Math.round((Number(montant_compte) - montantTheorique) * 100) / 100

    const [cloturee] = await fastify.db('sessions_caisse')
      .where({ id: session.id, hotel_id: req.hotelId })
      .update({
        statut: 'cloturee',
        montant_theorique: montantTheorique,
        montant_compte: Number(montant_compte),
        ecart,
        fermee_le: instantCloture,
        fermee_par: req.user.id,
        notes_cloture: notes || null,
      })
      .returning('*')

    req.log.info({ session_id: session.id, hotel_id: req.hotelId, ecart }, 'Session de caisse clôturée')
    await comptabilite.publier(fastify.db, { source: 'session_caisse', id: session.id, hotelId: req.hotelId, userId: req.user.id, log: req.log })
    return reply.send({ message: 'Caisse clôturée', session: cloturee, detail_theorique: calcul.detail })
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
