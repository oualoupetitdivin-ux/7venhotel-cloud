'use strict'

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib')
const path = require('path')
const fs   = require('fs/promises')

const FACTURES_DIR = path.join(__dirname, '../../../uploads/factures')
const RACINE       = path.join(__dirname, '../../../')

// ─────────────────────────────────────────────────────────────────────────────
// pdf.service.js
//
// Génère un PDF de facture hôtelière avec pdf-lib.
// Stocke le PDF dans uploads/factures/ et retourne le chemin relatif.
// Les montants viennent de la facture et du folio (billing certifié) : ce service
// ne recalcule aucune taxe, il met en page.
//
// HELICONIA-READY-01 — mise en page revue : logo et identité de l'hôtel
// (adresse, contacts, NIU/RCCM), taxes détaillées avec leur taux, règlements
// séparés des prestations (le paiement apparaissait deux fois), modes de
// paiement lisibles, statut acquittée / solde dû.
// ─────────────────────────────────────────────────────────────────────────────

// StandardFonts = WinAnsi : pas d'espace fine insécable (toLocaleString), formatage manuel.
function fmt(montant, devise) {
  if (montant == null) return '—'
  const n = Number(montant)
  if (isNaN(n)) return '—'
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return (n < 0 ? '-' : '') + s + ' ' + (devise || 'XAF')
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return String(iso) }
}

// Caractères hors WinAnsi (emoji, espaces spéciaux) → remplacés pour ne pas faire échouer drawText
function winAnsi(s) {
  return String(s ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x20-\x7E -ÿ–—‘’“”…€Œœ]/g, '')
}

const MODES_PAIEMENT = {
  especes: 'Espèces', carte: 'Carte bancaire', mobile_money: 'Mobile Money', virement: 'Virement',
  cheque: 'Chèque', cinetpay: 'CinetPay', avoir: 'Avoir', compte: 'Compte client',
}

const TYPES_EXCLUS_PRESTATIONS = new Set(['paiement', 'arrhes', 'taxe'])

/**
 * Identité de l'hôtel pour la facture : colonnes `hotels`, complétées par
 * parametres_supplementaires (adresse/email/niu/rccm), et taux des taxes actives.
 */
async function chargerHotelFacture(db, hotelId) {
  const [hotel, taxes] = await Promise.all([
    db('hotels AS h')
      .leftJoin('parametres_hotel AS ph', 'ph.hotel_id', 'h.id')
      .where('h.id', hotelId)
      .select('h.nom', 'h.adresse', 'h.ville', 'h.pays', 'h.telephone', 'h.email', 'h.site_web', 'h.logo_url',
        'ph.parametres_supplementaires AS ps', 'ph.tva_numero')
      .first(),
    db('taxes').where({ hotel_id: hotelId }).select('code', 'nom', 'type_taxe', 'valeur'),
  ])
  const ps = hotel?.ps || {}
  return {
    nom:       hotel?.nom || 'Hôtel',
    adresse:   hotel?.adresse || ps.adresse || null,
    ville:     [hotel?.ville, hotel?.pays].filter(v => v && v !== 'À renseigner').join(', ') || null,
    telephone: hotel?.telephone || ps.telephone || null,
    email:     hotel?.email || ps.email_contact || null,
    site_web:  hotel?.site_web || null,
    niu:       hotel?.tva_numero || ps.niu || ps.numero_contribuable || null,
    rccm:      ps.rccm || null,
    logo_url:  hotel?.logo_url || null,
    taxes,
  }
}

async function chargerLogo(doc, logoUrl) {
  if (!logoUrl || !logoUrl.startsWith('/uploads/')) return null
  try {
    const bytes = await fs.readFile(path.join(RACINE, logoUrl))
    if (bytes[0] === 0x89) return await doc.embedPng(bytes)
    if (bytes[0] === 0xFF) return await doc.embedJpg(bytes)
  } catch { /* logo absent ou illisible : facture sans logo */ }
  return null
}

/**
 * genererFacturePDF(params) → { cheminRelatif, filepath }
 *
 * @param {object} params.facture     — enregistrement factures
 * @param {object} params.reservation — réservation (dates, numéro)
 * @param {object} params.hotel       — voir chargerHotelFacture (au minimum { nom })
 * @param {object} params.client      — { nom, email, telephone }
 * @param {Array}  params.lignes      — lignes du folio ({ ...ligne, montant })
 * @param {Array}  params.paiements   — paiements du folio
 * @param {object} params.solde       — { solde_du } (get_solde_folio)
 */
async function genererFacturePDF({
  facture,
  reservation,
  hotel,
  client,
  lignes    = [],
  paiements = [],
  solde,
}) {
  await fs.mkdir(FACTURES_DIR, { recursive: true })

  const doc   = await PDFDocument.create()
  const fontR = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo  = await chargerLogo(doc, hotel?.logo_url)

  const pageW = 595, pageH = 842
  const ML = 48, MR = pageW - 48
  const encre   = rgb(0.10, 0.13, 0.18)
  const accent  = rgb(0.09, 0.27, 0.38)
  const gris    = rgb(0.42, 0.45, 0.50)
  const grisC   = rgb(0.62, 0.65, 0.69)
  const filet   = rgb(0.86, 0.88, 0.90)
  const fond    = rgb(0.965, 0.972, 0.98)
  const vert    = rgb(0.09, 0.50, 0.27)
  const rouge   = rgb(0.72, 0.13, 0.13)
  const blanc   = rgb(1, 1, 1)

  const devise   = facture.devise || 'XAF'
  const hotelNom = winAnsi(hotel?.nom || 'Hôtel')

  const pages = []
  let page = doc.addPage([pageW, pageH]); pages.push(page)
  let y

  const txt = (t, x, yy, { size = 9, font = fontR, color = encre } = {}) =>
    page.drawText(winAnsi(t), { x, y: yy, size, font, color })
  const txtD = (t, xDroite, yy, opts = {}) => {
    const f = opts.font || fontR, s = opts.size || 9
    txt(t, xDroite - f.widthOfTextAtSize(winAnsi(t), s), yy, opts)
  }
  const ligneH = (yy, x1 = ML, x2 = MR, couleur = filet) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.6, color: couleur })
  const tronquer = (t, f, s, largeur) => {
    let v = winAnsi(t)
    if (f.widthOfTextAtSize(v, s) <= largeur) return v
    while (v.length > 1 && f.widthOfTextAtSize(v + '…', s) > largeur) v = v.slice(0, -1)
    return v + '…'
  }

  // ── En-tête : identité hôtel (gauche) / facture (droite) ─────────────────
  let yG = pageH - 48
  if (logo) {
    const k = Math.min(130 / logo.width, 56 / logo.height, 1)
    const w = logo.width * k, h = logo.height * k
    page.drawImage(logo, { x: ML, y: yG - h, width: w, height: h })
    yG -= h + 12
    txt(hotelNom, ML, yG, { size: 11, font: fontB })
  } else {
    yG -= 14
    txt(hotelNom, ML, yG, { size: 16, font: fontB })
  }
  yG -= 13
  for (const l of [
    hotel?.adresse, hotel?.ville,
    [hotel?.telephone && `Tél. ${hotel.telephone}`, hotel?.email].filter(Boolean).join('  ·  '),
    [hotel?.niu && `NIU ${hotel.niu}`, hotel?.rccm && `RCCM ${hotel.rccm}`].filter(Boolean).join('  ·  '),
  ].filter(Boolean)) {
    txt(l, ML, yG, { size: 8.5, color: gris }); yG -= 11.5
  }

  let yD = pageH - 62
  txtD('FACTURE', MR, yD, { size: 22, font: fontB, color: accent }); yD -= 18
  txtD(facture.numero_facture || '—', MR, yD, { size: 11, font: fontB }); yD -= 14
  txtD(`Émise le ${fmtDate(facture.date_emission || facture.cree_le)}`, MR, yD, { size: 8.5, color: gris }); yD -= 18

  const soldeDu   = Number(solde?.solde_du ?? facture.montant_du ?? 0)
  const acquittee = soldeDu <= 0.5
  const statutTxt = acquittee ? 'ACQUITTÉE' : 'SOLDE DÛ'
  const sw = fontB.widthOfTextAtSize(statutTxt, 8) + 16
  page.drawRectangle({ x: MR - sw, y: yD - 5, width: sw, height: 16, color: acquittee ? vert : rouge })
  txtD(statutTxt, MR - 8, yD, { size: 8, font: fontB, color: blanc })
  yD -= 14

  y = Math.min(yG, yD) - 14
  ligneH(y, ML, MR, accent)
  y -= 22

  // ── Facturé à / Séjour ──────────────────────────────────────────────────
  const colR = 320
  txt('FACTURÉ À', ML, y, { size: 7.5, font: fontB, color: grisC })
  txt('SÉJOUR', colR, y, { size: 7.5, font: fontB, color: grisC })
  let yC = y - 15, yS = y - 15
  if (client?.nom)       { txt(client.nom, ML, yC, { size: 10.5, font: fontB }); yC -= 13 }
  if (client?.email)     { txt(client.email, ML, yC, { size: 8.5, color: gris }); yC -= 11.5 }
  if (client?.telephone) { txt(client.telephone, ML, yC, { size: 8.5, color: gris }); yC -= 11.5 }
  const nuits = reservation?.nombre_nuits
  for (const [label, val] of [
    ['Réservation', reservation?.numero_reservation || '—'],
    ['Arrivée',     fmtDate(reservation?.date_arrivee)],
    ['Départ',      fmtDate(reservation?.date_depart)],
    ['Nuits',       nuits != null ? String(nuits) : '—'],
  ]) {
    txt(label, colR, yS, { size: 8.5, color: gris })
    txt(val, colR + 72, yS, { size: 8.5, font: fontB })
    yS -= 12.5
  }
  y = Math.min(yC, yS) - 18

  // ── Prestations ─────────────────────────────────────────────────────────
  const colDate = 380
  function enteteTableau() {
    page.drawRectangle({ x: ML, y: y - 6, width: MR - ML, height: 20, color: fond })
    txt('DÉSIGNATION', ML + 8, y, { size: 7.5, font: fontB, color: gris })
    txt('DATE', colDate, y, { size: 7.5, font: fontB, color: gris })
    txtD('MONTANT', MR - 8, y, { size: 7.5, font: fontB, color: gris })
    y -= 22
  }
  function nouvellePage(avecEntete) {
    page = doc.addPage([pageW, pageH]); pages.push(page)
    y = pageH - 56
    txt(`${hotelNom} — ${facture.numero_facture || ''} (suite)`, ML, y, { size: 8, color: grisC })
    y -= 24
    if (avecEntete) enteteTableau()
  }

  txt('PRESTATIONS', ML, y, { size: 7.5, font: fontB, color: grisC }); y -= 14
  enteteTableau()
  // Une correction de ligne taxe (réajustement fiscal) relève du récapitulatif des taxes, pas des prestations
  const parId = Object.fromEntries(lignes.map(l => [l.id, l]))
  const corrigeTaxe = (l) => l.type_ligne === 'correction' && parId[l.ligne_corrigee_id]?.type_ligne === 'taxe'
  const prestations = lignes.filter(l => !TYPES_EXCLUS_PRESTATIONS.has(l.type_ligne) && !corrigeTaxe(l))
  if (!prestations.length) { txt('Aucune prestation', ML + 8, y, { color: grisC }); y -= 16 }
  for (const l of prestations) {
    if (y < 210) nouvellePage(true)
    const credit = l.sens === 'credit'
    txt(tronquer(l.description || l.type_ligne || '—', fontR, 9, colDate - ML - 24), ML + 8, y)
    txt(fmtDate(l.date_service || l.cree_le), colDate, y, { size: 8.5, color: gris })
    txtD(fmt(credit ? -Number(l.montant) : l.montant, devise), MR - 8, y, { color: credit ? vert : encre })
    y -= 7; ligneH(y, ML, MR); y -= 12
  }

  // ── Récapitulatif ───────────────────────────────────────────────────────
  // Taxes regroupées par libellé ; montants du folio. Le barème affiché est celui APPLIQUÉ à la ligne
  // (metadata.valeur / nombre_nuits) : le taux courant de la table taxes peut avoir changé depuis
  // (ex. TVA 19,25 % facturée, réglage passé à 18 % ensuite). Ligne sans barème → nom seul.
  const taux = Object.fromEntries((hotel?.taxes || []).map(t => [t.code, t]))
  const groupes = new Map()
  for (const l of lignes.filter(x => x.type_ligne === 'taxe' || corrigeTaxe(x))) {
    const src = l.type_ligne === 'taxe' ? l : parId[l.ligne_corrigee_id]
    const m = src.metadata || {}
    const t = m.code && taux[m.code]
    const nom = t ? t.nom : String(src.description || 'Taxe').split(' — ')[0]
    const v = m.valeur !== undefined && m.valeur !== null ? Number(m.valeur) : null
    const nuits = Number(m.nombre_nuits) || 0
    const libelle = v === null ? nom
      : (m.type_taxe === 'pourcentage' ? `${nom} (${String(v).replace('.', ',')} %)`
        : nuits ? `${nom} (${nuits} nuit${nuits > 1 ? 's' : ''} × ${fmt(v, devise)})` : nom)
    const signe = l.sens === 'credit' ? -1 : 1
    groupes.set(libelle, (groupes.get(libelle) || 0) + signe * Number(l.montant || 0))
  }
  for (const [libelle, montant] of groupes) if (Math.round(montant * 100) === 0) groupes.delete(libelle)

  const paiementsValides = paiements.filter(p => p.statut === 'valide')
  const hauteurRecap = 120 + groupes.size * 14 + paiementsValides.length * 14
  if (y - hauteurRecap < 70) nouvellePage(false)
  y -= 8

  const rX = 330, rV = MR - 8
  const recap = (label, valeur, { gras = false, couleur = encre, taille = 9 } = {}) => {
    txt(label, rX, y, { size: taille, color: gras ? encre : gris, font: gras ? fontB : fontR })
    txtD(valeur, rV, y, { size: taille, font: gras ? fontB : fontR, color: couleur })
    y -= 15
  }
  recap('Total HT', fmt(facture.montant_ht, devise))
  for (const [libelle, montant] of groupes) recap(libelle, fmt(montant, devise))
  if (!groupes.size && Number(facture.montant_taxes)) recap('Taxes', fmt(facture.montant_taxes, devise))

  y -= 4
  page.drawRectangle({ x: rX - 10, y: y - 8, width: MR - rX + 10, height: 24, color: accent })
  txt('TOTAL TTC', rX, y, { size: 10, font: fontB, color: blanc })
  txtD(fmt(facture.montant_ttc, devise), rV, y, { size: 12, font: fontB, color: blanc })
  y -= 30

  if (Number(facture.montant_arrhes) > 0) recap('Arrhes déduites', `-${fmt(facture.montant_arrhes, devise)}`, { couleur: vert })
  for (const p of paiementsValides) {
    const ref = p.reference_externe ? ` · ${p.reference_externe}` : ''
    recap(`${MODES_PAIEMENT[p.type_paiement] || p.type_paiement || 'Paiement'} — ${fmtDate(p.cree_le)}${ref}`,
      `-${fmt(p.montant, devise)}`, { couleur: vert, taille: 8.5 })
  }
  y -= 2; ligneH(y + 8, rX - 10, MR)
  recap(acquittee ? 'Solde' : 'Solde restant dû', fmt(Math.max(soldeDu, 0), devise),
    { gras: true, couleur: acquittee ? vert : rouge, taille: 10 })
  // Règlements supérieurs au total (ex. taxe réduite après un prépaiement) : montant dû au client
  if (soldeDu < -0.5) recap('Trop-perçu à rembourser', fmt(-soldeDu, devise), { couleur: vert, taille: 9 })

  // ── Pied de page ────────────────────────────────────────────────────────
  for (let i = 0; i < pages.length; i++) {
    page = pages[i]
    ligneH(52)
    txt(`Montants exprimés en ${devise === 'XAF' ? 'francs CFA (XAF)' : devise}.  Merci de votre séjour à ${hotelNom}.`,
      ML, 38, { size: 7.5, color: gris })
    txt(`Facture générée le ${fmtDate(new Date().toISOString())} · 7venHotel Cloud`, ML, 26, { size: 7, color: grisC })
    if (pages.length > 1) txtD(`Page ${i + 1} / ${pages.length}`, MR, 26, { size: 7, color: grisC })
  }

  const pdfBytes = await doc.save()
  const filename = `facture-${facture.id}.pdf`
  const filepath = path.join(FACTURES_DIR, filename)
  await fs.writeFile(filepath, pdfBytes)

  return { cheminRelatif: `factures/${filename}`, filepath }
}

module.exports = { genererFacturePDF, chargerHotelFacture, FACTURES_DIR }
