'use strict'

const { createReservationsService } = require('../services/reservations.service')
const { createFacturationService }  = require('../services/facturation.service')

module.exports = async function bookingRoutes(fastify) {

  const reservationsService = createReservationsService({ db: fastify.db, cache: fastify.cache })
  const facturationService  = createFacturationService({ db: fastify.db, cache: fastify.cache })

  // ── GET /disponibilite/:hotel_slug ─────────────────────────────────────────
  // Retourne chambres disponibles sur la période + taxes hébergement de l'hôtel.
  // Public — aucune authentification requise.
  fastify.get('/disponibilite/:hotel_slug', async (req, reply) => {
    const { date_arrivee, date_depart } = req.query
    if (!date_arrivee || !date_depart)
      return reply.status(400).send({ erreur: 'Dates requises' })

    const hotel = await fastify.db('hotels')
      .where({ slug: req.params.hotel_slug, actif: true })
      .first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })

    const reservees = await fastify.db('reservations')
      .where({ hotel_id: hotel.id })
      .whereNotIn('statut', ['annulee', 'no_show'])
      .where('date_arrivee', '<', date_depart)
      .where('date_depart',  '>', date_arrivee)
      .pluck('chambre_id')

    const chambres = await fastify.db('chambres AS ch')
      .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
      .where({ 'ch.hotel_id': hotel.id, 'ch.hors_service': false })
      .whereNotIn('ch.id', reservees)
      .select(
        'ch.id', 'ch.numero', 'ch.etage',
        'tc.nom AS type', 'tc.tarif_base', 'tc.description',
        'tc.capacite_adultes', 'tc.superficie_m2', 'tc.amenagements', 'tc.photos AS type_photos',
        fastify.db.raw(`COALESCE((SELECT json_agg(url_fichier ORDER BY ordre) FROM images_chambres WHERE chambre_id = ch.id), '[]'::json) AS room_photos`)
      )

    // P8.1 — Taxes hébergement de l'hôtel pour que le frontend calcule le vrai total
    const taxes = await fastify.db('taxes')
      .where({ hotel_id: hotel.id, active: true })
      .where(function () {
        this.where('s_applique_a', 'hebergement').orWhere('s_applique_a', 'tout')
      })
      .where('incluse_prix', false)
      .orderBy('ordre', 'asc')
      .select('code', 'nom', 'type_taxe', 'valeur', 's_applique_a', 'incluse_prix')

    reply.send({
      hotel: { nom: hotel.nom, ville: hotel.ville },
      chambres,
      taxes,
    })
  })

  // ── POST /reserver ─────────────────────────────────────────────────────────
  // Canal Booking → service.creerReservation() (même moteur que Canal Réception)
  //
  // Machine d'état :
  //   création  → statut = 'tentative'
  //   paiement  → paiement en_attente créé sur le folio
  //   webhook   → confirmerPaiement → puis confirmerReservation (tentative → confirmee)
  //
  // NB : confirmerReservation() n'est PAS appelé ici — seulement par le webhook.
  fastify.post('/reserver', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const {
      hotel_slug, client, chambre_id,
      date_arrivee, date_depart,
      type_paiement, numero_telephone,
    } = req.body

    // Valider les champs minimaux
    if (!hotel_slug || !client?.email || !chambre_id || !date_arrivee || !date_depart)
      return reply.status(400).send({ erreur: 'Champs obligatoires : hotel_slug, client.email, chambre_id, date_arrivee, date_depart' })

    // Types de paiement acceptés en ligne :
    //   mobile_money — opérateur camerounais (MTN/Orange), webhook HMAC
    //   cinetpay     — passerelle CinetPay (MTN, Orange, Visa/Mastercard)
    if (!['mobile_money', 'cinetpay'].includes(type_paiement))
      return reply.status(400).send({ erreur: 'Type de paiement non supporté. Valeurs acceptées : mobile_money, cinetpay' })

    if (type_paiement === 'mobile_money' && !numero_telephone)
      return reply.status(400).send({ erreur: 'Numéro de téléphone requis pour mobile money' })

    const hotel = await fastify.db('hotels')
      .where({ slug: hotel_slug, actif: true })
      .first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })

    // Trouver ou créer le client
    let clientRec = await fastify.db('clients')
      .where({ email: client.email, hotel_id: hotel.id })
      .first()

    if (!clientRec) {
      const mdpHash = await fastify.hashMotDePasse(
        client.mot_de_passe || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
      )
      const [created] = await fastify.db('clients').insert({
        hotel_id:           hotel.id,
        tenant_id:          hotel.tenant_id,
        prenom:             client.prenom  || '',
        nom:                client.nom     || '',
        email:              client.email,
        telephone:          client.telephone || null,
        mot_de_passe_hash:  mdpHash,
        source_acquisition: 'booking_engine',
      }).returning('*')
      clientRec = created
    }

    // Créer la réservation — source='online' → statut initial 'tentative'
    const reservation = await reservationsService.creerReservation(
      hotel.id,
      hotel.tenant_id,
      null,       // acteurId = null (portail public)
      'portail',
      {
        client_id:      clientRec.id,
        chambre_id,
        date_arrivee,
        date_depart,
        nombre_adultes: parseInt(client.nombre_adultes) || 1,
        nombre_enfants: 0,
        source:         'online',
        regime_repas:   'chambre_seule',
        notes_internes: null,
      }
    )

    // Récupérer le folio créé atomiquement par creerReservation
    const folio = await fastify.db('folios')
      .where({ reservation_id: reservation.id, hotel_id: hotel.id })
      .first()

    if (!folio) {
      req.log.error({ reservation_id: reservation.id }, 'Folio introuvable après création réservation online')
      return reply.status(500).send({ erreur: 'Erreur interne : folio non créé' })
    }

    // Pour mobile_money : créer la ligne paiement en_attente sur le folio.
    // Pour cinetpay : pas de ligne paiement ici — CinetPay gérera via paiements_online.
    let paiement = null
    if (type_paiement === 'mobile_money') {
      const result = await facturationService.creerPaiement(
        folio.id,
        hotel.id,
        hotel.tenant_id,
        null,  // acteurId = null (portail public)
        {
          typePaiement:    'mobile_money',
          montant:         reservation.total_general,
          devise:          reservation.devise || 'XAF',
          numeroTelephone: numero_telephone,
          notes:           `Réservation online ${reservation.numero_reservation}`,
        }
      )
      paiement = result.paiement
    }

    // Générer le token JWT client
    const jwtClient = fastify.jwt.sign(
      {
        id:        clientRec.id,
        email:     clientRec.email,
        type:      'client',
        hotel_id:  hotel.id,
        tenant_id: hotel.tenant_id,
      },
      { expiresIn: process.env.JWT_CLIENT_EXPIRES_IN || '24h' }
    )

    reply.status(202).send({
      message:        'Réservation en attente de confirmation de paiement',
      statut:         'tentative',
      id:             reservation.id,
      numero:         reservation.numero_reservation,
      montant:        reservation.total_general,
      paiement_id:    paiement?.id || null,
      token_client:   jwtClient,
    })
  })
}
