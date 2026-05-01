'use strict'

const { verifierTransaction }      = require('./mobileMoney.provider')
const { createFacturationService } = require('./facturation.service')
const { createFacturationRepository } = require('../repositories/facturation.repository')

// ─────────────────────────────────────────────────────────────────────────────
// reconciliation.service.js
//
// Réconcilie les paiements mobile money restés en statut 'en_attente'.
// Appelé par le job cron (reconciliation.job.js) toutes les 30 minutes.
//
// INVARIANTS :
//   - hotel_id TOUJOURS lu depuis la DB — jamais depuis l'API opérateur
//   - confirmerPaiement est idempotent — pas de double crédit possible
//   - UPDATE statut='echec' uniquement si paiement.statut === 'en_attente'
//   - toutes les écritures dans transactions (via confirmerPaiement)
//   - une seule instance active à la fois (géré dans le job)
// ─────────────────────────────────────────────────────────────────────────────

async function reconcilerPaiements({ db, logger, limit = 50 }) {
  const repo    = createFacturationRepository(db)
  const service = createFacturationService({ db, cache: _noopCache() })

  const statsTotal = { total: 0, fixes: 0, echecs: 0, ignores: 0, erreurs: 0 }
  let page = 0

  // PATCH batch — boucle jusqu'à épuisement des paiements en_attente
  // Chaque itération traite `limit` paiements, recommence tant qu'il en reste
  while (true) {
    page++

    const paiementsEnAttente = await db('paiements')
      .where({ statut: 'en_attente' })
      .whereNotNull('reference_externe')
      .where('cree_le', '<', db.raw("NOW() - INTERVAL '10 minutes'"))
      .orderBy('cree_le', 'asc')
      .limit(limit)
      .select('id', 'hotel_id', 'reference_externe', 'montant', 'devise', 'statut')

    if (paiementsEnAttente.length === 0) {
      if (page === 1) {
        logger.debug({ event: 'reconciliation', result: 'nothing_to_do' },
          'Réconciliation — aucun paiement en attente')
      }
      break
    }

    logger.info({ event: 'reconciliation', page, nb_paiements: paiementsEnAttente.length },
      'Réconciliation — batch démarré')

    const stats = { total: paiementsEnAttente.length, fixes: 0, echecs: 0, ignores: 0, erreurs: 0 }

  for (const paiement of paiementsEnAttente) {
    const { id, hotel_id, reference_externe } = paiement

    try {
      // PATCH 2 — Appel API opérateur via adaptateur avec timeout 3000ms
      const { statut: statutOperateur } = await Promise.race([
        verifierTransaction(reference_externe),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), 3000)
        ),
      ])

      if (statutOperateur === 'SUCCESS') {
        // PATCH 5 — hotel_id depuis DB, confirmerPaiement idempotent
        const resultat = await service.confirmerPaiement(id, hotel_id, null, reference_externe)

        // PATCH 4 — Log structuré
        logger.info({
          event:             'reconciliation',
          paiement_id:       id,
          reference_externe,
          hotel_id,
          result:            resultat.idempotent ? 'ignored' : 'fixed',
        }, resultat.idempotent
          ? 'Réconciliation — déjà confirmé (idempotent)'
          : 'Réconciliation — paiement confirmé avec succès')

        if (!resultat.idempotent) stats.fixes++
        else stats.ignores++

      } else if (statutOperateur === 'FAILED') {
        // UPDATE direct — pas de transaction nécessaire pour un simple statut echec
        // Re-vérifier statut en DB pour éviter d'écraser une confirmation concurrent
        const paiementActuel = await repo.trouverPaiementParId(id, hotel_id)
        if (paiementActuel && paiementActuel.statut === 'en_attente') {
          await db('paiements')
            .where({ id, hotel_id })
            .update({ statut: 'echec', traite_le: db.fn.now() })

          // Log financier — INSERT ONLY (immutable audit trail)
          await db('logs_financiers').insert({
            hotel_id,
            folio_id:     paiementActuel.folio_id || null,
            paiement_id:  id,
            action:       'paiement_echec_reconciliation',
            source_module: 'reconciliation',
            montant:      paiementActuel.montant,
            acteur_type:  'systeme',
            payload:      JSON.stringify({ reference_externe, raison: 'operateur_FAILED' }),
            horodatage:   db.fn.now(),
          })

          logger.info({
            event:             'reconciliation',
            paiement_id:       id,
            reference_externe,
            hotel_id,
            result:            'echec',
          }, 'Réconciliation — paiement marqué échoué')
          stats.echecs++
        } else {
          // Statut changé entre la sélection et la mise à jour — skip
          logger.info({ event: 'reconciliation', paiement_id: id, reference_externe,
            hotel_id, result: 'ignored', raison: 'statut_change' },
            'Réconciliation — statut modifié entre temps, ignoré')
          stats.ignores++
        }

      } else {
        // UNKNOWN — API indisponible ou transaction en cours côté opérateur
        logger.warn({
          event:             'reconciliation',
          paiement_id:       id,
          reference_externe,
          hotel_id,
          result:            'ignored',
          raison:            'statut_inconnu_operateur',
        }, 'Réconciliation — statut opérateur inconnu, paiement ignoré')
        stats.ignores++
      }

    } catch (err) {
      logger.error({
        event:             'reconciliation',
        paiement_id:       id,
        reference_externe,
        hotel_id,
        result:            'error',
        err:               { message: err.message, code: err.code },
      }, 'Réconciliation — erreur inattendue sur ce paiement')
      stats.erreurs++
      // Continue sur le paiement suivant — ne pas arrêter la boucle
    }
  }

    logger.info({ event: 'reconciliation', page, ...stats }, 'Réconciliation — batch terminé')

    statsTotal.total   += stats.total
    statsTotal.fixes   += stats.fixes
    statsTotal.echecs  += stats.echecs
    statsTotal.ignores += stats.ignores
    statsTotal.erreurs += stats.erreurs

    // Si le batch est inférieur à la limite, plus rien à traiter
    if (paiementsEnAttente.length < limit) break
  }

  if (statsTotal.total > 0)
    logger.info({ event: 'reconciliation', pages: page, ...statsTotal }, 'Réconciliation terminée')

  return statsTotal
}

// ── Cache no-op pour le service en contexte job ───────────────────────────────
// Le job n'a pas de cache Fastify — on passe un cache vide pour ne pas
// invalider de cache applicatif depuis un contexte non-HTTP.
function _noopCache() {
  return {
    get: async ()        => null,
    set: async ()        => null,
    del: async ()        => null,
    delPattern: async () => null,
  }
}

module.exports = { reconcilerPaiements }
