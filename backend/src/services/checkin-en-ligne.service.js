'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// checkin-en-ligne.service.js — check-in en ligne (LOT-GUEST-01)
//
// Pré-arrivée du client, branchée sur les objets PMS existants (pas d'état Guest parallèle) :
//   • identité / pièce d'identité → clients (fiche de l'hôtel de la réservation)
//   • heure d'arrivée prévue / préférences → reservations
//   • reservations.checkin_en_ligne_le → visible par la réception et tous les modules
// L'arrivée physique reste le check-in PMS (réception), qui active le portail chambre.
//
// Sécurité du lien :
//   • jeton 32 octets aléatoires, jamais stocké en clair (SHA-256 en base)
//   • un lien par réservation ; régénérer invalide le précédent
//   • expiration : lendemain de la date d'arrivée (fin de journée)
//   • usage unique : une fois 'complete', le lien ne permet plus aucune écriture
//   • tenant / hôtel / réservation lus depuis la ligne du lien — jamais depuis la requête
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto')
const { NotFoundError, ConflictError, DomainError, ValidationError } = require('../errors')

const hacher = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex')
const JETON  = /^[0-9a-f]{64}$/
const TYPES_DOCUMENT = ['passeport', 'cni', 'permis', 'titre_sejour']
const STATUTS_GENERABLES = ['tentative', 'confirmee']

const iso = (d) => {
  if (!d) return null
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return String(d).slice(0, 10)
}

function expiration(dateArrivee) {
  const d = new Date(`${iso(dateArrivee)}T23:59:59`)
  d.setDate(d.getDate() + 1)
  return d
}

function valider(body) {
  const b = body || {}
  const erreurs = []
  const err = (champ, message) => erreurs.push({ champ, message })
  const texte = (k, min, max, requis = true) => {
    const v = b[k] === undefined || b[k] === null ? '' : String(b[k]).trim()
    if (!v) { if (requis) err(k, 'requis'); return }
    if (v.length < min || v.length > max) err(k, `${min} à ${max} caractères`)
  }
  const date = (k, requis) => {
    if (!b[k]) { if (requis) err(k, 'requis (AAAA-MM-JJ)'); return null }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b[k]) || Number.isNaN(Date.parse(b[k]))) { err(k, 'format AAAA-MM-JJ'); return null }
    return new Date(b[k])
  }
  texte('prenom', 1, 100); texte('nom', 1, 100); texte('telephone', 5, 50)
  texte('nationalite', 2, 100); texte('numero_document', 3, 100)
  texte('adresse', 2, 500, false); texte('ville', 1, 100, false); texte('pays_residence', 2, 100, false)
  texte('preferences', 1, 1000, false)
  if (!TYPES_DOCUMENT.includes(b.type_document)) err('type_document', `valeurs : ${TYPES_DOCUMENT.join(', ')}`)
  const naissance = date('date_naissance', true)
  if (naissance && naissance >= new Date()) err('date_naissance', 'doit être dans le passé')
  const expDoc = date('date_expiration_document', false)
  if (expDoc && expDoc < new Date(new Date().toDateString())) err('date_expiration_document', 'pièce d\'identité expirée')
  if (b.heure_arrivee && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.heure_arrivee)) err('heure_arrivee', 'format HH:MM')
  if (b.acceptation_conditions !== true) err('acceptation_conditions', 'doit être acceptée')
  if (erreurs.length) throw new ValidationError(erreurs)
}

function createCheckinEnLigneService({ db }) {

  async function lienParJeton(trx, jeton, verrou = false) {
    if (!JETON.test(String(jeton || ''))) throw new DomainError('Lien de check-in invalide', 'LIEN_INVALIDE', 404)
    const q = trx('checkins_en_ligne').where({ token_hash: hacher(jeton) })
    const lien = await (verrou ? q.forUpdate().first() : q.first())
    if (!lien) throw new DomainError('Lien de check-in invalide', 'LIEN_INVALIDE', 404)
    return lien
  }

  return {
    // ── Générer (ou régénérer) le lien d'une réservation ──────────────────
    async genererLien({ reservationId, hotelId, acteurId }) {
      const reservation = await db('reservations').where({ id: reservationId, hotel_id: hotelId }).first()
      if (!reservation) throw new NotFoundError('Réservation', reservationId)
      if (!STATUTS_GENERABLES.includes(reservation.statut))
        throw new ConflictError(`Check-in en ligne impossible : réservation ${reservation.statut}`, 'CHECKIN_EN_LIGNE_INDISPONIBLE', { statut: reservation.statut })

      const existant = await db('checkins_en_ligne').where({ reservation_id: reservationId }).first()
      if (existant && existant.statut === 'complete')
        throw new ConflictError('Check-in en ligne déjà effectué', 'CHECKIN_EN_LIGNE_DEJA_EFFECTUE')

      const jeton = crypto.randomBytes(32).toString('hex')
      const expire = expiration(reservation.date_arrivee)
      await db('checkins_en_ligne')
        .insert({ tenant_id: reservation.tenant_id, hotel_id: hotelId, reservation_id: reservationId,
                  token_hash: hacher(jeton), expire_le: expire, genere_par: acteurId || null })
        .onConflict('reservation_id')
        .merge({ token_hash: hacher(jeton), expire_le: expire, genere_par: acteurId || null, genere_le: db.fn.now() })

      const base = process.env.APP_BASE_URL || 'http://localhost:3000'
      return { token: jeton, url: `${base}/checkin/${jeton}`, expire_le: expire.toISOString() }
    },

    // ── Lecture du dossier par le client (lien) ───────────────────────────
    async contexte(jeton) {
      const lien = await lienParJeton(db, jeton)
      const r = await db('reservations AS r')
        .join('clients AS c', 'c.id', 'r.client_id')
        .join('hotels AS h', 'h.id', 'r.hotel_id')
        .leftJoin('chambres AS ch', 'ch.id', 'r.chambre_id')
        .leftJoin('types_chambre AS tc', 'tc.id', 'ch.type_chambre_id')
        .where({ 'r.id': lien.reservation_id, 'r.hotel_id': lien.hotel_id, 'h.tenant_id': lien.tenant_id })
        .select('r.numero_reservation', 'r.statut', 'r.date_arrivee', 'r.date_depart', 'r.nombre_adultes',
                'r.arrivee_prevue', 'r.preferences_client', 'h.nom AS hotel', 'h.ville', 'tc.nom AS type_chambre',
                'c.prenom', 'c.nom', 'c.email', 'c.telephone', 'c.nationalite', 'c.date_naissance',
                'c.type_document', 'c.numero_document', 'c.date_expiration_document', 'c.adresse', 'c.ville AS ville_client', 'c.pays_residence')
        .first()
      if (!r) throw new DomainError('Lien de check-in invalide', 'LIEN_INVALIDE', 404)

      const expire = new Date(lien.expire_le) < new Date()
      return {
        statut: lien.statut === 'complete' ? 'complete' : expire ? 'expire' : 'en_attente',
        complete_le: lien.complete_le,
        expire_le: lien.expire_le,
        modifiable: lien.statut !== 'complete' && !expire && r.statut === 'confirmee',
        motif_blocage: lien.statut === 'complete' ? 'CHECKIN_DEJA_EFFECTUE'
          : expire ? 'LIEN_EXPIRE'
          : r.statut !== 'confirmee' ? `RESERVATION_${String(r.statut).toUpperCase()}` : null,
        reservation: { numero: r.numero_reservation, statut: r.statut, date_arrivee: iso(r.date_arrivee), date_depart: iso(r.date_depart),
                       nombre_adultes: r.nombre_adultes, hotel: r.hotel, ville: r.ville, type_chambre: r.type_chambre },
        client: { prenom: r.prenom, nom: r.nom, email: r.email, telephone: r.telephone, nationalite: r.nationalite,
                  date_naissance: iso(r.date_naissance), type_document: r.type_document, numero_document: r.numero_document,
                  date_expiration_document: iso(r.date_expiration_document), adresse: r.adresse, ville: r.ville_client,
                  pays_residence: r.pays_residence },
        types_document: TYPES_DOCUMENT,
      }
    },

    // ── Soumission (usage unique) ──────────────────────────────────────────
    async completer(jeton, body, ip) {
      valider(body)
      let resultat
      await db.transaction(async (trx) => {
        const lien = await lienParJeton(trx, jeton, true)
        if (lien.statut === 'complete') throw new ConflictError('Check-in en ligne déjà effectué', 'CHECKIN_EN_LIGNE_DEJA_EFFECTUE')
        if (new Date(lien.expire_le) < new Date()) throw new DomainError('Lien de check-in expiré', 'LIEN_EXPIRE', 410)

        const reservation = await trx('reservations')
          .where({ id: lien.reservation_id, hotel_id: lien.hotel_id, tenant_id: lien.tenant_id }).forUpdate().first()
        if (!reservation) throw new DomainError('Lien de check-in invalide', 'LIEN_INVALIDE', 404)
        if (reservation.statut !== 'confirmee')
          throw new ConflictError(
            reservation.statut === 'tentative' ? 'Réservation en attente de confirmation du paiement' : `Réservation ${reservation.statut}`,
            'RESERVATION_NON_CHECKINABLE', { statut: reservation.statut })

        const b = body
        const t = (v) => (v === undefined || v === null || String(v).trim() === '') ? null : String(v).trim()
        await trx('clients').where({ id: reservation.client_id, hotel_id: lien.hotel_id, tenant_id: lien.tenant_id }).update({
          prenom: t(b.prenom), nom: t(b.nom), telephone: t(b.telephone), nationalite: t(b.nationalite),
          date_naissance: b.date_naissance, type_document: b.type_document, numero_document: t(b.numero_document),
          date_expiration_document: b.date_expiration_document || null,
          adresse: t(b.adresse), ville: t(b.ville), pays_residence: t(b.pays_residence),
          mis_a_jour_le: trx.fn.now(),
        })
        const majResa = { checkin_en_ligne_le: trx.fn.now(), mis_a_jour_le: trx.fn.now() }
        if (b.heure_arrivee) majResa.arrivee_prevue = `${b.heure_arrivee}:00`
        if (t(b.preferences)) majResa.preferences_client = t(b.preferences)
        await trx('reservations').where({ id: reservation.id, hotel_id: lien.hotel_id }).update(majResa)

        await trx('checkins_en_ligne').where({ id: lien.id }).update({
          statut: 'complete', complete_le: trx.fn.now(), ip_completion: ip || null,
          donnees: JSON.stringify({ heure_arrivee: b.heure_arrivee || null, type_document: b.type_document,
                                    acceptation_conditions: true }),
        })
        await trx('logs_audit').insert({
          tenant_id: lien.tenant_id, hotel_id: lien.hotel_id, utilisateur_id: null,
          action: 'GUEST_CHECKIN_EN_LIGNE', module: 'guest', ressource_type: 'reservation', ressource_id: reservation.id,
          nouvelles_valeurs: JSON.stringify({ numero_reservation: reservation.numero_reservation, ip: ip || null }),
        })
        resultat = { statut: 'complete', numero_reservation: reservation.numero_reservation }
      })
      return resultat
    },
  }
}

module.exports = { createCheckinEnLigneService }
