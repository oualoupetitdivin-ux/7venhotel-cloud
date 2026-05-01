'use strict'

const { createFacturationRepository } = require('../repositories/facturation.repository')
const { NotFoundError, ConflictError, DomainError } = require('../errors')
const { MOYENS_ASYNC } = require('../validators/facturation.validator')

// ─────────────────────────────────────────────────────────────────────────────
// facturation.service.js
//
// Logique métier du module facturation.
// Aucune connaissance de req, reply, ou HTTP.
//
// INVARIANTS ANTI-FRAUDE (enforced ici ET par triggers DB) :
//   1. Solde TOUJOURS via get_solde_folio(folio_id, hotel_id) — jamais JS
//   2. Aucun UPDATE/DELETE sur folio_lignes (trigger DB bloque physiquement)
//   3. Toute écriture financière dans une transaction unique
//   4. hotel_id dans chaque requête — isolation tenant
//   5. Paiement mobile money : ligne credit UNIQUEMENT à confirmation (statut=valide)
//   6. Correction = nouvelle ligne (jamais modification de l'existante)
// ─────────────────────────────────────────────────────────────────────────────

function createFacturationService({ db, cache }) {
  const repo = createFacturationRepository(db)

  // ── Clés cache ─────────────────────────────────────────────────────────────
  const cleFolio  = (hotelId, folioId)      => `folio:${hotelId}:${folioId}`
  const cleRes    = (hotelId, reservId)     => `folio:res:${hotelId}:${reservId}`
  const cleSolde  = (hotelId, folioId)      => `solde:${hotelId}:${folioId}`

  async function invaliderFolio(hotelId, folioId, reservationId) {
    await Promise.all([
      cache.del(cleFolio(hotelId, folioId)),
      cache.del(cleSolde(hotelId, folioId)),
      reservationId ? cache.del(cleRes(hotelId, reservationId)) : Promise.resolve(),
    ])
  }

  return {

    // ── GET folio par réservation ─────────────────────────────────────────
    // Retourne folio + lignes + solde calculé en SQL.
    async getFolioParReservation(reservationId, hotelId) {
      const cle = cleRes(hotelId, reservationId)
      const cached = await cache.get(cle)
      if (cached) return cached

      const folio = await repo.trouverFolioParReservation(reservationId, hotelId)
      if (!folio) throw new NotFoundError('Folio', reservationId)

      const [lignes, solde] = await Promise.all([
        repo.listerLignes(folio.id, hotelId),
        repo.getSolde(folio.id, hotelId),
      ])

      if (!solde) throw new DomainError('Calcul de solde impossible', 'SOLDE_CALCUL_ERREUR', 500)

      const resultat = { folio, lignes, solde }
      await cache.set(cle, resultat, 30)
      return resultat
    },

    // ── GET solde direct par folioId ──────────────────────────────────────
    // PATCH 3 : si folio enfant (folio_parent_id != null), retourne le solde
    // du folio master — le solde consolidé inclut toutes les charges enfants
    // et les crédits déposés sur le master.
    async getSolde(folioId, hotelId) {
      const cle = cleSolde(hotelId, folioId)
      const cached = await cache.get(cle)
      if (cached) return cached

      // Résolution : enfant → master si applicable
      const resolution = await repo.resoudreFolioCible(folioId, hotelId)
      if (!resolution) throw new NotFoundError('Folio', folioId)

      const { folio } = resolution  // folio master si groupe, sinon folio original
      const folioIdCible = folio.id

      const solde = await repo.getSolde(folioIdCible, hotelId)
      if (!solde) throw new DomainError('Calcul de solde impossible', 'SOLDE_CALCUL_ERREUR', 500)

      const resultat = {
        ...solde,
        folio_id_demande: folioId,       // folio demandé par l'appelant
        folio_id_calcule: folioIdCible,  // folio sur lequel le calcul est effectué
        est_groupe: resolution.estGroupe,
      }

      await cache.set(cle, resultat, 15)
      return resultat
    },

    // ── Ajout de ligne manuelle (staff) ───────────────────────────────────
    //
    // RÈGLES :
    //   1. Le folio doit être en statut 'ouvert' (trigger DB le vérifie aussi)
    //   2. Le sens est toujours 'debit' pour les charges manuelles
    //   3. Transaction obligatoire (écriture + log)
    async ajouterLigne(folioId, hotelId, acteurId, { typeLigne, montant, description, sourceModule }) {
      let ligne
      let reservationId  // extrait dans la transaction pour invalider le cache post-commit

      await db.transaction(async (trx) => {
        const folio = await repo.trouverFolioParId(folioId, hotelId, trx)
        if (!folio) throw new NotFoundError('Folio', folioId)

        reservationId = folio.reservation_id

        // Vérification statut — le trigger DB est le filet de sécurité final
        if (folio.statut !== 'ouvert')
          throw new ConflictError(
            `Ajout de ligne impossible : folio en statut "${folio.statut}"`,
            'FOLIO_NON_OUVERT',
            { folio_id: folioId, statut: folio.statut }
          )

        ligne = await repo.insererLigne({
          folio_id:      folioId,
          hotel_id:      hotelId,
          type_ligne:    typeLigne,
          sens:          'debit',
          montant:       parseFloat(montant),
          devise:        folio.devise,
          description:   description.trim(),
          source_module: sourceModule || 'staff',
          cree_par:      acteurId || null,
          cree_par_type: 'staff',
          metadata:      {},
        }, trx)

        await repo.insererLog({
          hotel_id:     hotelId,
          folio_id:     folioId,
          action:       'ajout_ligne',
          source_module: sourceModule || 'staff',
          montant:      parseFloat(montant),
          acteur_id:    acteurId || null,
          acteur_type:  'staff',
          payload:      { type_ligne: typeLigne, description, sens: 'debit' },
        }, trx)
      })

      await invaliderFolio(hotelId, folioId, reservationId)
      return ligne
    },

    // ── Créer un paiement ─────────────────────────────────────────────────
    //
    // CAS SYNCHRONE (especes, carte, virement, cheque) :
    //   → INSERT paiement (statut=valide) + INSERT ligne credit — même transaction
    //
    // CAS ASYNCHRONE (mobile_money) :
    //   → INSERT paiement (statut=en_attente) — PAS de ligne credit
    //   → La ligne credit est créée à la confirmation (confirmerPaiement)
    async creerPaiement(folioId, hotelId, tenantId, acteurId, {
      typePaiement, montant, devise, numeroTelephone, notes, idempotencyKey,
    }) {
      const estAsync = MOYENS_ASYNC.includes(typePaiement)
      let paiement
      let ligne = null
      let reservationId   // extrait dans la transaction pour invalider le cache post-commit
      let folioIdMaster   // PATCH 1 : folio réellement modifié (master si groupe)

      try {
        await db.transaction(async (trx) => {
          // PATCH 1+2+5 — Résolution du folio cible (groupe ou standard)
          // Si folio_parent_id != NULL → paiement sur le folio MASTER
          // Comportement inchangé si folio_parent_id = NULL
          const resolution = await repo.resoudreFolioCible(folioId, hotelId, trx)
          if (!resolution) throw new NotFoundError('Folio', folioId)

          const { folio, estGroupe, folioEnfantId } = resolution
          const folioIdCible = folio.id  // master si groupe, original sinon
          folioIdMaster = folioIdCible   // PATCH 1 : exposé hors transaction pour invalidation

          reservationId = folio.reservation_id

          // Folio cible doit être ouvert ou en_attente pour recevoir un paiement
          if (!['ouvert', 'en_attente'].includes(folio.statut))
            throw new ConflictError(
              `Paiement impossible : folio ${estGroupe ? 'master ' : ''}en statut "${folio.statut}"`,
              'FOLIO_NON_PAYABLE',
              { folio_id: folioIdCible, folio_enfant_id: folioEnfantId, statut: folio.statut }
            )

          const montantFloat = parseFloat(montant)

          // PATCH 2 — Rejet si devise incompatible avec le folio cible
          if (devise && devise !== folio.devise)
            throw new DomainError(
              'Devise incompatible avec le folio',
              'DEVISE_INCOMPATIBLE',
              { folio_devise: folio.devise, paiement_devise: devise }
            )

          // INSERT paiement — toujours sur le folio master
          paiement = await repo.creerPaiement({
            folio_id:         folioIdCible,
            hotel_id:         hotelId,
            tenant_id:        tenantId,
            type_paiement:    typePaiement,
            statut:           estAsync ? 'en_attente' : 'valide',
            montant:          montantFloat,
            devise:           devise || folio.devise,
            numero_telephone: numeroTelephone || null,
            notes:            notes
              ? `${notes}${estGroupe ? ` [groupe, enfant: ${folioEnfantId}]` : ''}`
              : estGroupe ? `Paiement groupe — folio enfant: ${folioEnfantId}` : null,
            idempotency_key:  idempotencyKey || null,
            traite_par:       acteurId || null,
            source_module:    'staff',
          }, trx)

          // CAS SYNCHRONE : INSERT ligne credit sur le folio master
          if (!estAsync) {
            ligne = await repo.insererLigne({
              folio_id:      folioIdCible,
              hotel_id:      hotelId,
              type_ligne:    'paiement',
              sens:          'credit',
              montant:       montantFloat,
              devise:        devise || folio.devise,
              description:   `Paiement ${typePaiement} — réf. ${paiement.id.slice(0, 8)}${estGroupe ? ' (groupe)' : ''}`,
              reference_id:  paiement.id,
              reference_type: 'paiement',
              source_module: 'staff',
              cree_par:      acteurId || null,
              cree_par_type: 'staff',
              metadata:      {
                type_paiement: typePaiement,
                est_groupe:    estGroupe,
                folio_enfant_id: folioEnfantId,
              },
            }, trx)

            await repo.confirmerPaiement(paiement.id, hotelId, acteurId, ligne.id, null, trx)
          }

          const solde = await repo.getSolde(folioIdCible, hotelId, trx)
          await repo.insererLog({
            hotel_id:      hotelId,
            folio_id:      folioIdCible,
            paiement_id:   paiement.id,
            action:        estAsync ? 'paiement_initie' : 'paiement_confirme',
            source_module: 'staff',
            montant:       montantFloat,
            solde_apres:   solde?.solde_du ?? null,
            acteur_id:     acteurId || null,
            acteur_type:   'staff',
            payload: {
              type_paiement:   typePaiement,
              est_async:       estAsync,
              est_groupe:      estGroupe,
              folio_enfant_id: folioEnfantId,
              ligne_id:        ligne?.id ?? null,
            },
          }, trx)
        })
      } catch (err) {
        if (err.code === '23505')
          throw new ConflictError(
            'Ce paiement a déjà été enregistré',
            'PAIEMENT_DOUBLON',
            { folio_id: folioId }
          )
        throw err
      }

      // PATCH 1 : invalider le folio master (et non l'enfant) si paiement groupe
      const folioIdAInvalider = folioIdMaster
      await invaliderFolio(hotelId, folioIdAInvalider, reservationId)
      return { paiement, ligne }
    },
    //
    // RÈGLES :
    //   1. Le paiement doit exister et être en statut 'en_attente'
    //   2. La reference_externe doit être unique (anti-doublon webhook)
    //   3. INSERT ligne credit + UPDATE paiement dans la même transaction
    //   4. IDEMPOTENT : si reference_externe déjà connue → retourne sans erreur
    async confirmerPaiement(paiementId, hotelId, acteurId, referenceExterne) {
      let paiement
      let ligne
      let folioReservationId  // extrait dans la transaction pour invalider le cache post-commit

      // NOTE:
      // Ce check est une optimisation.
      // La vraie protection contre les doublons est la contrainte UNIQUE en base (23505).
      // En cas de race condition, le catch 23505 assure l'idempotence.
      const dejaConnu = await repo.referenceExterneExiste(referenceExterne, hotelId)
      if (dejaConnu) {
        // Webhook reçu deux fois — réponse idempotente, pas d'erreur
        paiement = await repo.trouverPaiementParId(paiementId, hotelId)
        return { paiement, ligne: null, idempotent: true }
      }

      try {
        await db.transaction(async (trx) => {
          paiement = await repo.trouverPaiementParId(paiementId, hotelId, trx)
          if (!paiement) throw new NotFoundError('Paiement', paiementId)

          if (paiement.statut !== 'en_attente')
            throw new ConflictError(
              `Confirmation impossible : paiement en statut "${paiement.statut}"`,
              'PAIEMENT_DEJA_TRAITE',
              { paiement_id: paiementId, statut: paiement.statut }
            )

          const folio = await repo.trouverFolioParId(paiement.folio_id, hotelId, trx)
          if (!folio) throw new NotFoundError('Folio', paiement.folio_id)

          folioReservationId = folio.reservation_id

          // INSERT ligne credit — autorisée sur folio 'en_attente' (trigger DB)
          ligne = await repo.insererLigne({
            folio_id:      paiement.folio_id,
            hotel_id:      hotelId,
            type_ligne:    'paiement',
            sens:          'credit',
            montant:       parseFloat(paiement.montant),
            devise:        paiement.devise,
            description:   `Paiement mobile money confirmé — réf. ${referenceExterne}`,
            reference_id:  paiementId,
            reference_type: 'paiement',
            source_module: 'integration_mobile_money',
            cree_par:      acteurId || null,
            cree_par_type: acteurId ? 'staff' : 'systeme',
            metadata:      { reference_externe: referenceExterne },
          }, trx)

          // UPDATE paiement → valide + lier reference_externe et folio_ligne_id
          paiement = await repo.confirmerPaiement(
            paiementId, hotelId, acteurId, ligne.id, referenceExterne, trx
          )

          const solde = await repo.getSolde(paiement.folio_id, hotelId, trx)
          await repo.insererLog({
            hotel_id:      hotelId,
            folio_id:      paiement.folio_id,
            paiement_id:   paiementId,
            action:        'paiement_confirme',
            source_module: 'integration_mobile_money',
            montant:       parseFloat(paiement.montant),
            solde_apres:   solde?.solde_du ?? null,
            acteur_id:     acteurId || null,
            acteur_type:   acteurId ? 'staff' : 'systeme',
            payload:       { reference_externe: referenceExterne, ligne_id: ligne.id },
          }, trx)
        })
      } catch (err) {
        // Race condition : deux webhooks simultanés passent le check idempotence
        if (err.code === '23505') {
          paiement = await repo.trouverPaiementParId(paiementId, hotelId)
          return { paiement, ligne: null, idempotent: true }
        }
        throw err
      }

      await invaliderFolio(hotelId, paiement.folio_id, folioReservationId)
      return { paiement, ligne, idempotent: false }
    },

    // ── Corriger une ligne ────────────────────────────────────────────────
    //
    // Une correction = nouvelle ligne credit (écriture inverse).
    // La ligne originale reste IMMUABLE — le trigger DB l'interdit.
    // Un seul index UNIQUE(ligne_corrigee_id) garantit qu'on ne corrige pas deux fois.
    async corrigerLigne(ligneId, hotelId, acteurId, motif) {
      let lignecorrection
      let folioReservationId  // extrait dans la transaction pour invalider le cache post-commit

      await db.transaction(async (trx) => {
        // Trouver la ligne à corriger (JOIN sur folios pour vérif hotel_id)
        const ligneOriginale = await repo.trouverLigneParId(ligneId, hotelId, trx)

        if (!ligneOriginale) throw new NotFoundError('Ligne de folio', ligneId)

        // La ligne doit appartenir à un folio de cet hôtel (déjà vérifié par le JOIN)
        if (ligneOriginale.folio_hotel_id !== hotelId)
          throw new NotFoundError('Ligne de folio', ligneId)

        // Impossible de corriger une correction (évite les boucles)
        if (ligneOriginale.type_ligne === 'correction')
          throw new ConflictError(
            'Impossible de corriger une ligne de type correction',
            'CORRECTION_DE_CORRECTION',
            { ligne_id: ligneId }
          )

        // Vérifier que le folio est ouvert (trigger DB est le filet final)
        const folio = await repo.trouverFolioParId(ligneOriginale.folio_id, hotelId, trx)
        if (folio.statut !== 'ouvert')
          throw new ConflictError(
            `Correction impossible : folio en statut "${folio.statut}"`,
            'FOLIO_NON_OUVERT',
            { folio_id: ligneOriginale.folio_id }
          )

        folioReservationId = folio.reservation_id

        // Écriture inverse : si la ligne était un debit, la correction est un credit
        const sensCorrection = ligneOriginale.sens === 'debit' ? 'credit' : 'debit'

        lignecorrection = await repo.insererLigne({
          folio_id:         ligneOriginale.folio_id,
          hotel_id:         hotelId,
          type_ligne:       'correction',
          sens:             sensCorrection,
          montant:          ligneOriginale.montant,
          devise:           ligneOriginale.devise,
          description:      `Correction — ${motif.trim()}`,
          reference_id:     ligneId,
          reference_type:   'folio_ligne',
          ligne_corrigee_id: ligneId,
          source_module:    'staff',
          cree_par:         acteurId || null,
          cree_par_type:    'staff',
          metadata:         {
            ligne_corrigee: ligneId,
            motif,
            type_original: ligneOriginale.type_ligne,
            sens_original: ligneOriginale.sens,
          },
        }, trx)

        // PATCH 3 : ligne_correction_id renseigné avec l'id réel de la ligne créée
        await repo.insererLog({
          hotel_id:     hotelId,
          folio_id:     ligneOriginale.folio_id,
          action:       'correction_ligne',
          source_module: 'staff',
          montant:      ligneOriginale.montant,
          acteur_id:    acteurId || null,
          acteur_type:  'staff',
          payload:      {
            ligne_id_originale:  ligneId,
            ligne_correction_id: lignecorrection.id,
            motif,
          },
        }, trx)
      })

      await invaliderFolio(hotelId, lignecorrection.folio_id, folioReservationId)
      return lignecorrection
    },

  }
}

module.exports = { createFacturationService }
