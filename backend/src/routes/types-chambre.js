'use strict'
const path   = require('path')
const fs     = require('fs/promises')
const crypto = require('crypto')

module.exports = async function typesChambreRoutes(fastify) {
  const pre      = [fastify.authentifier, fastify.contexteHotel]
  const preRead  = [...pre, fastify.verifierPermission('chambres.lire')]
  const preWrite = [...pre, fastify.verifierPermission('chambres.modifier')]

  // ── GET / — Liste des types de chambre ───────────────────────────────────
  fastify.get('/', { preHandler: preRead }, async (req, reply) => {
    const types = await fastify.db('types_chambre')
      .where({ hotel_id: req.hotelId })
      .orderBy('tarif_base')
    const [{ total }] = await fastify.db('types_chambre')
      .where({ hotel_id: req.hotelId })
      .count('id AS total')
    return reply.send({ types, total: parseInt(total) })
  })

  // ── GET /:id — Détail d'un type ───────────────────────────────────────────
  fastify.get('/:id', { preHandler: preRead }, async (req, reply) => {
    const type = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .first()
    if (!type) return reply.status(404).send({ erreur: 'Type de chambre introuvable' })
    const chambres = await fastify.db('chambres')
      .where({ type_chambre_id: req.params.id, hotel_id: req.hotelId })
      .select('id', 'numero', 'etage', 'statut')
    return reply.send({ type, chambres })
  })

  // ── POST / — Créer un type ────────────────────────────────────────────────
  fastify.post('/', { preHandler: preWrite }, async (req, reply) => {
    const { nom, description, capacite_adultes, capacite_enfants,
            superficie_m2, amenagements, tarif_base, devise } = req.body
    if (!nom) return reply.status(400).send({ erreur: 'nom est requis' })
    if (tarif_base === undefined || tarif_base === null)
      return reply.status(400).send({ erreur: 'tarif_base est requis' })

    const [type] = await fastify.db('types_chambre').insert({
      hotel_id: req.hotelId,
      nom,
      description:       description || null,
      capacite_adultes:  capacite_adultes  ?? 2,
      capacite_enfants:  capacite_enfants  ?? 0,
      superficie_m2:     superficie_m2     || null,
      amenagements:      JSON.stringify(amenagements || []),
      tarif_base,
      devise:            devise || 'XAF',
      actif:             true,
    }).returning('*')

    return reply.status(201).send({ message: 'Type de chambre créé', type })
  })

  // ── PUT /:id — Modifier un type ───────────────────────────────────────────
  fastify.put('/:id', { preHandler: preWrite }, async (req, reply) => {
    const CHAMPS = ['nom', 'description', 'capacite_adultes', 'capacite_enfants',
                    'superficie_m2', 'amenagements', 'tarif_base', 'devise', 'actif']
    const updateData = {}
    for (const k of CHAMPS) {
      if (req.body[k] !== undefined) {
        updateData[k] = k === 'amenagements' ? JSON.stringify(req.body[k]) : req.body[k]
      }
    }
    if (Object.keys(updateData).length === 0)
      return reply.status(400).send({ erreur: 'Aucun champ à modifier' })

    const [updated] = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update(updateData)
      .returning('*')
    if (!updated) return reply.status(404).send({ erreur: 'Type de chambre introuvable' })
    return reply.send({ message: 'Type de chambre mis à jour', type: updated })
  })

  // ── POST /:id/photos — Upload photo ───────────────────────────────────────
  fastify.post('/:id/photos', { preHandler: preWrite }, async (req, reply) => {
    const type = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .first()
    if (!type) return reply.status(404).send({ erreur: 'Type de chambre introuvable' })

    const photos = Array.isArray(type.photos) ? type.photos : []
    if (photos.length >= 5)
      return reply.status(400).send({ erreur: 'Maximum 5 photos par type atteint' })

    const data = await req.file()
    if (!data) return reply.status(400).send({ erreur: 'Fichier manquant' })

    const ext = path.extname(data.filename).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext))
      return reply.status(400).send({ erreur: 'Format non supporté. Utilisez JPG, PNG ou WebP.' })

    const filename  = crypto.randomBytes(16).toString('hex') + ext
    const TYPES_DIR = path.join(__dirname, '../../../uploads/rooms/types')
    await fs.mkdir(TYPES_DIR, { recursive: true })
    const buffer = await data.toBuffer()
    await fs.writeFile(path.join(TYPES_DIR, filename), buffer)

    const url       = `/uploads/rooms/types/${filename}`
    const newPhotos = [...photos, url]

    const [updated] = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ photos: JSON.stringify(newPhotos) })
      .returning('*')

    return reply.status(201).send({ message: 'Photo ajoutée', photos: updated.photos })
  })

  // ── DELETE /:id/photos — Supprimer une photo ──────────────────────────────
  fastify.delete('/:id/photos', { preHandler: preWrite }, async (req, reply) => {
    const { url } = req.body || {}
    if (!url) return reply.status(400).send({ erreur: 'URL requise' })

    const type = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .first()
    if (!type) return reply.status(404).send({ erreur: 'Type de chambre introuvable' })

    const photos    = Array.isArray(type.photos) ? type.photos : []
    const newPhotos = photos.filter(p => p !== url)

    const [updated] = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ photos: JSON.stringify(newPhotos) })
      .returning('*')

    try { await fs.unlink(path.join(__dirname, '../../../', url)) } catch {}

    return reply.send({ message: 'Photo supprimée', photos: updated.photos })
  })

  // ── DELETE /:id — Désactiver (soft delete) ────────────────────────────────
  fastify.delete('/:id', { preHandler: preWrite }, async (req, reply) => {
    const chambresLiees = await fastify.db('chambres')
      .where({ type_chambre_id: req.params.id, hotel_id: req.hotelId })
      .count('id AS total')
      .first()
    if (parseInt(chambresLiees.total) > 0)
      return reply.status(409).send({
        erreur: `Impossible de supprimer : ${chambresLiees.total} chambre(s) utilisent ce type`,
        chambres_liees: parseInt(chambresLiees.total)
      })

    const [deleted] = await fastify.db('types_chambre')
      .where({ id: req.params.id, hotel_id: req.hotelId })
      .update({ actif: false })
      .returning('*')
    if (!deleted) return reply.status(404).send({ erreur: 'Type de chambre introuvable' })
    return reply.send({ message: 'Type de chambre désactivé', type: deleted })
  })
}
