'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// jetonClient.js — jetons de l'espace client (LOT-GUEST-01)
//
// Les jetons client étaient signés avec le secret JWT du STAFF et sans jti :
// fastify.authentifier les acceptait comme « jetons legacy » et contexteHotel
// les laissait passer (tenant_id / hotel_id présents dans le payload). Un client
// accédait ainsi aux routes staff protégées par authentifier + contexteHotel
// (inbox portail, chambres, IA, notifications…).
//
// Correction dans le périmètre Guest, sans toucher l'authentification staff :
// les jetons client sont signés avec une CLÉ DISTINCTE — le jwtVerify staff les
// rejette donc structurellement.
//   JWT_CLIENT_SECRET si défini, sinon clé dérivée HMAC-SHA256(JWT_SECRET, 'espace-client').
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')

function cleClient() {
  if (process.env.JWT_CLIENT_SECRET) return process.env.JWT_CLIENT_SECRET
  const base = process.env.JWT_SECRET
  if (!base) throw new Error('JWT_SECRET absent — impossible de dériver la clé client')
  return crypto.createHmac('sha256', base).update('espace-client').digest('hex')
}

function signerJetonClient(fastify, client, hotel) {
  return fastify.jwt.sign(
    { id: client.id, email: client.email, prenom: client.prenom, nom: client.nom,
      type: 'client', hotel_id: hotel.id, tenant_id: hotel.tenant_id },
    { key: cleClient(), expiresIn: process.env.JWT_CLIENT_EXPIRES_IN || '24h' }
  )
}

// Retourne le payload ou lève une erreur (signature, expiration, type)
function verifierJetonClient(fastify, jeton) {
  const payload = fastify.jwt.verify(jeton, { key: cleClient() })
  if (payload.type !== 'client' || !payload.id || !payload.hotel_id || !payload.tenant_id) {
    throw new Error('JETON_CLIENT_INVALIDE')
  }
  return payload
}

module.exports = { signerJetonClient, verifierJetonClient }
