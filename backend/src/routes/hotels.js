'use strict'
const path   = require('path')
const fs     = require('fs/promises')
const crypto = require('crypto')

module.exports = async function hotelsRoutes(fastify) {
  const pre = [fastify.authentifier]

  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const tenantId = req.user.scope === 'platform'
      ? req.headers['x-tenant-id']
      : req.user.tenant_id
    if (!tenantId) return reply.status(400).send({ erreur: 'X-Tenant-ID requis pour l\'opérateur plateforme' })
    const hotels = await fastify.db('hotels').where({ tenant_id: tenantId }).select('*')
    reply.send({ hotels })
  })

  // ── GET /modules — Modules disponibles pour le tenant courant ──────────────
  // Expose le résultat de loadSubscriptionContext pour le frontend.
  // Utilisé par useTenantModules() pour le module-gating Sidebar.
  // NE constitue PAS une barrière de sécurité — le backend enforce toujours via PolicyEngine.
  fastify.get('/modules', { preHandler: [fastify.authentifier, fastify.resolveTenantContext] }, async (req, reply) => {
    if (!req.tenantId) return reply.status(400).send({ erreur: 'Tenant non résolu', code: 'TENANT_MANQUANT' })
    const ctx = await fastify.policy.loadSubscriptionContext(req.tenantId)
    reply.send({
      plan:    ctx.plan,
      statut:  ctx.statut,
      modules: ctx.modules,
    })
  })

  // ── POST / — Création avec enforcement quota ─────────────────────────────
  fastify.post('/', { preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager'])] }, async (req, reply) => {
    const tenantId = req.user.scope === 'platform' ? req.headers['x-tenant-id'] : req.user.tenant_id
    if (!tenantId) return reply.status(400).send({ erreur: 'X-Tenant-ID requis', code: 'TENANT_MANQUANT' })

    // ── Vérifier quota via PolicyEngine ──────────────────────────────────────
    const [subCtx, nbHotels] = await Promise.all([
      fastify.policy.loadSubscriptionContext(tenantId),
      fastify.db('hotels').where({ tenant_id: tenantId }).count('id AS nb').first(),
    ])
    const policyResult = await fastify.policy.evaluate('hotel.create', {
      plan:      subCtx.plan,
      nb_hotels: parseInt(nbHotels?.nb || 0),
      max_hotels: subCtx.max_hotels,
    })
    if (!policyResult.allowed) {
      req.log.warn({ tenant_id: tenantId, policy: 'hotel.create', result: policyResult }, 'POLICY_DENIED')
      return reply.status(403).send(policyResult)
    }

    const { nom, adresse, ville, pays, nombre_chambres, ...rest } = req.body
    if (!nom || !ville) return reply.status(400).send({ erreur: 'Nom et ville obligatoires' })

    const [hotel] = await fastify.db('hotels').insert({
      nom, adresse, ville, pays, nombre_chambres, tenant_id: tenantId, ...rest
    }).returning(['id', 'nom', 'ville', 'pays'])

    await fastify.audit.log({
      event: 'HOTEL_CREE', actor: { id: req.user.id, role: req.user.role, ip: req.ip },
      target: { type: 'hotel', id: hotel.id }, new_state: hotel, tenant_id: tenantId,
    })

    // Invalider le cache quota du tenant
    await fastify.cache.del(`tenant:${tenantId}:subscription`)

    reply.status(201).send({ message: 'Hôtel créé', hotel })
  })

  fastify.get('/:id', { preHandler: pre }, async (req, reply) => {
    const tenantId = req.user.scope === 'platform'
      ? req.headers['x-tenant-id']
      : req.user.tenant_id
    const filter = tenantId
      ? { id: req.params.id, tenant_id: tenantId }
      : { id: req.params.id }
    const hotel = await fastify.db('hotels').where(filter).first()
    if (!hotel) return reply.status(404).send({ erreur: 'Hôtel introuvable' })
    const params = await fastify.db('parametres_hotel').where({ hotel_id: hotel.id }).first()
    reply.send({ hotel, parametres: params })
  })

  // ── PATCH /:id — Mise à jour champs hôtel (nom, email, telephone, adresse…) ─
  fastify.patch('/:id', {
    preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager'])]
  }, async (req, reply) => {
    if (req.user.scope !== 'platform') {
      const hotel = await fastify.db('hotels')
        .where({ id: req.params.id, tenant_id: req.user.tenant_id }).first()
      if (!hotel) return reply.status(403).send({ erreur: 'Accès refusé', code: 'HOTEL_ACCES_REFUSE' })
    }
    const CHAMPS_AUTORISES = ['nom', 'adresse', 'ville', 'pays', 'telephone', 'email', 'site_web', 'description', 'nombre_etoiles', 'nombre_chambres', 'devise', 'fuseau_horaire']
    const update = Object.fromEntries(Object.entries(req.body).filter(([k]) => CHAMPS_AUTORISES.includes(k)))
    if (Object.keys(update).length === 0) return reply.status(400).send({ erreur: 'Aucun champ modifiable fourni' })
    const [updated] = await fastify.db('hotels').where({ id: req.params.id }).update(update).returning('*')
    reply.send({ message: 'Hôtel mis à jour', hotel: updated })
  })

  fastify.put('/:id/parametres', {
    preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager'])]
  }, async (req, reply) => {
    // Vérification cross-tenant pour les rôles exploitation
    if (req.user.scope !== 'platform') {
      const hotel = await fastify.db('hotels')
        .where({ id: req.params.id, tenant_id: req.user.tenant_id })
        .first()
      if (!hotel) {
        return reply.status(403).send({
          erreur: 'Accès refusé',
          message: 'Cet hôtel n\'appartient pas à votre organisation',
          code: 'HOTEL_ACCES_REFUSE',
        })
      }
    }

    // Lire avant modification pour diff d'audit
    const avant = await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).first()

    const existing = await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).first()
    if (existing) {
      await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).update(req.body)
    } else {
      await fastify.db('parametres_hotel').insert({ hotel_id: req.params.id, ...req.body })
    }

    // LOT-PMS-02 — Réglages fiscaux = façade de la table `taxes` (seule source de calcul)
    await require('../services/fiscalite.service').synchroniserDepuisParametres(fastify.db, req.params.id, req.body || {})

    // Audit log — même pour super_admin
    const hotel = await fastify.db('hotels').where({ id: req.params.id }).select('tenant_id').first()
    await fastify.db('logs_audit').insert({
      tenant_id:         hotel?.tenant_id,
      utilisateur_id:    req.user.id,
      hotel_id:          req.params.id,
      action:            'HOTEL_PARAMETRES_MODIFIES',
      module:            'hotels',
      ressource_type:    'parametres_hotel',
      ressource_id:      req.params.id,
      anciennes_valeurs: JSON.stringify(avant || {}),
      nouvelles_valeurs: JSON.stringify(req.body),
      ip_address:        req.ip,
    }).catch(() => {})

    await fastify.cache.delPattern('ai_ctx:*')
    reply.send({ message: 'Paramètres mis à jour' })
  })

  // ── POST /:id/image-fond — Upload photo d'ambiance ────────────────────────
  fastify.post('/:id/image-fond', {
    preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager'])]
  }, async (req, reply) => {
    if (req.user.scope !== 'platform') {
      const hotel = await fastify.db('hotels')
        .where({ id: req.params.id, tenant_id: req.user.tenant_id }).first()
      if (!hotel) return reply.status(403).send({ erreur: 'Accès refusé', code: 'HOTEL_ACCES_REFUSE' })
    }

    const data = await req.file()
    if (!data) return reply.status(400).send({ erreur: 'Fichier manquant' })

    const ext = path.extname(data.filename).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      return reply.status(400).send({ erreur: 'Format non supporté. Utilisez JPG, PNG ou WebP.' })
    }

    const uploadDir = path.join(__dirname, '../../../uploads/hotels')
    await fs.mkdir(uploadDir, { recursive: true })

    const filename = crypto.randomBytes(16).toString('hex') + ext
    const buffer   = await data.toBuffer()
    await fs.writeFile(path.join(uploadDir, filename), buffer)

    const imageUrl = `/uploads/hotels/${filename}`

    const existing = await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).first()
    if (existing) {
      await fastify.db('parametres_hotel').where({ hotel_id: req.params.id }).update({ image_fond_url: imageUrl })
      // Supprimer l'ancienne image si c'est un fichier local
      if (existing.image_fond_url?.startsWith('/uploads/')) {
        fs.unlink(path.join(__dirname, '../../../', existing.image_fond_url)).catch(() => {})
      }
    } else {
      await fastify.db('parametres_hotel').insert({ hotel_id: req.params.id, image_fond_url: imageUrl })
    }

    reply.send({ message: 'Image uploadée', url: imageUrl })
  })

  // ── Logo de l'hôtel (HELICONIA-READY-01) — affiché sur la facture ─────────
  // PNG / JPEG uniquement : seuls formats intégrables dans le PDF (pdf-lib).
  // Contrôle sur la signature binaire, pas seulement l'extension.
  const LOGO_MAX_OCTETS = 2 * 1024 * 1024
  const LOGO_DIR        = path.join(__dirname, '../../../uploads/logos')
  const formatLogo = (buf) => {
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return '.png'
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg'
    return null
  }
  const hotelDuTenant = async (req, reply) => {
    const q = fastify.db('hotels').where({ id: req.params.id })
    if (req.user.scope !== 'platform') q.where({ tenant_id: req.user.tenant_id })
    const hotel = await q.first()
    if (!hotel) reply.status(403).send({ erreur: 'Accès refusé', code: 'HOTEL_ACCES_REFUSE' })
    return hotel
  }
  const supprimerFichierLogo = (url) => {
    if (url?.startsWith('/uploads/logos/'))
      fs.unlink(path.join(__dirname, '../../../', url)).catch(() => {})
  }

  fastify.post('/:id/logo', {
    preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager'])]
  }, async (req, reply) => {
    const hotel = await hotelDuTenant(req, reply)
    if (!hotel) return

    const data = await req.file()
    if (!data) return reply.status(400).send({ erreur: 'Fichier manquant', code: 'FICHIER_MANQUANT' })
    const buffer = await data.toBuffer()
    if (buffer.length > LOGO_MAX_OCTETS)
      return reply.status(400).send({ erreur: 'Logo trop lourd (2 Mo maximum)', code: 'LOGO_TROP_LOURD' })
    const ext = formatLogo(buffer)
    if (!ext) return reply.status(400).send({ erreur: 'Format non supporté. Utilisez PNG ou JPEG.', code: 'LOGO_FORMAT' })

    await fs.mkdir(LOGO_DIR, { recursive: true })
    const filename = `${hotel.id}-${crypto.randomBytes(6).toString('hex')}${ext}`
    await fs.writeFile(path.join(LOGO_DIR, filename), buffer)
    const logoUrl = `/uploads/logos/${filename}`

    await fastify.db('hotels').where({ id: hotel.id }).update({ logo_url: logoUrl })
    supprimerFichierLogo(hotel.logo_url)
    req.log.info({ hotel_id: hotel.id, taille: buffer.length }, 'Logo hôtel mis à jour')
    reply.status(201).send({ message: 'Logo enregistré', logo_url: logoUrl })
  })

  fastify.delete('/:id/logo', {
    preHandler: [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager'])]
  }, async (req, reply) => {
    const hotel = await hotelDuTenant(req, reply)
    if (!hotel) return
    await fastify.db('hotels').where({ id: hotel.id }).update({ logo_url: null })
    supprimerFichierLogo(hotel.logo_url)
    reply.send({ message: 'Logo supprimé' })
  })
}
