'use strict'

const { reconcilerPaiements } = require('../services/reconciliation.service')

// ─────────────────────────────────────────────────────────────────────────────
// reconciliation.job.js
//
// Job cron : réconciliation mobile money toutes les 30 minutes.
//
// GARANTIE ANTI-OVERLAP :
//   Le flag `enCours` empêche deux cycles simultanés dans la même instance.
//   Si un cycle dure plus de 30 minutes (cas extrême), le suivant est skipé.
//
// Intégration dans server.js :
//   const job = require('./jobs/reconciliation.job')
//   job.demarrer({ db: fastify.db, logger: fastify.log })
//   // À l'arrêt : job.arreter()
// ─────────────────────────────────────────────────────────────────────────────

const INTERVALLE_MS = 30 * 60 * 1000  // 30 minutes

let _timer   = null
let _enCours = false

async function _executer({ db, logger }) {
  // PATCH 3 — Anti-overlap : skip si un cycle est déjà actif
  if (_enCours) {
    logger.warn({ event: 'reconciliation_job', result: 'SKIP_IN_PROGRESS' },
      'Job réconciliation déjà en cours — cycle suivant ignoré')
    return
  }

  _enCours = true
  const debut = Date.now()

  try {
    const stats = await reconcilerPaiements({ db, logger })
    logger.info({
      event:    'reconciliation_job',
      result:   'done',
      duree_ms: Date.now() - debut,
      ...stats,
    }, 'Cycle réconciliation terminé')
  } catch (err) {
    logger.error({
      event:    'reconciliation_job',
      result:   'error',
      duree_ms: Date.now() - debut,
      err:      { message: err.message },
    }, 'Erreur critique dans le job de réconciliation')
  } finally {
    _enCours = false
  }
}

function demarrer({ db, logger }) {
  if (_timer) {
    logger.warn({ event: 'reconciliation_job' }, 'Job déjà démarré — appel ignoré')
    return
  }

  logger.info({ event: 'reconciliation_job', intervalle_ms: INTERVALLE_MS },
    'Job réconciliation mobile money démarré')

  // Premier cycle au démarrage — décalé de 60s pour laisser le serveur s'initialiser
  const premierCycle = setTimeout(() => _executer({ db, logger }), 60 * 1000)

  _timer = setInterval(() => _executer({ db, logger }), INTERVALLE_MS)

  // Nettoyer le timer du premier cycle si arrêt avant son exécution
  _timer._premierCycle = premierCycle
}

function arreter(logger) {
  if (_timer) {
    clearInterval(_timer)
    if (_timer._premierCycle) clearTimeout(_timer._premierCycle)
    _timer = null
    if (logger) logger.info({ event: 'reconciliation_job' }, 'Job réconciliation arrêté')
  }
}

module.exports = { demarrer, arreter }
