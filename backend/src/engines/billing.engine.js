'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// billing.engine.js — Moteur de facturation Billing A3
//
// Périmètre autorisé (CEPOS GO A3) :
//   A3.1  Billing Periods (mensuel / annuel)
//   A3.2  Invoices + Invoice Items
//   A3.3  Prix depuis snapshot historique (pas le plan courant)
//   A3.4  Arithmétique de dates avec gestion du leap-day
//
// Interdictions :
//   ❌ Payment Intents / Payments / Refunds / Settlements
//   ❌ Webhooks
//   ❌ Dunning
//   ❌ Modification CONFIG / PMS / tenant 22222222-...
//   ❌ Nouvelle migration SQL
//
// Atomicité :
//   generatePeriodAndInvoice() : billing_period + invoice + items
//   dans une SEULE transaction Knex — rollback total sur toute erreur.
//
// Source de vérité des prix :
//   subscription_snapshots (snapshot actif ou snapshot de la période)
//   jamais abonnements.montant_mensuel ni plan courant post-changement.
//
// Idempotence :
//   billing_periods    : UNIQUE(subscription_id, debut_periode)
//   platform_invoices  : UNIQUE(billing_period_id) + UNIQUE(idempotency_key)
//   Double appel → retourne les objets existants sans duplication.
//
// Fiscalité :
//   Résout tax_configurations WHERE juridiction=tenant.pays, actif=true,
//   s_applique_a IN ('subscription','all').
//   Si absent → taux=0, pas de tax_context créé.
//   Montants TOUJOURS en centimes INTEGER (jamais DECIMAL).
// ─────────────────────────────────────────────────────────────────────────────

const fp = require('fastify-plugin')

// ── Utilitaires date ─────────────────────────────────────────────────────────

// Extrait "YYYY-MM-DD" d'un Date object (heure locale) ou d'une string ISO.
// Le driver pg retourne les colonnes DATE comme Date objects en heure locale.
// Sur WAT (UTC+1) : "2026-09-27" en DB → new Date(2026,8,27,0,0,0) → UTC 2026-09-26T23:00:00Z
// On extrait les composants LOCAUX, pas UTC.
function dateToStr(d) {
  if (!d) return null
  if (typeof d === 'string') return d.substring(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Ajoute 1 mois en clamant sur le dernier jour du mois cible.
// Exemples : 2024-01-31 → 2024-02-29, 2024-03-31 → 2024-04-30
function addMonthSafe(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  let newM = m + 1, newY = y
  if (newM > 13) { newM = 1; newY++ }   // mois 13 → janvier de l'année suivante
  if (newM > 12) { newM = 1; newY++ }   // normalement inaccessible mais garde-fou
  const lastDay = new Date(newY, newM, 0).getDate()  // dernier jour du mois newM/newY
  return `${newY}-${String(newM).padStart(2,'0')}-${String(Math.min(d, lastDay)).padStart(2,'0')}`
}

// Ajoute 1 an avec gestion du leap-day.
// Règle validée architecture v2.2.3 : 2024-02-29 + 1 an = 2025-02-28 (pas 2025-03-01)
function addYearSafe(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const newY = y + 1
  const lastDay = new Date(newY, m, 0).getDate()   // dernier jour du mois m de l'an newY
  return `${newY}-${String(m).padStart(2,'0')}-${String(Math.min(d, lastDay)).padStart(2,'0')}`
}

// Calcule fin_periode selon périodicité.
function computeFinPeriode(debutStr, periodicite) {
  return periodicite === 'annuel' ? addYearSafe(debutStr) : addMonthSafe(debutStr)
}

// Génère un numéro de facture unique : INV-YYYYMM-{8HEX} (max 20 chars).
// La contrainte UNIQUE(numero) en DB est le filet de sécurité final.
function makeNumero() {
  const d = new Date()
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2,'0')}`
  const hex = Math.random().toString(16).slice(2, 10).toUpperCase()
  return `INV-${yyyymm}-${hex}`
}

// ── Plugin Fastify ───────────────────────────────────────────────────────────

async function billingEnginePlugin(fastify) {

  const billing = {

    // ─────────────────────────────────────────────────────────────────────────
    // generatePeriodAndInvoice
    //
    // Crée atomiquement (1 transaction Knex) :
    //   1. billing_period  → snapshot + bornes calculées
    //   2. platform_invoice → numéro unique, montants HT/taxe/TTC
    //   3. platform_invoice_items → ligne(s) de facturation
    //   4. tax_context (optionnel) → si tax_configuration trouvée
    //
    // Idempotent : si période+facture existent déjà, les retourne sans créer.
    //
    // @param {string} tenant_id
    // @param {string|null} debut_periode — "YYYY-MM-DD", défaut = actif_depuis snapshot actif
    // @param {string|null} snapshot_id_override — force un snapshot spécifique (tests A3.3)
    // @returns {{ period, invoice, items, snapshot, tenant, idempotent: bool }}
    // ─────────────────────────────────────────────────────────────────────────
    async generatePeriodAndInvoice({ tenant_id, debut_periode = null, snapshot_id_override = null } = {}) {
      const db = fastify.db

      // 1. Tenant
      const tenant = await db('tenants').where({ id: tenant_id }).first()
      if (!tenant) {
        const e = new Error(`Tenant ${tenant_id} introuvable`)
        e.code = 'TENANT_INTROUVABLE'; e.statusCode = 404; throw e
      }

      // INVARIANT ABSOLU — ne jamais toucher le tenant de démonstration technique
      if (tenant_id.startsWith('22222222')) {
        const e = new Error('INVARIANT : tenant 22222222-… interdit')
        e.code = 'TENANT_INTERDIT'; e.statusCode = 403; throw e
      }

      // 2. Abonnement (actif > essai > autres)
      const abonnement = await db('abonnements')
        .where({ tenant_id })
        .orderByRaw("CASE WHEN statut='actif' THEN 0 WHEN statut='essai' THEN 1 ELSE 2 END")
        .orderBy('cree_le', 'desc')
        .first()
      if (!abonnement) {
        const e = new Error('Aucun abonnement pour ce tenant')
        e.code = 'ABONNEMENT_ABSENT'; e.statusCode = 409; throw e
      }

      // 3. Snapshot source
      // Si snapshot_id_override fourni → charge ce snapshot spécifique (test A3.3 prix historique)
      // Sinon → snapshot actif courant (actif_jusqu IS NULL)
      let snapshot
      if (snapshot_id_override) {
        snapshot = await db('subscription_snapshots').where({ id: snapshot_id_override }).first()
        if (!snapshot) {
          const e = new Error(`Snapshot ${snapshot_id_override} introuvable`)
          e.code = 'SNAPSHOT_INTROUVABLE'; e.statusCode = 404; throw e
        }
      } else {
        snapshot = await db('subscription_snapshots')
          .where({ subscription_id: abonnement.id })
          .whereNull('actif_jusqu')
          .orderBy('actif_depuis', 'desc')
          .first()
        if (!snapshot) {
          const e = new Error('Aucun snapshot billing actif pour cet abonnement')
          e.code = 'SNAPSHOT_ABSENT'; e.statusCode = 409; throw e
        }
      }

      // 4. Dates de période
      const debut = debut_periode || dateToStr(snapshot.actif_depuis)
      const fin   = computeFinPeriode(debut, snapshot.periodicite)

      // 5. Résolution fiscale : tax_configuration du pays du tenant
      const taxConfig = await db('tax_configurations')
        .where({ juridiction: tenant.pays, actif: true })
        .whereIn('s_applique_a', ['subscription', 'all'])
        .first()
        .catch(() => null)
      const taux_pct = taxConfig ? parseFloat(taxConfig.taux_pct) : 0

      // 6. Montants (centimes INTEGER — jamais DECIMAL)
      const montant_ht    = snapshot.montant_centimes
      const montant_taxe  = Math.round(montant_ht * taux_pct / 100)
      const montant_ttc   = montant_ht + montant_taxe   // CHECK: ttc = ht + taxe ✓

      // 7. Clé d'idempotence (unique par abonnement + jour de facturation)
      const idempotency_key = `period:${abonnement.id}:${debut}`

      // ─────────────────────────────────────────────────────────────────────
      // 8. Transaction atomique
      // Rollback total si UN SEUL INSERT échoue.
      // ─────────────────────────────────────────────────────────────────────
      const result = await db.transaction(async (trx) => {

        // 8.1 billing_period — idempotent via UNIQUE(subscription_id, debut_periode)
        let period = await trx('billing_periods')
          .where({ subscription_id: abonnement.id, debut_periode: debut })
          .first()

        let alreadyHadInvoice = false

        if (period) {
          // Période déjà existante → vérifier si facture aussi présente
          const existingInvoice = await trx('platform_invoices')
            .where({ billing_period_id: period.id })
            .first()
          if (existingInvoice) {
            const existingItems = await trx('platform_invoice_items')
              .where({ invoice_id: existingInvoice.id })
              .orderBy('ordre')
            return { period, invoice: existingInvoice, items: existingItems, snapshot, tenant, idempotent: true }
          }
          alreadyHadInvoice = false
        } else {
          // Nouvelle période
          const [newPeriod] = await trx('billing_periods').insert({
            subscription_id:         abonnement.id,
            snapshot_id:             snapshot.id,
            debut_periode:           debut,
            fin_periode:             fin,
            statut:                  'ouvert',
            montant_attendu_centimes: montant_ttc,
            devise:                  snapshot.devise,
          }).returning('*')
          period = newPeriod
        }

        // 8.2 Invoice — numéro unique avec retry (garde-fou contre collision aléatoire)
        let numero
        for (let i = 0; i < 10; i++) {
          const candidate = makeNumero()
          const clash = await trx('platform_invoices').where({ numero: candidate }).first()
          if (!clash) { numero = candidate; break }
        }
        if (!numero) throw new Error('Impossible de générer un numéro de facture unique')

        const today   = dateToStr(new Date())
        const echeance = addMonthSafe(today)

        const [invoice] = await trx('platform_invoices').insert({
          numero,
          tenant_id,
          subscription_id:          abonnement.id,
          billing_period_id:        period.id,
          snapshot_id:              snapshot.id,
          statut:                   'brouillon',
          montant_ht_centimes:      montant_ht,
          montant_taxe_centimes:    montant_taxe,
          montant_ttc_centimes:     montant_ttc,
          montant_paye_centimes:    0,
          montant_restant_centimes: montant_ttc,
          devise:                   snapshot.devise,
          date_emission:            today,
          date_echeance:            echeance,
          idempotency_key,
        }).returning('*')

        // 8.3 Invoice items — ligne abonnement principal
        const itemBase = {
          invoice_id:              invoice.id,
          ordre:                   1,
          type_ligne:              'subscription',
          description:             `Abonnement ${snapshot.plan_code} — ${debut} au ${fin}`,
          quantite:                1.0,
          prix_unitaire_centimes:  montant_ht,
          montant_ht_centimes:     montant_ht,
          taux_taxe_pct:           taux_pct,
          montant_taxe_centimes:   montant_taxe,
          montant_ttc_centimes:    montant_ttc,
          devise:                  snapshot.devise,
        }
        await trx('platform_invoice_items').insert(itemBase)
        const items = [{ ...itemBase, invoice_id: invoice.id }]

        // 8.4 Tax context — uniquement si une configuration fiscale s'applique
        if (taxConfig && montant_taxe > 0) {
          await trx('tax_contexts').insert({
            invoice_id:            invoice.id,
            tax_config_id:         taxConfig.id,
            juridiction:           taxConfig.juridiction,
            taux_pct_applique:     taux_pct,
            num_fiscal_plateforme: taxConfig.num_fiscal_plateforme || null,
          })
        }

        // 8.5 Mettre à jour statut période → facture_generee
        await trx('billing_periods')
          .where({ id: period.id })
          .update({ statut: 'facture_generee' })
        period.statut = 'facture_generee'

        return { period, invoice, items, snapshot, tenant, idempotent: false }
      })

      return result
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers lecture
    // ─────────────────────────────────────────────────────────────────────────

    async getInvoice(invoice_id) {
      const invoice = await fastify.db('platform_invoices AS i')
        .where('i.id', invoice_id)
        .first()
      if (!invoice) return null

      const items = await fastify.db('platform_invoice_items')
        .where({ invoice_id })
        .orderBy('ordre')

      const period = await fastify.db('billing_periods')
        .where({ id: invoice.billing_period_id })
        .first()

      const snapshot = await fastify.db('subscription_snapshots')
        .where({ id: invoice.snapshot_id })
        .first()

      const taxCtx = await fastify.db('tax_contexts')
        .where({ invoice_id })
        .first()
        .catch(() => null)

      return { invoice, items, period, snapshot, tax_context: taxCtx || null }
    },

    async getInvoicesByTenant(tenant_id, { page = 1, limite = 20, statut } = {}) {
      const offset = (parseInt(page) - 1) * parseInt(limite)
      let q = fastify.db('platform_invoices').where({ tenant_id }).orderBy('date_emission', 'desc')
      if (statut) q = q.where({ statut })
      const [invoices, total] = await Promise.all([
        q.limit(parseInt(limite)).offset(offset),
        fastify.db('platform_invoices').where({ tenant_id })
          .modify(q => { if (statut) q.where({ statut }) })
          .count('id AS total').first(),
      ])
      return { invoices, total: parseInt(total?.total || 0) }
    },

    async getBillingPeriods(subscription_id, { page = 1, limite = 20 } = {}) {
      const offset = (parseInt(page) - 1) * parseInt(limite)
      const [periods, total] = await Promise.all([
        fastify.db('billing_periods').where({ subscription_id })
          .orderBy('debut_periode', 'desc').limit(parseInt(limite)).offset(offset),
        fastify.db('billing_periods').where({ subscription_id }).count('id AS total').first(),
      ])
      return { periods, total: parseInt(total?.total || 0) }
    },

    // Utilitaires exposés pour les tests
    dateToStr,
    addMonthSafe,
    addYearSafe,
    computeFinPeriode,
  }

  fastify.decorate('billing', billing)
}

module.exports = fp(billingEnginePlugin, {
  name:         'billing-engine',
  fastify:      '4.x',
  dependencies: ['database'],
})
