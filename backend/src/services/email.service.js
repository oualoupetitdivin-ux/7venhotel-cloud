'use strict'

const nodemailer = require('nodemailer')
const fs         = require('fs/promises')
const path       = require('path')

// ─────────────────────────────────────────────────────────────────────────────
// email.service.js
//
// Service d'envoi email réutilisable.
// Si aucune config SMTP n'est définie dans .env → log clair, échec propre.
// Ne bloque JAMAIS une opération métier (checkout, etc.).
//
// Variables .env requises pour activation :
//   SMTP_HOST      — ex. smtp.gmail.com
//   SMTP_PORT      — ex. 587
//   SMTP_USER      — ex. hotel@gmail.com
//   SMTP_PASS      — mot de passe ou app password
//   SMTP_FROM      — ex. "Hôtel Heliconia <hotel@heliconia.com>"
//
// ÉTAT ACTUEL : aucune de ces variables n'est définie dans .env.
// L'email ne part pas. Le code est prêt — configurer .env pour activer.
// ─────────────────────────────────────────────────────────────────────────────

function smtpDisponible() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function creerTransporteur() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth:   {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

/**
 * envoyerFacture — Envoie la facture PDF par email au client.
 *
 * @param {object} opts
 * @param {string}  opts.emailDestinataire
 * @param {string}  opts.nomClient
 * @param {string}  opts.nomHotel
 * @param {string}  opts.numeroFacture
 * @param {string}  opts.pdfPath        — chemin absolu vers le PDF
 * @param {object}  [opts.log]          — logger Fastify (optionnel)
 *
 * @returns {{ envoye: boolean, raison?: string }}
 */
async function envoyerFacture({ emailDestinataire, nomClient, nomHotel, numeroFacture, pdfPath, log }) {
  const logger = log || console

  if (!smtpDisponible()) {
    logger.warn({ numeroFacture },
      '[EMAIL] SMTP non configuré (SMTP_HOST/SMTP_USER/SMTP_PASS manquants) — email non envoyé.')
    return { envoye: false, raison: 'SMTP_NON_CONFIGURE' }
  }

  if (!emailDestinataire) {
    logger.warn({ numeroFacture }, '[EMAIL] Aucune adresse email client — email non envoyé.')
    return { envoye: false, raison: 'EMAIL_ABSENT' }
  }

  try {
    const pdfExists = await fs.access(pdfPath).then(() => true).catch(() => false)
    if (!pdfExists) {
      logger.warn({ pdfPath }, '[EMAIL] PDF introuvable — email non envoyé.')
      return { envoye: false, raison: 'PDF_INTROUVABLE' }
    }

    const transport = creerTransporteur()

    await transport.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      to:      emailDestinataire,
      subject: `Votre facture ${numeroFacture} — ${nomHotel}`,
      text: [
        `Bonjour ${nomClient || ''},`,
        '',
        `Veuillez trouver ci-joint votre facture ${numeroFacture} pour votre séjour à ${nomHotel}.`,
        '',
        `Merci de votre confiance et à bientôt.`,
        '',
        `— L'équipe de ${nomHotel}`,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
          <div style="background:#1a3cb8;padding:24px 32px;border-radius:8px 8px 0 0">
            <h1 style="color:white;margin:0;font-size:20px">${nomHotel}</h1>
          </div>
          <div style="background:#f8f9fa;padding:24px 32px">
            <p>Bonjour <strong>${nomClient || ''}</strong>,</p>
            <p>Votre facture <strong>${numeroFacture}</strong> est disponible en pièce jointe.</p>
            <p>Merci de votre confiance et à bientôt.</p>
          </div>
          <div style="padding:12px 32px;font-size:11px;color:#999">
            Généré par 7venHotel Cloud PMS
          </div>
        </div>
      `,
      attachments: [{
        filename: `${numeroFacture}.pdf`,
        path:     pdfPath,
        contentType: 'application/pdf',
      }],
    })

    logger.info({ emailDestinataire, numeroFacture }, '[EMAIL] Facture envoyée.')
    return { envoye: true }
  } catch (err) {
    logger.error({ err: err.message, emailDestinataire, numeroFacture }, '[EMAIL] Échec envoi.')
    return { envoye: false, raison: 'ERREUR_SMTP', detail: err.message }
  }
}

module.exports = { envoyerFacture, smtpDisponible }
