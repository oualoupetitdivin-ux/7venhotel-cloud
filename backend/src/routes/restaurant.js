'use strict'

const { createFacturationRepository } = require('../repositories/facturation.repository')

module.exports = async function restaurantRoutes(fastify) {
  const facturationRepo = createFacturationRepository(fastify.db)
  const pre      = [fastify.authentifier, fastify.contexteHotel]
  const preRead   = [...pre, fastify.verifierPermission('restaurant.lire')]
  const preCreate = [...pre, fastify.verifierPermission('restaurant.creer')]
  const preModif  = [...pre, fastify.verifierPermission('restaurant.modifier')]

  // ── GET /menu ──────────────────────────────────────────────────────────────
  fastify.get('/menu', { preHandler: preRead }, async (req, reply) => {
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

  // ── POST /articles — Créer un article du menu ──────────────────────────────
  // Le champ emoji est encodé en préfixe de description : "[EMOJI] texte"
  fastify.post('/articles', { preHandler: preCreate }, async (req, reply) => {
    const { nom, prix, categorie, description, emoji, ordre, disponible } = req.body || {}
    if (!nom || !prix || !categorie) {
      return reply.status(400).send({ erreur: 'nom, prix et categorie sont requis', code: 'CHAMPS_MANQUANTS' })
    }
    const descFinale = emoji && emoji.trim()
      ? `[${emoji.trim()}] ${(description || '').trim()}`
      : (description || null)

    const [article] = await fastify.db('articles_menu')
      .insert({
        hotel_id:    req.hotelId,
        nom:         nom.trim(),
        prix:        parseFloat(prix),
        categorie:   categorie.trim(),
        description: descFinale,
        ordre:       ordre != null ? parseInt(ordre) : 999,
        disponible:  disponible !== false,
        devise:      'XAF',
      })
      .returning('*')
    return reply.status(201).send({ article })
  })

  // ── GET /commandes ─────────────────────────────────────────────────────────
  fastify.get('/commandes', { preHandler: preRead }, async (req, reply) => {
    const { statut } = req.query
    let q = fastify.db('commandes_restaurant').where({ hotel_id: req.hotelId })
    if (statut) q = q.whereIn('statut', Array.isArray(statut) ? statut : [statut])
    const commandes = await q.orderBy('heure_commande', 'desc').limit(100)
    const avecLignes = await Promise.all(
      commandes.map(async c => ({
        ...c,
        lignes: await fastify.db('lignes_commande').where({ commande_id: c.id }),
      }))
    )
    reply.send({ commandes: avecLignes })
  })

  // ── POST /commandes ────────────────────────────────────────────────────────
  // PATCH 1 : mode_reglement accepté — 'chambre' (défaut hôtel) ou 'immediat'
  // PATCH 2 : walk_in DOIT avoir mode_reglement='immediat' — rejet sinon
  fastify.post('/commandes', { preHandler: preCreate }, async (req, reply) => {
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
  fastify.put('/commandes/:id/statut', { preHandler: preModif }, async (req, reply) => {
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

      // PHASE1-A — Déstockage automatique à l'entrée en préparation.
      // Idempotent via commandeAvant.statut : ne s'exécute qu'à la transition
      // depuis un statut différent de 'en_preparation' (jamais rejouée).
      if (nouveauStatut === 'en_preparation' && commandeAvant.statut !== 'en_preparation') {
        const lignesAvecArticle = await trx('lignes_commande AS l')
          .join('articles_menu AS a', 'a.id', 'l.article_id')
          .where({ 'l.commande_id': commandeAvant.id, 'a.hotel_id': hotelId })
          .select('l.article_id', 'l.quantite', 'a.stock_actuel')

        for (const ligne of lignesAvecArticle) {
          const stockAvant = Number(ligne.stock_actuel) || 0
          const stockApres = Math.max(0, stockAvant - Number(ligne.quantite))

          await trx('mouvements_stock').insert({
            hotel_id:       hotelId,
            article_id:     ligne.article_id,
            type_mouvement: 'sortie',
            quantite:       ligne.quantite,
            stock_avant:    stockAvant,
            stock_apres:    stockApres,
            motif:          `Commande restaurant ${commandeAvant.numero_commande}`,
            commande_id:    commandeAvant.id,
            cree_par:       req.user.id || null,
          })

          await trx('articles_menu')
            .where({ id: ligne.article_id, hotel_id: hotelId })
            .update({ stock_actuel: stockApres })
        }
      }

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

        const reservationId  = commandeAvant.reservation_id
        const modeReglement  = commandeAvant.mode_reglement || 'chambre'
        const devise         = commandeAvant.devise || 'XAF'
        const estClientHotel = !!reservationId

        // ── CAS 3 — CLIENT EXTERNE ─────────────────────────────────────────
        // Aucune écriture dans lignes_folio.
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

          const [paiementExt] = await trx('paiements').insert({
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
          }).returning('id')

          await facturationRepo.insererLog({
            hotel_id:     hotelId,
            folio_id:     null,
            paiement_id:  paiementExt.id,
            action:       'paiement_externe',
            source_module: 'restaurant',
            montant:      montant,
            acteur_id:    req.user.id || null,
            acteur_type:  'staff',
            payload: {
              commande_id:     commandeAvant.id,
              numero_commande: commandeAvant.numero_commande,
              type_client:     'walk_in',
              type_paiement:   commandeAvant.mode_paiement,
            },
          }, trx)

          req.log.info({ commande_id: commandeAvant.id, hotel_id: hotelId, montant },
            'Client externe — paiement enregistré, pas de folio')
          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }

        // ── CLIENT HÔTEL — Idempotence avant toute écriture folio ──────────
        // Lookup sur lignes_folio (table prod réelle) par reference_id + reference_type.
        // Le FOR UPDATE sur commandes_restaurant est la protection anti-race principale.
        const ligneExistante = await trx('lignes_folio')
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
        // INSERT debit uniquement — solde augmente, réglé au checkout.
        // Table : lignes_folio (nom prod réel — Option A)
        // Colonne montant : montant_total (nom prod réel — Option A)
        if (modeReglement === 'chambre') {
          await trx('lignes_folio').insert({
            folio_id:       folio.id,
            hotel_id:       hotelId,
            type_ligne:     'restaurant',
            sens:           'debit',
            prix_unitaire:  montant,
            montant_total:  montant,
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

          await facturationRepo.insererLog({
            hotel_id:     hotelId,
            folio_id:     folio.id,
            action:       'charge_restaurant',
            source_module: 'restaurant',
            montant:      montant,
            acteur_id:    req.user.id || null,
            acteur_type:  'staff',
            payload: {
              commande_id:     commandeAvant.id,
              numero_commande: commandeAvant.numero_commande,
              mode_reglement:  'chambre',
              sens:            'debit',
            },
          }, trx)

          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }

        // ── CAS 2 — CLIENT HÔTEL + PAIEMENT IMMÉDIAT ───────────────────────
        // INSERT debit + INSERT credit dans la même transaction.
        // Le folio reste équilibré : debit restaurant + credit paiement = solde inchangé.
        if (modeReglement === 'immediat') {
          // Ligne debit — la charge restaurant
          await trx('lignes_folio').insert({
            folio_id:       folio.id,
            hotel_id:       hotelId,
            type_ligne:     'restaurant',
            sens:           'debit',
            prix_unitaire:  montant,
            montant_total:  montant,
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
          }).returning('id')

          // Ligne credit — le paiement, référencé sur l'entrée paiements
          await trx('lignes_folio').insert({
            folio_id:       folio.id,
            hotel_id:       hotelId,
            type_ligne:     'paiement',
            sens:           'credit',
            prix_unitaire:  montant,
            montant_total:  montant,
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

          await facturationRepo.insererLog({
            hotel_id:     hotelId,
            folio_id:     folio.id,
            action:       'charge_restaurant',
            source_module: 'restaurant',
            montant:      montant,
            acteur_id:    req.user.id || null,
            acteur_type:  'staff',
            payload: {
              commande_id:     commandeAvant.id,
              numero_commande: commandeAvant.numero_commande,
              mode_reglement:  'immediat',
              sens:            'debit',
            },
          }, trx)

          await facturationRepo.insererLog({
            hotel_id:     hotelId,
            folio_id:     folio.id,
            paiement_id:  paiement.id,
            action:       'paiement_confirme',
            source_module: 'restaurant',
            montant:      montant,
            acteur_id:    req.user.id || null,
            acteur_type:  'staff',
            payload: {
              commande_id:     commandeAvant.id,
              numero_commande: commandeAvant.numero_commande,
              mode_reglement:  'immediat',
              type_paiement:   commandeAvant.mode_paiement,
              sens:            'credit',
            },
          }, trx)

          return reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: false })
        }
      }

      // Hors 'servie' — doit_payer selon mode_reglement et statut courant
      const doitPayer = updated.mode_reglement === 'immediat' && updated.statut !== 'servie'
      reply.send({ message: 'Statut mis à jour', commande: updated, doit_payer: doitPayer })
    })
  })

  // ── GET /reservations-actives — Picker hébergement POS ───────────────────
  fastify.get('/reservations-actives', { preHandler: preRead }, async (req, reply) => {
    const reservations = await fastify.db('reservations AS r')
      .leftJoin('clients AS c', 'c.id', 'r.client_id')
      .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
      .where({ 'r.hotel_id': req.hotelId })
      .whereIn('r.statut', ['arrivee'])
      .select(
        'r.id', 'r.numero_reservation', 'r.date_arrivee', 'r.date_depart',
        'ch.numero AS numero_chambre',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'c.email AS email_client',
      )
      .orderBy('ch.numero')
    reply.send({ reservations })
  })

  // ── GET /cuisine ───────────────────────────────────────────────────────────
  fastify.get('/cuisine', { preHandler: preRead }, async (req, reply) => {
    const commandes = await fastify.db('commandes_restaurant AS c')
      .where({ 'c.hotel_id': req.hotelId })
      .whereNotIn('c.statut', ['servie', 'annulee'])
      .orderBy('c.heure_commande')
      .select(
        'c.*',
        fastify.db.raw("EXTRACT(EPOCH FROM (NOW() - c.heure_commande))/60 AS minutes_depuis_commande"),
        fastify.db.raw("CASE WHEN c.heure_preparation IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - c.heure_preparation))/60 END AS minutes_en_preparation"),
      )
    const avecLignes = await Promise.all(commandes.map(async c => ({
      ...c,
      lignes:     await fastify.db('lignes_commande').where({ commande_id: c.id }),
      doit_payer: c.mode_reglement === 'immediat',
    })))
    const parStatut = { nouvelle: [], en_preparation: [], prete: [], servie: [] }
    avecLignes.forEach(c => { if (parStatut[c.statut]) parStatut[c.statut].push(c) })
    reply.send({ cuisine: parStatut })
  })

  // ── GET /performance ───────────────────────────────────────────────────────
  fastify.get('/performance', { preHandler: preRead }, async (req, reply) => {
    const { date } = req.query
    const dateCible = date || new Date().toISOString().slice(0, 10)
    const debut = `${dateCible} 00:00:00`
    const fin   = `${dateCible} 23:59:59`

    const stats = await fastify.db('commandes_restaurant AS c')
      .where({ 'c.hotel_id': req.hotelId })
      .whereBetween('c.heure_commande', [debut, fin])
      .select(
        fastify.db.raw('COUNT(*) AS total'),
        fastify.db.raw("COUNT(*) FILTER (WHERE c.statut = 'servie') AS servies"),
        fastify.db.raw("COUNT(*) FILTER (WHERE c.statut = 'annulee') AS annulees"),
        fastify.db.raw("COUNT(*) FILTER (WHERE c.statut NOT IN ('servie','annulee')) AS en_cours"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (c.heure_preparation - c.heure_commande))/60) FILTER (WHERE c.heure_preparation IS NOT NULL)) AS avg_attente_preparation_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (c.heure_prete - c.heure_preparation))/60) FILTER (WHERE c.heure_prete IS NOT NULL AND c.heure_preparation IS NOT NULL)) AS avg_preparation_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (c.heure_servie - c.heure_prete))/60) FILTER (WHERE c.heure_servie IS NOT NULL AND c.heure_prete IS NOT NULL)) AS avg_service_min"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (c.heure_servie - c.heure_commande))/60) FILTER (WHERE c.heure_servie IS NOT NULL)) AS avg_total_min"),
        fastify.db.raw("ROUND(SUM(c.total) FILTER (WHERE c.statut = 'servie')) AS chiffre_affaires"),
        fastify.db.raw("ROUND(AVG(c.total) FILTER (WHERE c.statut = 'servie')) AS panier_moyen"),
      )
      .first()

    // Trend 7 jours
    const trend = await fastify.db('commandes_restaurant AS c')
      .where({ 'c.hotel_id': req.hotelId })
      .whereRaw("c.heure_commande BETWEEN CURRENT_DATE - INTERVAL '6 days' AND CURRENT_TIMESTAMP")
      .groupByRaw("DATE(c.heure_commande)")
      .select(
        fastify.db.raw("DATE(c.heure_commande) AS jour"),
        fastify.db.raw('COUNT(*) AS total'),
        fastify.db.raw("COUNT(*) FILTER (WHERE c.statut = 'servie') AS servies"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (c.heure_servie - c.heure_commande))/60) FILTER (WHERE c.heure_servie IS NOT NULL)) AS avg_total"),
        fastify.db.raw("ROUND(SUM(c.total) FILTER (WHERE c.statut = 'servie')) AS ca"),
      )
      .orderByRaw("DATE(c.heure_commande)")

    // Par serveur
    const parServeur = await fastify.db('commandes_restaurant AS c')
      .leftJoin('utilisateurs AS u', 'u.id', 'c.serveur_id')
      .where({ 'c.hotel_id': req.hotelId })
      .whereBetween('c.heure_commande', [debut, fin])
      .groupBy('c.serveur_id', 'u.prenom', 'u.nom')
      .select(
        fastify.db.raw("u.prenom || ' ' || u.nom AS nom_serveur"),
        fastify.db.raw('COUNT(*) AS commandes'),
        fastify.db.raw("COUNT(*) FILTER (WHERE c.statut = 'servie') AS servies"),
        fastify.db.raw("ROUND(SUM(c.total) FILTER (WHERE c.statut = 'servie')) AS ca"),
        fastify.db.raw("ROUND(AVG(EXTRACT(EPOCH FROM (c.heure_servie - c.heure_commande))/60) FILTER (WHERE c.heure_servie IS NOT NULL)) AS avg_service"),
      )
      .orderByRaw("ROUND(SUM(c.total) FILTER (WHERE c.statut = 'servie')) DESC NULLS LAST")

    reply.send({ stats, trend, parServeur, date: dateCible })
  })
}
