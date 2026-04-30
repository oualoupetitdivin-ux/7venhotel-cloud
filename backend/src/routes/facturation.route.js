'use strict'

const { createFacturationService }  = require('../services/facturation.service')
const { ValidationError }           = require('../errors')
const {
  validerAjoutLigne,
  validerCreationPaiement,
  validerConfirmationPaiement,
  validerCorrection,
} = require('../validators/facturation.validator')

// ─────────────────────────────────────────────────────────────────────────────
// routes/facturation.route.js
//
// Transport HTTP uniquement. Aucune logique métier, aucun accès DB.
// Délègue intégralement au service.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function facturationRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  const service = createFacturationService({ db: fastify.db, cache: fastify.cache })

  // ── GET /folio/:reservationId — Folio complet d'une réservation ───────────
  fastify.get('/folio/:reservationId', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const resultat = await service.getFolioParReservation(
      request.params.reservationId,
      request.hotelId
    )
    return reply.send(resultat)
  })

  // ── GET /solde/:folioId — Solde calculé en SQL ─────────────────────────────
  fastify.get('/solde/:folioId', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const solde = await service.getSolde(request.params.folioId, request.hotelId)
    return reply.send(solde)
  })

  // ── POST /ligne — Ajout de charge manuelle ────────────────────────────────
  fastify.post('/ligne', {
    preHandler: [...pre, fastify.verifierPermission('facturation.creer')],
  }, async (request, reply) => {
    const validation = validerAjoutLigne(request.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { folio_id, type_ligne, montant, description, source_module } = request.body

    const ligne = await service.ajouterLigne(
      folio_id,
      request.hotelId,
      request.user.id,
      { typeLigne: type_ligne, montant, description, sourceModule: source_module }
    )

    request.log.info(
      { folio_id, hotel_id: request.hotelId, type_ligne, montant },
      'Ligne folio ajoutée'
    )
    return reply.status(201).send({ message: 'Ligne ajoutée', ligne })
  })

  // ── POST /paiement — Créer un paiement ────────────────────────────────────
  fastify.post('/paiement', {
    preHandler: [...pre, fastify.verifierPermission('facturation.creer')],
  }, async (request, reply) => {
    const validation = validerCreationPaiement(request.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const {
      folio_id, type_paiement, montant, devise,
      numero_telephone, notes, idempotency_key,
    } = request.body

    const resultat = await service.creerPaiement(
      folio_id,
      request.hotelId,
      request.tenantId,
      request.user.id,
      { typePaiement: type_paiement, montant, devise, numeroTelephone: numero_telephone,
        notes, idempotencyKey: idempotency_key }
    )

    const httpStatus = resultat.paiement.statut === 'en_attente' ? 202 : 201
    const message    = resultat.paiement.statut === 'en_attente'
      ? 'Paiement initié — en attente de confirmation opérateur'
      : 'Paiement enregistré'

    request.log.info(
      { folio_id, hotel_id: request.hotelId, type_paiement, montant,
        statut: resultat.paiement.statut },
      'Paiement créé'
    )
    return reply.status(httpStatus).send({ message, ...resultat })
  })

  // ── POST /paiement/confirm — Confirmer un paiement mobile money ───────────
  fastify.post('/paiement/confirm', {
    preHandler: [...pre, fastify.verifierPermission('facturation.creer')],
  }, async (request, reply) => {
    const validation = validerConfirmationPaiement(request.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { paiement_id, reference_externe } = request.body

    const resultat = await service.confirmerPaiement(
      paiement_id,
      request.hotelId,
      request.user.id,
      reference_externe
    )

    if (resultat.idempotent) {
      return reply.send({ message: 'Paiement déjà confirmé', ...resultat })
    }

    request.log.info(
      { paiement_id, hotel_id: request.hotelId, reference_externe },
      'Paiement mobile money confirmé'
    )
    return reply.send({ message: 'Paiement confirmé', ...resultat })
  })

  // ── POST /correction — Corriger une ligne ─────────────────────────────────
  fastify.post('/correction', {
    preHandler: [...pre, fastify.verifierPermission('facturation.modifier')],
  }, async (request, reply) => {
    const validation = validerCorrection(request.body)
    if (!validation.ok) throw new ValidationError(validation.erreurs)

    const { ligne_id, motif } = request.body

    const ligneCorrection = await service.corrigerLigne(
      ligne_id,
      request.hotelId,
      request.user.id,
      motif
    )

    request.log.info(
      { ligne_id, hotel_id: request.hotelId },
      'Ligne corrigée'
    )
    return reply.status(201).send({ message: 'Correction enregistrée', ligne: ligneCorrection })
  })
}
