'use strict'

const { createPortailRepository, STATUTS_ACTIFS } = require('../repositories/portail.repository')
const { NotFoundError, ConflictError, DomainError } = require('../errors')

// ─────────────────────────────────────────────────────────────────────────────
// portail.service.js
//
// Logique métier du portail client.
// Aucune connaissance de req, reply, ou HTTP.
//
// ISOLATION TENANT :
//   Chaque méthode reçoit reservationId + hotelId.
//   Ces deux paramètres sont passés à chaque appel repository.
//   Un client ne peut accéder qu'aux données de SA réservation dans SON hôtel.
//
// RATE LIMITING :
//   Implémenté en mémoire (Map) — suffisant pour la v1 (instance unique).
//   À migrer vers Redis si multi-instance.
// ─────────────────────────────────────────────────────────────────────────────

// Rate limit messages : 1 message toutes les 30 secondes par session
//
// STRATÉGIE V1 — RATE LIMIT EN MÉMOIRE (INTENTIONNEL)
//
// La méthode `repo.dernierMessageClient()` existe mais n'est PAS utilisée ici.
// Ce choix est délibéré pour deux raisons :
//
//   1. Performance : une vérification en mémoire (Map) est O(1) sans aller-retour DB.
//      En contexte africain (latence 200-500ms), éviter une requête DB pour chaque
//      tentative d'envoi améliore significativement la réactivité du portail.
//
//   2. Suffisance v1 : le portail tourne en instance unique (Railway single service).
//      Un Map en mémoire est fiable tant qu'il n'y a pas de scaling horizontal.
//
// MIGRATION VERS REDIS (si scaling multi-instance) :
//   Remplacer checkRateLimit() par une vérification via fastify.cache :
//     const cle = `ratelimit:portail:message:${sessionId}`
//     const existant = await cache.get(cle)
//     if (existant) throw ConflictError(...)
//     await cache.set(cle, 1, 30)   // TTL 30s
//   Supprimer alors le Map et le setInterval de nettoyage.
//   `repo.dernierMessageClient()` reste disponible pour audit/historique.
const RATE_LIMIT_MESSAGE_MS = 30 * 1000
const rateLimitMap = new Map()  // sessionId → timestamp du dernier message

function checkRateLimit(sessionId) {
  const dernierEnvoi = rateLimitMap.get(sessionId)
  const maintenant   = Date.now()

  if (dernierEnvoi && (maintenant - dernierEnvoi) < RATE_LIMIT_MESSAGE_MS) {
    const resteMs     = RATE_LIMIT_MESSAGE_MS - (maintenant - dernierEnvoi)
    const resteSecondes = Math.ceil(resteMs / 1000)
    throw new ConflictError(
      `Un message toutes les 30 secondes — réessayez dans ${resteSecondes} seconde(s)`,
      'RATE_LIMIT_MESSAGE',
      { attendre_secondes: resteSecondes }
    )
  }

  rateLimitMap.set(sessionId, maintenant)
}

// Nettoyage périodique du Map (évite la fuite mémoire sur longue durée)
setInterval(() => {
  const limite = Date.now() - RATE_LIMIT_MESSAGE_MS * 2
  for (const [key, ts] of rateLimitMap.entries()) {
    if (ts < limite) rateLimitMap.delete(key)
  }
}, 60 * 1000)

function createPortailService({ db, cache }) {
  const repo = createPortailRepository(db)

  // ── Clés cache ─────────────────────────────────────────────────────────────
  const cleContexte = (reservationId) => `portail:contexte:${reservationId}`

  return {

    // ── Initialiser la session portail (échange token QR → session_token) ──
    //
    // Flow :
    //   1. Valider le token QR (actif=true AND expire_le > NOW())
    //   2. Générer un session_token distinct (32 bytes, 4h durée)
    //   3. Retourner le session_token au client
    //
    // Le token QR n'est PAS révoqué — il peut être réutilisé pour initialiser
    // une nouvelle session si la session expire (ex: le client ferme et rouvre).
    // La session_expire (4h) est indépendante de expire_le du token QR (date départ + 12h).
    //
    // Pourquoi ne pas révoquer le QR ? Un client qui ferme son navigateur doit
    // pouvoir rescanner le QR. Révoquer le QR après un seul accès rendrait le
    // portail inutilisable sur connexion instable (page chargée à moitié).
    async initSession(token, ipAddress) {
      const session = await repo.trouverSessionParToken(token)

      if (!session)
        throw new DomainError(
          'Lien expiré ou invalide. Scannez à nouveau le QR code ou contactez la réception.',
          'TOKEN_PORTAIL_INVALIDE',
          401
        )

      // Générer le session_token dans une transaction
      let sessionToken
      await db.transaction(async (trx) => {
        sessionToken = await repo.creerSessionToken(session.id, trx)
      })

      return {
        session_token:  sessionToken,
        reservation_id: session.reservation_id,
        hotel_id:       session.hotel_id,
        expire_dans_ms: 4 * 60 * 60 * 1000,
      }
    },

    // ── Valider une session portail (utilisé par authentifierSession) ──────
    // Retourne { reservationId, hotelId, sessionId } ou lève une DomainError.
    async validerSession(sessionToken) {
      const session = await repo.trouverSessionParSessionToken(sessionToken)

      if (!session)
        throw new DomainError(
          'Session expirée. Scannez à nouveau le QR code.',
          'SESSION_PORTAIL_EXPIREE',
          401
        )

      // PATCH 2 — Bloquer l'accès si la réservation est terminée.
      // Une session reste techniquement valide (session_expire non atteinte)
      // après un checkout, mais le portail ne doit plus être utilisable.
      // La vérification est ici et non dans chaque méthode pour centraliser
      // le contrôle d'accès sans dupliquer la logique.
      // Exception volontaire : GET /context reste lisible (voir route) —
      // c'est le service getContexte qui ajoute portail_expire: true.
      // Cette méthode est appelée par authentifierSession sur TOUTES les routes,
      // y compris GET /context. Le cas terminee est traité dans getContexte
      // (lecture autorisée) mais bloqué ici pour les actions (messages, services).
      // DÉCISION : validerSession ne bloque PAS pour terminee — le contrôle
      // statut est fait dans chaque méthode métier (envoyerMessage, etc.).
      // Ce qui EST bloqué ici : session associée à une réservation qui n'existe
      // plus ou dont la chambre a changé de tenant (protection défense en profondeur).
      const reservation = await repo.trouverContexteReservation(
        session.reservation_id,
        session.hotel_id
      )

      if (!reservation)
        throw new DomainError(
          'Session invalide — réservation introuvable.',
          'SESSION_RESERVATION_INTROUVABLE',
          401
        )

      // Bloquer explicitement si checkout effectué — aucune action possible,
      // y compris la lecture (le client est invité à l'évaluation à la place)
      const STATUTS_BLOQUANTS = ['terminee', 'annulee', 'no_show']

      if (STATUTS_BLOQUANTS.includes(reservation.statut))
        throw new DomainError(
          'Votre séjour est terminé. Le portail n\'est plus accessible. Merci pour votre visite !',
          'SESSION_TERMINEE',
          401
        )

      // Rafraîchir l'expiration de la session à chaque requête (fenêtre glissante)
      // Fire & forget — pas critique, pas de await bloquant
      repo.rafraichirSession(session.id).catch(() => {})

      return {
        reservationId: session.reservation_id,
        hotelId:       session.hotel_id,
        sessionId:     session.id,
        chambreId:     session.chambre_id,
      }
    },

    // ── Contexte complet du séjour (endpoint GET /context) ────────────────
    //
    // PERFORMANCE : une seule requête DB principale + deux parallèles.
    // Retourne TOUT le contexte en une réponse pour minimiser les allers-retours
    // sur connexion instable (contexte africain).
    //
    // RÈGLE : même après checkout, le contexte est lisible (messages inclus).
    async getContexte(reservationId, hotelId) {
      // Cache court (30s) — les données changent peu pendant le séjour
      const cle = cleContexte(reservationId)
      const cached = await cache.get(cle)
      if (cached) return cached

      const reservation = await repo.trouverContexteReservation(reservationId, hotelId)

      if (!reservation)
        throw new NotFoundError('Réservation', reservationId)

      // Messages et demandes en parallèle
      const [messages, demandes, commandes] = await Promise.all([
        repo.listerMessages(reservationId, hotelId),
        repo.listerDemandesService(reservationId, hotelId),
        // LOT-GUEST-01 — commandes room service réelles (suivi du statut par le client)
        db('commandes_restaurant')
          .where({ hotel_id: hotelId, reservation_id: reservationId })
          .select('id', 'numero_commande', 'statut', 'sous_total', 'taxes', 'total', 'devise', 'cree_le')
          .orderBy('cree_le', 'desc'),
      ])

      const PORTAIL_EXPIRE_STATUTS = ['terminee', 'annulee', 'no_show']

      const contexte = {
        reservation,
        messages,
        demandes_service: demandes,
        commandes_room_service: commandes,
        // Indicateur UX : portail expiré si statut terminal
        portail_expire: PORTAIL_EXPIRE_STATUTS.includes(reservation.statut),
      }
      await cache.set(cle, contexte, 30)
      return contexte
    },

    // ── Envoyer un message ────────────────────────────────────────────────
    //
    // RÈGLES MÉTIER :
    //   1. Rate limit : 1 message / 30s par session
    //   2. Statut réservation : IN ('arrivee', 'depart_aujourd_hui')
    //      → Lecture autorisée après checkout, écriture bloquée
    async envoyerMessage(reservationId, hotelId, sessionId, corps) {
      // Rate limit en mémoire — vérifié avant toute requête DB
      checkRateLimit(sessionId)

      // Vérifier le statut de la réservation
      const reservation = await repo.trouverContexteReservation(reservationId, hotelId)
      if (!reservation) throw new NotFoundError('Réservation', reservationId)

      if (!STATUTS_ACTIFS.includes(reservation.statut))
        throw new ConflictError(
          reservation.statut === 'terminee'
            ? 'Votre séjour est terminé — les messages ne sont plus disponibles'
            : 'Les messages sont disponibles uniquement pendant votre séjour',
          'MESSAGES_INDISPONIBLES',
          { statut: reservation.statut }
        )

      let message
      await db.transaction(async (trx) => {
        message = await repo.creerMessage({ reservationId, hotelId, corps }, trx)
      })

      // Invalider le cache contexte après création d'un message
      await cache.del(cleContexte(reservationId))

      return message
    },

    // ── Créer une demande de service ──────────────────────────────────────
    //
    // RÈGLES MÉTIER :
    //   Mêmes règles de statut que les messages.
    async creerDemandeService(reservationId, hotelId, chambreId, { typeService, description }) {
      const reservation = await repo.trouverContexteReservation(reservationId, hotelId)
      if (!reservation) throw new NotFoundError('Réservation', reservationId)

      if (!STATUTS_ACTIFS.includes(reservation.statut))
        throw new ConflictError(
          'Les demandes de service sont disponibles uniquement pendant votre séjour',
          'DEMANDES_INDISPONIBLES',
          { statut: reservation.statut }
        )

      let demande
      await db.transaction(async (trx) => {
        demande = await repo.creerDemandeService({
          reservationId,
          hotelId,
          chambreId,
          typeService,
          description,
        }, trx)
      })

      await cache.del(cleContexte(reservationId))
      return demande
    },

    // ── Catalogue room service (LOT-GUEST-01) ─────────────────────────────
    // Auparavant : menu codé en dur dans le frontend, prix fictifs, simple demande texte.
    // Désormais : articles réels de l'hôtel (articles_menu), disponibles et actifs.
    async menu(hotelId) {
      return db('articles_menu')
        .where({ hotel_id: hotelId, disponible: true, actif: true })
        .select('id', 'nom', 'description', 'categorie', 'prix', 'devise', 'image_url')
        .orderBy([{ column: 'categorie' }, { column: 'ordre' }, { column: 'nom' }])
    },

    // ── Commande room service (LOT-GUEST-01) ──────────────────────────────
    // Crée une VRAIE commande restaurant rattachée au séjour et à la chambre de la session
    // (type_client 'hebergement', mode_reglement 'chambre'). Le cycle PMS existant prend
    // le relais : préparation → servie → débit folio (+ taxes restaurant, PMS-02) → facture.
    // Prix, hôtel, séjour et chambre viennent de la base — jamais du client.
    async commanderRoomService(reservationId, hotelId, chambreId, { lignes, notes }) {
      const reservation = await repo.trouverContexteReservation(reservationId, hotelId)
      if (!reservation) throw new NotFoundError('Réservation', reservationId)
      if (!STATUTS_ACTIFS.includes(reservation.statut))
        throw new ConflictError('Le room service est disponible uniquement pendant votre séjour', 'ROOM_SERVICE_INDISPONIBLE', { statut: reservation.statut })

      const demandes = new Map()
      for (const l of lignes) demandes.set(l.article_id, (demandes.get(l.article_id) || 0) + l.quantite)
      const articles = await db('articles_menu')
        .where({ hotel_id: hotelId, disponible: true, actif: true })
        .whereIn('id', [...demandes.keys()])
      if (articles.length !== demandes.size)
        throw new DomainError('Article indisponible ou inconnu', 'ARTICLE_INDISPONIBLE', 400)

      const recentes = await db('commandes_restaurant')
        .where({ hotel_id: hotelId, reservation_id: reservationId })
        .where('numero_commande', 'like', 'RS-%')
        .where('cree_le', '>', db.raw("NOW() - INTERVAL '10 minutes'"))
        .count('* AS n').first()
      if (Number(recentes.n) >= 5)
        throw new ConflictError('Trop de commandes récentes — patientez quelques minutes', 'RATE_LIMIT_COMMANDE')

      const lignesCmd = articles.map(a => {
        const quantite = demandes.get(a.id)
        return { article_id: a.id, nom_article: a.nom, categorie: a.categorie, quantite,
                 prix_unitaire: Number(a.prix), montant_total: Math.round(Number(a.prix) * quantite * 100) / 100 }
      })
      const sousTotal = Math.round(lignesCmd.reduce((s, l) => s + l.montant_total, 0) * 100) / 100
      const chambre = chambreId ? await db('chambres').where({ id: chambreId, hotel_id: hotelId }).select('numero').first() : null

      let commande
      await db.transaction(async (trx) => {
        const numero = `RS-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${require('crypto').randomBytes(4).toString('hex').toUpperCase()}`
        ;[commande] = await trx('commandes_restaurant').insert({
          hotel_id: hotelId, reservation_id: reservationId, chambre_id: chambreId || null,
          numero_commande: numero, type_client: 'hebergement',
          numero_chambre: chambre ? chambre.numero : reservation.numero_chambre, numero_table: null,
          mode_reglement: 'chambre', sous_total: sousTotal, total: sousTotal,
          devise: reservation.devise || 'XAF',
          notes: notes ? `Portail chambre — ${String(notes).slice(0, 500)}` : 'Commande portail chambre',
        }).returning(['id', 'numero_commande', 'statut', 'sous_total', 'devise', 'cree_le'])
        await trx('lignes_commande').insert(lignesCmd.map(l => ({ ...l, commande_id: commande.id })))
      })
      await cache.del(cleContexte(reservationId))
      return { ...commande, lignes: lignesCmd }
    },

    // ── Soumettre une évaluation ──────────────────────────────────────────
    //
    // RÈGLES MÉTIER :
    //   1. Uniquement si statut = 'terminee' (pas pendant le séjour)
    //   2. Une seule évaluation par réservation
    //   3. La contrainte UNIQUE(reservation_id) en DB est le filet final
    async soumettreEvaluation(reservationId, hotelId, donnees) {
      const reservation = await repo.trouverContexteReservation(reservationId, hotelId)
      if (!reservation) throw new NotFoundError('Réservation', reservationId)

      // Règle métier : évaluation uniquement après checkout
      if (reservation.statut !== 'terminee')
        throw new ConflictError(
          'L\'évaluation est disponible uniquement après la fin de votre séjour',
          'EVALUATION_INDISPONIBLE',
          { statut: reservation.statut }
        )

      // Vérification préalable pour un message d'erreur lisible
      // (la contrainte DB UNIQUE est le filet si deux requêtes simultanées passent)
      if (await repo.evaluationExiste(reservationId, hotelId))
        throw new ConflictError(
          'Vous avez déjà soumis une évaluation pour ce séjour',
          'EVALUATION_DEJA_SOUMISE'
        )

      let evaluation
      try {
        await db.transaction(async (trx) => {
          evaluation = await repo.creerEvaluation({ reservationId, hotelId, donnees }, trx)
        })
      } catch (err) {
        // Filet de sécurité : contrainte UNIQUE(reservation_id) en DB
        if (err.code === '23505')
          throw new ConflictError(
            'Vous avez déjà soumis une évaluation pour ce séjour',
            'EVALUATION_DEJA_SOUMISE'
          )
        throw err
      }

      await cache.del(cleContexte(reservationId))
      return evaluation
    },

  }
}

module.exports = { createPortailService }
