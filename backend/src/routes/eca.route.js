'use strict'

// Stub ECA — retourne eca_context_id: null
// La page /diagnostic affiche "Aucun contexte comptable disponible" proprement.
// L'intégration CEPOS complète est hors périmètre de ce déploiement.
module.exports = async function ecaRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  fastify.get('/current', { preHandler: pre }, async (req, reply) => {
    reply.send({ eca_context_id: null })
  })
}
