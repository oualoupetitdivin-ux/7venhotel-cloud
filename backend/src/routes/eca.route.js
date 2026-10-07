'use strict'

// ECA — contexte comptable courant de l'hôtel (LOT-OHADA-01)
//
// Remplace le stub historique ({ eca_context_id: null }). Route conservée pour
// compatibilité API ; sa logique pointe désormais sur les structures Finance OHADA :
//   eca_context_id = id de l'exercice comptable courant (null si dossier non initialisé)
//   exercice / periode_courante = lus dans exercices_comptables / periodes_comptables
// Contexte tenant/hôtel issu de contexteHotel — jamais du client.
module.exports = async function ecaRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel, fastify.verifierPermission('finance.lire')]

  fastify.get('/current', { preHandler: pre }, async (req, reply) => {
    const contexte = await fastify.accounting.contexteComptable({ tenantId: req.tenantId, hotelId: req.hotelId })
    reply.send({
      eca_context_id:   contexte.exercice ? contexte.exercice.id : null,
      source:           'finance.ohada',
      initialise:       contexte.initialise,
      exercice:         contexte.exercice,
      periode_courante: contexte.periode_courante,
    })
  })
}
