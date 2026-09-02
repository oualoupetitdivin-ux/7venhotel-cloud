'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// onboarding.route.js — Premier hôtel du manager SaaS
//
// Parcours :
//   POST /onboarding/hotel  → Manager (hotel_id=null) crée son premier hôtel
//
// INVARIANTS :
//   ① JWT scope='hotel', role='manager', hotel_id=null obligatoires
//   ② tenant.statut doit être 'essai' ou 'actif'
//   ③ PolicyEngine vérifie le quota hotel.create avant création
//   ④ Transaction atomique : INSERT hotels + parametres_hotel + UPDATE utilisateurs
//   ⑤ UPDATE utilisateurs WHERE hotel_id IS NULL → idempotence anti-race condition
//   ⑥ Nouveau JWT émis avec hotel_id — ancien JWT abandonné, expire naturellement
//   ⑦ AuditEngine strict sur HOTEL_CREE et MANAGER_HOTEL_ASSIGNE
// ─────────────────────────────────────────────────────────────────────────────

const { randomUUID, randomBytes } = require('crypto')

// Convertit un nom en slug URL-safe
function slugifier(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Génère un slug unique parmi les hôtels d'un tenant
async function slugUnique(db, tenantId, nom) {
  const base  = slugifier(nom)
  let   slug  = base
  let   n     = 2
  while (true) {
    const exists = await db('hotels').where({ tenant_id: tenantId, slug }).first()
    if (!exists) return slug
    slug = `${base}-${n++}`
    if (n > 20) return `${base}-${randomBytes(3).toString('hex')}`
  }
}

const STATUTS_AUTORISES = new Set(['essai', 'actif'])
const STATUT_CODES = {
  lead:      { code: 'TENANT_ABONNEMENT_REQUIS',  msg: 'Un abonnement est requis avant de créer un hôtel' },
  suspendu:  { code: 'TENANT_SUSPENDU',            msg: 'Ce compte est suspendu — contactez le support' },
  grace:     { code: 'TENANT_EN_GRACE',            msg: 'Compte en période de grâce — régularisez votre abonnement' },
  résilié:   { code: 'TENANT_RESILIE',             msg: 'Ce compte est résilié' },
}

module.exports = async function onboardingRoutes(fastify) {

  // ── POST /onboarding/hotel ────────────────────────────────────────────────
  //
  // Crée le premier hôtel d'un manager fraîchement provisionné.
  // Émet un nouveau JWT contenant hotel_id — le frontend remplace sa session.
  //
  fastify.post('/hotel', {
    preHandler: [fastify.authentifier, fastify.verifierRole(['manager'])],
    config: { rateLimit: { max: process.env.NODE_ENV === 'test' ? 1000 : 5, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const user = req.user

    // ── Guard 1 : scope hotel uniquement ─────────────────────────────────────
    if (user.scope !== 'hotel') {
      return reply.status(403).send({
        erreur: 'Route réservée aux managers hôtel',
        code:   'SCOPE_INCORRECT',
      })
    }

    // ── Guard 2 : hotel_id doit être null (pas encore d'hôtel) ───────────────
    if (user.hotel_id != null) {
      return reply.status(409).send({
        erreur: 'Votre compte a déjà un hôtel assigné',
        code:   'HOTEL_DEJA_ASSIGNE',
      })
    }

    // ── Validation body ───────────────────────────────────────────────────────
    const {
      nom,
      ville,
      pays           = 'Cameroun',
      adresse        = null,
      nombre_chambres = 0,
      devise         = 'XAF',
      fuseau_horaire = 'Africa/Douala',
    } = req.body || {}

    const manquants = []
    if (!nom?.trim())       manquants.push('nom')
    if (!ville?.trim())     manquants.push('ville')
    if (manquants.length) {
      return reply.status(400).send({
        erreur: 'Champs obligatoires manquants',
        champs: manquants,
        code:   'VALIDATION_ECHEC',
      })
    }

    const nbChambres = parseInt(nombre_chambres, 10)
    if (isNaN(nbChambres) || nbChambres < 0) {
      return reply.status(400).send({
        erreur: 'nombre_chambres doit être un entier positif',
        code:   'VALIDATION_ECHEC',
      })
    }

    const tenantId = user.tenant_id

    // ── Vérifier statut tenant ────────────────────────────────────────────────
    const tenant = await fastify.db('tenants').where({ id: tenantId }).first()
    if (!tenant) {
      return reply.status(403).send({ erreur: 'Organisation introuvable', code: 'TENANT_INTROUVABLE' })
    }

    if (!STATUTS_AUTORISES.has(tenant.statut)) {
      const err = STATUT_CODES[tenant.statut] || { code: 'TENANT_STATUT_BLOQUANT', msg: `Statut tenant non autorisé : ${tenant.statut}` }
      return reply.status(403).send({ erreur: err.msg, code: err.code })
    }

    // ── PolicyEngine : quota hotel.create ─────────────────────────────────────
    const [subCtx, nbHotels] = await Promise.all([
      fastify.policy.loadSubscriptionContext(tenantId),
      fastify.db('hotels').where({ tenant_id: tenantId }).count('id AS nb').first(),
    ])

    const policyResult = await fastify.policy.evaluate('hotel.create', {
      plan:       subCtx.plan,
      nb_hotels:  parseInt(nbHotels?.nb || 0),
      max_hotels: subCtx.max_hotels,
    })

    if (!policyResult.allowed) {
      req.log.warn({ tenant_id: tenantId, policy: 'hotel.create', result: policyResult }, 'POLICY_DENIED')
      return reply.status(403).send({ ...policyResult, code: policyResult.code || 'QUOTA_DEPASSE' })
    }

    // ── Générer slug unique ───────────────────────────────────────────────────
    const slug = await slugUnique(fastify.db, tenantId, nom.trim())

    // ── Transaction atomique ──────────────────────────────────────────────────
    let hotel
    await fastify.db.transaction(async (trx) => {
      // 1. Créer l'hôtel
      const hotelId = randomUUID()
      ;[hotel] = await trx('hotels').insert({
        id:             hotelId,
        tenant_id:      tenantId,
        nom:            nom.trim(),
        slug,
        adresse:        adresse?.trim() || '',
        ville:          ville.trim(),
        pays:           pays.trim(),
        nombre_chambres: nbChambres,
      }).returning(['id', 'nom', 'slug', 'ville', 'pays', 'nombre_chambres', 'tenant_id'])

      // 2. Initialiser parametres_hotel
      await trx('parametres_hotel').insert({
        id:             randomUUID(),
        hotel_id:       hotelId,
        devise:         devise.trim().toUpperCase(),
        fuseau_horaire: fuseau_horaire.trim(),
        langue:         'fr',
      })

      // 3. Assigner le manager — idempotent : WHERE hotel_id IS NULL
      const rowsAffected = await trx('utilisateurs')
        .where({ id: user.id, tenant_id: tenantId })
        .whereNull('hotel_id')
        .update({ hotel_id: hotelId })

      if (rowsAffected === 0) {
        throw Object.assign(
          new Error('hotel_id déjà défini sur ce compte'),
          { statusCode: 409, code: 'HOTEL_DEJA_ASSIGNE' }
        )
      }
    })

    // ── Audit (après COMMIT — FK hotel_id nullable dans logs_audit) ───────────
    await fastify.audit.log({
      event:          'HOTEL_CREE',
      actor:          { id: user.id, role: user.role, ip: req.ip },
      target:         { type: 'hotel', id: hotel.id },
      new_state:      { nom: hotel.nom, slug, ville: hotel.ville, pays: hotel.pays },
      tenant_id:      tenantId,
      hotel_id:       hotel.id,
      correlation_id: req.correlationId,
      strict:         true,
    })

    await fastify.audit.log({
      event:          'MANAGER_HOTEL_ASSIGNE',
      actor:          { id: user.id, role: user.role, ip: req.ip },
      target:         { type: 'utilisateur', id: user.id },
      new_state:      { hotel_id: hotel.id, hotel_nom: hotel.nom },
      tenant_id:      tenantId,
      hotel_id:       hotel.id,
      correlation_id: req.correlationId,
      strict:         true,
    })

    // ── Émettre un nouveau JWT avec hotel_id ──────────────────────────────────
    const userMisAJour = await fastify.db('utilisateurs')
      .where({ id: user.id })
      .first()

    const nouveauToken        = fastify.genererToken(userMisAJour)
    const nouveauTokenRefresh = fastify.genererTokenRafraichissement(userMisAJour)

    await fastify.cache.set(`refresh:${userMisAJour.id}`, nouveauTokenRefresh, 7 * 24 * 3600)
    await fastify.creerSession(userMisAJour, nouveauToken, req.ip, req.headers['user-agent'])

    // Invalider cache quota tenant
    await fastify.cache.del(`tenant:${tenantId}:subscription`)

    req.log.info({
      event:     'ONBOARDING_HOTEL_COMPLETE',
      tenant_id: tenantId,
      hotel_id:  hotel.id,
      manager_id: user.id,
    }, 'Premier hôtel créé — session mise à jour')

    // ── Paramètres hôtel pour la réponse ─────────────────────────────────────
    const params = await fastify.db('parametres_hotel')
      .where({ hotel_id: hotel.id })
      .select('devise', 'fuseau_horaire', 'langue')
      .first()

    return reply.status(201).send({
      token:                  nouveauToken,
      token_rafraichissement: nouveauTokenRefresh,
      utilisateur: {
        id:               userMisAJour.id,
        email:            userMisAJour.email,
        prenom:           userMisAJour.prenom,
        nom:              userMisAJour.nom,
        role:             userMisAJour.role,
        hotel_id:         userMisAJour.hotel_id,
        tenant_id:        userMisAJour.tenant_id,
        doit_changer_mdp: userMisAJour.doit_changer_mdp === true,
      },
      hotel: {
        id:             hotel.id,
        nom:            hotel.nom,
        ville:          hotel.ville,
        pays:           hotel.pays,
        nombre_chambres: hotel.nombre_chambres,
        devise:         params?.devise         || devise.toUpperCase(),
        fuseau_horaire: params?.fuseau_horaire || fuseau_horaire,
        langue:         params?.langue         || 'fr',
      },
    })
  })
}
