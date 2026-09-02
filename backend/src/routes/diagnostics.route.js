'use strict'

// Stub diagnostics — retourne état vide cohérent avec le frontend
// La page affiche "Aucun Diagnostic" + bouton "Lancer" inactif (eca_context_id=null).
module.exports = async function diagnosticsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    reply.status(501).send({ erreur: 'Moteur CEPOS non intégré', code: 'NON_IMPLEMENTE' })
  })

  fastify.get('/current', { preHandler: pre }, async (req, reply) => {
    reply.send({ data: null })
  })

  fastify.get('/history', { preHandler: pre }, async (req, reply) => {
    reply.send({ history: [] })
  })
}
