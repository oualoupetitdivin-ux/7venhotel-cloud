'use strict'
const path = require('path')
const fs = require('fs/promises')
const crypto = require('crypto')
module.exports = async function uploadsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]
  const UPLOAD_DIR = path.join(__dirname, '../../../uploads/rooms')
  const MAX_IMAGES = parseInt(process.env.MAX_IMAGES_PER_ROOM) || 7
  fastify.post('/chambres/:chambre_id/images', { preHandler: pre }, async (req, reply) => {
    const { chambre_id } = req.params
    const existingCount = await fastify.db('images_chambres').where({ chambre_id }).count('id AS total').first()
    if (parseInt(existingCount.total) >= MAX_IMAGES) {
      return reply.status(400).send({ erreur: `Maximum ${MAX_IMAGES} images par chambre` })
    }
    const data = await req.file()
    if (!data) return reply.status(400).send({ erreur: 'Fichier manquant' })
    const ext = path.extname(data.filename).toLowerCase()
    const allowedExts = ['.jpg','.jpeg','.png','.webp']
    if (!allowedExts.includes(ext)) return reply.status(400).send({ erreur: 'Format non supporté. Utilisez JPG, PNG ou WebP.' })
    const filename = crypto.randomBytes(16).toString('hex') + ext
    const filepath = path.join(UPLOAD_DIR, filename)
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
    const buffer = await data.toBuffer()
    await fs.writeFile(filepath, buffer)
    const ordre = parseInt(existingCount.total)
    const [image] = await fastify.db('images_chambres').insert({
      chambre_id, url_fichier: `/uploads/rooms/${filename}`,
      nom_fichier: data.filename, taille_octets: buffer.length,
      est_principale: ordre === 0, ordre
    }).returning('*')
    await fastify.cache.delPattern(`chambres:${req.hotelId}*`)
    reply.status(201).send({ message: 'Image uploadée', image })
  })
  fastify.delete('/chambres/:chambre_id/images/:id', { preHandler: pre }, async (req, reply) => {
    const image = await fastify.db('images_chambres').where({ id: req.params.id, chambre_id: req.params.chambre_id }).first()
    if (!image) return reply.status(404).send({ erreur: 'Image introuvable' })
    try { await fs.unlink(path.join(__dirname, '../../../', image.url_fichier)) } catch {}
    await fastify.db('images_chambres').where({ id: req.params.id }).delete()
    reply.send({ message: 'Image supprimée' })
  })
}
