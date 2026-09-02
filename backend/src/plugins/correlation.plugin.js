'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// correlation.plugin.js — Identifiants de corrélation cross-request
//
// Invariant garanti :
//   Chaque request HTTP entrant dans 7venHotel Cloud possède un identifiant
//   unique traceable dans tous les logs, les réponses, et l'audit trail.
//
// Comportement :
//   1. Si le client envoie X-Correlation-ID → réutilisé (traçabilité client-serveur)
//   2. Sinon → généré ici (UUID v4 via crypto.randomUUID)
//   3. Ajouté à request.correlationId
//   4. Ajouté à request.log (child logger — propagé dans tous les logs suivants)
//   5. Retourné dans X-Correlation-ID de la réponse
//
// Usage dans les routes :
//   request.correlationId              → accès direct
//   request.log.info({ ... })         → correlation_id inclus automatiquement
// ─────────────────────────────────────────────────────────────────────────────

const fp             = require('fastify-plugin')
const { randomUUID } = require('crypto')

// Longueur max acceptée pour un X-Correlation-ID entrant (évite header injection)
const MAX_CID_LENGTH = 128
const CID_PATTERN    = /^[a-zA-Z0-9\-_:.]{1,128}$/

async function correlationPlugin(fastify) {

  fastify.addHook('onRequest', (request, reply, done) => {
    // Fastify.genReqId() (server.js) a déjà : utilisé l'ID entrant ou généré un UUID.
    // request.id === correlationId — les logs framework ("reqId") sont donc déjà corrélés.
    // On expose request.correlationId comme alias pratique pour les routes et engines.
    request.correlationId = request.id

    // Retourner l'ID dans la réponse — permet au client de lier ses propres logs
    reply.header('x-correlation-id', request.id)

    done()
  })
}

module.exports = fp(correlationPlugin, { name: 'correlation', fastify: '4.x' })
