'use strict'

const { createReservationsRepository, STATUTS_CHECKIN_VALIDES, STATUTS_CHECKOUT_VALIDES } = require('../repositories/reservations.repository')
const { createFacturationRepository } = require('../repositories/facturation.repository')
const { genererFacturePDF, chargerHotelFacture } = require('./pdf.service')
const { envoyerFacture }    = require('./email.service')
const comptabilite          = require('./comptabilite.bridge')
const folioRegles           = require('./folio.regles')
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
      detailTaxes.push({ code: taxe.code, nom: taxe.nom, montant, type_taxe: taxe.type_taxe, valeur: parseFloat(taxe.valeur) })
    }

    return { totalTaxes: Math.round(totalTaxes * 100) / 100, detailTaxes }
  }

  // Ligne folio d'une taxe d'hébergement : le barème appliqué (taux, nuits) est conservé dans la
  // ligne pour que folio, facture et PDF affichent le calcul réel, même si la configuration change.
  function ligneTaxe(folioId, hotelId, taxe, { tarifNuit, nombreNuits, devise, acteurId, acteurType, motif }) {
    const nb = `${nombreNuits} nuit${nombreNuits > 1 ? 's' : ''}`
    const description = taxe.type_taxe === 'fixe'
      ? `${taxe.nom} — ${nb} × ${taxe.valeur} ${devise}`
      : `${taxe.nom} — ${String(taxe.valeur).replace('.', ',')} % × ${nb}`
    return {
      folio_id: folioId, hotel_id: hotelId, type_ligne: 'taxe', sens: 'debit',
      montant: taxe.montant, devise, description, source_module: 'reservation',
      cree_par: acteurId || null, cree_par_type: acteurType || 'staff',
      metadata: { code: taxe.code, type_taxe: taxe.type_taxe, valeur: taxe.valeur, nombre_nuits: nombreNuits, tarif_nuit: tarifNuit, ...(motif ? { motif } : {}) },
    }
  }

  // ── Réajustement fiscal au départ (HELICONIA-RETOUR-01) ──────────────────
  // Les taxes d'hébergement sont pré-facturées à la création (P5) avec la configuration du jour.
  // La facture doit suivre la configuration fiscale EFFECTIVE à son émission : si les taxes ont
  // changé depuis (TVA désactivée, taxe de séjour modifiée…), les lignes taxe de la réservation
  // sont contre-passées (corrections — lignes immuables) puis reposées au barème courant.
  // Les taxes restaurant (fait générateur = la commande) ne sont pas concernées.
  async function reajusterTaxesHebergement(trx, folio, hotelId, acteurId) {
    const lignes   = await trx('lignes_folio').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le')
    const corrigees = new Set(lignes.filter(l => l.ligne_corrigee_id).map(l => l.ligne_corrigee_id))
    const actives  = lignes.filter(l => l.sens === 'debit' && l.source_module === 'reservation' && !corrigees.has(l.id))
    const heberg   = actives.find(l => l.type_ligne === 'hebergement' && l.metadata?.nombre_nuits)
    if (!heberg) return []
    const tarifNuit   = Number(heberg.metadata.tarif_nuit)
    const nombreNuits = Number(heberg.metadata.nombre_nuits)
    const devise      = folio.devise || heberg.devise || 'XAF'

    const { detailTaxes } = calculerTaxes(tarifNuit, nombreNuits, await repo.trouverTaxesHebergement(hotelId, trx))
    const voulues = Object.fromEntries(detailTaxes.filter(t => t.montant > 0).map(t => [t.code, t]))
    const posees = {}
    for (const l of actives) {
      if (l.type_ligne === 'taxe' && l.metadata?.code) (posees[l.metadata.code] = posees[l.metadata.code] || []).push(l)
    }

    const cts = (v) => Math.round(Number(v || 0) * 100)
    const ajustements = []
    for (const code of new Set([...Object.keys(posees), ...Object.keys(voulues)])) {
      const avant = (posees[code] || []).reduce((s, l) => s + cts(l.montant_total), 0)
      const apres = voulues[code] ? cts(voulues[code].montant) : 0
      if (avant === apres) continue
      for (const l of posees[code] || []) {
        await facturationRepo.insererLigne({
          folio_id: folio.id, hotel_id: hotelId, type_ligne: 'correction', sens: 'credit',
          montant: l.montant_total, devise: l.devise, description: `Réajustement fiscal — ${l.description}`,
          reference_id: l.id, reference_type: 'folio_ligne', ligne_corrigee_id: l.id,
          source_module: 'reservation', cree_par: acteurId || null, cree_par_type: 'staff',
          metadata: { motif: 'reajustement_fiscal', code },
        }, trx)
      }
      if (voulues[code]) {
        await facturationRepo.insererLigne(ligneTaxe(folio.id, hotelId, voulues[code],
          { tarifNuit, nombreNuits, devise, acteurId, acteurType: 'staff', motif: 'reajustement_fiscal' }), trx)
      }
      ajustements.push({ code, avant: avant / 100, apres: apres / 100 })
    }
    return ajustements
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
              await facturationRepo.insererLigne(ligneTaxe(folio.id, hotelId, taxe,
                { tarifNuit, nombreNuits, devise: champs.devise, acteurId, acteurType }), trx)
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
      let factureCreee = null
      let folioApres   = null

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

        // LOT-PMS-02 — Folio + facture dans la MÊME transaction que le checkout :
        // folio verrouillé, facture = ventilation nette des lignes, folio sorti de l'état 'ouvert'
        // (cloture si solde nul, en_attente sinon). Double checkout / folio incohérent impossibles.
        const folio = await trx('folios').where({ reservation_id: id, hotel_id: hotelId }).forUpdate().first()
        if (folio) {
          if (folio.statut !== 'ouvert')
            throw new ConflictError(`Checkout impossible : folio déjà en statut "${folio.statut}"`, 'FOLIO_DEJA_FERME', { folio_id: folio.id })
          const ajustements = await reajusterTaxesHebergement(trx, folio, hotelId, acteurId)
          if (ajustements.length) {
            await repo.insererLogAudit({
              reservation_id: id, hotel_id: hotelId, action: 'reajustement_fiscal',
              statut_avant: reservation.statut, statut_apres: reservation.statut,
              acteur_id: acteurId || null, acteur_type: 'staff',
              donnees_avant: JSON.stringify({ ajustements }),
            }, trx)
          }
          factureCreee = await _creerFactureCheckout({ trx, repo: facturationRepo, hotelId, reservationId: id, folio })
          folioApres   = await folioRegles.fermerAuCheckout(trx, folio.id, hotelId, acteurId)
        }

        // Attribution automatique de points fidélité — dans la même transaction
        // que le checkout, mais son échec ne doit jamais faire échouer le checkout.
        if (reservation.client_id) {
          try {
           // Savepoint : une erreur SQL fidélité ne doit pas avorter la transaction du checkout
           await trx.transaction(async (trx) => {
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
           })
          } catch (errFidelite) {
            console.error('[CHECKOUT] Erreur attribution points fidélité (non bloquant):', errFidelite.message)
          }
        }
      })

      await invaliderCaches(hotelId, id)

      // ── PDF + email (post-commit, non bloquant) — la facture existe déjà en base ──
      let factureGeneree = factureCreee
        ? { id: factureCreee.id, numero_facture: factureCreee.numero_facture, url_pdf: factureCreee.url_pdf,
            montant_ttc: factureCreee.montant_ttc, montant_arrhes: factureCreee.montant_arrhes,
            montant_paye: factureCreee.montant_paye, montant_du: factureCreee.montant_du, devise: factureCreee.devise }
        : null
      if (factureCreee && !factureCreee.url_pdf) {
        try {
          const pdf = await _publierFactureCheckout({ db, repo: facturationRepo, hotelId, reservationId: id, facture: factureCreee, log: db.log })
          factureGeneree.url_pdf = pdf.url_pdf
        } catch (errFacture) {
          console.error('[CHECKOUT] Erreur PDF/email facture (non bloquant):', errFacture.message)
        }
      }

      // LOT-PMS-01 — facture émise → ventes + imputation arrhes (post-commit, non bloquant, idempotent)
      let comptabiliteFacture = null
      if (factureGeneree?.id) {
        comptabiliteFacture = await comptabilite.publier(db, { source: 'facture', id: factureGeneree.id, hotelId, userId: acteurId })
      }

      return {
        tache_menage: tacheMenage || null,
        facture:      factureGeneree,
        folio:        folioApres ? { id: folioApres.id, statut: folioApres.statut, solde_du: Number(folioApres.solde_total) } : null,
        comptabilite: comptabiliteFacture,
      }
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

        // LOT-PMS-02 — Folio cohérent à l'annulation : les nuitées/taxes pré-facturées à la création
        // (P5) sont neutralisées par des corrections (lignes immuables, jamais supprimées).
        // Le folio sort de l'état 'ouvert' : cloture si solde nul, en_attente s'il reste des arrhes à régler.
        const folioAnnule = await trx('folios').where({ reservation_id: id, hotel_id: hotelId }).forUpdate().first()
        if (folioAnnule && folioAnnule.statut === 'ouvert') {
          const lignesFolio = await trx('lignes_folio').where({ folio_id: folioAnnule.id, hotel_id: hotelId })
          const dejaCorrigees = new Set(lignesFolio.filter(l => l.ligne_corrigee_id).map(l => l.ligne_corrigee_id))
          for (const l of lignesFolio) {
            if (l.sens !== 'debit' || l.source_module !== 'reservation' || dejaCorrigees.has(l.id)) continue
            if (!['hebergement', 'taxe'].includes(l.type_ligne)) continue
            await facturationRepo.insererLigne({
              folio_id: folioAnnule.id, hotel_id: hotelId, type_ligne: 'correction', sens: 'credit',
              montant: l.montant_total, devise: l.devise, description: `Annulation réservation — ${l.description}`,
              reference_id: l.id, reference_type: 'folio_ligne', ligne_corrigee_id: l.id,
              source_module: 'reservation', cree_par: acteurId || null, cree_par_type: 'staff',
              metadata: { motif: 'annulation', raison: raison || null },
            }, trx)
          }
          await folioRegles.fermerAuCheckout(trx, folioAnnule.id, hotelId, acteurId)
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

// ── Facture de checkout (LOT-PMS-02) ────────────────────────────────────────
// Créée DANS la transaction du checkout. Idempotente (une facture par réservation).
// montant_ttc = ventes nettes (débits − remises − corrections) ; montant_du = solde du folio.
async function _creerFactureCheckout({ trx, repo, hotelId, reservationId, folio }) {
  const existante = await repo.trouverFactureParReservation(reservationId, hotelId, trx)
  if (existante) return existante

  const reservation = await trx('reservations').where({ id: reservationId, hotel_id: hotelId }).select('client_id').first()
  const lignes = await trx('lignes_folio').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc')
  const v = folioRegles.ventilerLignes(lignes)

  const facture = await repo.creerFacture({
    hotel_id:       hotelId,
    reservation_id: reservationId,
    client_id:      reservation?.client_id || null,
    montant_ht:     v.ht,
    montant_taxes:  v.taxes,
    montant_ttc:    v.ttc,
    devise:         folio.devise || 'XAF',
    lignes:         lignes.map(l => ({ id: l.id, description: l.description, type: l.type_ligne, montant: l.montant_total, sens: l.sens, ligne_corrigee_id: l.ligne_corrigee_id || null })),
    statut:         'emise',
  }, trx)
  const [maj] = await trx('factures').where({ id: facture.id, hotel_id: hotelId })
    .update({ montant_arrhes: v.arrhes, montant_paye: v.paye, montant_du: v.du }).returning('*')
  return maj
}

// ── PDF + email de la facture (post-commit, non bloquant) ─────────────────────
async function _publierFactureCheckout({ db, repo, hotelId, reservationId, facture, log }) {
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
    chargerHotelFacture(db, hotelId),
  ])
  if (!reservation || !folio) throw new Error(`Données manquantes pour la facture (res=${reservationId})`)

  const [lignes, paiements, soldeResult] = await Promise.all([
    db('lignes_folio').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc'),
    db('paiements').where({ folio_id: folio.id, hotel_id: hotelId }).orderBy('cree_le', 'asc'),
    db.raw('SELECT * FROM get_solde_folio(?, ?)', [folio.id, hotelId]),
  ])

  const { cheminRelatif, filepath } = await genererFacturePDF({
    facture,
    reservation,
    hotel,
    client:    { nom: reservation.nom_client, email: reservation.email_client, telephone: reservation.telephone_client },
    lignes:    lignes.map(l => ({ ...l, montant: l.montant_total })),
    paiements,
    solde:     soldeResult.rows[0],
  })
  await repo.mettreAJourUrlPdf(facture.id, hotelId, cheminRelatif)

  // HELICONIA-READY-01 — email hors du chemin de réponse : un SMTP lent ou en échec
  // bloquait le checkout ~4 s. L'envoi reste tenté, son échec est seulement journalisé.
  envoyerFacture({
    emailDestinataire: reservation.email_client,
    nomClient:         reservation.nom_client,
    nomHotel:          hotel?.nom || 'Hôtel',
    numeroFacture:     facture.numero_facture,
    pdfPath:           filepath,
    log,
  }).catch(err => console.error('[CHECKOUT] Erreur email facture (non bloquant):', err.message))
  return { url_pdf: cheminRelatif }
}

module.exports = { createReservationsService }
