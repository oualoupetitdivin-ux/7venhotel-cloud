'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// _base.service.js — MODÈLE pour tous les services
//
// Règles :
//   - Seule couche qui contient les règles métier
//   - Ouvre et possède les transactions — les propage aux repositories via trx
//   - Aucune connaissance de req, reply, ou HTTP
//   - Lève des DomainError — jamais de reply.status() ici
// ─────────────────────────────────────────────────────────────────────────────

const { NotFoundError, ConflictError } = require('../errors')

// Exemple d'un service complet illustrant tous les patterns.
// Chaque module réel étend ce modèle — sans l'importer (copier-adapter).

function createBaseService({ db, cache }, repo, cachePrefix) {

  const cle      = (hotelId)     => `${cachePrefix}:${hotelId}`
  const cleItem  = (hotelId, id) => `${cachePrefix}:${hotelId}:${id}`

  return {

    // ── Lecture avec cache ────────────────────────────────────────────────
    async getParId(id, hotelId) {
      const cached = await cache.get(cleItem(hotelId, id))
      if (cached) return cached

      const entite = await repo.trouverParId(id, hotelId)
      if (!entite) throw new NotFoundError(cachePrefix, id)

      await cache.set(cleItem(hotelId, id), entite, 120)
      return entite
    },

    // ── Mutation simple ───────────────────────────────────────────────────
    async mettreAJour(id, hotelId, champs) {
      await this.getParId(id, hotelId)   // lève NotFoundError si absent

      const mis = await repo.mettreAJour(id, hotelId, champs)

      await Promise.all([
        cache.del(cleItem(hotelId, id)),
        cache.delPattern(cle(hotelId)),
      ])
      return mis
    },

    // ── Opération composée avec transaction ───────────────────────────────
    // Pattern Knex recommandé : callback async — commit automatique si succès,
    // rollback automatique si exception. Garanti même sur erreur inattendue.
    // Cache invalidé dans un .then() après résolution — jamais dans le callback
    // (le callback ne garantit pas que le commit est effectif avant de continuer).
    async operationComposee(hotelId, donnees, autreRepo) {
      let resultat

      await db.transaction(async (trx) => {
        resultat = await repo.creer(donnees, trx)
        await autreRepo.mettreAJour(donnees.ref_id, hotelId, { statut: 'lie' }, trx)
        // Pas de commit() explicite — Knex commit automatiquement si le callback
        // se résout sans erreur. Rollback automatique si une erreur est levée.
      })

      // Ici la transaction est commitée — cache invalidé en toute sécurité
      await cache.delPattern(cle(hotelId))
      return resultat
    },

    // ── Vérification d'unicité réutilisable ───────────────────────────────
    async _assertUnique({ hotelId, where, excluireId, code, message }) {
      const existe = await repo.existeParCritere({ hotelId, where, excluireId })
      if (existe) throw new ConflictError(message, code, { hotel_id: hotelId, ...where })
    },

  }
}

module.exports = { createBaseService }
