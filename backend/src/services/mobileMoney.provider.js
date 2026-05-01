'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// mobileMoney.provider.js
//
// Adaptateur opérateur mobile money.
// Interface stable — la logique de réconciliation ne change pas
// quand le provider réel est branché.
//
// Retourne toujours : { statut: 'SUCCESS' | 'FAILED' | 'UNKNOWN', raw?: any }
//
// Pour intégrer MTN MoMo :
//   remplacer le corps de verifierTransaction() par l'appel HTTP réel
//   et mapper le statut de la réponse vers SUCCESS / FAILED / UNKNOWN.
//
// Variable d'environnement à ajouter en prod :
//   MOBILE_MONEY_PROVIDER=mtn|orange|mock (défaut: mock)
//   MOBILE_MONEY_API_URL=https://...
//   MOBILE_MONEY_API_KEY=...
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER = process.env.MOBILE_MONEY_PROVIDER || 'mock'

// ── Mock de simulation (dev + tests) ─────────────────────────────────────────

async function verifierTransactionMock(reference) {
  // Simule une latence réseau réaliste (Afrique : 200-800ms)
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 300) + 100))

  // Déterminisme basé sur le dernier caractère de la référence
  // Permet des tests prévisibles sans appel réseau réel
  const dernier = reference.slice(-1).toLowerCase()
  if ('abcde012'.includes(dernier)) return { statut: 'SUCCESS', raw: { mock: true } }
  if ('fghij345'.includes(dernier)) return { statut: 'FAILED',  raw: { mock: true } }
  return { statut: 'UNKNOWN', raw: { mock: true } }
}

// ── Contrat d'interface pour intégration MTN MoMo réelle ─────────────────────
// Décommenter et compléter lors de l'intégration prod

// async function verifierTransactionMtn(reference) {
//   const res = await fetch(`${process.env.MOBILE_MONEY_API_URL}/transactions/${reference}`, {
//     headers: {
//       'Authorization': `Bearer ${process.env.MOBILE_MONEY_API_KEY}`,
//       'X-Target-Environment': process.env.NODE_ENV === 'production' ? 'mtncameroon' : 'sandbox',
//     },
//     signal: AbortSignal.timeout(5000),
//   })
//   if (!res.ok) return { statut: 'UNKNOWN', raw: { http_status: res.status } }
//   const data = await res.json()
//   if (data.status === 'SUCCESSFUL') return { statut: 'SUCCESS', raw: data }
//   if (data.status === 'FAILED')     return { statut: 'FAILED',  raw: data }
//   return { statut: 'UNKNOWN', raw: data }
// }

// ── Export principal ──────────────────────────────────────────────────────────

async function verifierTransaction(reference) {
  if (!reference || typeof reference !== 'string')
    return { statut: 'UNKNOWN', raw: { raison: 'reference_invalide' } }

  try {
    switch (PROVIDER) {
      // case 'mtn':    return await verifierTransactionMtn(reference)
      // case 'orange': return await verifierTransactionOrange(reference)
      default:       return await verifierTransactionMock(reference)
    }
  } catch (err) {
    // Toute erreur réseau → UNKNOWN pour que le job skipe et réessaie
    return { statut: 'UNKNOWN', raw: { erreur: err.message } }
  }
}

module.exports = { verifierTransaction }
