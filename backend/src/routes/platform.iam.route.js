'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// platform.iam.route.js — Identity & Access Management Control Plane
//
// INVARIANTS garantis par ce module :
//   ① Toute session est révocable instantanément (Redis + DB)
//   ② Toute impersonation est auditée avec IP + raison + durée
//   ③ Impossible d'escalader ses privilèges via impersonation
//   ④ Max 5 sessions d'impersonation par admin/jour (policy engine)
//   ⑤ Bannière impersonation encodée dans le token — non falsifiable
//   ⑥ Révocation tenant-wide atomique (pipeline Redis + DB bulk update)
//
// Routes exposées :
//   GET    /platform/iam/sessions                  → sessions actives plateforme
//   GET    /platform/iam/sessions/tenant/:id        → sessions d'un tenant
//   DELETE /platform/iam/sessions/:jti             → révoquer une session
//   DELETE /platform/iam/sessions/tenant/:id        → révoquer toutes sessions tenant
//   POST   /platform/iam/impersonate/:tenant_id     → démarrer impersonation
//   DELETE /platform/iam/impersonate/:session_id    → terminer impersonation
//   GET    /platform/iam/impersonation-sessions     → historique impersonations
// ─────────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto')

// Durée max d'une session d'impersonation : 2 heures
const IMPERSONATION_TTL_SECONDS = 2 * 60 * 60

module.exports = async function platformIamRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.scopePlateforme]

  // ── GET /platform/iam/sessions ───────────────────────────────────────────
  // Liste les sessions actives sur toute la plateforme (avec pagination).
  fastify.get('/sessions', { preHandler: pre }, async (req, reply) => {
    const { tenant_id, page = 1, limite = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    let query = fastify.db('sessions_actives AS s')
      .leftJoin('utilisateurs AS u', 'u.id', 's.utilisateur_id')
      .leftJoin('tenants AS t',      't.id', 's.tenant_id')
      .select(
        's.jti', 's.scope', 's.role', 's.ip_address', 's.expire_le', 's.cree_le', 's.revoque_le',
        'u.email AS user_email', 'u.prenom', 'u.nom',
        't.nom AS tenant_nom', 't.pays AS tenant_pays',
      )
      .where('s.expire_le', '>', fastify.db.fn.now())
      .whereNull('s.revoque_le')
      .orderBy('s.cree_le', 'desc')

    if (tenant_id) query = query.where('s.tenant_id', tenant_id)

    const [sessions, total] = await Promise.all([
      query.limit(parseInt(limite)).offset(offset),
      fastify.db('sessions_actives').count('jti AS total')
        .where('expire_le', '>', fastify.db.fn.now())
        .whereNull('revoque_le')
        .modify(q => { if (tenant_id) q.where('tenant_id', tenant_id) })
        .first(),
    ])

    return reply.send({
      sessions,
      pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total?.total || 0) },
    })
  })

  // ── GET /platform/iam/sessions/tenant/:id ────────────────────────────────
  fastify.get('/sessions/tenant/:id', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params

    const tenant = await fastify.db('tenants').where({ id }).select('nom', 'statut').first()
    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })

    const sessions = await fastify.db('sessions_actives AS s')
      .leftJoin('utilisateurs AS u', 'u.id', 's.utilisateur_id')
      .select('s.jti', 's.scope', 's.role', 's.ip_address', 's.expire_le', 's.cree_le', 'u.email', 'u.prenom', 'u.nom')
      .where('s.tenant_id', id)
      .where('s.expire_le', '>', fastify.db.fn.now())
      .whereNull('s.revoque_le')
      .orderBy('s.cree_le', 'desc')

    return reply.send({ tenant, sessions, total: sessions.length })
  })

  // ── DELETE /platform/iam/sessions/:jti ───────────────────────────────────
  // Révoque une session individuelle par son JTI.
  fastify.delete('/sessions/:jti', { preHandler: pre }, async (req, reply) => {
    const { jti } = req.params

    const session = await fastify.db('sessions_actives').where({ jti }).whereNull('revoque_le').first()
    if (!session) return reply.status(404).send({ erreur: 'Session introuvable ou déjà révoquée', code: 'SESSION_INTROUVABLE' })

    // Audit strict — bloquer si l'audit échoue
    await fastify.audit.platform(req, 'SESSION_REVOQUEE',
      { type: 'session', id: jti, tenant_id: session.tenant_id },
      { scope: session.scope, user_email: session.utilisateur_id },
      { revoque_par: req.user.id },
    )

    await fastify.revoquerSession(jti, session.tenant_id)

    req.log.warn({ jti, tenant_id: session.tenant_id, admin: req.user.id }, 'SESSION_REVOQUEE')
    return reply.send({ message: 'Session révoquée', jti })
  })

  // ── DELETE /platform/iam/sessions/tenant/:id ─────────────────────────────
  // Révoque toutes les sessions actives d'un tenant (utilisé par suspension).
  fastify.delete('/sessions/tenant/:id', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    const { motif = 'révocation administrative' } = req.body || {}

    const tenant = await fastify.db('tenants').where({ id }).first()
    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })

    // Audit strict avant action
    await fastify.audit.platform(req, 'SESSIONS_MASS_REVOKE',
      { type: 'tenant', id, tenant_id: id },
      null,
      { motif, admin_id: req.user.id },
    )

    const nbRevoked = await fastify.revoquerSessionsTenant(id)

    req.log.warn({ tenant_id: id, nb_revoked: nbRevoked, motif }, 'SESSIONS_MASS_REVOKE')
    return reply.send({ message: `${nbRevoked} session(s) révoquée(s)`, tenant_id: id, nb_revoked: nbRevoked })
  })

  // ── POST /platform/iam/impersonate/:tenant_id ────────────────────────────
  // Rate limit : 10 impersonations / heure par admin (defense-in-depth, en plus de la policy)
  fastify.post('/impersonate/:tenant_id', {
    preHandler: pre,
    config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: (req) => req.user?.id || req.ip } }
  }, async (req, reply) => {
    const { tenant_id }  = req.params
    const { raison = '' } = req.body || {}

    // Validation raison
    if (!raison || raison.trim().length < 10) {
      return reply.status(400).send({
        erreur: 'Raison obligatoire (minimum 10 caractères)',
        code:   'RAISON_REQUISE',
      })
    }

    const tenant = await fastify.db('tenants').where({ id: tenant_id }).first()
    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })
    if (tenant.statut === 'resilié') {
      return reply.status(403).send({ erreur: 'Impossible d\'impersonner un tenant résilié', code: 'TENANT_RESILIÉ' })
    }

    // Policy centralisée : limite quotidienne impersonations (PolicyEngine)
    // Le chargement du context est fait ici — la policy est stateless
    const sessionsDuJour = await fastify.db('platform_impersonation_sessions')
      .where('admin_id', req.user.id)
      .whereRaw("cree_le >= NOW() - INTERVAL '24 hours'")
      .count('id AS nb').first()

    const policyResult = await fastify.policy.evaluate('iam.impersonate', {
      sessions_today:       parseInt(sessionsDuJour?.nb || 0),
      max_sessions_per_day: parseInt(process.env.IAM_IMPERSONATION_DAILY_LIMIT || '5'),
    })
    if (!policyResult.allowed) {
      req.log.warn({ admin_id: req.user.id, sessions_today: sessionsDuJour?.nb }, 'IMPERSONATION_POLICY_DENIED')
      return reply.status(403).send(policyResult)
    }

    // Générer le token d'impersonation — scope distinct, non réutilisable
    const jti        = randomUUID()
    const expire_le  = new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000)
    const exp        = Math.floor(expire_le.getTime() / 1000)

    const impersonationToken = fastify.jwt.sign({
      // Identité du super_admin qui impersonne (non celle du tenant)
      id:                    req.user.id,
      email:                 req.user.email,
      role:                  req.user.role,
      scope:                 'impersonation',          // scope distinct — pas 'platform'
      impersonating_tenant:  tenant_id,
      tenant_nom:            tenant.nom,
      jti,
    }, { expiresIn: IMPERSONATION_TTL_SECONDS })

    // Persister en DB (audit trail immuable)
    const [session] = await fastify.db('platform_impersonation_sessions').insert({
      admin_id:   req.user.id,
      tenant_id,
      raison:     raison.trim(),
      jti,
      ip_address: req.ip,
      user_agent: (req.headers['user-agent'] || '').slice(0, 255),
      expire_le:  expire_le.toISOString(),
    }).returning('*')

    // Session Redis pour révocation
    await fastify.cache.set(`session:${jti}`, {
      scope:      'impersonation',
      admin_id:   req.user.id,
      tenant_id,
    }, IMPERSONATION_TTL_SECONDS)

    // Audit strict — impersonation doit être tracée ou l'opération échoue
    await fastify.audit.platform(req, 'IMPERSONATION_DEMARREE',
      { type: 'tenant', id: tenant_id, tenant_id },
      null,
      { session_id: session.id, raison: raison.trim(), expire_le: expire_le.toISOString() },
    )

    req.log.warn({
      event:       'IMPERSONATION_DEMARREE',
      session_id:  session.id,
      tenant_id,
      tenant_nom:  tenant.nom,
      admin_id:    req.user.id,
      expire_le:   expire_le.toISOString(),
    }, 'Impersonation démarrée')

    return reply.send({
      impersonation_token: impersonationToken,
      session_id:          session.id,
      tenant_id,
      tenant_nom:          tenant.nom,
      expire_le:           expire_le.toISOString(),
      message:             `Impersonation active pour ${tenant.nom} — expire dans 2h`,
    })
  })

  // ── DELETE /platform/iam/impersonate/:session_id ──────────────────────────
  // Termine une session d'impersonation et révoque son token.
  fastify.delete('/impersonate/:session_id', { preHandler: pre }, async (req, reply) => {
    const { session_id } = req.params

    const session = await fastify.db('platform_impersonation_sessions')
      .where({ id: session_id })
      .whereNull('revoque_le')
      .first()

    if (!session) {
      return reply.status(404).send({ erreur: 'Session d\'impersonation introuvable ou déjà terminée', code: 'SESSION_INTROUVABLE' })
    }

    // Révoquer le token d'impersonation
    await fastify.cache.del(`session:${session.jti}`)

    // Marquer comme révoquée en DB
    await fastify.db('platform_impersonation_sessions')
      .where({ id: session_id })
      .update({ revoque_le: fastify.db.fn.now(), revoque_par: req.user.id })

    // Audit strict
    await fastify.audit.platform(req, 'IMPERSONATION_REVOQUEE',
      { type: 'tenant', id: session.tenant_id, tenant_id: session.tenant_id },
      { jti: session.jti, expire_le: session.expire_le },
      { session_id, revoque_par: req.user.id },
    )

    req.log.info({ session_id, tenant_id: session.tenant_id }, 'IMPERSONATION_REVOQUEE')
    return reply.send({ message: 'Session d\'impersonation terminée', session_id })
  })

  // ── GET /platform/iam/impersonation-sessions ─────────────────────────────
  // Historique complet des impersonations (actives + passées).
  fastify.get('/impersonation-sessions', { preHandler: pre }, async (req, reply) => {
    const { tenant_id, statut, page = 1, limite = 30 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    let query = fastify.db('platform_impersonation_sessions AS s')
      .leftJoin('utilisateurs AS a', 'a.id', 's.admin_id')
      .leftJoin('tenants AS t',      't.id', 's.tenant_id')
      .select(
        's.id', 's.raison', 's.ip_address', 's.expire_le', 's.revoque_le', 's.cree_le',
        'a.email AS admin_email', 'a.prenom AS admin_prenom', 'a.nom AS admin_nom',
        't.nom AS tenant_nom', 't.pays AS tenant_pays',
      )
      .orderBy('s.cree_le', 'desc')

    if (tenant_id) query = query.where('s.tenant_id', tenant_id)
    if (statut === 'active') {
      query = query.whereNull('s.revoque_le').where('s.expire_le', '>', fastify.db.fn.now())
    } else if (statut === 'terminee') {
      query = query.where(q => q.whereNotNull('s.revoque_le').orWhere('s.expire_le', '<=', fastify.db.fn.now()))
    }

    const [sessions, total] = await Promise.all([
      query.limit(parseInt(limite)).offset(offset),
      fastify.db('platform_impersonation_sessions').count('id AS total')
        .modify(q => { if (tenant_id) q.where('tenant_id', tenant_id) })
        .first(),
    ])

    return reply.send({
      sessions: sessions.map(s => ({
        ...s,
        active: !s.revoque_le && new Date(s.expire_le) > new Date(),
      })),
      pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total?.total || 0) },
    })
  })
}
