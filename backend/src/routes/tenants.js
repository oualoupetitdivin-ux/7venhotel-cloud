'use strict'
module.exports = async function tenantsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.verifierRole(['super_admin'])]
  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const tenants = await fastify.db('tenants').select('*').orderBy('cree_le','desc')
    reply.send({ tenants })
  })
  // ── POST / — DÉSACTIVÉ (410 Gone) ───────────────────────────────────────
  // Parcours de création sécurisé : POST /platform/tenants (provisioning officiel)
  // Cet endpoint ne doit plus être utilisé — il court-circuitait le lifecycle
  // et n'appliquait aucun audit, quota ni transition d'état.
  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    return reply.status(410).send({
      erreur: 'Endpoint désactivé',
      message: 'Utilisez POST /api/v1/platform/tenants pour créer un tenant. Cet endpoint ne respecte pas le lifecycle de provisioning.',
      code:    'ENDPOINT_DESACTIVE',
      redirect: '/api/v1/platform/tenants',
    })
  })
  fastify.put('/:id', { preHandler: pre }, async (req, reply) => {
    const avant = await fastify.db('tenants').where({ id: req.params.id }).select('nom', 'statut', 'parametres').first()
    const [updated] = await fastify.db('tenants').where({ id: req.params.id }).update(req.body).returning('*')

    await fastify.db('logs_audit').insert({
      tenant_id:        req.params.id,
      utilisateur_id:   req.user.id,
      action:           'TENANT_MODIFIE',
      module:           'platform',
      ressource_type:   'tenant',
      ressource_id:     req.params.id,
      anciennes_valeurs: JSON.stringify(avant),
      nouvelles_valeurs: JSON.stringify(req.body),
      ip_address:       req.ip,
    }).catch(() => {})

    reply.send({ message: 'Tenant mis à jour', tenant: updated })
  })
}
