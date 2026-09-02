'use strict'

module.exports = async function clientRoutes(fastify) {

  async function authentifierClient(request, reply) {
    try {
      await request.jwtVerify()
      if (request.user.type !== 'client') {
        return reply.status(403).send({ erreur: 'Accès réservé aux clients' })
      }
    } catch {
      return reply.status(401).send({ erreur: 'Session expirée', code: 'SESSION_EXPIREE' })
    }
  }

  const pre = [authentifierClient]

  // ── GET /client/profil ────────────────────────────────────────────────
  fastify.get('/profil', { preHandler: pre }, async (req, reply) => {
    const client = await fastify.db('clients')
      .where({ id: req.user.id, hotel_id: req.user.hotel_id })
      .select(
        'id', 'prenom', 'nom', 'email', 'telephone',
        'adresse', 'ville', 'pays_residence', 'segment',
        'points_fidelite', 'nombre_sejours', 'niveau_fidelite'
      )
      .first()

    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })

    reply.send({ client: { ...client, niveau_fidelite: client.niveau_fidelite || 'bronze' } })
  })

  // ── GET /client/reservations ──────────────────────────────────────────
  fastify.get('/reservations', { preHandler: pre }, async (req, reply) => {
    const reservations = await fastify.db('reservations AS r')
      .leftJoin('chambres AS ch',    'ch.id', 'r.chambre_id')
      .leftJoin('types_chambre AS tc','tc.id', 'ch.type_chambre_id')
      .where({ 'r.client_id': req.user.id, 'r.hotel_id': req.user.hotel_id })
      .select(
        'r.id', 'r.numero_reservation', 'r.statut',
        'r.date_arrivee', 'r.date_depart', 'r.nombre_nuits',
        'r.total_general', 'r.devise',
        'ch.numero AS numero_chambre',
        'tc.nom AS type_chambre',
        'r.qr_token', 'r.qr_token_actif'
      )
      .orderBy('r.date_arrivee', 'desc')
      .limit(20)

    reply.send({ reservations })
  })

  // ── GET /client/factures ──────────────────────────────────────────────
  fastify.get('/factures', { preHandler: pre }, async (req, reply) => {
    const factures = await fastify.db('factures AS f')
      .where({ 'f.client_id': req.user.id, 'f.hotel_id': req.user.hotel_id })
      .select(
        'f.id', 'f.numero_facture', 'f.montant_ttc',
        'f.statut', 'f.date_emission', 'f.devise'
      )
      .orderBy('f.date_emission', 'desc')
      .limit(20)

    reply.send({ factures })
  })

  // ── GET /client/offres — offres actives visibles par le client ─────────
  fastify.get('/offres', { preHandler: pre }, async (req, reply) => {
    const client = await fastify.db('clients')
      .where({ id: req.user.id, hotel_id: req.user.hotel_id })
      .select('niveau_fidelite')
      .first()
    const niveauClient = client?.niveau_fidelite || 'bronze'

    const offresBrutes = await fastify.db('offres')
      .where({ hotel_id: req.user.hotel_id, actif: true })
      .where(function () {
        this.whereNull('date_fin').orWhere('date_fin', '>=', fastify.db.raw('CURRENT_DATE'))
      })
      .orderBy('cree_le', 'desc')

    // Hiérarchie de niveau : une offre 'silver' reste visible aux clients 'gold'.
    const offres = offresBrutes.filter(o =>
      !o.niveau_requis ||
      o.niveau_requis === niveauClient ||
      (o.niveau_requis === 'silver' && ['silver', 'gold'].includes(niveauClient))
    )

    reply.send({ offres })
  })

  // ── GET /client/points — solde, niveau, progression et historique ──────
  fastify.get('/points', { preHandler: pre }, async (req, reply) => {
    const [client, regles, historique] = await Promise.all([
      fastify.db('clients')
        .where({ id: req.user.id, hotel_id: req.user.hotel_id })
        .select('points_fidelite', 'niveau_fidelite')
        .first(),
      fastify.db('regles_fidelite').where({ hotel_id: req.user.hotel_id }).first(),
      fastify.db('points_fidelite_log')
        .where({ client_id: req.user.id, hotel_id: req.user.hotel_id })
        .orderBy('cree_le', 'desc')
        .limit(20),
    ])

    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })

    reply.send({
      client: { points_fidelite: client.points_fidelite || 0, niveau_fidelite: client.niveau_fidelite || 'bronze' },
      regles: {
        seuil_silver: regles?.seuil_silver ?? 200,
        seuil_gold:   regles?.seuil_gold ?? 500,
      },
      historique,
    })
  })

  // ── PUT /client/checkin/:id ─────────────────────────────────────────────
  // Check-in en ligne simplifié : le client confirme son arrivée depuis le
  // portail. Ne fait qu'un changement de statut — l'attribution de chambre
  // et le portail-chambre restent gérés par le flow staff (reservations.route.js).
  fastify.put('/checkin/:id', { preHandler: pre }, async (req, reply) => {
    // Fenêtre calculée en SQL (CURRENT_DATE) plutôt qu'en JS Date/toISOString :
    // un DATE Postgres lu par node-postgres est réinterprété dans le fuseau
    // local du process Node puis décalé en UTC à la sérialisation, ce qui
    // décale la comparaison d'un jour selon le fuseau du serveur.
    const reservation = await fastify.db('reservations')
      .where({ id: req.params.id, client_id: req.user.id, hotel_id: req.user.hotel_id })
      .select('*', fastify.db.raw("date_arrivee BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day' AS fenetre_eligible"))
      .first()

    if (!reservation) return reply.status(404).send({ erreur: 'Réservation introuvable' })

    if (reservation.statut !== 'confirmee')
      return reply.status(409).send({
        erreur: 'Cette réservation n\'est pas éligible au check-in',
        code:   'STATUT_INVALIDE',
      })

    if (!reservation.fenetre_eligible)
      return reply.status(409).send({
        erreur: 'Le check-in en ligne n\'est disponible que la veille ou le jour de l\'arrivée',
        code:   'HORS_FENETRE',
      })

    const [updated] = await fastify.db('reservations')
      .where({ id: req.params.id, client_id: req.user.id, hotel_id: req.user.hotel_id })
      .update({ statut: 'arrivee' })
      .returning('*')

    reply.send({ message: 'Check-in confirmé', reservation: updated })
  })

  // ── PUT /client/profil ────────────────────────────────────────────────
  fastify.put('/profil', { preHandler: pre }, async (req, reply) => {
    const { prenom, nom, telephone, adresse, ville, pays } = req.body || {}

    const [updated] = await fastify.db('clients')
      .where({ id: req.user.id, hotel_id: req.user.hotel_id })
      .update({
        ...(prenom    !== undefined && { prenom }),
        ...(nom       !== undefined && { nom }),
        ...(telephone !== undefined && { telephone }),
        ...(adresse       !== undefined && { adresse }),
        ...(ville         !== undefined && { ville }),
        ...(pays          !== undefined && { pays_residence: pays }),
        mis_a_jour_le: fastify.db.fn.now()
      })
      .returning(['id', 'prenom', 'nom', 'email', 'telephone', 'adresse', 'ville', 'pays_residence'])

    if (!updated) return reply.status(404).send({ erreur: 'Client introuvable' })
    reply.send({ client: updated })
  })

  // ── PUT /client/motdepasse ────────────────────────────────────────────────
  fastify.put('/motdepasse', { preHandler: pre }, async (req, reply) => {
    const { mot_de_passe_actuel, nouveau_mot_de_passe } = req.body || {}
    if (!mot_de_passe_actuel || !nouveau_mot_de_passe)
      return reply.status(400).send({ erreur: 'Les deux champs sont requis' })
    if (nouveau_mot_de_passe.length < 6)
      return reply.status(400).send({ erreur: 'Nouveau mot de passe : 6 caractères minimum' })

    const client = await fastify.db('clients')
      .where({ id: req.user.id, hotel_id: req.user.hotel_id })
      .select('mot_de_passe_hash')
      .first()
    if (!client) return reply.status(404).send({ erreur: 'Client introuvable' })

    const ok = await fastify.verifierMotDePasse(mot_de_passe_actuel, client.mot_de_passe_hash)
    if (!ok) return reply.status(401).send({ erreur: 'Mot de passe actuel incorrect' })

    const hash = await fastify.hashMotDePasse(nouveau_mot_de_passe)
    await fastify.db('clients')
      .where({ id: req.user.id, hotel_id: req.user.hotel_id })
      .update({ mot_de_passe_hash: hash, mis_a_jour_le: fastify.db.fn.now() })

    reply.send({ message: 'Mot de passe modifié avec succès' })
  })
}
