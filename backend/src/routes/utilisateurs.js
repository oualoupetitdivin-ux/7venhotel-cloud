'use strict'
module.exports = async function utilisateursRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager']), fastify.resolveTenantContext]

  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const users = await fastify.db('utilisateurs')
      .where({ tenant_id: req.tenantId })
      .select('id', 'email', 'prenom', 'nom', 'role', 'actif', 'derniere_connexion', 'avatar_url', 'hotel_id')
      .orderBy('nom')
    reply.send({ utilisateurs: users })
  })

  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    // ── Enforcement quota utilisateurs ───────────────────────────────────────
    const [subCtx, nbUsers] = await Promise.all([
      fastify.policy.loadSubscriptionContext(req.tenantId),
      fastify.db('utilisateurs').where({ tenant_id: req.tenantId, actif: true }).count('id AS nb').first(),
    ])
    const policyResult = await fastify.policy.evaluate('utilisateur.create', {
      plan:             subCtx.plan,
      nb_utilisateurs:  parseInt(nbUsers?.nb || 0),
      max_utilisateurs: subCtx.max_utilisateurs,
    })
    if (!policyResult.allowed) {
      req.log.warn({ tenant_id: req.tenantId, policy: 'utilisateur.create', result: policyResult }, 'POLICY_DENIED')
      return reply.status(403).send(policyResult)
    }

    const data = { ...req.body }
    data.mot_de_passe_hash = await fastify.hashMotDePasse(data.mot_de_passe || 'TempPass@2024!')
    delete data.mot_de_passe
    data.tenant_id = req.tenantId

    let user
    try {
      ;[user] = await fastify.db('utilisateurs').insert(data).returning(['id', 'email', 'prenom', 'nom', 'role'])
    } catch (err) {
      if (err.constraint === 'utilisateurs_tenant_id_email_key' || (err.message || '').includes('dupliquée')) {
        return reply.status(409).send({ erreur: 'Cet email est déjà utilisé dans ce tenant', code: 'EMAIL_DUPLIQUE' })
      }
      throw err
    }

    // Invalider le cache quota du tenant
    await fastify.cache.del(`tenant:${req.tenantId}:subscription`)

    await fastify.db('logs_audit').insert({
      tenant_id: req.tenantId,
      utilisateur_id: req.user.id,
      action: 'UTILISATEUR_CREE',
      module: 'utilisateurs',
      ressource_type: 'utilisateur',
      ressource_id: user.id,
      nouvelles_valeurs: JSON.stringify({ email: user.email, role: user.role }),
      ip_address: req.ip,
    }).catch(() => {})

    reply.status(201).send({ message: 'Utilisateur créé', utilisateur: user })
  })

  fastify.put('/:id', { preHandler: pre }, async (req, reply) => {
    const data = { ...req.body }
    if (data.mot_de_passe) {
      data.mot_de_passe_hash = await fastify.hashMotDePasse(data.mot_de_passe)
      delete data.mot_de_passe
    }

    // Lecture avant modification pour audit diff
    const avant = await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .select('email', 'role', 'actif')
      .first()
    if (!avant) return reply.status(404).send({ erreur: 'Utilisateur introuvable' })

    const [updated] = await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .update(data)
      .returning('*')

    await fastify.db('logs_audit').insert({
      tenant_id: req.tenantId,
      utilisateur_id: req.user.id,
      action: 'UTILISATEUR_MODIFIE',
      module: 'utilisateurs',
      ressource_type: 'utilisateur',
      ressource_id: req.params.id,
      anciennes_valeurs: JSON.stringify(avant),
      nouvelles_valeurs: JSON.stringify({ role: data.role, actif: data.actif }),
      ip_address: req.ip,
    }).catch(() => {})

    reply.send({ message: 'Utilisateur mis à jour', utilisateur: updated })
  })

  fastify.delete('/:id', { preHandler: pre }, async (req, reply) => {
    const avant = await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .select('email', 'role')
      .first()
    if (!avant) return reply.status(404).send({ erreur: 'Utilisateur introuvable' })

    await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .update({ actif: false })

    await fastify.db('logs_audit').insert({
      tenant_id: req.tenantId,
      utilisateur_id: req.user.id,
      action: 'UTILISATEUR_DESACTIVE',
      module: 'utilisateurs',
      ressource_type: 'utilisateur',
      ressource_id: req.params.id,
      anciennes_valeurs: JSON.stringify(avant),
      nouvelles_valeurs: JSON.stringify({ actif: false }),
      ip_address: req.ip,
    }).catch(() => {})

    reply.send({ message: 'Utilisateur désactivé' })
  })
}
