'use strict'

const { createReservationsService } = require('../services/reservations.service')
const { createFacturationService }  = require('../services/facturation.service')
const { createCheckinEnLigneService } = require('../services/checkin-en-ligne.service')
const { signerJetonClient } = require('../utils/jetonClient')

// LOT-GUEST-01 — Une réservation online reste 'tentative' tant que le paiement n'est pas
// confirmé. Sans expiration, une réservation abandonnée bloquait la chambre indéfiniment.
// Délai aligné sur la session de paiement en ligne (paiements_online.expire_le = 30 min).
const TTL_TENTATIVE_MIN = parseInt(process.env.BOOKING_TENTATIVE_TTL_MIN || '30', 10)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

module.exports = async function bookingRoutes(fastify) {

  const reservationsService = createReservationsService({ db: fastify.db, cache: fastify.cache })
  const facturationService  = createFacturationService({ db: fastify.db, cache: fastify.cache })
  const checkinService      = createCheckinEnLigneService({ db: fastify.db })

  // Annule (via le service PMS : folio neutralisé, portail révoqué) les réservations online
  // restées 'tentative' au-delà du délai sans paiement validé ; paiements en attente → echec.
  async function expirerTentatives(hotelId) {
    const perimees = await fastify.db('reservations AS r')
      .where({ 'r.hotel_id': hotelId, 'r.statut': 'tentative', 'r.source': 'online' })
      .where('r.cree_le', '<', fastify.db.raw(`NOW() - INTERVAL '${TTL_TENTATIVE_MIN} minutes'`))
      .whereNotExists(function () {
        this.select(1).from('paiements AS p').whereRaw('p.reservation_id = r.id OR p.folio_id IN (SELECT id FROM folios WHERE reservation_id = r.id)')
          .where('p.statut', 'valide')
      })
      .select('r.id')
    for (const { id } of perimees) {
      try {
        await reservationsService.annulerReservation(id, hotelId, null, `Expiration — paiement non reçu sous ${TTL_TENTATIVE_MIN} min`)
        await fastify.db('paiements').where({ hotel_id: hotelId, statut: 'en_attente' })
          .whereIn('folio_id', fastify.db('folios').select('id').where({ reservation_id: id }))
          .update({ statut: 'echec', notes: fastify.db.raw("COALESCE(notes,'') || ' [expiration réservation online]'") })
      } catch (err) {
        fastify.log.warn({ reservation_id: id, err: err.message }, 'Expiration tentative impossible')
      }
    }
    return perimees.length
  }

  function validerDates(date_arrivee, date_depart) {
    if (!DATE.test(String(date_arrivee || '')) || !DATE.test(String(date_depart || ''))) return 'Dates au format AAAA-MM-JJ requises'
    if (date_depart <= date_arrivee) return "La date de départ doit suivre la date d'arrivée"
    if (date_arrivee < aujourdhui()) return "La date d'arrivée est passée"
    return null
  }

  // ── GET /disponibilite/:hotel_slug ─────────────────────────────────────────
  // Retourne chambres disponibles sur la période + taxes hébergement de l'hôtel.
  // Public — aucune authentification requise.
  fastify.get('/disponibilite/:hotel_slug', async (req, reply) => {
    const { date_arrivee, date_depart } = req.query
    const erreurDates = validerDates(date_arrivee, date_depart)
    if (erreurDates) return reply.status(400).send({ erreur: erreurDates, code: 'DATES_INVALIDES' })

    const hotel = await fastify.db('hotels')
      .where({ slug: req.params.hotel_slug, actif: true })
      .first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })

    await expirerTentatives(hotel.id)

    const reservees = await fastify.db('reservations')
      .where({ hotel_id: hotel.id })
      .whereNotIn('statut', ['annulee', 'no_show'])
      .where('date_arrivee', '<', date_depart)
      .where('date_depart',  '>', date_arrivee)
      .whereNotNull('chambre_id')   // LOT-GUEST-01 : un NULL dans NOT IN excluait TOUTES les chambres
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
      // Ordre stable (sans ORDER BY, l'ordre physique PostgreSQL variait d'un appel à l'autre)
      .orderBy('ch.numero')

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

    const erreurDates = validerDates(date_arrivee, date_depart)
    if (erreurDates) return reply.status(400).send({ erreur: erreurDates, code: 'DATES_INVALIDES' })

    const hotel = await fastify.db('hotels')
      .where({ slug: hotel_slug, actif: true })
      .first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })

    await expirerTentatives(hotel.id)

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

    // Jeton espace client — clé CLIENT (refusé par l'authentification staff, LOT-GUEST-01)
    const jwtClient = signerJetonClient(fastify, clientRec, hotel)

    // Lien de check-in en ligne (utilisable dès la confirmation du paiement)
    const checkin = await checkinService.genererLien({ reservationId: reservation.id, hotelId: hotel.id, acteurId: null })

    reply.status(202).send({
      message:        'Réservation en attente de confirmation de paiement',
      statut:         'tentative',
      id:             reservation.id,
      numero:         reservation.numero_reservation,
      montant:        reservation.total_general,
      paiement_id:    paiement?.id || null,
      token_client:   jwtClient,
      checkin_en_ligne_url: checkin.url,
      checkin_en_ligne_expire_le: checkin.expire_le,
    })
  })
}
