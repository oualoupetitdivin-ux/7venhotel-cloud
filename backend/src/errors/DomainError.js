'use strict'

class DomainError extends Error {
  constructor(message, code, statusCode = 500, meta = {}) {
    super(message)
    this.name       = this.constructor.name
    this.code       = code
    this.statusCode = statusCode
    this.meta       = meta
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor)
  }
}

module.exports = { DomainError }
