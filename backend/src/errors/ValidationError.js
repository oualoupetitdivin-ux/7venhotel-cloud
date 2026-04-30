'use strict'

const { DomainError } = require('./DomainError')

// Les détails sont portés dans `this.validation` — pas `this.details`.
// Le setErrorHandler existant lit `error.validation` (ligne 380 server.js).
// Aucune modification de server.js requise.
//
// Chaque entrée : { champ: string, message: string }
class ValidationError extends DomainError {
  constructor(erreurs) {
    super('Données invalides', 'DONNEES_INVALIDES', 400)
    this.validation = erreurs
  }
}

module.exports = { ValidationError }
