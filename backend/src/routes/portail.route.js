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
}
