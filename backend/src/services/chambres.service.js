'use strict'

const { createChambresRepository } = require('../repositories/chambres.repository')
const { NotFoundError, ConflictError } = require('../errors')

// ─────────────────────────────────────────────────────────────────────────────
// chambres.service.js
//
// Toutes les règles métier du module chambres.
// Aucune connaissance de req, reply, ou HTTP.
// Transactions ouvertes ici — propagées aux repositories via trx.
// Cache invalidé APRÈS commit de transaction.
//
// Stratégie cache :
//   Création        → invalider liste
//   Modification    → invalider item + liste
//   Changement statut → invalider item + liste
//   Désactivation   → invalider item + liste
// ─────────────────────────────────────────────────────────────────────────────

// Statuts qui indiquent qu'une chambre doit être nettoyée
const STATUTS_A_NETTOYER = ['sale', 'nettoyage', 'inspection']

function createChambresService({ db, cache }) {
  const repo = createChambresRepository(db)

  // ── Clés cache ─────────────────────────────────────────────────────────────
  const cleListe  = (hotelId)     => `chambres:${hotelId}`
  const cleItem   = (hotelId, id) => `chambres:${hotelId}:${id}`

  // ── Invalider cache liste ──────────────────────────────────────────────────
  // Le pattern `${cleListe(hotelId)}:*` cible toutes les sous-clés filtrées
  // (ex: chambres:hotelId:{"statut":"libre_propre"}) sans affecter les clés
  // d'autres modules. Le wildcard est dans l'expression keys(), pas dans la clé.
  async function invaliderListe(hotelId) {
    await cache.delPattern(`${cleListe(hotelId)}:*`)
  }

  // ── Invalider cache item + liste ───────────────────────────────────────────
  async function invaliderItem(hotelId, id) {
    await Promise.all([
      cache.del(cleItem(hotelId, id)),
      cache.delPattern(`${cleListe(hotelId)}:*`),
    ])
  }

  return {

    // ── Lister avec stats ────────────────────────────────────────────────────
    async lister(hotelId, filtres = {}) {
      const cle = `${cleListe(hotelId)}:${JSON.stringify(filtres)}`
      const cached = await cache.get(cle)
      if (cached) return cached

      const { donnees, total } = await repo.lister({ hotelId, ...filtres })

      // Stats calculées ici — règle métier sur la définition de "à nettoyer"
      const stats = {
        total,
        libres:       donnees.filter(c => c.statut === 'libre_propre').length,
        occupees:     donnees.filter(c => c.statut === 'occupee').length,
        hors_service: donnees.filter(c => c.hors_service).length,
        a_nettoyer:   donnees.filter(c => STATUTS_A_NETTOYER.includes(c.statut)).length,
      }

      const resultat = { donnees, total, stats }
      await cache.set(cle, resultat, 60)
      return resultat
    },

    // ── Récupérer par id avec images + réservation active ───────────────────
    async getParId(id, hotelId) {
      const cached = await cache.get(cleItem(hotelId, id))
      if (cached) return cached

      const chambre = await repo.trouverParId(id, hotelId)
      if (!chambre) throw new NotFoundError('Chambre', id)

      // hotelId transmis — trouverImages enforce l'isolation tenant via JOIN
      const images = await repo.trouverImages(id, hotelId)

      // Règle métier : chercher réservation active seulement si chambre occupée
      const reservationEnCours = chambre.statut === 'occupee'
        ? await repo.trouverReservationEnCours(id, hotelId)
        : null

      const resultat = { chambre, images, reservation_en_cours: reservationEnCours }
      // TTL 30s : donnée volatile (statut + réservation active changent fréquemment)
      await cache.set(cleItem(hotelId, id), resultat, 30)
      return resultat
    },

    // ── Chambres disponibles sur une période ─────────────────────────────────
    // Délègue le filtrage complet à repo.listerDisponibles (SQL).
    // Aucun chargement en mémoire pour filtrage JS — correctif critique performance.
    async getDisponibles(hotelId, { dateArrivee, dateDepart, adultes, enfants, typeId }) {
      const nbNuits = Math.ceil(
        (new Date(dateDepart) - new Date(dateArrivee)) / (1000 * 60 * 60 * 24)
      )

      const donnees = await repo.listerDisponibles({
        hotelId, dateArrivee, dateDepart, adultes, enfants, typeId,
      })

      // Enrichissement du total séjour — tarif_nuit calculé en SQL par COALESCE
      const enrichies = donnees.map(c => ({
        ...c,
        tarif_nuit:   parseFloat(c.tarif_nuit),
        total_sejour: parseFloat(c.tarif_nuit) * nbNuits,
        nb_nuits:     nbNuits,
      }))

      return {
        chambres_disponibles: enrichies,
        total_disponibles:    enrichies.length,
        periode: { date_arrivee: dateArrivee, date_depart: dateDepart, nb_nuits: nbNuits },
      }
    },

    // ── Créer une chambre ────────────────────────────────────────────────────
    async creer(hotelId, tenantId, donnees) {
      let cree

      try {
        await db.transaction(async (trx) => {
          // Règle unicité numéro dans l'hôtel
          if (await repo.numeroExiste(hotelId, donnees.numero, null, trx))
            throw new ConflictError(
              `La chambre numéro "${donnees.numero}" existe déjà dans cet hôtel`,
              'NUMERO_DEJA_UTILISE',
              { hotel_id: hotelId, numero: donnees.numero }
            )

          // Règle isolation tenant sur type_chambre_id
          if (donnees.type_chambre_id) {
            if (!(await repo.typeAppartientHotel(donnees.type_chambre_id, hotelId, trx)))
              throw new ConflictError(
                'Type de chambre invalide pour cet hôtel',
                'TYPE_CHAMBRE_INVALIDE',
                { hotel_id: hotelId, type_chambre_id: donnees.type_chambre_id }
              )
          }

          const champs = _construireChamps(donnees, hotelId)
          cree = await repo.creer(champs, trx)
        })
      } catch (err) {
        // Race condition : deux inserts simultanés passent numeroExiste puis
        // l'un des deux viole la contrainte UNIQUE(hotel_id, numero) côté PostgreSQL.
        // Code 23505 = unique_violation. Sans ce catch, le client reçoit HTTP 500.
        if (err.code === '23505') {
          throw new ConflictError(
            `La chambre numéro "${donnees.numero}" existe déjà dans cet hôtel`,
            'NUMERO_DEJA_UTILISE',
            { hotel_id: hotelId, numero: donnees.numero }
          )
        }
        throw err
      }

      // Cache invalidé après commit
      await invaliderListe(hotelId)
      return cree
    },

    // ── Modifier une chambre ─────────────────────────────────────────────────
    async modifier(id, hotelId, donnees) {
      let mis

      try {
        await db.transaction(async (trx) => {
          const existante = await repo.trouverParId(id, hotelId, trx)
          if (!existante) throw new NotFoundError('Chambre', id)

          // Unicité numéro si modifié
          if (donnees.numero !== undefined &&
              donnees.numero.toString().trim() !== existante.numero) {
            if (await repo.numeroExiste(hotelId, donnees.numero, id, trx))
              throw new ConflictError(
                `La chambre numéro "${donnees.numero}" existe déjà dans cet hôtel`,
                'NUMERO_DEJA_UTILISE',
                { hotel_id: hotelId, numero: donnees.numero }
              )
          }

          // Isolation tenant sur type_chambre_id si modifié
          if (donnees.type_chambre_id !== undefined && donnees.type_chambre_id !== null) {
            if (!(await repo.typeAppartientHotel(donnees.type_chambre_id, hotelId, trx)))
              throw new ConflictError(
                'Type de chambre invalide pour cet hôtel',
                'TYPE_CHAMBRE_INVALIDE',
                { hotel_id: hotelId, type_chambre_id: donnees.type_chambre_id }
              )
          }

          const champs = _construireChamps(donnees, hotelId)
          delete champs.hotel_id // hotel_id ne peut jamais être modifié
          mis = await repo.mettreAJour(id, hotelId, champs, trx)
        })
      } catch (err) {
        // Même race condition que creer — deux modifications simultanées
        // du même numéro passent la vérification puis l'une viole UNIQUE(hotel_id, numero)
        if (err.code === '23505') {
          throw new ConflictError(
            `La chambre numéro "${donnees.numero}" existe déjà dans cet hôtel`,
            'NUMERO_DEJA_UTILISE',
            { hotel_id: hotelId, numero: donnees.numero }
          )
        }
        throw err
      }

      await invaliderItem(hotelId, id)
      return mis
    },

    // ── Changer le statut ────────────────────────────────────────────────────
    async changerStatut(id, hotelId, { statut, horsService, horsServiceRaison }) {
      let mis

      await db.transaction(async (trx) => {
        const chambre = await repo.trouverParId(id, hotelId, trx)
        if (!chambre) throw new NotFoundError('Chambre', id)

        // Règle métier critique : transition occupee → libre_propre interdite
        // si une réservation active existe (checkout requis)
        if (chambre.statut === 'occupee' && statut === 'libre_propre') {
          const reservationActive = await repo.trouverReservationEnCours(id, hotelId, trx)
          if (reservationActive)
            throw new ConflictError(
              'Cette chambre a une réservation active. Effectuez le check-out via le module réservations.',
              'CHAMBRE_OCCUPEE_RESERVATION_ACTIVE',
              { chambre_id: id, reservation_id: reservationActive.id }
            )
        }

        const champs = {}
        if (statut            !== undefined) champs.statut              = statut
        if (horsService       !== undefined) champs.hors_service         = Boolean(horsService)
        if (horsServiceRaison !== undefined) champs.hors_service_raison  = horsServiceRaison ?? null

        // ── Invariant statut ↔ hors_service ───────────────────────────────
        // Les deux champs doivent rester cohérents — états contradictoires interdits.
        // Règle 1 : hors_service=true → forcer statut='hors_service'
        // Règle 2 : statut='hors_service' → forcer hors_service=true
        // Règle 3 : hors_service=false + statut actuel 'hors_service'
        //           → forcer statut='libre_propre' (chambre remise en service)
        if (champs.hors_service === true) {
          champs.statut = 'hors_service'
        } else if (champs.statut === 'hors_service') {
          champs.hors_service = true
        } else if (champs.hors_service === false && chambre.statut === 'hors_service') {
          champs.statut = 'libre_propre'
        }

        mis = await repo.mettreAJour(id, hotelId, champs, trx)
      })

      await invaliderItem(hotelId, id)
      return mis
    },

    // ── Désactiver (soft delete) ─────────────────────────────────────────────
    async desactiver(id, hotelId) {
      await db.transaction(async (trx) => {
        const chambre = await repo.trouverParId(id, hotelId, trx)
        if (!chambre) throw new NotFoundError('Chambre', id)

        // Règle 1 : chambre actuellement occupée
        if (chambre.statut === 'occupee')
          throw new ConflictError(
            'Impossible de désactiver une chambre occupée',
            'CHAMBRE_OCCUPEE',
            { chambre_id: id }
          )

        // Règle 2 : réservations futures existantes
        const nbFutures = await repo.compterReservationsFutures(id, hotelId, trx)
        if (nbFutures > 0)
          throw new ConflictError(
            `Impossible de désactiver : ${nbFutures} réservation(s) future(s) associée(s)`,
            'RESERVATIONS_FUTURES_EXISTANTES',
            { chambre_id: id, nb_reservations: nbFutures }
          )

        await repo.mettreAJour(id, hotelId, {
          hors_service:        true,
          hors_service_raison: 'Chambre désactivée',
          statut:              'hors_service',
        }, trx)
      })

      await invaliderItem(hotelId, id)
    },

  }
}

// ── Helper interne — construction des champs à persister ─────────────────────
// Responsabilité : typage, trim, sérialisation JSONB
// Séparé du service pour être partagé entre creer et modifier

function _construireChamps(donnees, hotelId) {
  const champs = { hotel_id: hotelId }

  if (donnees.numero          !== undefined) champs.numero           = donnees.numero.toString().trim()
  if (donnees.etage           !== undefined) champs.etage            = parseInt(donnees.etage)
  if (donnees.type_chambre_id !== undefined) champs.type_chambre_id  = donnees.type_chambre_id ?? null
  if (donnees.description     !== undefined) champs.description      = donnees.description     ?? null
  if (donnees.vue             !== undefined) champs.vue              = donnees.vue             ?? null
  if (donnees.lits            !== undefined) champs.lits             = JSON.stringify(donnees.lits)
  if (donnees.caracteristiques !== undefined) champs.caracteristiques = JSON.stringify(donnees.caracteristiques)
  if (donnees.superficie_m2   !== undefined) champs.superficie_m2    = donnees.superficie_m2 !== null ? parseFloat(donnees.superficie_m2) : null
  if (donnees.tarif_specifique !== undefined) champs.tarif_specifique = donnees.tarif_specifique !== null ? parseFloat(donnees.tarif_specifique) : null
  if (donnees.notes_internes  !== undefined) champs.notes_internes   = donnees.notes_internes  ?? null

  return champs
}

module.exports = { createChambresService }
