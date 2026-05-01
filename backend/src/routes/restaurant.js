'use strict'

module.exports = async function restaurantRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /menu ──────────────────────────────────────────────────────────────
  fastify.get('/menu', { preHandler: pre }, async (req, reply) => {
    const menu = await fastify.db('articles_menu')
      .where({ hotel_id: req.hotelId, disponible: true })
      .orderBy('categorie').orderBy('ordre')
    const parCategorie = menu.reduce((acc, a) => {
      if (!acc[a.categorie]) acc[a.categorie] = []
      acc[a.categorie].push(a)
      return acc
    }, {})
    reply.send({ menu: parCategorie, articles: menu })
  })

  // ── GET /commandes ─────────────────────────────────────────────────────────
  fastify.get('/commandes', { preHandler: pre }, async (req, reply) => {
    const { statut } = req.query
    let q = fastify.db('commandes_restaurant').where({ hotel_id: req.hotelId })
    if (statut) q = q.whereIn('statut', Array.isArray(statut) ? statut : [statut])
    const commandes = await q.orderBy('heure_commande', 'desc').limit(100)
    reply.send({ commandes })
  })

  // ── POST /commandes ────────────────────────────────────────────────────────
  // PATCH 1 : mode_reglement accepté — 'chambre' (défaut hôtel) ou 'immediat'
  // PATCH 2 : walk_in DOIT avoir mode_reglement='immediat' — rejet sinon
  fastify.post('/commandes', { preHandler: pre }, async (req, reply) => {
    const { lignes, ...cmdData } = req.body
    const typeClient    = cmdData.type_client || 'walk_in'
    const modeReglement = cmdData.mode_reglement || (typeClient === 'walk_in' ? 'immediat' : 'chambre')

    if (typeClient === 'walk_in' && modeReglement !== 'immediat')
      return reply.status(400).send({
        erreur: 'Un client walk_in doit avoir mode_reglement="immediat"',
        code:   'MODE_REGLEMENT_INVALIDE',
      })

    if (!['chambre', 'immediat'].includes(modeReglement))
      return reply.status(400).send({
        erreur: 'mode_reglement invalide — valeurs acceptées : chambre, immediat',
        code:   'MODE_REGLEMENT_INVALIDE',
      })

    const trx = await fastify.db.transaction()
    try {
      const [commande] = await trx('commandes_restaurant').insert({
        ...cmdData,
        hotel_id:       req.hotelId,
        serveur_id:     req.user.id,
        type_client:    typeClient,
        mode_reglement: modeReglement,
      }).returning('*')

      if (lignes?.length) {
        await trx('lignes_commande').insert(lignes.map(l => ({ ...l, commande_id: commande.id })))
      }

      await trx.commit()
      // PATCH 5 — doit_payer : le serveur sait immédiatement si encaissement requis
      reply.status(201).send({ message: 'Commande créée', commande, doit_payer: modeReglement === 'immediat' })
    } catch (err) { await trx.rollback(); throw err }
  })

  // ── PUT /commandes/:id/statut ──────────────────────────────────────────────
  // PATCH 3 — Facturation à statut='servie', 3 cas selon type_client + mode_reglement
  fastify.put('/commandes/:id/statut', { preHandler: pre }, async (req, reply) => {
    const nouveauStatut = req.body.statut
    const hotelId       = req.hotelId

    await fastify.db.transaction(async (trx) => {

      // Verrou pessimiste — sérialise les doubles "servie" concurrents
      const commandeAvant = await trx('commandes_restaurant')
        .where({ id: req.params.id, hotel_id: hotelId })
        .forUpdate()
        .first()

      if (!commandeAvant)
        return reply.status(404).send({ erreur: 'Commande introuvable' })

      const updates = { statut: nouveauStatut }
      if (nouveauStatut === 'en_preparation') updates.heure_preparation = trx.fn.now()
      if (nouveauStatut === 'prete')          updates.heure_prete        = trx.fn.now()
      if (nouveauStatut === 'servie')         updates.heure_servie        = trx.fn.now()

      const [updated] = await trx('commandes_restaurant')
        .where({ id: req.params.id, hotel_id: hotelId })
        .update(updates)
        .returning('*')

      if (nouveauStatut === 'servie') {

        // Commande annulée — aucune écriture financière
        if (commandeAvant.statut === 'annulee')
          return reply.status(409).send({
            erreur: 'Commande annulée — facturation impossible',
            code:   'COMMANDE_ANNULEE',
          })

        // Montant réel depuis lignes_commande — jamais depuis le total persisté
        const lignesCmd   = await trx('lignes_commande').where({ commande_id: commandeAvant.id })
        const montantReel = lignesCmd.reduce((s, l) => s + Number(l.montant_total), 0)
        const montant     = montantReel > 0 ? montantReel : Number(commandeAvant.total)

        if (montant <= 0) {
          req.log.warn({ commande_id: commandeAvant.id, hotel_id: hotelId },
            'Commande servie montant nul — aucune écriture financière')
          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }

        const reservationId = commandeAvant.reservation_id
        const modeReglement = commandeAvant.mode_reglement || 'chambre'
        const devise        = commandeAvant.devise || 'XAF'
        const estClientHotel = !!reservationId

        // ── CAS 3 — CLIENT EXTERNE ─────────────────────────────────────────
        // Aucune écriture dans folio_lignes.
        // Paiement enregistré dans paiements avec hotel_id pour traçabilité analytics.
        if (!estClientHotel) {
          const MOYENS_VALIDES = ['carte', 'especes', 'virement', 'mobile_money']
          const moyenExt = commandeAvant.mode_paiement
          if (!moyenExt || !MOYENS_VALIDES.includes(moyenExt))
            return reply.status(400).send({
              erreur: `mode_paiement requis et valide pour client externe — reçu : "${moyenExt || 'absent'}"`,
              code:   'MODE_PAIEMENT_INVALIDE',
              valeurs_acceptees: MOYENS_VALIDES,
            })

          await trx('paiements').insert({
            hotel_id:        hotelId,
            tenant_id:       req.tenantId,
            reservation_id:  null,
            folio_id:        null,
            type_paiement:   moyenExt,
            statut:          'valide',
            montant:         montant,
            devise:          devise,
            notes:           `Commande restaurant ${commandeAvant.numero_commande} — client externe`,
            methode_detail:  JSON.stringify({ commande_id: commandeAvant.id, type_client: commandeAvant.type_client }),
            traite_par:      req.user.id || null,
            traite_le:       trx.fn.now(),
            idempotency_key: `resto-ext-${commandeAvant.id}`,
            source_module:   'restaurant',
          })

          req.log.info({ commande_id: commandeAvant.id, hotel_id: hotelId, montant },
            'Client externe — paiement enregistré, pas de folio')
          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }

        // ── CLIENT HÔTEL — Idempotence avant toute écriture folio ──────────
        // NOTE : idx_folio_lignes_reference n'est PAS UNIQUE (reference_id seul).
        // Le FOR UPDATE sur commandes_restaurant est la protection anti-race.
        const ligneExistante = await trx('folio_lignes')
          .where({ reference_id: commandeAvant.id, reference_type: 'commande_restaurant' })
          .first()

        if (ligneExistante)
          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })

        const folio = await trx('folios')
          .where({ reservation_id: reservationId, hotel_id: hotelId, statut: 'ouvert' })
          .first()

        if (!folio) {
          req.log.warn({
            code:           'FOLIO_ABSENT_RESTAURANT',
            commande_id:    commandeAvant.id,
            hotel_id:       hotelId,
            reservation_id: reservationId,
          }, 'Commande servie sans folio ouvert — réconciliation requise')
          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }

        // ── CAS 1 — CLIENT HÔTEL + PAIEMENT DIFFÉRÉ (chambre) ──────────────
        // INSERT debit uniquement — solde augmente, réglé au checkout
        if (modeReglement === 'chambre') {
          await trx('folio_lignes').insert({
            folio_id:       folio.id,
            hotel_id:       hotelId,
            type_ligne:     'restaurant',
            sens:           'debit',
            montant:        montant,
            devise:         devise,
            description:    `Restaurant — ${commandeAvant.numero_commande}`,
            reference_id:   commandeAvant.id,
            reference_type: 'commande_restaurant',
            source_module:  'restaurant',
            cree_par:       req.user.id || null,
            cree_par_type:  'staff',
            metadata:       JSON.stringify({ numero_commande: commandeAvant.numero_commande, mode_reglement: 'chambre' }),
          })

          await trx('commandes_restaurant')
            .where({ id: commandeAvant.id, hotel_id: hotelId })
            .update({ debitee_folio: true })

          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }

        // ── CAS 2 — CLIENT HÔTEL + PAIEMENT IMMÉDIAT ───────────────────────
        // INSERT debit + INSERT credit dans la même transaction.
        // Le folio reste équilibré : debit restaurant + credit paiement = solde inchangé.
        if (modeReglement === 'immediat') {
          // Ligne debit — la charge restaurant
          await trx('folio_lignes').insert({
            folio_id:       folio.id,
            hotel_id:       hotelId,
            type_ligne:     'restaurant',
            sens:           'debit',
            montant:        montant,
            devise:         devise,
            description:    `Restaurant — ${commandeAvant.numero_commande}`,
            reference_id:   commandeAvant.id,
            reference_type: 'commande_restaurant',
            source_module:  'restaurant',
            cree_par:       req.user.id || null,
            cree_par_type:  'staff',
            metadata:       JSON.stringify({ numero_commande: commandeAvant.numero_commande, mode_reglement: 'immediat' }),
          })

          // PATCH 4 — Enregistrement paiement dans paiements (traçabilité + analytics)
          const MOYENS_VALIDES_IMM = ['carte', 'especes', 'virement', 'mobile_money']
          const moyenImm = commandeAvant.mode_paiement
          if (!moyenImm || !MOYENS_VALIDES_IMM.includes(moyenImm))
            return reply.status(400).send({
              erreur: `mode_paiement requis et valide pour paiement immédiat — reçu : "${moyenImm || 'absent'}"`,
              code:   'MODE_PAIEMENT_INVALIDE',
              valeurs_acceptees: MOYENS_VALIDES_IMM,
            })

          const [paiement] = await trx('paiements').insert({
            hotel_id:        hotelId,
            tenant_id:       req.tenantId,
            reservation_id:  reservationId,
            folio_id:        folio.id,
            type_paiement:   moyenImm,
            statut:          'valide',
            montant:         montant,
            devise:          devise,
            notes:           `Paiement immédiat restaurant ${commandeAvant.numero_commande}`,
            methode_detail:  JSON.stringify({ commande_id: commandeAvant.id }),
            traite_par:      req.user.id || null,
            traite_le:       trx.fn.now(),
            idempotency_key: `resto-imm-${commandeAvant.id}`,
            source_module:   'restaurant',
          }).returning('id')

          // Ligne credit — le paiement, référencé sur l'entrée paiements
          await trx('folio_lignes').insert({
            folio_id:       folio.id,
            hotel_id:       hotelId,
            type_ligne:     'paiement',
            sens:           'credit',
            montant:        montant,
            devise:         devise,
            description:    `Paiement restaurant immédiat — ${commandeAvant.numero_commande}`,
            reference_id:   paiement.id,
            reference_type: 'paiement',
            source_module:  'restaurant',
            cree_par:       req.user.id || null,
            cree_par_type:  'staff',
            metadata:       JSON.stringify({ commande_id: commandeAvant.id }),
          })

          await trx('commandes_restaurant')
            .where({ id: commandeAvant.id, hotel_id: hotelId })
            .update({ debitee_folio: true })

          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }
      }

      // Hors 'servie' — doit_payer selon mode_reglement et statut courant
      const doitPayer = updated.mode_reglement === 'immediat' && updated.statut !== 'servie'
      reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: doitPayer })
    })
  })

  // ── GET /cuisine ───────────────────────────────────────────────────────────
  fastify.get('/cuisine', { preHandler: pre }, async (req, reply) => {
    const commandes = await fastify.db('commandes_restaurant AS c')
      .where({ 'c.hotel_id': req.hotelId })
      .whereNotIn('c.statut', ['servie', 'annulee'])
      .orderBy('c.heure_commande')
      .select('c.*')
    const avecLignes = await Promise.all(commandes.map(async c => ({
      ...c,
      lignes:     await fastify.db('lignes_commande').where({ commande_id: c.id }),
      doit_payer: c.mode_reglement === 'immediat',
    })))
    const parStatut = { nouvelle: [], en_preparation: [], prete: [], servie: [] }
    avecLignes.forEach(c => { if (parStatut[c.statut]) parStatut[c.statut].push(c) })
    reply.send({ cuisine: parStatut })
  })
}
