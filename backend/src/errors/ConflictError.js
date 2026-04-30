'use strict'

const { DomainError } = require('./DomainError')

// Données valides mais état du système empêche l'opération.
// Distinct de ValidationError (format) — ici c'est une règle métier.
class ConflictError extends DomainError {
  constructor(message, code, meta = {}) {
    super(message, code, 409, meta)
  }
}

module.exports = { ConflictError }
