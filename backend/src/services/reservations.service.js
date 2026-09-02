'use strict'

const { createReservationsRepository, STATUTS_CHECKIN_VALIDES, STATUTS_CHECKOUT_VALIDES } = require('../repositories/reservations.repository')
const { createFacturationRepository } = require('../repositories/facturation.repository')
const { genererFacturePDF } = require('./pdf.service')
const { envoyerFacture }    = require('./email.service')
const { NotFoundError, ConflictError, DomainError } = require('../errors')

// ─────────────────────────────────────────────────────────────────────────────
// reservations.service.js
//
// Toutes les règles métier du module réservations.
// Aucune connaissance de req, reply, ou HTTP.
// Transactions ouvertes ici — propagées aux repositories via trx.
// Cache invalidé APRÈS commit de transaction.
//
// ANTI-FRAUDE — INVARIANTS NON NÉGOCIABLES :
//   1. Aucune chambre ne peut passer à 'occupee' sans réservation en statut 'arrivee'
//   2. Le check-in vérifie atomiquement réservation + chambre dans la même transaction
//   3. Toute transition d'état est loguée dans logs_audit_reservations
//   4. Le token portail est activé DANS la même transaction que le check-in
//   5. Le checkout révoque le token DANS la même transaction
// ─────────────────────────────────────────────────────────────────────────────

// Machine d'état stricte — seules ces transitions sont autorisées
const TRANSITIONS_VALIDES = {
  tentative:           ['confirmee', 'annulee'],
  confirmee:           ['arrivee', 'annulee', 'no_show'],
  arrivee:             ['depart_aujourd_hui', 'terminee'],
  depart_aujourd_hui:  ['terminee', 'no_show'],
  annulee:             [],
  no_show:             [],
  terminee:            [],
}

function createReservationsService({ db, cache }) {
  const repo            = createReservationsRepository(db)
  const facturationRepo = createFacturationRepository(db)

  // ── Clés cache ─────────────────────────────────────────────────────────────
  const cleListeRes  = (hotelId) => `reservations:${hotelId}`
  const cleTimeline  = (hotelId) => `timeline:${hotelId}`
  const cleItem      = (hotelId, id) => `reservation:${hotelId}:${id}`

  async function invaliderCaches(hotelId, id) {
    await Promise.all([
      id ? cache.del(cleItem(hotelId, id)) : Promise.resolve(),
      cache.delPattern(`${cleListeRes(hotelId)}:*`),
      cache.delPattern(`${cleTimeline(hotelId)}:*`),
      cache.delPattern(`chambres:${hotelId}:*`), // Invalidation inter-modules
    ])
  }

  // ── Vérification de transition d'état ─────────────────────────────────────
  function assertTransitionValide(statutActuel, statutCible) {
    const permises = TRANSITIONS_VALIDES[statutActuel] ?? []
    if (!permises.includes(statutCible)) {
      throw new ConflictError(
        `Transition interdite : ${statutActuel} → ${statutCible}`,
        'TRANSITION_INVALIDE',
        { statut_actuel: statutActuel, statut_cible: statutCible }
      )
    }
  }

  // ── Calcul des taxes ───────────────────────────────────────────────────────
  function calculerTaxes(tarifNuit, nombreNuits, taxes) {
    let totalTaxes = 0
    const detailTaxes = []

    for (const taxe of taxes) {
      let montant = 0
      if (taxe.type_taxe === 'pourcentage') {
        montant = (tarifNuit * nombreNuits * parseFloat(taxe.valeur)) / 100
      } else if (taxe.type_taxe === 'fixe') {
        // Taxe fixe par nuit
        montant = parseFloat(taxe.valeur) * nombreNuits
      }
      totalTaxes += montant
      detailTaxes.push({ code: taxe.code, nom: taxe.nom, montant })
    }

    return { totalTaxes: Math.round(totalTaxes * 100) / 100, detailTaxes }
  }

  // ── Calcul de la remise online ─────────────────────────────────────────────
  function calculerRemise(tarifNuit, nombreNuits, remisePct) {
    if (!remisePct || remisePct <= 0) return { remiseMontant: 0, remisePct: 0 }
    const base = tarifNuit * nombreNuits
    const montant = Math.round((base * remisePct / 100) * 100) / 100
    return { remiseMontant: montant, remisePct }
  }

  return {

    // ── Récupérer une réservation par id ──────────────────────────────────
    async getParId(id, hotelId) {
      const cached = await cache.get(cleItem(hotelId, id))
      if (cached) return cached

      const reservation = await repo.trouverParId(id, hotelId)
      if (!reservation) throw new NotFoundError('Réservation', id)

      await cache.set(cleItem(hotelId, id), reservation, 30)
      return reservation
    },

    // ── Créer une réservation ─────────────────────────────────────────────
    //
    // Séquence :
    //   1. Vérifier appartenance client à l'hôtel
    //   2. Récupérer tarif chambre (snapshot)
    //   3. Vérifier disponibilité dans la transaction
    //   4. Calculer remise online si applicable
    //   5. Calculer taxes
    //   6. Insérer réservation (statut: confirmee par défaut reception, tentative pour online)
    //   7. Créer session portail inactive
    //   8. Logger l'audit
    async creerReservation(hotelId, tenantId, acteurId, acteurType, donnees) {
      let reservation
      let tentatives = 0
      const MAX_TENTATIVES = 2

      while (tentatives < MAX_TENTATIVES) {
        tentatives++
        try {
        await db.transaction(async (trx) => {

          // Vérification client — isolation tenant
          if (!(await repo.clientAppartientHotel(donnees.client_id, hotelId, trx)))
            throw new NotFoundError('Client', donnees.client_id)

          // Récupération tarif + paramètres hôtel
          const [chambre, parametres, taxes] = await Promise.all([
            donnees.chambre_id
              ? trx('chambres AS ch')
                  .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
                  .where({ 'ch.id': donnees.chambre_id, 'ch.hotel_id': hotelId })
                  .select('ch.id', 'ch.statut', 'ch.hors_service', 'ch.tarif_specifique', 'tc.tarif_base', 'tc.capacite_adultes', 'tc.capacite_enfants')
                  .first()
              : Promise.resolve(null),
            repo.trouverParametres(hotelId, trx),
            repo.trouverTaxesHebergement(hotelId, trx),
          ])

          // Vérifications chambre si spécifiée
          if (donnees.chambre_id) {
            if (!chambre)
              throw new NotFoundError('Chambre', donnees.chambre_id)

            if (chambre.hors_service)
              throw new ConflictError(
                'La chambre est hors service',
                'CHAMBRE_HORS_SERVICE',
                { chambre_id: donnees.chambre_id }
              )

            // Vérification disponibilité — fenêtre de chevauchement SQL
            const conflit = await repo.verifierDisponibilite({
              chambreId:   donnees.chambre_id,
              hotelId,
              dateArrivee: donnees.date_arrivee,
              dateDepart:  donnees.date_depart,
            }, trx)

            if (conflit)
              throw new ConflictError(
                'La chambre est déjà réservée sur cette période',
                'CHAMBRE_NON_DISPONIBLE',
                { chambre_id: donnees.chambre_id, reservation_conflit: conflit.id }
              )
          }

          // Calcul tarifaire — snapshot immuable
          const nombreNuits = Math.ceil(
            (new Date(donnees.date_depart) - new Date(donnees.date_arrivee)) / (1000 * 60 * 60 * 24)
          )
          const tarifNuit = chambre
            ? parseFloat(chambre.tarif_specifique ?? chambre.tarif_base ?? 0)
            : parseFloat(donnees.tarif_nuit ?? 0)

          const totalHebergementBrut = tarifNuit * nombreNuits

          // Remise online automatique
          const source = donnees.source || 'reception'
          const remisePct = source === 'online'
            ? parseFloat(parametres?.parametres_supplementaires?.remise_online_pourcentage ?? 0)
            : 0
          const { remiseMontant } = calculerRemise(tarifNuit, nombreNuits, remisePct)

          const totalHebergement           = Math.round((totalHebergementBrut - remiseMontant) * 100) / 100
          const { totalTaxes, detailTaxes } = calculerTaxes(tarifNuit, nombreNuits, taxes)
          const totalGeneral               = Math.round((totalHebergement + totalTaxes) * 100) / 100

          // Statut initial : tentative si online, confirmee si réception
          const statut = source === 'online' ? 'tentative' : 'confirmee'

          const champs = {
            hotel_id:          hotelId,
            tenant_id:         tenantId,
            client_id:         donnees.client_id,
            chambre_id:        donnees.chambre_id || null,
            statut,
            date_arrivee:      donnees.date_arrivee,
            date_depart:       donnees.date_depart,
            nombre_adultes:    parseInt(donnees.nombre_adultes) || 2,
            nombre_enfants:    parseInt(donnees.nombre_enfants) || 0,
            tarif_nuit:        tarifNuit,
            devise:            donnees.devise || parametres?.devise || 'XAF',
            total_hebergement: totalHebergement,
            total_taxes:       totalTaxes,
            total_general:     totalGeneral,
            reduction_pct:     remisePct,
            source,
            regime_repas:      donnees.regime_repas || 'chambre_seule',
            arrivee_prevue:    donnees.arrivee_prevue || parametres?.heure_arrivee || '14:00:00',
            preferences_client: donnees.preferences_client || null,
            notes_internes:    donnees.notes_internes || null,
            creee_par:         acteurId || null,
          }

          reservation = await repo.creer(champs, trx)

          // R1 — Créer le folio dans la même transaction + lignes initiales (P5)
          // Si l'un des INSERT échoue → rollback total. Zéro folio orphelin possible.
          const folio = await facturationRepo.creerFolio({
            reservation_id: reservation.id,
            hotel_id:       hotelId,
            client_id:      donnees.client_id || null,
            numero_folio:   'FOL-' + reservation.numero_reservation,
            devise:         champs.devise,
          }, trx)

          // P5 — Ligne hébergement (débit de base)
          if (totalHebergement > 0) {
            const descHeberg = remisePct > 0
              ? `Hébergement — ${nombreNuits} nuit${nombreNuits > 1 ? 's' : ''} × ${tarifNuit} ${champs.devise} (remise ${remisePct}%)`
              : `Hébergement — ${nombreNuits} nuit${nombreNuits > 1 ? 's' : ''} × ${tarifNuit} ${champs.devise}`
            await facturationRepo.insererLigne({
              folio_id:      folio.id,
              hotel_id:      hotelId,
              type_ligne:    'hebergement',
              sens:          'debit',
              montant:       totalHebergement,
              devise:        champs.devise,
              description:   descHeberg,
              source_module: 'reservation',
              cree_par:      acteurId || null,
              cree_par_type: acteurType,
              metadata:      { tarif_nuit: tarifNuit, nombre_nuits: nombreNuits, reduction_pct: remisePct },
            }, trx)
          }

          // P5 — Lignes taxes (une ligne débit par taxe active)
          for (const taxe of detailTaxes) {
            if (taxe.montant > 0) {
              await facturationRepo.insererLigne({
                folio_id:      folio.id,
                hotel_id:      hotelId,
                type_ligne:    'taxe',
                sens:          'debit',
                montant:       taxe.montant,
                devise:        champs.devise,
                description:   taxe.nom,
                source_module: 'reservation',
                cree_par:      acteurId || null,
                cree_par_type: acteurType,
                metadata:      { code: taxe.code },
              }, trx)
            }
          }

          // Créer session portail inactive (activée au check-in)
          if (donnees.chambre_id) {
            const dureeSejourMs = (new Date(donnees.date_depart) - new Date(donnees.date_arrivee))
            const expireLe = new Date(
              new Date(donnees.date_depart).getTime() + 12 * 60 * 60 * 1000  // J départ + 12h buffer
            )
            await repo.creerSessionChambre({
              hotelId,
              chambreId:     donnees.chambre_id,
              reservationId: reservation.id,
              expireLe:      expireLe.toISOString(),
            }, trx)
          }

          // Log audit — INSERT ONLY
          await repo.insererLogAudit({
            reservation_id: reservation.id,
            hotel_id:       hotelId,
            action:         'creation',
            statut_avant:   null,
            statut_apres:   statut,
            acteur_id:      acteurId || null,
            acteur_type:    acteurType,
          }, trx)
        })
        break // succès — sortir de la boucle
        } catch (err) {
          if (err.code === '23505' && tentatives < MAX_TENTATIVES) {
            // Collision de numéro (trigger COUNT non atomique) — retenter une fois
            continue
          }
          if (err.code === '23505') {
            throw new ConflictError('Erreur de génération du numéro de réservation', 'NUMERO_COLLISION')
          }
          if (err.code === '23P01') {
            // Contrainte d'exclusion PostgreSQL : chevauchement de dates détecté
            // au niveau DB (filet de sécurité contre les race conditions)
            throw new ConflictError(
              'La chambre est déjà réservée sur cette période',
              'CHAMBRE_NON_DISPONIBLE',
              { chambre_id: donnees.chambre_id }
            )
          }
          throw err
        }
      }

      await invaliderCaches(hotelId, null)
      return reservation
    },

    // ── Confirmer une réservation (tentative → confirmee) ─────────────────
    async confirmerReservation(id, hotelId, acteurId) {
      let mis

      await db.transaction(async (trx) => {
        const reservation = await repo.trouverParId(id, hotelId, trx)
        if (!reservation) throw new NotFoundError('Réservation', id)

        assertTransitionValide(reservation.statut, 'confirmee')

        mis = await repo.mettreAJourStatut(id, hotelId, {
          statut:         'confirmee',
          confirmee_par:  acteurId || null,
        }, trx)

        await repo.insererLogAudit({
          reservation_id: id,
          hotel_id:       hotelId,
          action:         'confirmation',
          statut_avant:   reservation.statut,
          statut_apres:   'confirmee',
          acteur_id:      acteurId || null,
          acteur_type:    'staff',
        }, trx)
      })

      await invaliderCaches(hotelId, id)
      return mis
    },

    // ── Check-in ──────────────────────────────────────────────────────────
    //
    // ANTI-FRAUDE — Séquence atomique :
    //   1. SELECT FOR UPDATE réservation → vérifier statut = confirmee
    //   2. Vérifier chambre libre_propre + !hors_service
    //   3. UPDATE réservation → arrivee + timestamps
    //   4. UPDATE chambre → occupee (SEULE voie légale vers ce statut)
    //   5. Activer session portail dans la même transaction
    //   6. Logger audit
    //
    // Si l'une de ces étapes échoue → rollback total.
    // La chambre ne peut JAMAIS être 'occupee' sans que la réservation soit 'arrivee'.
    async checkin(id, hotelId, acteurId, acteurRole, ipAddress) {
      let tokenActif

      await db.transaction(async (trx) => {
        // Verrou SELECT FOR UPDATE pour prévenir les double check-in concurrents.
        // trx.raw() retourne { rows: [...], rowCount: N, ... } — PAS un tableau.
        // La déstructuration [reservation] opère sur l'objet, pas sur rows.
        // FIX : accès explicite à .rows[0]
        const result = await trx.raw(
          `SELECT r.* FROM reservations r
           WHERE r.id = ? AND r.hotel_id = ?
           FOR UPDATE`,
          [id, hotelId]
        )
        const reservation = result.rows[0] ?? null

        if (!reservation)
          throw new NotFoundError('Réservation', id)

        // ── Vérification machine d'état ───────────────────────────────────
        if (!STATUTS_CHECKIN_VALIDES.includes(reservation.statut))
          throw new ConflictError(
            `Check-in impossible : la réservation est en statut "${reservation.statut}"`,
            'STATUT_INVALIDE_CHECKIN',
            { statut_actuel: reservation.statut }
          )

        // ── Vérification check-in anticipé — ANTI-FRAUDE ──────────────────
        // Un check-in avant date_arrivee est un vecteur de fraude interne :
        // héberger quelqu'un sans réservation en utilisant une réservation future.
        // Override autorisé uniquement pour manager et super_admin, et loggué.
        const aujourdhui = new Date().toISOString().split('T')[0]
        // Knex hydrate les colonnes DATE en objets Date JS — normaliser en string ISO
        const dateArriveeStr = reservation.date_arrivee instanceof Date
          ? reservation.date_arrivee.toISOString().split('T')[0]
          : String(reservation.date_arrivee).slice(0, 10)
        const estAnticipe = dateArriveeStr > aujourdhui

        if (estAnticipe) {
          const ROLES_OVERRIDE_ANTICIPE = ['manager', 'super_admin']
          if (!acteurRole || !ROLES_OVERRIDE_ANTICIPE.includes(acteurRole)) {
            throw new ConflictError(
              `Check-in anticipé impossible : date d'arrivée prévue le ${reservation.date_arrivee}`,
              'CHECKIN_ANTICIPE',
              { date_arrivee: reservation.date_arrivee, aujourd_hui: aujourdhui }
            )
          }
          // Override manager : loggué AVANT les autres actions pour traçabilité
          await repo.insererLogAudit({
            reservation_id: id,
            hotel_id:       hotelId,
            action:         'checkin_anticipe_override',
            statut_avant:   reservation.statut,
            statut_apres:   reservation.statut,  // pas encore changé
            acteur_id:      acteurId || null,
            acteur_type:    'staff',
            ip_address:     ipAddress || null,
            donnees_avant:  JSON.stringify({
              date_arrivee: reservation.date_arrivee,
              aujourd_hui:  aujourdhui,
              role_acteur:  acteurRole,
            }),
          }, trx)
        }

        // ── Vérification chambre — ANTI-FRAUDE CRITIQUE ───────────────────
        // La chambre doit être libre_propre. Toute autre vérification est
        // insuffisante — un statut 'sale' ou 'inspection' indique que la chambre
        // n'est pas prête, peu importe ce que la réservation dit.
        if (!reservation.chambre_id)
          throw new ConflictError(
            'Aucune chambre affectée à cette réservation — affectez une chambre avant le check-in',
            'CHAMBRE_NON_AFFECTEE'
          )

        const chambre = await repo.trouverChambreDispoCheckin(reservation.chambre_id, hotelId, trx)
        if (!chambre)
          throw new ConflictError(
            'La chambre n\'est pas disponible pour le check-in (hors service, occupée, ou en nettoyage)',
            'CHAMBRE_NON_DISPONIBLE_CHECKIN',
            { chambre_id: reservation.chambre_id }
          )

        // ── UPDATE réservation → arrivee ──────────────────────────────────
        await repo.mettreAJourStatut(id, hotelId, {
          statut:              'arrivee',
          heure_arrivee_reelle: trx.fn.now(),
          qr_token_actif:      true,
        }, trx)

        // ── UPDATE chambre → occupee (SEULE voie légale) ──────────────────
        // hotel_id vérifié dans mettreAJourStatutChambre — isolation tenant garantie
        await repo.mettreAJourStatutChambre(reservation.chambre_id, hotelId, {
          statut:            'occupee',
          hors_service:      false,
        }, trx)

        // ── Activation session portail dans la même transaction ───────────
        // Cas 1 : session déjà active (double check-in détecté) — ne pas créer de doublon
        // Cas 2 : session inactive existante (chambre_id fourni à la création) — activer
        // Cas 3 : aucune session (réservation créée sans chambre_id) — créer + activer
        // Dans tous les cas, qr_token_actif=true DOIT être accompagné d'un token réel.
        if (await repo.sessionActiveExiste(id, trx)) {
          // Session déjà active : double check-in détecté — token déjà en place
          const sessionExistante = await trx('sessions_chambre')
            .where({ reservation_id: id, actif: true })
            .select('token')
            .first()
          tokenActif = sessionExistante?.token ?? null
        } else {
          // Tenter d'activer une session inactive existante
          tokenActif = await repo.activerSessionChambre(id, trx)

          if (!tokenActif) {
            // Aucune session en base (réservation créée sans chambre_id) :
            // créer la session maintenant que chambre_id est connu et activer
            const expireLe = new Date(
              new Date(reservation.date_depart).getTime() + 12 * 60 * 60 * 1000
            ).toISOString()

            const nouvelleSession = await repo.creerSessionChambre({
              hotelId,
              chambreId:     reservation.chambre_id,
              reservationId: id,
              expireLe,
            }, trx)

            // Activer immédiatement
            await trx('sessions_chambre')
              .where({ id: nouvelleSession.id })
              .update({ actif: true })

            tokenActif = nouvelleSession.token
          }

          // Synchroniser qr_token sur la réservation — garanti non-null ici
          if (tokenActif) {
            await trx('reservations')
              .where({ id, hotel_id: hotelId })
              .update({ qr_token: tokenActif })
          }
        }

        // ── Log audit ─────────────────────────────────────────────────────
        await repo.insererLogAudit({
          reservation_id: id,
          hotel_id:       hotelId,
          action:         'checkin',
          statut_avant:   reservation.statut,
          statut_apres:   'arrivee',
          acteur_id:      acteurId || null,
          acteur_type:    'staff',
          ip_address:     ipAddress || null,
        }, trx)
      })

      await invaliderCaches(hotelId, id)

      return {
        token_portail: tokenActif,
        url_portail:   tokenActif
          ? `${process.env.APP_URL || ''}/room-portal/${tokenActif}`
          : null,
      }
    },

    // ── Check-out ─────────────────────────────────────────────────────────
    //
    // Séquence atomique :
    //   1. Vérifier statut arrivee|depart_aujourd_hui
    //   2. UPDATE réservation → terminee + timestamps
    //   3. UPDATE chambre → sale (ou libre_propre si housekeeping disabled)
    //   4. Révoquer session portail
    //   5. Créer tâche ménage automatique avec priorité calculée
    //   6. Logger audit
    async checkout(id, hotelId, acteurId) {
      let tacheMenage

      await db.transaction(async (trx) => {
        const reservation = await repo.trouverParId(id, hotelId, trx)
        if (!reservation) throw new NotFoundError('Réservation', id)

        if (!STATUTS_CHECKOUT_VALIDES.includes(reservation.statut))
          throw new ConflictError(
            `Check-out impossible : la réservation est en statut "${reservation.statut}"`,
            'STATUT_INVALIDE_CHECKOUT',
            { statut_actuel: reservation.statut }
          )

        // Récupérer paramètres pour déterminer le workflow ménage
        const parametres = await repo.trouverParametres(hotelId, trx)
        const housekeepingRequired = parametres?.parametres_supplementaires?.housekeeping_required !== false

        // UPDATE réservation → terminee
        await repo.mettreAJourStatut(id, hotelId, {
          statut:             'terminee',
          heure_depart_reelle: trx.fn.now(),
        }, trx)

        // UPDATE chambre selon configuration housekeeping
        const statutChambreApres = housekeepingRequired ? 'sale' : 'libre_propre'
        await repo.mettreAJourStatutChambre(reservation.chambre_id, hotelId, {
          statut:       statutChambreApres,
          hors_service: false,
        }, trx)

        // Révoquer session portail dans la même transaction
        await repo.revoquerSessionChambre(id, trx)

        // Créer tâche ménage si housekeeping activé
        if (housekeepingRequired && reservation.chambre_id) {
          // Priorité urgente si check-in prévu sur cette chambre dans les 3 prochaines heures
          const prochainCheckin = await repo.prochainCheckinDansDuree(
            reservation.chambre_id, hotelId, 3, trx
          )
          const priorite = prochainCheckin ? 'urgente' : 'normale'

          tacheMenage = await repo.creerTacheMenage({
            hotel_id:    hotelId,
            chambre_id:  reservation.chambre_id,
            type_tache:  'nettoyage_depart',
            statut:      'ouverte',
            priorite,
            description: `Nettoyage départ — Réservation ${reservation.numero_reservation}`,
            date_tache:  new Date().toISOString().split('T')[0],
          }, trx)
        }

        // Log audit
        await repo.insererLogAudit({
          reservation_id: id,
          hotel_id:       hotelId,
          action:         'checkout',
          statut_avant:   reservation.statut,
          statut_apres:   'terminee',
          acteur_id:      acteurId || null,
          acteur_type:    'staff',
        }, trx)

        // Attribution automatique de points fidélité — dans la même transaction
        // que le checkout, mais son échec ne doit jamais faire échouer le checkout.
        if (reservation.client_id) {
          try {
            const regles = await trx('regles_fidelite').where({ hotel_id: hotelId }).first()
            const pointsParNuit = regles?.points_par_nuit ?? 10
            const pointsPar1000 = regles?.points_par_1000_xaf ?? 5
            const seuilSilver   = regles?.seuil_silver ?? 200
            const seuilGold     = regles?.seuil_gold ?? 500

            const nbNuits = Number(reservation.nombre_nuits) || 0
            const total   = Number(reservation.total_general) || 0
            const pointsGagnes = (nbNuits * pointsParNuit) + (Math.floor(total / 1000) * pointsPar1000)

            if (pointsGagnes > 0) {
              const clientAvant = await trx('clients')
                .where({ id: reservation.client_id, hotel_id: hotelId })
                .first()

              if (clientAvant) {
                const soldeApres = (clientAvant.points_fidelite || 0) + pointsGagnes
                const nouveauNiveau = soldeApres >= seuilGold ? 'gold' : soldeApres >= seuilSilver ? 'silver' : 'bronze'

                await trx('clients')
                  .where({ id: reservation.client_id, hotel_id: hotelId })
                  .update({ points_fidelite: soldeApres, niveau_fidelite: nouveauNiveau })

                await trx('points_fidelite_log').insert({
                  hotel_id:       hotelId,
                  client_id:      reservation.client_id,
                  type_mouvement: 'credit',
                  points:         pointsGagnes,
                  solde_apres:    soldeApres,
                  motif:          `Checkout réservation ${reservation.numero_reservation}`,
                  reference_id:   id,
                })
              }
            }
          } catch (errFidelite) {
            console.error('[CHECKOUT] Erreur attribution points fidélité (non bloquant):', errFidelite.message)
          }
        }
      })

      await invaliderCaches(hotelId, id)

      // ── Génération facture + PDF + email (post-transaction, non bloquant) ──
      // La transaction est déjà commitée — les erreurs ici ne font PAS rollback.
      let factureGeneree = null
      try {
        factureGeneree = await _genererFactureCheckout({ db, repo: facturationRepo, hotelId, reservationId: id, log: db.log })
      } catch (errFacture) {
        console.error('[CHECKOUT] Erreur génération facture (non bloquant):', errFacture.message)
      }

      return { tache_menage: tacheMenage || null, facture: factureGeneree }
    },

    // ── Annuler une réservation ───────────────────────────────────────────
    async annulerReservation(id, hotelId, acteurId, raison) {
      let mis

      await db.transaction(async (trx) => {
        const reservation = await repo.trouverParId(id, hotelId, trx)
        if (!reservation) throw new NotFoundError('Réservation', id)

        assertTransitionValide(reservation.statut, 'annulee')

        // Si la réservation était confirmée, révoquer le token portail si existant
        if (reservation.qr_token_actif) {
          await repo.revoquerSessionChambre(id, trx)
        }

        mis = await repo.mettreAJourStatut(id, hotelId, {
          statut:            'annulee',
          annulee_par:       acteurId || null,
          raison_annulation: raison   || null,
        }, trx)

        await repo.insererLogAudit({
          reservation_id: id,
          hotel_id:       hotelId,
          action:         'annulation',
          statut_avant:   reservation.statut,
          statut_apres:   'annulee',
          acteur_id:      acteurId || null,
          acteur_type:    'staff',
          donnees_avant:  JSON.stringify({ statut: reservation.statut }),
        }, trx)
      })

      await invaliderCaches(hotelId, id)
      return mis
    },

  }
}

// ── Génération de facture au checkout ────────────────────────────────────────
// Appelée POST-transaction checkout. Ne doit jamais faire planter le checkout.
// Si la facture existe déjà (retry), on retourne l'existante sans doublon.
async function _genererFactureCheckout({ db, repo, hotelId, reservationId, log }) {
  // 1. Vérifier si une facture existe déjà pour cette réservation
  const existante = await repo.trouverFactureParReservation(reservationId, hotelId)
  if (existante) {
    return { id: existante.id, numero_facture: existante.numero_facture, url_pdf: existante.url_pdf, deja_existante: true }
  }

  // 2. Récupérer données nécessaires
  const [reservation, folio, hotel] = await Promise.all([
    db('reservations AS r')
      .leftJoin('clients AS c', 'c.id', 'r.client_id')
      .where({ 'r.id': reservationId, 'r.hotel_id': hotelId })
      .select(
        'r.*',
        db.raw("c.prenom || ' ' || c.nom AS nom_client"),
        'c.email AS email_client',
        'c.telephone AS telephone_client',
        'c.id AS client_id_reel'
      )
      .first(),
    db('folios').where({ reservation_id: reservationId, hotel_id: hotelId }).first(),
    db('hotels AS h')
      .leftJoin('parametres_hotel AS ph', 'ph.hotel_id', 'h.id')
      .where('h.id', hotelId)
      .select('h.nom', 'h.id', db.raw("ph.parametres_supplementaires->>'adresse' AS adresse"), db.raw("ph.parametres_supplementaires->>'email_contact' AS email"))
      .first(),
  ])

  if (!reservation || !folio) throw new Error(`Données manquantes pour checkout (res=${reservationId}, folio=${!!folio})`)

  const [lignes, paiements, soldeResult] = await Promise.all([
    db('lignes_folio').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc'),
    db('paiements').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc'),
    db.raw('SELECT * FROM get_solde_folio(?, ?)', [folio.id, hotelId]),
  ])
  const solde = soldeResult.rows[0]

  // 3. Calcul montants — depuis lignes folio (source de vérité)
  const debits  = lignes.filter(l => l.sens === 'debit')
  const credits = lignes.filter(l => l.sens === 'credit')
  const totalHT    = debits.reduce((s, l) => s + Number(l.montant_total || 0), 0)
  const totalTaxes = debits.filter(l => l.type_ligne === 'taxe').reduce((s, l) => s + Number(l.montant_total || 0), 0)
  const totalTTC   = totalHT // lignes folio = TTC (taxes incluses dans les lignes séparées)

  // 4. Créer la facture en DB
  const facture = await repo.creerFacture({
    hotel_id:       hotelId,
    reservation_id: reservationId,
    client_id:      reservation.client_id_reel || null,
    montant_ht:     Math.max(0, totalHT - totalTaxes),
    montant_taxes:  totalTaxes,
    montant_ttc:    totalTTC,
    devise:         folio.devise || 'XAF',
    lignes:         lignes.map(l => ({ description: l.description, type: l.type_ligne, montant: l.montant_total, sens: l.sens })),
    statut:         'emise',
  })

  // 5. Générer le PDF
  const { cheminRelatif, filepath } = await genererFacturePDF({
    facture,
    reservation,
    hotel:     { nom: hotel?.nom || 'Hôtel', adresse: hotel?.adresse, email: hotel?.email },
    client:    { nom: reservation.nom_client, email: reservation.email_client, telephone: reservation.telephone_client },
    lignes:    lignes.map(l => ({ ...l, montant: l.montant_total })),
    paiements,
    solde,
  })

  // 6. Stocker l'URL du PDF
  await repo.mettreAJourUrlPdf(facture.id, hotelId, cheminRelatif)

  // 7. Envoyer l'email (silencieux si pas de SMTP)
  await envoyerFacture({
    emailDestinataire: reservation.email_client,
    nomClient:         reservation.nom_client,
    nomHotel:          hotel?.nom || 'Hôtel',
    numeroFacture:     facture.numero_facture,
    pdfPath:           filepath,
    log,
  })

  return {
    id:             facture.id,
    numero_facture: facture.numero_facture,
    url_pdf:        cheminRelatif,
    montant_ttc:    facture.montant_ttc,
    devise:         facture.devise,
  }
}

module.exports = { createReservationsService }
