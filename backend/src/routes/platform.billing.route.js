'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/platform.billing.route.js — API Billing A3
//
// Routes (toutes : scope=platform, super_admin uniquement) :
//   POST /platform/billing/generate               → period + invoice atomiques
//   GET  /platform/billing/invoices               → liste toutes factures
//   GET  /platform/billing/invoices/:id           → facture détaillée + items
//   GET  /platform/tenants/:id/invoices           → factures d'un tenant
//   GET  /platform/tenants/:id/billing/periods    → périodes d'un tenant
//
// Interdictions A3 :
//   ❌ Aucun paiement, intent, webhook, refund, settlement, dunning
//   ❌ Aucune modification CONFIG / PMS / tenant 22222222-...
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function platformBillingRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.scopePlateforme]

  // ── POST /platform/billing/generate ───────────────────────────────────────
  // Génère une billing_period + invoice + items pour un tenant.
  // Atomique — rollback total si une étape échoue.
  // Idempotent — rejouer le même appel retourne les objets existants.
  fastify.post('/billing/generate', { preHandler: pre }, async (req, reply) => {
    const { tenant_id, debut_periode = null, snapshot_id = null } = req.body || {}

    if (!tenant_id) {
      return reply.status(400).send({ erreur: 'tenant_id requis', code: 'TENANT_ID_MANQUANT' })
    }

    try {
      const result = await fastify.billing.generatePeriodAndInvoice({
        tenant_id,
        debut_periode: debut_periode || null,
        snapshot_id_override: snapshot_id || null,
      })

      const status = result.idempotent ? 200 : 201
      return reply.status(status).send({
        message:    result.idempotent ? 'Période et facture déjà existantes (idempotent)' : 'Période et facture créées',
        idempotent: result.idempotent,
        period:     result.period,
        invoice:    result.invoice,
        items:      result.items,
        snapshot: {
          id:               result.snapshot.id,
          plan_code:        result.snapshot.plan_code,
          periodicite:      result.snapshot.periodicite,
          montant_centimes: result.snapshot.montant_centimes,
          devise:           result.snapshot.devise,
        },
      })
    } catch (err) {
      if (err.statusCode === 404) return reply.status(404).send({ erreur: err.message, code: err.code })
      if (err.statusCode === 409) return reply.status(409).send({ erreur: err.message, code: err.code })
      if (err.statusCode === 403) return reply.status(403).send({ erreur: err.message, code: err.code })
      throw err
    }
  })

  // ── GET /platform/billing/invoices ────────────────────────────────────────
  // Liste toutes les factures (cross-tenant, paginées).
  fastify.get('/billing/invoices', { preHandler: pre }, async (req, reply) => {
    const { tenant_id, statut, page = 1, limite = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    let q = fastify.db('platform_invoices AS i')
      .leftJoin('tenants AS t', 't.id', 'i.tenant_id')
      .select(
        'i.id', 'i.numero', 'i.tenant_id', 't.nom AS tenant_nom',
        'i.statut', 'i.montant_ht_centimes', 'i.montant_taxe_centimes',
        'i.montant_ttc_centimes', 'i.montant_paye_centimes', 'i.montant_restant_centimes',
        'i.devise', 'i.date_emission', 'i.date_echeance', 'i.cree_le',
      )
      .orderBy('i.date_emission', 'desc')

    if (tenant_id) q = q.where('i.tenant_id', tenant_id)
    if (statut)    q = q.where('i.statut', statut)

    const [invoices, total] = await Promise.all([
      q.limit(parseInt(limite)).offset(offset),
      fastify.db('platform_invoices').count('id AS total')
        .modify(q => {
          if (tenant_id) q.where('tenant_id', tenant_id)
          if (statut)    q.where('statut', statut)
        }).first(),
    ])

    return reply.send({
      invoices,
      pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total?.total || 0) },
    })
  })

  // ── GET /platform/billing/invoices/:id ────────────────────────────────────
  // Détail d'une facture : invoice + items + period + snapshot + tax_context.
  fastify.get('/billing/invoices/:id', { preHandler: pre }, async (req, reply) => {
    const detail = await fastify.billing.getInvoice(req.params.id)
    if (!detail) return reply.status(404).send({ erreur: 'Facture introuvable', code: 'INVOICE_NOT_FOUND' })
    return reply.send(detail)
  })

  // ── GET /platform/tenants/:id/invoices ────────────────────────────────────
  // Toutes les factures d'un tenant spécifique.
  fastify.get('/tenants/:id/invoices', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    const { statut, page = 1, limite = 20 } = req.query

    const tenant = await fastify.db('tenants').where({ id }).first()
    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })

    const result = await fastify.billing.getInvoicesByTenant(id, { page, limite, statut })
    return reply.send({ tenant_id: id, tenant_nom: tenant.nom, ...result })
  })

  // ── GET /platform/tenants/:id/billing/periods ────────────────────────────
  // Toutes les périodes de facturation d'un tenant.
  fastify.get('/tenants/:id/billing/periods', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    const { page = 1, limite = 20 } = req.query

    const tenant = await fastify.db('tenants').where({ id }).first()
    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })

    const abonnement = await fastify.db('abonnements')
      .where({ tenant_id: id })
      .orderByRaw("CASE WHEN statut='actif' THEN 0 WHEN statut='essai' THEN 1 ELSE 2 END")
      .first()
    if (!abonnement) return reply.send({ tenant_id: id, periods: [], total: 0 })

    const result = await fastify.billing.getBillingPeriods(abonnement.id, { page, limite })
    return reply.send({ tenant_id: id, subscription_id: abonnement.id, ...result })
  })
}
