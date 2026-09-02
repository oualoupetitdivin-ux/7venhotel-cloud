'use strict'

// Config arrhes par défaut si non configurée
const CONFIG_DEFAUT = {
  actives: false,
  taux: 30,
  montant_minimum: 10000,
  delai_paiement_jours: 3,
  politique_annulation: [
    { jours_avant: 14, remboursement_pct: 100 },
    { jours_avant: 7,  remboursement_pct: 50  },
    { jours_avant: 3,  remboursement_pct: 0   },
  ],
}

function calculerRemboursement(politique, dateArrivee) {
  const aujourd_hui = new Date()
  const arrivee     = new Date(dateArrivee)
  const joursAvant  = Math.ceil((arrivee - aujourd_hui) / (1000 * 60 * 60 * 24))

  // Trier par jours_avant décroissant — on prend la première règle applicable
  const regles = [...politique].sort((a, b) => b.jours_avant - a.jours_avant)
  for (const regle of regles) {
    if (joursAvant >= regle.jours_avant) return { pct: regle.remboursement_pct, joursAvant }
  }
  return { pct: 0, joursAvant }
}

module.exports = async function arrhesRoutes(fastify) {
  const pre       = [fastify.authentifier, fastify.contexteHotel]
  const preRead   = [...pre, fastify.verifierPermission('reservations.lire')]
  const preWrite  = [...pre, fastify.verifierPermission('reservations.modifier')]
  const preAdmin  = [...pre, fastify.verifierPermission('reservations.confirmer')]

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function getConfig(hotelId) {
    const params = await fastify.db('parametres_hotel')
      .where({ hotel_id: hotelId }).select('parametres_supplementaires').first()
    return (params?.parametres_supplementaires?.arrhes) || CONFIG_DEFAUT
  }

  async function getGarantie(id, hotelId) {
    return fastify.db('garanties_reservation AS g')
      .leftJoin('reservations AS r', 'r.id', 'g.reservation_id')
      .leftJoin('clients AS c',      'c.id', 'r.client_id')
      .leftJoin('chambres AS ch',    'ch.id', 'r.chambre_id')
      .leftJoin('utilisateurs AS u', 'u.id', 'g.traite_par')
      .where({ 'g.id': id, 'g.hotel_id': hotelId })
      .select(
        'g.*',
        'r.numero_reservation', 'r.date_arrivee', 'r.date_depart', 'r.total_general', 'r.statut AS statut_reservation',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"), 'c.email AS email_client', 'c.telephone AS tel_client',
        'ch.numero AS numero_chambre',
        fastify.db.raw("u.prenom || ' ' || u.nom AS traite_par_nom"),
      )
      .first()
  }

  // ── GET /arrhes/config ─────────────────────────────────────────────────────
  fastify.get('/config', { preHandler: preRead }, async (req, reply) => {
    const config = await getConfig(req.hotelId)
    reply.send({ config })
  })

  // ── PUT /arrhes/config ─────────────────────────────────────────────────────
  fastify.put('/config', { preHandler: preAdmin }, async (req, reply) => {
    const { actives, taux, montant_minimum, delai_paiement_jours, politique_annulation } = req.body

    if (taux != null && (taux < 0 || taux > 100))
      return reply.status(400).send({ erreur: 'taux doit être entre 0 et 100' })
    if (politique_annulation) {
      for (const r of politique_annulation) {
        if (r.remboursement_pct < 0 || r.remboursement_pct > 100)
          return reply.status(400).send({ erreur: 'remboursement_pct doit être entre 0 et 100' })
      }
    }

    const params = await fastify.db('parametres_hotel')
      .where({ hotel_id: req.hotelId }).select('parametres_supplementaires').first()
    const supp = params?.parametres_supplementaires || {}

    supp.arrhes = {
      ...((supp.arrhes) || CONFIG_DEFAUT),
      ...(actives !== undefined && { actives }),
      ...(taux !== undefined && { taux }),
      ...(montant_minimum !== undefined && { montant_minimum }),
      ...(delai_paiement_jours !== undefined && { delai_paiement_jours }),
      ...(politique_annulation !== undefined && { politique_annulation }),
    }

    await fastify.db('parametres_hotel')
      .where({ hotel_id: req.hotelId })
      .update({ parametres_supplementaires: JSON.stringify(supp), mis_a_jour_le: fastify.db.fn.now() })

    reply.send({ message: 'Configuration mise à jour', config: supp.arrhes })
  })

  // ── GET /arrhes — liste toutes les garanties ────────────────────────────────
  fastify.get('/', { preHandler: preRead }, async (req, reply) => {
    const { statut, page = 1, limit = 30 } = req.query
    const offset = (page - 1) * limit

    let q = fastify.db('garanties_reservation AS g')
      .leftJoin('reservations AS r', 'r.id', 'g.reservation_id')
      .leftJoin('clients AS c',      'c.id', 'r.client_id')
      .leftJoin('chambres AS ch',    'ch.id', 'r.chambre_id')
      .where({ 'g.hotel_id': req.hotelId })
      .select(
        'g.id', 'g.statut', 'g.montant_demande', 'g.montant_recu', 'g.taux_applique',
        'g.devise', 'g.mode_paiement', 'g.echeance_paiement', 'g.cree_le', 'g.montant_rembourse',
        'r.id AS reservation_id', 'r.numero_reservation', 'r.date_arrivee', 'r.date_depart',
        'r.total_general', 'r.statut AS statut_reservation',
        fastify.db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'c.telephone AS tel_client',
        'ch.numero AS numero_chambre',
      )
      .orderBy('g.cree_le', 'desc')
      .limit(limit).offset(offset)

    if (statut) q = q.where('g.statut', statut)

    const garanties = await q

    // Stats globales
    const stats = await fastify.db('garanties_reservation')
      .where({ hotel_id: req.hotelId })
      .select(
        fastify.db.raw("COUNT(*) AS total"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'en_attente') AS en_attente"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'partielle')  AS partielle"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'complete')   AS complete"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'remboursee') AS remboursee"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'acquise')    AS acquise"),
        fastify.db.raw("ROUND(SUM(montant_demande) FILTER (WHERE statut NOT IN ('annulee'))) AS total_demande"),
        fastify.db.raw("ROUND(SUM(montant_recu)    FILTER (WHERE statut IN ('complete','partielle'))) AS total_recu"),
        fastify.db.raw("COUNT(*) FILTER (WHERE echeance_paiement < CURRENT_DATE AND statut = 'en_attente') AS en_retard"),
      )
      .first()

    reply.send({ garanties, stats })
  })

  // ── GET /arrhes/stats ──────────────────────────────────────────────────────
  fastify.get('/stats', { preHandler: preRead }, async (req, reply) => {
    const stats = await fastify.db('garanties_reservation')
      .where({ hotel_id: req.hotelId })
      .select(
        fastify.db.raw("COUNT(*) AS total"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'en_attente') AS en_attente"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'complete')   AS complete"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'remboursee') AS remboursee"),
        fastify.db.raw("COUNT(*) FILTER (WHERE statut = 'acquise')    AS acquise"),
        fastify.db.raw("ROUND(SUM(montant_demande)) AS total_demande"),
        fastify.db.raw("ROUND(SUM(montant_recu)    FILTER (WHERE statut IN ('complete','partielle','remboursee','acquise'))) AS total_recu"),
        fastify.db.raw("COUNT(*) FILTER (WHERE echeance_paiement < CURRENT_DATE AND statut IN ('en_attente','partielle')) AS en_retard"),
      )
      .first()
    reply.send({ stats })
  })

  // ── GET /arrhes/reservation/:reservation_id ────────────────────────────────
  fastify.get('/reservation/:reservation_id', { preHandler: preRead }, async (req, reply) => {
    const g = await fastify.db('garanties_reservation AS g')
      .where({ 'g.reservation_id': req.params.reservation_id, 'g.hotel_id': req.hotelId })
      .select('g.*')
      .first()
    reply.send({ garantie: g || null })
  })

  // ── POST /arrhes — créer une garantie pour une réservation ────────────────
  fastify.post('/', { preHandler: preWrite }, async (req, reply) => {
    const { reservation_id, montant_personnalise, mode_paiement, notes } = req.body || {}

    if (!reservation_id) return reply.status(400).send({ erreur: 'reservation_id requis' })

    // Vérifier que la réservation appartient à cet hôtel
    const res = await fastify.db('reservations')
      .where({ id: reservation_id, hotel_id: req.hotelId })
      .select('id', 'total_general', 'devise', 'date_arrivee', 'statut')
      .first()
    if (!res) return reply.status(404).send({ erreur: 'Réservation introuvable' })
    if (['annulee', 'no_show', 'terminee'].includes(res.statut))
      return reply.status(400).send({ erreur: 'Impossible de créer une garantie pour cette réservation' })

    // Vérifier qu'une garantie n'existe pas déjà
    const existing = await fastify.db('garanties_reservation')
      .where({ reservation_id, hotel_id: req.hotelId }).first()
    if (existing) return reply.status(409).send({ erreur: 'Une garantie existe déjà pour cette réservation', garantie: existing })

    const config = await getConfig(req.hotelId)
    const taux   = config.taux || 30
    const montantCalcule = Math.round((res.total_general * taux) / 100)
    const montantDemande = montant_personnalise || Math.max(montantCalcule, config.montant_minimum || 0)

    const echeance = new Date()
    echeance.setDate(echeance.getDate() + (config.delai_paiement_jours || 3))

    const [garantie] = await fastify.db('garanties_reservation').insert({
      hotel_id:         req.hotelId,
      reservation_id,
      montant_demande:  montantDemande,
      taux_applique:    taux,
      devise:           res.devise || 'XAF',
      mode_paiement:    mode_paiement || null,
      echeance_paiement: echeance.toISOString().slice(0, 10),
      notes:            notes || null,
      traite_par:       req.user.id,
      cree_le:          fastify.db.fn.now(),
      mis_a_jour_le:    fastify.db.fn.now(),
    }).returning('*')

    reply.status(201).send({ message: 'Garantie créée', garantie })
  })

  // ── PUT /arrhes/:id/confirmer — enregistrer un paiement reçu ───────────────
  fastify.put('/:id/confirmer', { preHandler: preWrite }, async (req, reply) => {
    const { montant_recu, mode_paiement, reference_paiement, notes } = req.body || {}

    if (!montant_recu || montant_recu <= 0)
      return reply.status(400).send({ erreur: 'montant_recu requis et > 0' })

    const g = await fastify.db('garanties_reservation')
      .where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!g) return reply.status(404).send({ erreur: 'Garantie introuvable' })
    if (['acquise', 'annulee'].includes(g.statut))
      return reply.status(400).send({ erreur: `Garantie ${g.statut} — modification impossible` })

    const totalRecu  = Number(g.montant_recu) + Number(montant_recu)
    const nouveauStatut = totalRecu >= g.montant_demande ? 'complete' : 'partielle'

    const [updated] = await fastify.db('garanties_reservation')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({
        montant_recu:      totalRecu,
        statut:            nouveauStatut,
        mode_paiement:     mode_paiement || g.mode_paiement,
        reference_paiement: reference_paiement || g.reference_paiement,
        notes:             notes || g.notes,
        traite_par:        req.user.id,
        confirme_le:       nouveauStatut === 'complete' ? fastify.db.fn.now() : g.confirme_le,
        mis_a_jour_le:     fastify.db.fn.now(),
      })
      .returning('*')

    // Si garantie complète, enregistrer dans le folio comme crédit
    if (nouveauStatut === 'complete') {
      try {
        const folio = await fastify.db('folios')
          .where({ reservation_id: g.reservation_id, hotel_id: req.hotelId, statut: 'ouvert' })
          .first()
        if (folio) {
          await fastify.db('lignes_folio').insert({
            folio_id:       folio.id,
            hotel_id:       req.hotelId,
            type_ligne:     'arrhes',
            sens:           'credit',
            prix_unitaire:  totalRecu,
            montant_total:  totalRecu,
            devise:         g.devise,
            description:    `Arrhes reçues (${g.taux_applique}% — réf. ${reference_paiement || 'N/A'})`,
            reference_id:   updated.id,
            reference_type: 'garantie',
            source_module:  'arrhes',
            cree_par:       req.user.id,
            cree_par_type:  'staff',
          })
        }
      } catch (err) {
        req.log.warn({ err: err.message }, 'Arrhes confirmées mais erreur crédit folio')
      }
    }

    reply.send({ message: `Garantie ${nouveauStatut === 'complete' ? 'complète' : 'partielle'} — ${totalRecu.toLocaleString('fr-FR')} reçus`, garantie: updated })
  })

  // ── PUT /arrhes/:id/rembourser ─────────────────────────────────────────────
  fastify.put('/:id/rembourser', { preHandler: preAdmin }, async (req, reply) => {
    const { motif } = req.body || {}

    const g = await fastify.db('garanties_reservation')
      .where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!g) return reply.status(404).send({ erreur: 'Garantie introuvable' })
    if (!['complete', 'partielle'].includes(g.statut))
      return reply.status(400).send({ erreur: 'Seules les garanties reçues peuvent être remboursées' })

    // Récupérer la date d'arrivée pour calcul politique
    const res = await fastify.db('reservations')
      .where({ id: g.reservation_id }).select('date_arrivee').first()
    const config     = await getConfig(req.hotelId)
    const { pct, joursAvant } = calculerRemboursement(config.politique_annulation || [], res.date_arrivee)
    const montantRembourse    = Math.round((g.montant_recu * pct) / 100)

    const [updated] = await fastify.db('garanties_reservation')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({
        statut:              'remboursee',
        montant_rembourse:   montantRembourse,
        pct_remboursement:   pct,
        motif_remboursement: motif || null,
        traite_par:          req.user.id,
        rembourse_le:        fastify.db.fn.now(),
        mis_a_jour_le:       fastify.db.fn.now(),
      })
      .returning('*')

    reply.send({
      message: `Remboursement ${pct}% (${joursAvant}j avant arrivée) — ${montantRembourse.toLocaleString('fr-FR')} à rembourser`,
      garantie: updated,
      pct_remboursement: pct,
      montant_rembourse: montantRembourse,
      jours_avant_arrivee: joursAvant,
    })
  })

  // ── PUT /arrhes/:id/acquerir — arrhes acquises (annulation sans remboursement) ──
  fastify.put('/:id/acquerir', { preHandler: preAdmin }, async (req, reply) => {
    const { motif } = req.body || {}

    const g = await fastify.db('garanties_reservation')
      .where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!g) return reply.status(404).send({ erreur: 'Garantie introuvable' })
    if (!['complete', 'partielle', 'en_attente'].includes(g.statut))
      return reply.status(400).send({ erreur: `Statut ${g.statut} ne permet pas l'acquisition` })

    const [updated] = await fastify.db('garanties_reservation')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({
        statut:              'acquise',
        pct_remboursement:   0,
        motif_remboursement: motif || 'Annulation tardive — arrhes acquises',
        traite_par:          req.user.id,
        mis_a_jour_le:       fastify.db.fn.now(),
      })
      .returning('*')

    reply.send({ message: "Arrhes marquées comme acquises par l'hôtel", garantie: updated })
  })

  // ── GET /arrhes/:id — détail d'une garantie ────────────────────────────────
  fastify.get('/:id', { preHandler: preRead }, async (req, reply) => {
    const g = await getGarantie(req.params.id, req.hotelId)
    if (!g) return reply.status(404).send({ erreur: 'Garantie introuvable' })
    reply.send({ garantie: g })
  })
}
