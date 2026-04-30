'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// _base.repository.js — MODÈLE pour tous les repositories
//
// Règles :
//   - Seule couche qui connaît Knex et les noms de tables
//   - Aucune règle métier — aucun if/else décisionnel
//   - hotelId obligatoire sur toute requête scopée
//   - conn(trx) : utilise la transaction si fournie, sinon db global
// ─────────────────────────────────────────────────────────────────────────────

function createBaseRepository(db, table) {
  const conn = (trx) => trx || db

  return {

    async trouverParId(id, hotelId, trx) {
      return conn(trx)(table)
        .where({ id, hotel_id: hotelId })
        .first() ?? null
    },

    async lister({ hotelId, filtres = {}, page = 1, limite = 50 }, trx) {
      const offset = (page - 1) * limite
      let q = conn(trx)(table).where({ hotel_id: hotelId, ...filtres })
      const [donnees, [{ total }]] = await Promise.all([
        q.clone().limit(limite).offset(offset),
        q.clone().count('id AS total'),
      ])
      return { donnees, total: parseInt(total) }
    },

    async existeParCritere({ hotelId, where, excluireId = null }, trx) {
      let q = conn(trx)(table).where({ hotel_id: hotelId, ...where })
      if (excluireId) q = q.whereNot({ id: excluireId })
      return !!(await q.first())
    },

    async creer(champs, trx) {
      const c = conn(trx)
      const [cree] = await c(table)
        .insert({ ...champs, cree_le: c.fn.now(), mis_a_jour_le: c.fn.now() })
        .returning('*')
      return cree
    },

    async mettreAJour(id, hotelId, champs, trx) {
      const c = conn(trx)
      const [mis] = await c(table)
        .where({ id, hotel_id: hotelId })
        .update({ ...champs, mis_a_jour_le: c.fn.now() })
        .returning('*')
      return mis ?? null
    },

    async desactiver(id, hotelId, trx) {
      const c = conn(trx)
      await c(table)
        .where({ id, hotel_id: hotelId })
        .update({ actif: false, mis_a_jour_le: c.fn.now() })
    },

  }
}

module.exports = { createBaseRepository }
