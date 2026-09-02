'use strict'
const https = require('https')

const CINETPAY_API   = 'https://api-checkout.cinetpay.com/v2/payment'
const CINETPAY_CHECK = 'https://api-checkout.cinetpay.com/v2/payment/check'

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const opts = new URL(url)
    const req = https.request({
      hostname: opts.hostname, path: opts.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { resolve({ raw }) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Initier un paiement — retourne { payment_url, transaction_id, sandbox }
async function initierPaiement({ transactionId, montant, description, customerEmail, customerName, customerPhone, returnUrl, notifyUrl }) {
  const siteId = process.env.CINETPAY_SITE_ID
  const apiKey = process.env.CINETPAY_API_KEY

  if (!siteId || !apiKey) {
    // Mode sandbox/dev : retourner une URL de test
    return {
      payment_url:    `${returnUrl}?tx=${transactionId}&status=sandbox`,
      transaction_id: transactionId,
      sandbox:        true,
    }
  }

  const payload = {
    apikey:                  apiKey,
    site_id:                 siteId,
    transaction_id:          transactionId,
    amount:                  Math.round(montant),
    currency:                'XAF',
    description:             description.slice(0, 200),
    return_url:              returnUrl,
    notify_url:              notifyUrl,
    customer_email:          customerEmail    || 'client@hotel.com',
    customer_name:           customerName     || 'Client Hôtel',
    customer_phone_number:   customerPhone    || '',
    customer_address:        '',
    customer_city:           '',
    customer_country:        'CM',
    customer_state:          'CM',
    customer_zip_code:       '',
    channels:                'ALL',
    lang:                    'fr',
    metadata:                transactionId,
  }

  const result = await postJson(CINETPAY_API, payload)
  if (result?.code !== '201') {
    throw new Error(`CinetPay erreur: ${result?.message || JSON.stringify(result)}`)
  }

  return {
    payment_url:    result.data?.payment_url,
    transaction_id: transactionId,
    sandbox:        false,
  }
}

// Vérifier le statut d'un paiement (appel serveur après webhook)
async function verifierPaiement(transactionId) {
  const siteId = process.env.CINETPAY_SITE_ID
  const apiKey = process.env.CINETPAY_API_KEY

  if (!siteId || !apiKey) return { statut: 'sandbox', code: 'SANDBOX' }

  const result = await postJson(CINETPAY_CHECK, {
    apikey:         apiKey,
    site_id:        siteId,
    transaction_id: transactionId,
  })

  const statut = result?.data?.status === 'ACCEPTED' ? 'reussi'
    : result?.data?.status === 'REFUSED'   ? 'echoue'
    : 'en_attente'

  return { statut, code: result?.data?.status, data: result?.data }
}

module.exports = { initierPaiement, verifierPaiement }
