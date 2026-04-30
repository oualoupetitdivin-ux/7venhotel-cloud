'use strict'

const { DomainError } = require('./DomainError')

// Utilisé pour : ressource absente OU appartenant à un autre tenant.
// Le 404 masque l'existence cross-tenant — jamais de 403 pour ce cas.
class NotFoundError extends DomainError {
  constructor(ressource, id = null) {
    const code = ressource.toUpperCase().replace(/\s+/g, '_') + '_INTROUVABLE'
    super(`${ressource} introuvable`, code, 404, id ? { id } : {})
  }
}

module.exports = { NotFoundError }
