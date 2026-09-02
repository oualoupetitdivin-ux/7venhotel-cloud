'use strict'

const path = require('path')
const fs   = require('fs/promises')

const { createFacturationService }  = require('../services/facturation.service')
const { createFacturationRepository } = require('../repositories/facturation.repository')
const { genererFacturePDF, FACTURES_DIR } = require('../services/pdf.service')
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
  const pre  = [fastify.authentifier, fastify.contexteHotel]
  const repo = createFacturationRepository(fastify.db)

  const service = createFacturationService({ db: fastify.db, cache: fastify.cache })

  // ── GET /taxes — Taxes de l'hôtel ────────────────────────────────────────
  fastify.get('/taxes', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const taxes = await fastify.db('taxes')
      .where({ hotel_id: request.hotelId })
      .orderBy('ordre')
    return reply.send({ taxes })
  })

  // ── POST /taxes — Créer une taxe ─────────────────────────────────────────
  fastify.post('/taxes', {
    preHandler: [...pre, fastify.verifierPermission('facturation.creer')],
  }, async (request, reply) => {
    const { code, nom, type_taxe, valeur, s_applique_a, incluse_prix, ordre } = request.body
    if (!nom || !type_taxe || valeur === undefined)
      return reply.status(400).send({ erreur: 'nom, type_taxe et valeur sont requis' })
    const [taxe] = await fastify.db('taxes').insert({
      code: code || nom.toUpperCase().replace(/\s+/g, '_').slice(0, 20),
      nom, type_taxe, valeur, s_applique_a: s_applique_a || 'hebergement',
      incluse_prix: incluse_prix || false, ordre: ordre || 10,
      hotel_id: request.hotelId,
    }).returning('*')
    return reply.status(201).send({ message: 'Taxe créée', taxe })
  })

  // ── PUT /taxes/:id — Modifier une taxe ───────────────────────────────────
  fastify.put('/taxes/:id', {
    preHandler: [...pre, fastify.verifierPermission('facturation.modifier')],
  }, async (request, reply) => {
    const CHAMPS = ['nom', 'type_taxe', 'valeur', 's_applique_a', 'incluse_prix', 'active', 'ordre']
    const updateData = {}
    for (const k of CHAMPS) {
      if (request.body[k] !== undefined) updateData[k] = request.body[k]
    }
    const [updated] = await fastify.db('taxes')
      .where({ id: request.params.id, hotel_id: request.hotelId })
      .update(updateData)
      .returning('*')
    if (!updated) return reply.status(404).send({ erreur: 'Taxe introuvable' })
    return reply.send({ message: 'Taxe mise à jour', taxe: updated })
  })

  // ── GET /factures — Liste des factures ────────────────────────────────────
  fastify.get('/factures', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const { statut, page = 1, limite = 50 } = request.query
    let query = fastify.db('factures').where({ hotel_id: request.hotelId })
    if (statut) query = query.where({ statut })
    const offset = (parseInt(page) - 1) * parseInt(limite)
    const [data, [{ total }]] = await Promise.all([
      query.clone().orderBy('cree_le', 'desc').limit(parseInt(limite)).offset(offset),
      query.clone().count('id AS total'),
    ])
    return reply.send({ data, pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) } })
  })

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

    const { paiement_id } = request.body
    const reference_externe = request.body.reference_externe?.trim()
      || `CONF-MANUEL-${Date.now()}`

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

  // ── GET /paiements — Historique paiements (folio_id optionnel → tous) ───
  fastify.get('/paiements', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const { folio_id } = request.query
    const q = fastify.db('paiements AS p')
      .leftJoin('folios AS f', 'f.id', 'p.folio_id')
      .leftJoin('clients AS c', 'c.id', 'f.client_id')
      .where({ 'p.hotel_id': request.hotelId })
      .select(
        'p.*',
        fastify.db.raw("f.numero_folio"),
        fastify.db.raw("f.reservation_id"),
        fastify.db.raw("COALESCE(c.prenom || ' ' || c.nom, '—') AS nom_client")
      )
      .orderBy('p.cree_le', 'desc')
      .limit(50)
    if (folio_id) q.andWhere({ 'p.folio_id': folio_id })
    const paiements = await q
    return reply.send({ paiements })
  })

  // ── GET /factures/:id/pdf — Téléchargement PDF facture ───────────────────
  // Si url_pdf est vide ou fichier manquant, régénère le PDF à la volée
  // plutôt que de renvoyer un 404 définitif (la génération initiale peut avoir
  // échoué silencieusement au checkout pour ne pas bloquer le client).
  fastify.get('/factures/:id/pdf', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const facture = await repo.trouverFactureParId(request.params.id, request.hotelId)
    if (!facture) return reply.status(404).send({ erreur: 'Facture introuvable' })

    // Chercher le fichier sur disque
    let pdfPath = null
    if (facture.url_pdf) {
      const candidat = path.join(FACTURES_DIR, '..', facture.url_pdf)
      try { await fs.access(candidat); pdfPath = candidat }
      catch { /* fichier absent — régénération ci-dessous */ }
    }

    // Régénérer si nécessaire
    if (!pdfPath) {
      try {
        const db         = fastify.db
        const hotelId    = request.hotelId
        const reservationId = facture.reservation_id

        const [reservation, folio, hotel] = await Promise.all([
          db('reservations AS r')
            .leftJoin('clients AS c', 'c.id', 'r.client_id')
            .where({ 'r.id': reservationId, 'r.hotel_id': hotelId })
            .select(
              'r.*',
              db.raw("c.prenom || ' ' || c.nom AS nom_client"),
              'c.email AS email_client',
              'c.telephone AS telephone_client'
            )
            .first(),
          db('folios').where({ reservation_id: reservationId, hotel_id: hotelId }).first(),
          db('hotels AS h')
            .leftJoin('parametres_hotel AS ph', 'ph.hotel_id', 'h.id')
            .where('h.id', hotelId)
            .select(
              'h.nom',
              db.raw("ph.parametres_supplementaires->>'adresse' AS adresse"),
              db.raw("ph.parametres_supplementaires->>'email_contact' AS email")
            )
            .first(),
        ])

        if (!reservation || !folio)
          return reply.status(500).send({ erreur: 'Données manquantes pour régénérer le PDF' })

        const [lignes, paiements, soldeResult] = await Promise.all([
          db('lignes_folio').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc'),
          db('paiements').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc'),
          db.raw('SELECT * FROM get_solde_folio(?, ?)', [folio.id, hotelId]),
        ])

        const { cheminRelatif, filepath } = await genererFacturePDF({
          facture,
          reservation,
          hotel:     { nom: hotel?.nom || 'Hôtel', adresse: hotel?.adresse, email: hotel?.email },
          client:    { nom: reservation.nom_client, email: reservation.email_client, telephone: reservation.telephone_client },
          lignes:    lignes.map(l => ({ ...l, montant: l.montant_total })),
          paiements,
          solde:     soldeResult.rows[0],
        })

        await repo.mettreAJourUrlPdf(facture.id, hotelId, cheminRelatif)
        pdfPath = filepath
        request.log.info({ facture_id: facture.id }, 'PDF régénéré à la volée')
      } catch (err) {
        request.log.error({ facture_id: facture.id, err: err.message }, 'Échec régénération PDF')
        return reply.status(500).send({ erreur: `Impossible de régénérer le PDF : ${err.message}` })
      }
    }

    const pdfBuffer = await fs.readFile(pdfPath)
    const filename  = `${facture.numero_facture}.pdf`
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(pdfBuffer)
  })

  // ── GET /factures/:reservationId/par-reservation ─────────────────────────
  fastify.get('/factures/par-reservation/:reservationId', {
    preHandler: [...pre, fastify.verifierPermission('facturation.lire')],
  }, async (request, reply) => {
    const facture = await repo.trouverFactureParReservation(request.params.reservationId, request.hotelId)
    return reply.send({ facture: facture || null })
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
