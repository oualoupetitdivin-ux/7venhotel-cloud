'use strict'

// ══════════════════════════════════════════════════════════════════════════════
// Pont PMS → Finance OHADA (LOT-PMS-01)
//
// Le PMS ne connaît AUCUN compte comptable. Chaque fonction :
//   1. relit l'objet métier en base (source de vérité, scope hotel_id)
//   2. produit un BUSINESS EVENT { type, montant, montant_taxe?, attributs, référence }
//   3. le confie à accounting.engine (mapping → journal → écriture)
//
// Idempotence : chaque événement porte une clé déterministe dérivée de l'objet
// métier (ex. FACTURE:<id>:HEBERGEMENT, PAIEMENT:paiement:<id>). Rejouer = aucun doublon.
//
// Un point comptable unique par événement :
//   ventes      → facture émise (checkout)      paiements → paiement 'valide'
//   charges     → validation                    achats    → réception
//   arrhes      → confirmation / remboursement / acquisition / imputation facture
//   caisse      → mouvement, écart de clôture   corrections post-facture → avoir / contre-passation
//
// Les hooks PMS appellent publier() APRÈS commit : un échec comptable ne bloque
// jamais l'opération hôtelière ; il est tracé (FINANCE_EVENEMENT_ECHEC) et
// rejouable via POST /finance/pms/rejouer. Un hôtel sans dossier comptable
// initialisé est ignoré silencieusement (module Finance non activé).
// ══════════════════════════════════════════════════════════════════════════════

const moteur = require('../engines/accounting.engine')
const { AccountingError, versCentimes, isoDate } = moteur

const dec = (c) => (c / 100).toFixed(2)

// Catégories de lignes folio → type d'événement
const CATEGORIE_LIGNE = {
  hebergement: 'HEBERGEMENT', restaurant: 'RESTAURANT', bar: 'RESTAURANT', minibar: 'RESTAURANT',
  spa: 'SERVICE_ANNEXE', blanchisserie: 'SERVICE_ANNEXE', transport: 'SERVICE_ANNEXE',
  telephone: 'SERVICE_ANNEXE', autre: 'SERVICE_ANNEXE',
}
const CATEGORIE_TAXE_CIBLE = { hebergement: 'HEBERGEMENT', restaurant: 'RESTAURANT' }

async function contexte(db, hotelId) {
  const h = await db('hotels').where({ id: hotelId }).select('tenant_id').first()
  if (!h) throw new AccountingError('HOTEL_INTROUVABLE', 'Hôtel introuvable', 404)
  return { tenantId: h.tenant_id, hotelId }
}

async function dossierActif(db, hotelId) {
  return !!(await db('exercices_comptables').where({ hotel_id: hotelId }).first())
}

async function evenement(db, ctx, ev) {
  const r = await moteur.comptabiliserEvenement(db, { ...ctx, ...ev })
  return { type: ev.type, cle: ev.cle_idempotence, ecriture_id: r.ecriture.id, numero_piece: r.ecriture.numero_piece,
           rejeu: !!r.ecriture.rejeu, total: Number(r.ecriture.total_debit) }
}

async function ecritureParCle(db, hotelId, cle) {
  return db('ecritures_comptables').where({ hotel_id: hotelId, cle_idempotence: cle }).first()
}

// ── Classement d'une ligne folio (catégorie + composante HT / TVA) ────────────
async function classerLignes(db, hotelId, lignes) {
  const taxes = Object.fromEntries((await db('taxes').where({ hotel_id: hotelId }).select('code', 'nom', 's_applique_a'))
    .map(t => [t.code, t]))
  const commandes = {}
  const idsCmd = lignes.filter(l => l.reference_type === 'commande_restaurant' && l.reference_id).map(l => l.reference_id)
  if (idsCmd.length) {
    for (const c of await db('commandes_restaurant').whereIn('id', idsCmd).select('id', 'numero_chambre', 'numero_table')) commandes[c.id] = c
  }
  const anomalies = []

  const classer = (l) => {
    if (l.type_ligne === 'taxe') {
      const code = (l.metadata && l.metadata.code) || null
      const t = code ? taxes[code] : null
      if (code && /SEJOUR/i.test(code)) return { cat: 'TAXE_SEJOUR', comp: 'ht' }
      // LOT-PMS-02 — taxe d'une commande restaurant : même catégorie que la commande (restaurant / room service)
      let cible = t ? (CATEGORIE_TAXE_CIBLE[t.s_applique_a] || 'HEBERGEMENT') : null
      if (l.reference_type === 'commande_restaurant' && commandes[l.reference_id]) {
        const c = commandes[l.reference_id]
        cible = c.numero_chambre && !c.numero_table ? 'ROOM_SERVICE' : 'RESTAURANT'
      }
      if (t && /^TVA/i.test(code)) return { cat: cible, comp: 'tva' }
      if (t) return { cat: cible, comp: 'ht' }  // ex : service 10 % = produit
      anomalies.push({ ligne_id: l.id, anomalie: 'TAXE_INCONNUE', code })
      return { cat: 'HEBERGEMENT', comp: 'tva' }
    }
    if (l.type_ligne === 'remise') return { cat: 'HEBERGEMENT', comp: 'ht' }
    let cat = CATEGORIE_LIGNE[l.type_ligne]
    if (!cat) return null
    if (cat === 'RESTAURANT' && l.reference_type === 'commande_restaurant') {
      const c = commandes[l.reference_id]
      if (c && c.numero_chambre && !c.numero_table) cat = 'ROOM_SERVICE'
    }
    return { cat, comp: 'ht' }
  }
  return { classer, anomalies }
}

// ── 1. FACTURE (checkout) — ventes + imputation des arrhes ────────────────────
async function comptabiliserFacture(db, { hotelId, factureId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const facture = await db('factures').where({ id: factureId, hotel_id: hotelId }).first()
  if (!facture) throw new AccountingError('FACTURE_INTROUVABLE', 'Facture introuvable', 404)
  const folio = await db('folios').where({ reservation_id: facture.reservation_id, hotel_id: hotelId }).first()
  if (!folio) throw new AccountingError('FOLIO_INTROUVABLE', 'Folio de la facture introuvable', 404)

  // Lignes connues au moment de l'émission (les corrections ultérieures = avoirs).
  // Comparaison en SQL : une date JS est tronquée à la milliseconde, ce qui excluait les lignes posées
  // dans la transaction du checkout (réajustement fiscal), horodatées à la microseconde près comme la facture.
  const lignes = await db('lignes_folio').where({ folio_id: folio.id, hotel_id: hotelId })
    .whereRaw('cree_le <= (SELECT cree_le FROM factures WHERE id = ?)', [facture.id]).orderBy('cree_le')
  const parId = Object.fromEntries(lignes.map(l => [l.id, l]))
  const { classer, anomalies } = await classerLignes(db, hotelId, lignes)

  const totaux = {}   // cat → { ht, tva } en centimes
  const ajouter = (cls, montant) => {
    if (!cls) return
    totaux[cls.cat] = totaux[cls.cat] || { ht: 0, tva: 0 }
    totaux[cls.cat][cls.comp] += montant
  }
  for (const l of lignes) {
    const m = versCentimes(l.montant_total)
    if (l.sens === 'debit' && l.type_ligne !== 'correction') ajouter(classer(l), m)
    else if (l.type_ligne === 'remise' && l.sens === 'credit') ajouter(classer(l), -m)
    else if (l.type_ligne === 'correction' && l.ligne_corrigee_id && parId[l.ligne_corrigee_id]) {
      const orig = parId[l.ligne_corrigee_id]
      if (orig.type_ligne === 'paiement') continue            // correction de paiement : traitée côté paiement
      ajouter(classer(orig), orig.sens === 'debit' ? -m : m)
    }
  }

  const date = isoDate(facture.date_emission || facture.cree_le)
  const resultats = []
  for (const [cat, t] of Object.entries(totaux)) {
    if (t.ht < 0 || t.tva < 0 || t.ht + t.tva <= 0) {
      if (t.ht + t.tva !== 0) anomalies.push({ categorie: cat, anomalie: 'MONTANT_NEGATIF', ht: dec(t.ht), tva: dec(t.tva) })
      continue
    }
    if (t.ht === 0) { anomalies.push({ categorie: cat, anomalie: 'TAXE_SANS_BASE', tva: dec(t.tva) }); continue }
    resultats.push(await evenement(db, ctx, {
      type: cat, montant: dec(t.ht), montant_taxe: cat === 'TAXE_SEJOUR' ? undefined : dec(t.tva), date,
      libelle: `Facture ${facture.numero_facture} — ${cat.toLowerCase().replace('_', ' ')}`,
      reference_type: 'facture', reference_id: facture.id, cle_idempotence: `FACTURE:${facture.id}:${cat}`,
    }))
  }

  // Imputation des arrhes encore détenues (419 → 411)
  const garanties = await db('garanties_reservation')
    .where({ reservation_id: facture.reservation_id, hotel_id: hotelId }).whereIn('statut', ['complete', 'partielle'])
  let impute = 0
  for (const g of garanties) {
    const net = versCentimes(g.montant_recu) - versCentimes(g.montant_rembourse || 0)
    if (net <= 0) continue
    impute += net
    // N'impute que des arrhes effectivement comptabilisées à l'encaissement
    const recues = await db('ecritures_comptables').where({ hotel_id: hotelId, evenement_type: 'ARRHES', reference_type: 'garantie', reference_id: g.id }).first()
    if (!recues) { anomalies.push({ garantie_id: g.id, anomalie: 'ARRHES_NON_COMPTABILISEES' }); continue }
    resultats.push(await evenement(db, ctx, {
      type: 'ARRHES_IMPUTATION', montant: dec(net), date,
      libelle: `Imputation arrhes sur facture ${facture.numero_facture}`,
      reference_type: 'garantie', reference_id: g.id, cle_idempotence: `ARRHES_IMPUTATION:garantie:${g.id}`,
    }))
  }
  // LOT-PMS-02 — contrôle : arrhes imputées en comptabilité = arrhes portées par la facture (folio)
  if (facture.montant_arrhes !== undefined && impute !== versCentimes(facture.montant_arrhes)) {
    anomalies.push({ anomalie: 'ARRHES_FACTURE_DIVERGENTES', comptabilite: dec(impute), facture: facture.montant_arrhes })
  }
  return { source: 'facture', id: facture.id, ecritures: resultats, anomalies }
}

// ── 2. PAIEMENT (statut valide) ──────────────────────────────────────────────
async function comptabiliserPaiement(db, { hotelId, paiementId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const p = await db('paiements').where({ id: paiementId, hotel_id: hotelId }).first()
  if (!p) throw new AccountingError('PAIEMENT_INTROUVABLE', 'Paiement introuvable', 404)
  if (p.statut !== 'valide') return { source: 'paiement', id: p.id, ignore: `statut ${p.statut}`, ecritures: [] }
  if (p.type_paiement === 'chambre') return { source: 'paiement', id: p.id, ignore: 'report sur chambre (pas de trésorerie)', ecritures: [] }
  const date = isoDate(p.confirme_le || p.traite_le || p.cree_le)
  return { source: 'paiement', id: p.id, ecritures: [await evenement(db, ctx, {
    type: 'PAIEMENT', montant: p.montant, date, attributs: { mode_paiement: p.type_paiement },
    libelle: `Encaissement ${p.type_paiement}${p.reçu_numero ? ` — reçu ${p.reçu_numero}` : ''}`,
    reference_type: 'paiement', reference_id: p.id, cle_idempotence: `PAIEMENT:paiement:${p.id}`,
  })] }
}

// ── 3. RESTAURANT servie — vente directe walk-in + paiement immédiat ─────────
async function comptabiliserCommandeRestaurant(db, { hotelId, commandeId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const c = await db('commandes_restaurant').where({ id: commandeId, hotel_id: hotelId }).first()
  if (!c) throw new AccountingError('COMMANDE_INTROUVABLE', 'Commande introuvable', 404)
  if (c.statut !== 'servie') return { source: 'commande_restaurant', id: c.id, ignore: `statut ${c.statut}`, ecritures: [] }
  const ecritures = []
  const paiement = await db('paiements').where({ hotel_id: hotelId })
    .whereIn('idempotency_key', [`resto-ext-${c.id}`, `resto-imm-${c.id}`]).first()

  if (!c.reservation_id) {
    // Walk-in : aucune facture de séjour ne portera cette vente → vente comptabilisée au service
    const lignes = await db('lignes_commande').where({ commande_id: c.id })
    let montant = lignes.reduce((s, l) => s + versCentimes(l.montant_total), 0) || versCentimes(c.sous_total || c.total)
    // LOT-PMS-02 — ventilation fiscale du paiement : TVA → taxe ; autres taxes (ex. service) → produit
    const detail = paiement && paiement.methode_detail && Array.isArray(paiement.methode_detail.taxes) ? paiement.methode_detail.taxes : null
    let tva = 0
    if (detail) {
      for (const t of detail) { const m = versCentimes(t.montant); if (/^TVA/i.test(t.code)) tva += m; else montant += m }
    } else {
      tva = versCentimes(c.taxes || 0)
    }
    const type = c.numero_chambre && !c.numero_table ? 'ROOM_SERVICE' : 'RESTAURANT'
    ecritures.push(await evenement(db, ctx, {
      type, montant: dec(montant), montant_taxe: dec(tva), date: isoDate(c.heure_servie || c.cree_le),
      libelle: `Vente directe ${c.numero_commande}`, reference_type: 'commande_restaurant', reference_id: c.id,
      cle_idempotence: `VENTE_DIRECTE:commande:${c.id}`,
    }))
  }
  // Client hôtel : la vente est portée par la facture de séjour ; seul l'encaissement immédiat est comptabilisé ici
  if (paiement) ecritures.push(...(await comptabiliserPaiement(db, { hotelId, paiementId: paiement.id, userId })).ecritures)
  return { source: 'commande_restaurant', id: c.id, ecritures }
}

// ── 4. CORRECTION de ligne folio après facture → AVOIR / contre-passation ────
async function comptabiliserCorrection(db, { hotelId, ligneId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const corr = await db('lignes_folio').where({ id: ligneId, hotel_id: hotelId, type_ligne: 'correction' }).first()
  if (!corr) throw new AccountingError('CORRECTION_INTROUVABLE', 'Ligne de correction introuvable', 404)
  const orig = await db('lignes_folio').where({ id: corr.ligne_corrigee_id, hotel_id: hotelId }).first()
  const folio = await db('folios').where({ id: corr.folio_id, hotel_id: hotelId }).first()

  if (orig.type_ligne === 'paiement' && orig.reference_type === 'paiement') {
    const e = await ecritureParCle(db, hotelId, `PAIEMENT:paiement:${orig.reference_id}`)
    if (!e) return { source: 'correction', id: corr.id, ignore: 'paiement non comptabilisé', ecritures: [] }
    const deja = await db('ecritures_comptables').where({ ecriture_origine_id: e.id, source: 'contre_ecriture' }).first()
    if (deja) return { source: 'correction', id: corr.id, ecritures: [{ type: 'ANNULATION', ecriture_id: deja.id, numero_piece: deja.numero_piece, rejeu: true }] }
    const ce = await moteur.contreEcriture(db, { ...ctx, ecritureId: e.id, motif: `Correction folio — ${corr.description}` })
    return { source: 'correction', id: corr.id, ecritures: [{ type: 'ANNULATION', ecriture_id: ce.id, numero_piece: ce.numero_piece, rejeu: false }] }
  }

  const facture = folio && await db('factures').where({ reservation_id: folio.reservation_id, hotel_id: hotelId }).first()
  if (!facture || new Date(corr.cree_le) <= new Date(facture.cree_le)) {
    return { source: 'correction', id: corr.id, ignore: 'avant facture — intégrée à la facture', ecritures: [] }
  }
  const { classer } = await classerLignes(db, hotelId, [orig])
  const cls = classer(orig)
  if (!cls) return { source: 'correction', id: corr.id, ignore: `type ${orig.type_ligne} non comptable`, ecritures: [] }
  const categorie = cls.comp === 'tva' ? 'TVA' : cls.cat
  return { source: 'correction', id: corr.id, ecritures: [await evenement(db, ctx, {
    type: 'AVOIR', montant: corr.montant_total, montant_taxe: '0', date: isoDate(corr.cree_le),
    attributs: { categorie }, libelle: `Avoir sur facture ${facture.numero_facture} — ${corr.description}`,
    reference_type: 'lignes_folio', reference_id: corr.id, cle_idempotence: `AVOIR:correction:${corr.id}`,
  })] }
}

// ── 5. CAISSE — mouvement / écart de clôture ─────────────────────────────────
async function comptabiliserMouvementCaisse(db, { hotelId, mouvementId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const m = await db('mouvements_caisse').where({ id: mouvementId, hotel_id: hotelId }).first()
  if (!m) throw new AccountingError('MOUVEMENT_INTROUVABLE', 'Mouvement introuvable', 404)
  if (!['decaissement', 'retrait'].includes(m.type_mouvement)) return { source: 'mouvement_caisse', id: m.id, ignore: m.type_mouvement, ecritures: [] }
  return { source: 'mouvement_caisse', id: m.id, ecritures: [await evenement(db, ctx, {
    type: 'CAISSE_DECAISSEMENT', montant: m.montant, date: isoDate(m.cree_le), attributs: { type_mouvement: m.type_mouvement },
    libelle: `Caisse — ${m.libelle}`, reference_type: 'mouvement_caisse', reference_id: m.id, cle_idempotence: `CAISSE:mouvement:${m.id}`,
  })] }
}

async function comptabiliserClotureCaisse(db, { hotelId, sessionId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const s = await db('sessions_caisse').where({ id: sessionId, hotel_id: hotelId }).first()
  if (!s) throw new AccountingError('SESSION_INTROUVABLE', 'Session de caisse introuvable', 404)
  if (s.statut !== 'cloturee') return { source: 'session_caisse', id: s.id, ignore: 'session ouverte', ecritures: [] }
  const ecart = versCentimes(s.ecart || 0)
  if (ecart === 0) return { source: 'session_caisse', id: s.id, ignore: 'aucun écart', ecritures: [] }
  return { source: 'session_caisse', id: s.id, ecritures: [await evenement(db, ctx, {
    type: 'ECART_CAISSE', montant: dec(Math.abs(ecart)), date: isoDate(s.fermee_le),
    attributs: { sens: ecart < 0 ? 'manquant' : 'excedent' },
    libelle: `Écart de caisse ${ecart < 0 ? 'manquant' : 'excédent'} — clôture`,
    reference_type: 'session_caisse', reference_id: s.id, cle_idempotence: `ECART_CAISSE:session:${s.id}`,
  })] }
}

// ── 6. CHARGE validée ────────────────────────────────────────────────────────
async function comptabiliserCharge(db, { hotelId, chargeId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const ch = await db('charges AS c').leftJoin('categories_charges AS k', 'k.id', 'c.categorie_id')
    .where({ 'c.id': chargeId, 'c.hotel_id': hotelId }).select('c.*', 'k.nom AS categorie_nom').first()
  if (!ch) throw new AccountingError('CHARGE_INTROUVABLE', 'Charge introuvable', 404)
  if (ch.statut === 'saisie') return { source: 'charge', id: ch.id, ignore: 'charge non validée (saisie)', ecritures: [] }
  const categorie = ch.categorie_nom ? ch.categorie_nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim() : null
  return { source: 'charge', id: ch.id, ecritures: [await evenement(db, ctx, {
    type: 'CHARGE', montant: ch.montant, date: isoDate(ch.date_charge),
    attributs: { ...(categorie ? { categorie } : {}), ...(ch.categorie_id ? { categorie_id: ch.categorie_id } : {}) },
    libelle: `Charge — ${ch.libelle}`, reference_type: 'charge', reference_id: ch.id, cle_idempotence: `CHARGE:charge:${ch.id}`,
  })] }
}

// ── 7. ACHAT réceptionné (réceptions partielles cumulées) ────────────────────
async function comptabiliserReceptionAchat(db, { hotelId, bonId, userId }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const bon = await db('bons_achat').where({ id: bonId, hotel_id: hotelId }).first()
  if (!bon) throw new AccountingError('BON_INTROUVABLE', 'Bon d\'achat introuvable', 404)
  if (!['recu', 'recu_partiel'].includes(bon.statut)) return { source: 'bon_achat', id: bon.id, ignore: `statut ${bon.statut}`, ecritures: [] }
  const lignes = await db('lignes_bon_achat').where({ bon_achat_id: bon.id })
  // Cumul reçu HT et TVA fournisseur (LOT-PMS-02 : TVA seulement si le taux est saisi sur la ligne)
  let cumul = 0, cumulTva = 0
  for (const l of lignes) {
    const ht = Math.round(Number(l.quantite_recue || 0) * versCentimes(l.prix_unitaire))
    cumul += ht
    if (l.taux_tva !== null && l.taux_tva !== undefined) cumulTva += Math.round(ht * Number(l.taux_tva) / 100)
  }
  // Déjà comptabilisé : lu dans la clé de la dernière écriture (ACHAT:bon_achat:<id>:<cumulHT>[:<cumulTVA>])
  const cles = (await db('ecritures_comptables')
    .where({ hotel_id: hotelId, evenement_type: 'ACHAT', reference_type: 'bon_achat', reference_id: bon.id, source: 'moteur' })
    .select('cle_idempotence')).map(r => String(r.cle_idempotence).split(':'))
  const dejaHt  = cles.reduce((m, k) => Math.max(m, Number(k[3] || 0)), 0)
  const dejaTva = cles.reduce((m, k) => Math.max(m, Number(k[4] || 0)), 0)
  const ht = cumul - dejaHt, tva = cumulTva - dejaTva
  if (ht <= 0) return { source: 'bon_achat', id: bon.id, ecritures: [], deja_comptabilise: dec(dejaHt) }
  return { source: 'bon_achat', id: bon.id, ecritures: [await evenement(db, ctx, {
    type: 'ACHAT', montant: dec(ht), montant_taxe: dec(Math.max(tva, 0)), date: isoDate(bon.date_reception || new Date()),
    libelle: `Réception bon d'achat ${bon.numero_bon}`, reference_type: 'bon_achat', reference_id: bon.id,
    cle_idempotence: cumulTva > 0 ? `ACHAT:bon_achat:${bon.id}:${cumul}:${cumulTva}` : `ACHAT:bon_achat:${bon.id}:${cumul}`,
  })] }
}

// ── 8. ARRHES — encaissement / remboursement / acquisition ───────────────────
async function comptabiliserArrhes(db, { hotelId, garantieId, userId, montantRecu }) {
  const ctx = { ...(await contexte(db, hotelId)), userId }
  const g = await db('garanties_reservation').where({ id: garantieId, hotel_id: hotelId }).first()
  if (!g) throw new AccountingError('GARANTIE_INTROUVABLE', 'Garantie introuvable', 404)
  const ecritures = []
  const mode = g.mode_paiement ? { mode_paiement: g.mode_paiement } : {}
  const recu = versCentimes(g.montant_recu || 0)

  // Encaissements : un événement par palier de cumul reçu (clé = cumul après réception)
  const dejaEnc = (await db('ecritures_comptables')
    .where({ hotel_id: hotelId, evenement_type: 'ARRHES', reference_type: 'garantie', reference_id: g.id, source: 'moteur' })
    .select('total_debit')).reduce((s, r) => s + versCentimes(r.total_debit), 0)
  if (recu > dejaEnc) {
    ecritures.push(await evenement(db, ctx, {
      type: 'ARRHES', montant: dec(recu - dejaEnc), date: isoDate(g.mis_a_jour_le || new Date()), attributs: mode,
      libelle: `Arrhes reçues — réservation ${g.reservation_id.slice(0, 8)}`,
      reference_type: 'garantie', reference_id: g.id, cle_idempotence: `ARRHES:garantie:${g.id}:${recu}`,
    }))
  }
  const rembourse = versCentimes(g.montant_rembourse || 0)
  if (g.statut === 'remboursee' && rembourse > 0) {
    ecritures.push(await evenement(db, ctx, {
      type: 'ARRHES_REMBOURSEMENT', montant: dec(rembourse), date: isoDate(g.rembourse_le || new Date()), attributs: mode,
      libelle: 'Remboursement d\'arrhes', reference_type: 'garantie', reference_id: g.id,
      cle_idempotence: `ARRHES_REMBOURSEMENT:garantie:${g.id}`,
    }))
  }
  const conserve = recu - rembourse
  if (['remboursee', 'acquise'].includes(g.statut) && conserve > 0) {
    ecritures.push(await evenement(db, ctx, {
      type: 'ARRHES_ACQUISES', montant: dec(conserve), date: isoDate(g.mis_a_jour_le || new Date()),
      libelle: 'Arrhes conservées par l\'hôtel', reference_type: 'garantie', reference_id: g.id,
      cle_idempotence: `ARRHES_ACQUISES:garantie:${g.id}`,
    }))
  }
  return { source: 'garantie', id: g.id, ecritures }
}

const SOURCES = {
  facture:             (db, a) => comptabiliserFacture(db, { ...a, factureId: a.id }),
  paiement:            (db, a) => comptabiliserPaiement(db, { ...a, paiementId: a.id }),
  commande_restaurant: (db, a) => comptabiliserCommandeRestaurant(db, { ...a, commandeId: a.id }),
  correction:          (db, a) => comptabiliserCorrection(db, { ...a, ligneId: a.id }),
  mouvement_caisse:    (db, a) => comptabiliserMouvementCaisse(db, { ...a, mouvementId: a.id }),
  session_caisse:      (db, a) => comptabiliserClotureCaisse(db, { ...a, sessionId: a.id }),
  charge:              (db, a) => comptabiliserCharge(db, { ...a, chargeId: a.id }),
  bon_achat:           (db, a) => comptabiliserReceptionAchat(db, { ...a, bonId: a.id }),
  garantie:            (db, a) => comptabiliserArrhes(db, { ...a, garantieId: a.id }),
}

/**
 * Point d'entrée des hooks PMS — APRÈS commit de l'opération métier.
 * Ne lève jamais : un échec est journalisé (FINANCE_EVENEMENT_ECHEC) pour rejeu.
 */
async function publier(db, { source, id, hotelId, userId, log }) {
  try {
    if (!(await dossierActif(db, hotelId))) return { source, id, ignore: 'dossier comptable non initialisé', ecritures: [] }
    return await SOURCES[source](db, { id, hotelId, userId })
  } catch (err) {
    const e = moteur.traduireErreurPg(err)
    const logger = log || console
    ;(logger.warn || logger.error).call(logger, { source, id, hotel_id: hotelId, code: e.code, err: e.message }, 'FINANCE_EVENEMENT_ECHEC')
    try {
      const h = await db('hotels').where({ id: hotelId }).select('tenant_id').first()
      await db('logs_audit').insert({
        tenant_id: h ? h.tenant_id : null, hotel_id: hotelId, utilisateur_id: userId || null,
        action: 'FINANCE_EVENEMENT_ECHEC', module: 'finance', ressource_type: source,
        ressource_id: /^[0-9a-f-]{36}$/i.test(String(id)) ? id : null,
        nouvelles_valeurs: JSON.stringify({ code: e.code || null, message: e.message }),
      })
    } catch { /* l'audit d'échec ne doit jamais bloquer */ }
    return { source, id, erreur: { code: e.code || 'ERREUR', message: e.message }, ecritures: [] }
  }
}

module.exports = { publier, SOURCES, comptabiliserFacture, comptabiliserPaiement, comptabiliserCommandeRestaurant,
  comptabiliserCorrection, comptabiliserMouvementCaisse, comptabiliserClotureCaisse, comptabiliserCharge,
  comptabiliserReceptionAchat, comptabiliserArrhes }
