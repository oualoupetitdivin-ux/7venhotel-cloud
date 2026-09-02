'use strict'

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')
const path = require('path')
const fs   = require('fs/promises')

const FACTURES_DIR = path.join(__dirname, '../../../uploads/factures')

// ─────────────────────────────────────────────────────────────────────────────
// pdf.service.js
//
// Génère un PDF de facture hôtelière avec pdf-lib.
// Stocke le PDF dans uploads/factures/ et retourne le chemin relatif.
// Aucun accès DB — les données sont passées en paramètre.
// ─────────────────────────────────────────────────────────────────────────────

function fmt(montant, devise) {
  if (montant == null) return '—'
  const n = Number(montant)
  if (isNaN(n)) return '—'
  // Formatage manuel — évite   (espace fine insécable) produit par toLocaleString('fr-FR')
  // que StandardFonts (WinAnsi) de pdf-lib ne peut pas encoder.
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + s + ' ' + (devise || 'XAF')
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return String(iso) }
}

// Dessine du texte avec retour à la ligne manuel (pdf-lib ne wrap pas)
function drawText(page, font, text, { x, y, size = 9, color = rgb(0.2, 0.2, 0.2), maxWidth, lineHeight }) {
  if (!text) return y

  if (!maxWidth) {
    page.drawText(String(text), { x, y, size, font, color })
    return y
  }

  const words = String(text).split(' ')
  let line = ''
  let curY = y

  for (const word of words) {
    const test = line ? line + ' ' + word : word
    const w    = font.widthOfTextAtSize(test, size)
    if (w > maxWidth && line) {
      page.drawText(line, { x, y: curY, size, font, color })
      curY -= lineHeight
      line = word
    } else {
      line = test
    }
  }
  if (line) {
    page.drawText(line, { x, y: curY, size, font, color })
    curY -= lineHeight
  }
  return curY
}

/**
 * genererFacturePDF(params) → { cheminRelatif: string }
 *
 * @param {object} params
 * @param {object} params.facture        — enregistrement factures
 * @param {object} params.reservation    — réservation (dates, num, source)
 * @param {object} params.hotel          — hôtel (nom, adresse)
 * @param {object} params.client         — client (nom, email, telephone)
 * @param {Array}  params.lignes         — lignes du folio
 * @param {Array}  params.paiements      — paiements validés
 * @param {object} params.solde          — { total_debits, total_credits, solde_du }
 */
async function genererFacturePDF({
  facture,
  reservation,
  hotel,
  client,
  lignes   = [],
  paiements= [],
  solde,
}) {
  await fs.mkdir(FACTURES_DIR, { recursive: true })

  const doc   = await PDFDocument.create()
  const fontR = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)

  const pageW = 595
  const pageH = 842
  const ML    = 50   // margin left
  const MR    = 545  // margin right

  const gray1   = rgb(0.35, 0.35, 0.35)
  const gray2   = rgb(0.6,  0.6,  0.6)
  const blue    = rgb(0.12, 0.35, 0.75)
  const black   = rgb(0,    0,    0)
  const red     = rgb(0.80, 0.10, 0.10)
  const green   = rgb(0.10, 0.60, 0.25)
  const white   = rgb(1,    1,    1)
  const greenBg = rgb(0.95, 0.98, 0.95)  // fond léger pour lignes paiement

  const devise   = facture.devise || 'XAF'
  const hotelNom = hotel?.nom || 'Hôtel'

  // Toutes les pages créées — nécessaire pour la numérotation finale
  const allPages = []

  // Page courante (let pour permettre le changement de page)
  let page = doc.addPage([pageW, pageH])
  allPages.push(page)
  let y = pageH - 45

  // ── En-tête première page — bande bleue ──────────────────────────────────
  page.drawRectangle({ x: 0, y: pageH - 85, width: pageW, height: 85, color: blue })

  page.drawText('FACTURE', { x: ML, y: pageH - 35, size: 22, font: fontB, color: white })
  page.drawText(facture.numero_facture || '—', { x: ML, y: pageH - 55, size: 12, font: fontR, color: rgb(0.8, 0.9, 1) })
  page.drawText(`Date : ${fmtDate(facture.date_emission)}`, { x: ML, y: pageH - 70, size: 9, font: fontR, color: rgb(0.8, 0.9, 1) })

  const hotelW = fontB.widthOfTextAtSize(hotelNom, 13)
  page.drawText(hotelNom, { x: MR - hotelW, y: pageH - 35, size: 13, font: fontB, color: white })
  if (hotel?.adresse) {
    const addrW = fontR.widthOfTextAtSize(hotel.adresse, 8)
    page.drawText(hotel.adresse, { x: MR - addrW, y: pageH - 50, size: 8, font: fontR, color: rgb(0.8, 0.9, 1) })
  }
  if (hotel?.email) {
    const emlW = fontR.widthOfTextAtSize(hotel.email, 8)
    page.drawText(hotel.email, { x: MR - emlW, y: pageH - 63, size: 8, font: fontR, color: rgb(0.8, 0.9, 1) })
  }

  y = pageH - 105

  // ── Blocs infos client / réservation ─────────────────────────────────────
  // Client (gauche)
  page.drawText('FACTURÉ À', { x: ML, y, size: 8, font: fontB, color: gray2 })
  y -= 14
  if (client?.nom) {
    page.drawText(client.nom, { x: ML, y, size: 10, font: fontB, color: black })
    y -= 13
  }
  if (client?.email) {
    page.drawText(client.email, { x: ML, y, size: 9, font: fontR, color: gray1 })
    y -= 12
  }
  if (client?.telephone) {
    page.drawText(client.telephone, { x: ML, y, size: 9, font: fontR, color: gray1 })
    y -= 12
  }

  // Réservation (droite)
  const colR = 340
  let yR = pageH - 105
  page.drawText('RÉSERVATION', { x: colR, y: yR, size: 8, font: fontB, color: gray2 })
  yR -= 14

  const infoRes = [
    ['N°',       reservation?.numero_reservation || '—'],
    ['Arrivée',  fmtDate(reservation?.date_arrivee)],
    ['Départ',   fmtDate(reservation?.date_depart)],
    ['Nuits',    String(reservation?.nombre_nuits || '—')],
  ]
  for (const [label, val] of infoRes) {
    page.drawText(label, { x: colR,       y: yR, size: 9, font: fontR, color: gray2 })
    page.drawText(val,   { x: colR + 60,  y: yR, size: 9, font: fontB, color: black })
    yR -= 13
  }

  y = Math.min(y, yR) - 20

  // ── Ligne de séparation ───────────────────────────────────────────────────
  page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
  y -= 15

  // ── Helpers multi-page ────────────────────────────────────────────────────

  // Dessine l'en-tête colonnes du tableau sur la page courante.
  // Modifie y via closure.
  function drawTableHeader() {
    page.drawRectangle({ x: ML, y: y - 2, width: MR - ML, height: 16, color: rgb(0.93, 0.95, 0.98) })
    page.drawText('Description', { x: ML + 4, y: y + 1, size: 8, font: fontB, color: blue })
    page.drawText('Type',        { x: 375,    y: y + 1, size: 8, font: fontB, color: blue })
    page.drawText('Montant',     { x: 480,    y: y + 1, size: 8, font: fontB, color: blue })
    y -= 18
  }

  // Passe à une nouvelle page PDF.
  // - Écrit "Suite page X..." en bas de la page courante.
  // - Crée la page, la pousse dans allPages, réinitialise page et y.
  // - Si withTableHeader=true, dessine l'en-tête tableau (pour continuer le folio).
  function startNewPage(withTableHeader = false) {
    const nextNum  = allPages.length + 1
    const suiteStr = `Suite page ${nextNum}...`
    const suiteW   = fontR.widthOfTextAtSize(suiteStr, 8)
    page.drawText(suiteStr, { x: MR - suiteW, y: 28, size: 8, font: fontR, color: gray2 })

    page = doc.addPage([pageW, pageH])
    allPages.push(page)
    y = pageH - 50

    if (withTableHeader) {
      drawTableHeader()
    }
  }

  // ── Tableau lignes folio ──────────────────────────────────────────────────
  drawTableHeader()

  if (lignes.length === 0) {
    page.drawText('Aucune ligne de folio', { x: ML + 4, y, size: 9, font: fontR, color: gray2 })
    y -= 15
  } else {
    for (const l of lignes) {
      // Débordement : passer à la page suivante avant de dessiner la ligne
      if (y < 180) {
        startNewPage(true)
      }

      // Fond alterné de ligne
      page.drawRectangle({ x: ML, y: y - 3, width: MR - ML, height: 15, color: rgb(0.98, 0.98, 0.98), opacity: 0.5 })

      // Description — 3 cas selon la longueur :
      //   ≤ 55 chars → affichage direct (taille 9)
      //   56-80 chars → wrapping sur la largeur colonne (ML+4 → x=370, ~312 px)
      //   > 80 chars  → tronqué à 52 + "..."
      const rawDesc = l.description || l.type_ligne || '—'
      const rowY    = y  // référence y pour type et montant (toujours sur la 1re ligne)

      if (rawDesc.length > 80) {
        page.drawText(rawDesc.slice(0, 52) + '...', { x: ML + 4, y: rowY, size: 9, font: fontR, color: black })
      } else if (rawDesc.length > 55) {
        drawText(page, fontR, rawDesc, { x: ML + 4, y: rowY, size: 9, color: black, maxWidth: 312, lineHeight: 15 })
      } else {
        page.drawText(rawDesc, { x: ML + 4, y: rowY, size: 9, font: fontR, color: black })
      }

      // Type (colonne centrale élargie, x=375)
      page.drawText(l.type_ligne || '—', { x: 375, y: rowY, size: 9, font: fontR, color: gray1 })

      // Montant (aligné à droite jusqu'à MR)
      const montantStr     = fmt(l.montant, devise)
      const mW             = fontR.widthOfTextAtSize(montantStr, 9)
      const couleurMontant = l.sens === 'credit' ? green : black
      page.drawText(montantStr, { x: MR - mW - 4, y: rowY, size: 9, font: fontR, color: couleurMontant })

      y -= 15  // lineHeight 15 pour meilleure lisibilité
    }
  }

  y -= 8
  page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
  y -= 15

  // ── Guard espace avant synthèse ───────────────────────────────────────────
  // Si le folio long a laissé peu de place, passer à une page dédiée au récap.
  if (y <= 200) {
    startNewPage(false)
    y -= 10  // petite marge en haut de la page récap
  }

  // ── Récapitulatif montants ────────────────────────────────────────────────
  const recapX  = 380
  const recapVX = MR - 4

  function drawRecapLine(label, valeur, bold = false, color = black) {
    const f  = bold ? fontB : fontR
    const vW = f.widthOfTextAtSize(valeur, 9)
    page.drawText(label,  { x: recapX, y, size: 9, font: fontR, color: gray1 })
    page.drawText(valeur, { x: recapVX - vW, y, size: 9, font: f, color })
    y -= 13
  }

  drawRecapLine('Total HT',    fmt(facture.montant_ht,    devise))
  drawRecapLine('Taxes',       fmt(facture.montant_taxes, devise))

  // Ligne TTC avec fond bleu
  y -= 2
  page.drawRectangle({ x: recapX - 6, y: y - 3, width: MR - recapX + 10, height: 18, color: blue })
  const ttcLabel = 'TOTAL TTC'
  const ttcVal   = fmt(facture.montant_ttc, devise)
  const ttcVW    = fontB.widthOfTextAtSize(ttcVal, 11)
  page.drawText(ttcLabel, { x: recapX, y: y + 1, size: 10, font: fontB, color: white })
  page.drawText(ttcVal,   { x: recapVX - ttcVW, y: y + 1, size: 11, font: fontB, color: white })
  y -= 20

  // Paiements — fond vert léger (greenBg) sur chaque ligne pour meilleure visibilité
  const paiementsValides = paiements.filter(p => p.statut === 'valide')
  if (paiementsValides.length > 0) {
    y -= 5
    page.drawText('PAIEMENTS REÇUS', { x: recapX, y, size: 7, font: fontB, color: gray2 })
    y -= 12
    for (const p of paiementsValides) {
      page.drawRectangle({ x: recapX - 4, y: y - 3, width: MR - recapX + 8, height: 14, color: greenBg })
      drawRecapLine(`  ${p.type_paiement || '-'} - ${fmtDate(p.cree_le)}`, `-${fmt(p.montant, devise)}`, false, green)
    }
  }

  // Solde final
  const soldeDu    = Number(solde?.solde_du ?? 0)
  y -= 4
  const soldeColor = soldeDu > 0 ? red : green
  const soldeLabel = soldeDu > 0 ? 'SOLDE RESTANT DU' : 'SOLDE ACQUITTE'
  const soldeVal   = fmt(Math.abs(soldeDu), devise)
  const soldeVW    = fontB.widthOfTextAtSize(soldeVal, 10)
  page.drawText(soldeLabel, { x: recapX, y, size: 9, font: fontB, color: soldeColor })
  page.drawText(soldeVal,   { x: recapVX - soldeVW, y, size: 10, font: fontB, color: soldeColor })
  y -= 20

  // ── Pied de page (dernière page) ─────────────────────────────────────────
  const footer = `${hotelNom} · Facture générée le ${fmtDate(new Date().toISOString())} · 7venHotel Cloud PMS`
  page.drawLine({ start: { x: ML, y: 40 }, end: { x: MR, y: 40 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) })
  page.drawText(footer, { x: ML, y: 28, size: 7, font: fontR, color: gray2 })

  // ── Numérotation "Page N / Total" centrée en bas de chaque page ──────────
  if (allPages.length > 1) {
    const total = allPages.length
    for (let i = 0; i < total; i++) {
      const pg     = allPages[i]
      const numTxt = `Page ${i + 1} / ${total}`
      const numW   = fontR.widthOfTextAtSize(numTxt, 7)
      pg.drawText(numTxt, { x: (pageW - numW) / 2, y: 15, size: 7, font: fontR, color: gray2 })
    }
  }

  // ── Sauvegarder le PDF ───────────────────────────────────────────────────
  const pdfBytes = await doc.save()
  const filename  = `facture-${facture.id}.pdf`
  const filepath  = path.join(FACTURES_DIR, filename)
  await fs.writeFile(filepath, pdfBytes)

  return { cheminRelatif: `factures/${filename}`, filepath }
}

module.exports = { genererFacturePDF, FACTURES_DIR }
