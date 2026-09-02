'use strict'

const { createPortailService } = require('../services/portail.service')
const { ValidationError, DomainError } = require('../errors')
const {
  validerToken,
  validerSessionToken,
  validerMessage,
  validerDemandeService,
  validerEvaluation,
} = require('../validators/portail.validator')

// ─────────────────────────────────────────────────────────────────────────────
// routes/portail.route.js
//
// Transport HTTP uniquement — pas de logique métier, pas d'accès DB direct.
//
// AUTHENTIFICATION — DEUX NIVEAUX :
//
//   Niveau 1 : GET /:token
//     Le token QR est dans le path (URL initiale).
//     Validé → génère un session_token retourné au client.
//     C'est LA SEULE FOIS que le token QR est utilisé.
//
//   Niveau 2 : toutes les autres routes
//     Le client envoie le session_token dans le header :
//       Authorization: Bearer {session_token}
//     Jamais le token QR. Jamais dans l'URL.
//
// POURQUOI HEADER ET PAS COOKIE :
//   @fastify/cookie n'est pas dans les dépendances du projet.
//   L'ajout d'une dépendance requiert un redéploiement avec npm install.
//   Le header Authorization est équivalent pour une API — les logs Fastify
//   ne loguent pas les headers par défaut (contrairement au path).
//
// ISOLATION TENANT :
//   req.portailCtx injecté par authentifierSession contient :
//     { reservationId, hotelId, sessionId, chambreId }
//   Ces valeurs sont transmises au service — jamais lues depuis le body.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function portailRoutes(fastify) {

  // Service instancié une fois à l'enregistrement
  const service = createPortailService({ db: fastify.db, cache: fastify.cache })

  // ── Middleware d'authentification session portail ──────────────────────────
  // Utilisé sur toutes les routes sauf GET /:token
  const authentifierSession = async (req, reply) => {
    const authHeader = req.headers['authorization']
    const sessionToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null

    const validation = validerSessionToken(sessionToken)
    if (!validation.ok) {
      return reply.status(401).send({
        erreur:  validation.erreurs[0].message,
        code:    'SESSION_REQUISE',
        conseil: 'Accédez d\'abord au portail via votre lien ou QR code',
      })
    }

    // Délégation complète au service — aucune logique ici
    try {
      req.portailCtx = await service.validerSession(sessionToken)
    } catch (err) {
      return reply.status(err.statusCode || 401).send({
        erreur: err.message,
        code:   err.code || 'SESSION_INVALIDE',
      })
    }
  }

  // ── GET /:token — Échange token QR → session_token ───────────────────────
  // SEULE route qui reçoit le token QR dans le path.
  // Toutes les autres routes utilisent le session_token en header.
  fastify.get('/:token', async (req, reply) => {
    const { token } = req.params

    const validation = validerToken(token)
    if (!validation.ok) {
      return reply.status(400).send({
        erreur:  validation.erreurs[0].message,
        code:    'TOKEN_INVALIDE',
      })
    }

    // IP pour logging — jamais stockée dans le path ou la réponse
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim()

    const resultat = await service.initSession(token, ipAddress)

    // Le token QR n'est pas retourné dans la réponse
    // Le client stocke session_token en mémoire (JS) ou localStorage
    return reply.send({
      session_token:  resultat.session_token,
      expire_dans_ms: resultat.expire_dans_ms,
      message:        'Session portail initialisée. Utilisez session_token dans le header Authorization.',
    })
  })

  // ── GET /context — Contexte complet du séjour ─────────────────────────────
  // Retourne réservation + messages + demandes en une seule réponse.
  // Optimisé pour connexion instable : pas de multiples appels nécessaires.
  fastify.get('/context', { preHandler: authentifierSession }, async (req, reply) => {
    const { reservationId, hotelId } = req.portailCtx

    const contexte = await service.getContexte(reservationId, hotelId)
    return reply.send(contexte)
  })

  // ── POST /messages — Envoyer un message à la réception ───────────────────
  fastify.post('/messages', { preHandler: authentifierSession }, async (req, reply) => {
    const validation = validerMessage(req.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { reservationId, hotelId, sessionId } = req.portailCtx

    const message = await service.envoyerMessage(
      reservationId,
      hotelId,
      sessionId,
      req.body.corps
    )

    return reply.status(201).send({
      message:    'Message envoyé à la réception',
      id_message: message.id,
      envoye_le:  message.cree_le,
    })
  })

  // ── POST /services — Demande de service ───────────────────────────────────
  fastify.post('/services', { preHandler: authentifierSession }, async (req, reply) => {
    const validation = validerDemandeService(req.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { reservationId, hotelId, chambreId } = req.portailCtx

    const demande = await service.creerDemandeService(
      reservationId,
      hotelId,
      chambreId,
      {
        typeService: req.body.type_service,
        description: req.body.description,
      }
    )

    return reply.status(201).send({
      message:    'Demande envoyée — notre équipe intervient dans les plus brefs délais',
      id_demande: demande.id,
      type:       demande.type_service,
      statut:     demande.statut,
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // INBOX PORTAIL — Routes réception (staff JWT + contexteHotel)
  //
  // Ces routes sont distinctes de l'authentification session portail client.
  // Elles utilisent le JWT staff standard (fastify.authentifier + contexteHotel).
  // Permet à la réception de lire et répondre aux messages envoyés par les clients.
  // ─────────────────────────────────────────────────────────────────────────

  // ── GET /inbox — Liste des conversations avec messages non lus ────────────
  fastify.get('/inbox', {
    preHandler: [fastify.authentifier, fastify.contexteHotel],
  }, async (req, reply) => {
    const hotelId = req.hotelId

    // Deux passes pour éviter les agrégats complexes imbriqués.
    // Passe 1 : réservations ayant au moins 1 message
    const convs = await fastify.db('reservations AS r')
      .join('clients AS c',       'c.id',  'r.client_id')
      .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
      .whereIn('r.id', function () {
        this.select('reservation_id').from('messages').where('hotel_id', hotelId).distinct()
      })
      .where('r.hotel_id', hotelId)
      .select(
        'r.id AS reservation_id',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'ch.numero AS numero_chambre',
        'r.numero_reservation',
        'r.statut AS statut_reservation'
      )

    // Pour chaque conversation, compter les non-lus et récupérer le dernier message
    const enrichies = await Promise.all(convs.map(async conv => {
      const [stats] = await fastify.db('messages')
        .where({ reservation_id: conv.reservation_id, hotel_id: hotelId })
        .select(
          fastify.db.raw("COUNT(CASE WHEN expediteur_type = 'client' AND lu = false THEN 1 END)::int AS messages_non_lus"),
          fastify.db.raw('MAX(cree_le) AS dernier_message_le')
        )

      const dernier = await fastify.db('messages')
        .where({ reservation_id: conv.reservation_id, hotel_id: hotelId })
        .orderBy('cree_le', 'desc')
        .select('corps', 'expediteur_type')
        .first()

      return {
        ...conv,
        messages_non_lus: parseInt(stats?.messages_non_lus || 0),
        dernier_message:  dernier?.corps ? dernier.corps.slice(0, 100) : '',
        dernier_expediteur: dernier?.expediteur_type,
        dernier_message_le: stats?.dernier_message_le,
      }
    }))

    enrichies.sort((a, b) => new Date(b.dernier_message_le) - new Date(a.dernier_message_le))

    return reply.send({ conversations: enrichies })
  })

  // ── GET /inbox/:reservationId — Messages d'une réservation ────────────────
  fastify.get('/inbox/:reservationId', {
    preHandler: [fastify.authentifier, fastify.contexteHotel],
  }, async (req, reply) => {
    const { reservationId } = req.params
    const hotelId = req.hotelId

    // Vérifier que la réservation appartient à cet hôtel
    const reservation = await fastify.db('reservations AS r')
      .join('clients AS c',       'c.id',  'r.client_id')
      .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
      .where({ 'r.id': reservationId, 'r.hotel_id': hotelId })
      .select(
        'r.id', 'r.numero_reservation', 'r.statut',
        'r.date_arrivee', 'r.date_depart',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'ch.numero AS numero_chambre'
      )
      .first()

    if (!reservation) {
      return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    }

    // Tous les messages de cette réservation
    const messages = await fastify.db('messages')
      .where({ reservation_id: reservationId, hotel_id: hotelId })
      .select('id', 'expediteur_type', 'corps', 'lu', 'lu_le', 'cree_le')
      .orderBy('cree_le', 'asc')

    // Marquer les messages client non lus comme lus
    await fastify.db('messages')
      .where({ reservation_id: reservationId, hotel_id: hotelId, expediteur_type: 'client', lu: false })
      .update({ lu: true, lu_le: fastify.db.fn.now() })

    return reply.send({ reservation, messages })
  })

  // ── POST /inbox/:reservationId/reply — Réponse de la réception ───────────
  fastify.post('/inbox/:reservationId/reply', {
    preHandler: [fastify.authentifier, fastify.contexteHotel],
  }, async (req, reply) => {
    const { reservationId } = req.params
    const hotelId = req.hotelId
    const { corps } = req.body || {}

    if (!corps || typeof corps !== 'string' || corps.trim().length === 0) {
      return reply.status(400).send({ erreur: 'Message requis', code: 'CORPS_MANQUANT' })
    }
    if (corps.trim().length > 2000) {
      return reply.status(400).send({ erreur: 'Message trop long (max 2000 caractères)', code: 'MESSAGE_TROP_LONG' })
    }

    // Vérifier que la réservation appartient à cet hôtel
    const reservation = await fastify.db('reservations')
      .where({ id: reservationId, hotel_id: hotelId })
      .first()

    if (!reservation) {
      return reply.status(404).send({ erreur: 'Réservation introuvable', code: 'RESERVATION_INTROUVABLE' })
    }

    const [message] = await fastify.db('messages')
      .insert({
        reservation_id:  reservationId,
        hotel_id:        hotelId,
        expediteur_type: 'staff',
        expediteur_id:   req.user.id,
        corps:           corps.trim(),
        lu:              true,  // messages staff : lus d'emblée
        lu_le:           fastify.db.fn.now(),
        cree_le:         fastify.db.fn.now(),
      })
      .returning('id', 'expediteur_type', 'corps', 'lu', 'cree_le')

    return reply.status(201).send({ message })
  })

  // ── POST /evaluation — Soumettre une évaluation du séjour ────────────────
  fastify.post('/evaluation', { preHandler: authentifierSession }, async (req, reply) => {
    const validation = validerEvaluation(req.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { reservationId, hotelId } = req.portailCtx

    const evaluation = await service.soumettreEvaluation(
      reservationId,
      hotelId,
      req.body
    )

    return reply.status(201).send({
      message:    'Merci pour votre évaluation !',
      id:         evaluation.id,
      note:       evaluation.note_globale,
      envoye_le:  evaluation.cree_le,
    })
  })

  // GET /portail/appels — Alertes d'appel en attente (polling réception, 2h glissantes)
  fastify.get('/appels', { preHandler: [fastify.authentifier, fastify.contexteHotel] }, async (req, reply) => {
    const appels = await fastify.db('demandes_service AS ds')
      .join('reservations AS r', 'r.id', 'ds.reservation_id')
      .join('chambres AS c', 'c.id', 'r.chambre_id')
      .where({ 'ds.hotel_id': req.hotelId, 'ds.type_service': 'appel_reception' })
      .whereIn('ds.statut', ['nouvelle', 'en_cours'])
      .where('ds.cree_le', '>', fastify.db.raw("NOW() - INTERVAL '2 hours'"))
      .select(
        'ds.id', 'ds.cree_le', 'ds.description', 'ds.statut',
        'c.numero AS numero_chambre'
      )
      .orderBy('ds.cree_le', 'desc')
    return reply.send({ appels, total: appels.length })
  })

  // PUT /portail/appels/:id/traiter — Marquer un appel comme traité
  fastify.put('/appels/:id/traiter', { preHandler: [fastify.authentifier, fastify.contexteHotel] }, async (req, reply) => {
    await fastify.db('demandes_service')
      .where({ id: req.params.id, hotel_id: req.hotelId, type_service: 'appel_reception' })
      .update({ statut: 'terminee' })
    return reply.send({ ok: true })
  })
}
