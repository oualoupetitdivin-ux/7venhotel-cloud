'use strict'
const path   = require('path')
const fs     = require('fs/promises')
const crypto = require('crypto')

module.exports = async function uploadsRoutes(fastify) {
  const pre        = [fastify.authentifier, fastify.contexteHotel]
  const preModifier = [...pre, fastify.verifierPermission('chambres.administrer')]
  const UPLOAD_DIR  = path.join(__dirname, '../../../uploads/rooms')
  const MAX_IMAGES  = parseInt(process.env.MAX_IMAGES_PER_ROOM) || 7

  // Isolation tenant : vérifie que chambre_id appartient à req.hotelId
  async function verifierChambreHotel(chambreId, hotelId, reply) {
    const chambre = await fastify.db('chambres')
      .where({ id: chambreId, hotel_id: hotelId })
      .first()
    if (!chambre) {
      reply.status(404).send({ erreur: 'Chambre introuvable dans cet hôtel' })
      return false
    }
    return true
  }

  // ── POST /chambres/:chambre_id/images ─────────────────────────────────────
  fastify.post('/chambres/:chambre_id/images', {
    preHandler: preModifier,
  }, async (req, reply) => {
    const { chambre_id } = req.params

    // LOI-CH-01 — isolation tenant
    if (!await verifierChambreHotel(chambre_id, req.hotelId, reply)) return

    const existingCount = await fastify.db('images_chambres')
      .where({ chambre_id })
      .count('id AS total')
      .first()

    if (parseInt(existingCount.total) >= MAX_IMAGES) {
      return reply.status(400).send({ erreur: `Maximum ${MAX_IMAGES} images par chambre atteint` })
    }

    const data = await req.file()
    if (!data) return reply.status(400).send({ erreur: 'Fichier manquant' })

    const ext = path.extname(data.filename).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext))
      return reply.status(400).send({ erreur: 'Format non supporté. Utilisez JPG, PNG ou WebP.' })

    const filename = crypto.randomBytes(16).toString('hex') + ext
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const buffer = await data.toBuffer()
    await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer)

    const ordre = parseInt(existingCount.total)
    const [image] = await fastify.db('images_chambres').insert({
      chambre_id,
      url_fichier:   `/uploads/rooms/${filename}`,
      nom_fichier:   data.filename,
      taille_octets: buffer.length,
      est_principale: ordre === 0,
      ordre,
    }).returning('*')

    await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    req.log.info({ chambre_id, image_id: image.id }, 'Image uploadée')
    return reply.status(201).send({ message: 'Image uploadée', image })
  })

  // ── DELETE /chambres/:chambre_id/images/:id ───────────────────────────────
  fastify.delete('/chambres/:chambre_id/images/:id', {
    preHandler: preModifier,
  }, async (req, reply) => {
    const { chambre_id, id } = req.params

    // LOI-CH-01 — isolation tenant via JOIN : images_chambres n'a pas hotel_id,
    // la jointure avec chambres enforce que la chambre appartient à cet hôtel
    const image = await fastify.db('images_chambres AS img')
      .join('chambres AS ch', 'ch.id', 'img.chambre_id')
      .where({ 'img.id': id, 'img.chambre_id': chambre_id, 'ch.hotel_id': req.hotelId })
      .select('img.*')
      .first()

    if (!image) return reply.status(404).send({ erreur: 'Image introuvable' })

    try { await fs.unlink(path.join(__dirname, '../../../', image.url_fichier)) } catch {}
    await fastify.db('images_chambres').where({ id }).delete()

    await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    req.log.info({ chambre_id, image_id: id }, 'Image supprimée')
    return reply.send({ message: 'Image supprimée' })
  })

  // ── PUT /chambres/:chambre_id/images/:id/principale ───────────────────────
  // LOI-CH-08 : une seule image principale par chambre — transaction atomique
  fastify.put('/chambres/:chambre_id/images/:id/principale', {
    preHandler: preModifier,
  }, async (req, reply) => {
    const { chambre_id, id } = req.params

    // LOI-CH-01 — isolation tenant
    if (!await verifierChambreHotel(chambre_id, req.hotelId, reply)) return

    const image = await fastify.db('images_chambres')
      .where({ id, chambre_id })
      .first()
    if (!image) return reply.status(404).send({ erreur: 'Image introuvable' })

    await fastify.db.transaction(async (trx) => {
      await trx('images_chambres').where({ chambre_id }).update({ est_principale: false })
      await trx('images_chambres').where({ id }).update({ est_principale: true })
    })

    await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    req.log.info({ chambre_id, image_id: id }, 'Image principale définie')
    return reply.send({ message: 'Image principale définie' })
  })
}
