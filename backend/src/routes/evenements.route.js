'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/evenements.route.js
//
// Module événementiel — salles de réunion/réception et événements réservés.
// hotel_id obligatoire sur toute requête.
//
// Note permissions : les autres modules (restaurant, chambres…) utilisent
// fastify.verifierPermission('module.action'), résolu depuis les tables
// permissions/role_permissions. Ce module est nouveau — aucune ligne n'existe
// encore pour 'evenements.*' dans ces tables, et les seeder est hors périmètre
// de cette tâche (fichiers non listés). On utilise donc fastify.verifierRole([...])
// avec exactement les rôles spécifiés — équivalent fonctionnel, sans dépendance
// à un seed de permissions absent.
// ─────────────────────────────────────────────────────────────────────────────

const STATUTS_VALIDES  = ['demande', 'confirme', 'en_cours', 'termine', 'annule']
const FORMULES_VALIDES = ['demi_journee', 'journee']

module.exports = async function evenementsRoutes(fastify) {
  const pre         = [fastify.authentifier, fastify.contexteHotel]
  const preLire      = [...pre, fastify.verifierRole(['manager', 'super_admin', 'reception'])]
  const preCreer     = [...pre, fastify.verifierRole(['manager', 'super_admin'])]
  const preModifier  = [...pre, fastify.verifierRole(['manager', 'super_admin'])]

  async function genererNumeroEvenement(trx, hotelId) {
    const maintenant = new Date()
    const periode = `${maintenant.getFullYear()}${String(maintenant.getMonth() + 1).padStart(2, '0')}`
    const { count } = await trx('evenements')
      .where({ hotel_id: hotelId })
      .whereRaw("TO_CHAR(cree_le, 'YYYYMM') = ?", [periode])
      .count('* AS count')
      .first()
    const seq = String(Number(count) + 1).padStart(4, '0')
    return `EVT-${periode}-${seq}`
  }

  // ── GET /salles — liste des salles ──────────────────────────────────────────
  fastify.get('/salles', { preHandler: preLire }, async (req, reply) => {
    const { actif } = req.query
    let q = fastify.db('salles_evenements').where({ hotel_id: req.hotelId })
    if (actif !== undefined) q = q.andWhere({ actif: actif === 'true' })
    const salles = await q.orderBy('nom')
    reply.send({ salles })
  })

  // ── POST /salles — créer une salle ──────────────────────────────────────────
  fastify.post('/salles', { preHandler: preCreer }, async (req, reply) => {
    const { nom, capacite, superficie_m2, equipements, prix_demi_journee, prix_journee, description } = req.body
    if (!nom) return reply.status(400).send({ erreur: 'nom requis' })

    const [salle] = await fastify.db('salles_evenements').insert({
      hotel_id:          req.hotelId,
      nom,
      capacite:          capacite !== undefined ? Number(capacite) : 10,
      superficie_m2:     superficie_m2 || null,
      equipements:       equipements || null,
      prix_demi_journee: prix_demi_journee || null,
      prix_journee:      prix_journee || null,
      description:       description || null,
    }).returning('*')

    reply.status(201).send({ message: 'Salle créée', salle })
  })

  // ── PUT /salles/:id — modifier une salle ────────────────────────────────────
  fastify.put('/salles/:id', { preHandler: preModifier }, async (req, reply) => {
    const CHAMPS = ['nom', 'capacite', 'superficie_m2', 'equipements', 'prix_demi_journee', 'prix_journee', 'description', 'actif']
    const updateData = {}
    for (const k of CHAMPS) {
      if (req.body[k] !== undefined) updateData[k] = req.body[k]
    }

    const [salle] = await fastify.db('salles_evenements')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updateData)
      .returning('*')

    if (!salle) return reply.status(404).send({ erreur: 'Salle introuvable' })
    reply.send({ message: 'Salle mise à jour', salle })
  })

  // ── DELETE /salles/:id — désactiver (pas de suppression physique) ──────────
  fastify.delete('/salles/:id', { preHandler: preModifier }, async (req, reply) => {
    const [salle] = await fastify.db('salles_evenements')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ actif: false })
      .returning('*')

    if (!salle) return reply.status(404).send({ erreur: 'Salle introuvable' })
    reply.send({ message: 'Salle désactivée', salle })
  })

  // ── GET / — liste des événements ────────────────────────────────────────────
  fastify.get('/', { preHandler: preLire }, async (req, reply) => {
    const { statut, date_debut, date_fin, page = 1, limite = 50 } = req.query

    let q = fastify.db('evenements AS e')
      .leftJoin('salles_evenements AS s', 's.id', 'e.salle_id')
      .leftJoin('clients AS c', 'c.id', 'e.client_id')
      .where({ 'e.hotel_id': req.hotelId })

    if (statut)     q = q.andWhere({ 'e.statut': statut })
    if (date_debut) q = q.andWhere('e.date_debut', '>=', date_debut)
    if (date_fin)   q = q.andWhere('e.date_debut', '<=', date_fin)

    const offset = (parseInt(page) - 1) * parseInt(limite)
    const [data, [{ total }]] = await Promise.all([
      q.clone()
        .select(
          'e.*',
          's.nom AS nom_salle',
          fastify.db.raw("NULLIF(TRIM(c.prenom || ' ' || c.nom), '') AS nom_client")
        )
        .orderBy('e.date_debut', 'desc')
        .limit(parseInt(limite)).offset(offset),
      q.clone().count('e.id AS total'),
    ])

    reply.send({ data, pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total) } })
  })

  // ── POST / — créer un événement ─────────────────────────────────────────────
  fastify.post('/', { preHandler: preCreer }, async (req, reply) => {
    const body = req.body

    if (!body.nom_organisateur || !body.titre || !body.date_debut || !body.date_fin)
      return reply.status(400).send({ erreur: 'nom_organisateur, titre, date_debut et date_fin sont requis' })

    const formule = body.formule || 'journee'
    if (!FORMULES_VALIDES.includes(formule))
      return reply.status(400).send({ erreur: `formule invalide — valeurs acceptées : ${FORMULES_VALIDES.join(', ')}` })

    const statut = body.statut || 'demande'
    if (!STATUTS_VALIDES.includes(statut))
      return reply.status(400).send({ erreur: `statut invalide — valeurs acceptées : ${STATUTS_VALIDES.join(', ')}` })

    const trx = await fastify.db.transaction()
    try {
      // Montant HT : fourni explicitement, sinon dérivé du tarif de la salle selon la formule.
      let montantHt = body.montant_ht !== undefined && body.montant_ht !== null ? Number(body.montant_ht) : null
      if (montantHt === null) {
        montantHt = 0
        if (body.salle_id) {
          const salle = await trx('salles_evenements').where({ id: body.salle_id, hotel_id: req.hotelId }).first()
          if (salle) {
            montantHt = Number((formule === 'demi_journee' ? salle.prix_demi_journee : salle.prix_journee) || 0)
          }
        }
      }

      const montantTtc = body.montant_ttc !== undefined && body.montant_ttc !== null ? Number(body.montant_ttc) : montantHt
      const acompte     = Number(body.acompte || 0)
      const soldeRestant = montantTtc - acompte

      const numero_evenement = await genererNumeroEvenement(trx, req.hotelId)

      const [evenement] = await trx('evenements').insert({
        hotel_id:               req.hotelId,
        numero_evenement,
        salle_id:               body.salle_id || null,
        client_id:               body.client_id || null,
        nom_organisateur:        body.nom_organisateur,
        telephone_organisateur: body.telephone_organisateur || null,
        email_organisateur:      body.email_organisateur || null,
        type_evenement:          body.type_evenement || null,
        titre:                   body.titre,
        date_debut:              body.date_debut,
        date_fin:                body.date_fin,
        heure_debut:             body.heure_debut || null,
        heure_fin:               body.heure_fin || null,
        nombre_participants:     body.nombre_participants || 0,
        formule,
        montant_ht:              montantHt,
        montant_ttc:              montantTtc,
        acompte,
        solde_restant:            soldeRestant,
        statut,
        notes:                   body.notes || null,
      }).returning('*')

      await trx.commit()
      req.log.info({ evenement_id: evenement.id, hotel_id: req.hotelId, numero_evenement }, 'Événement créé')
      reply.status(201).send({ message: 'Événement créé', evenement })
    } catch (err) { await trx.rollback(); throw err }
  })

  // ── GET /calendrier — événements sur une plage de dates ─────────────────────
  fastify.get('/calendrier', { preHandler: preLire }, async (req, reply) => {
    const { debut, fin } = req.query
    if (!debut || !fin)
      return reply.status(400).send({ erreur: 'Paramètres debut et fin requis' })

    const evenements = await fastify.db('evenements AS e')
      .leftJoin('salles_evenements AS s', 's.id', 'e.salle_id')
      .where({ 'e.hotel_id': req.hotelId })
      .andWhere('e.date_debut', '<=', fin)
      .andWhere('e.date_fin', '>=', debut)
      .select('e.*', 's.nom AS nom_salle')
      .orderBy('e.date_debut')

    reply.send({ evenements })
  })

  // ── PUT /:id — modifier un événement (statut, notes, acompte, etc.) ────────
  fastify.put('/:id', { preHandler: preModifier }, async (req, reply) => {
    const existant = await fastify.db('evenements').where({ id: req.params.id, hotel_id: req.hotelId }).first()
    if (!existant) return reply.status(404).send({ erreur: 'Événement introuvable' })

    if (req.body.statut !== undefined && !STATUTS_VALIDES.includes(req.body.statut))
      return reply.status(400).send({ erreur: `statut invalide — valeurs acceptées : ${STATUTS_VALIDES.join(', ')}` })
    if (req.body.formule !== undefined && !FORMULES_VALIDES.includes(req.body.formule))
      return reply.status(400).send({ erreur: `formule invalide — valeurs acceptées : ${FORMULES_VALIDES.join(', ')}` })

    const CHAMPS = [
      'salle_id', 'client_id', 'nom_organisateur', 'telephone_organisateur', 'email_organisateur',
      'type_evenement', 'titre', 'date_debut', 'date_fin', 'heure_debut', 'heure_fin',
      'nombre_participants', 'formule', 'montant_ht', 'montant_ttc', 'statut', 'acompte', 'notes',
    ]
    const updateData = { modifie_le: fastify.db.fn.now() }
    for (const k of CHAMPS) {
      if (req.body[k] !== undefined) updateData[k] = req.body[k]
    }

    // Recalcule solde_restant si le montant TTC ou l'acompte changent.
    if (updateData.montant_ttc !== undefined || updateData.acompte !== undefined) {
      const montantTtc = updateData.montant_ttc !== undefined ? Number(updateData.montant_ttc) : Number(existant.montant_ttc)
      const acompte      = updateData.acompte !== undefined ? Number(updateData.acompte) : Number(existant.acompte)
      updateData.solde_restant = montantTtc - acompte
    }

    const [evenement] = await fastify.db('evenements')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updateData)
      .returning('*')

    reply.send({ message: 'Événement mis à jour', evenement })
  })
}
