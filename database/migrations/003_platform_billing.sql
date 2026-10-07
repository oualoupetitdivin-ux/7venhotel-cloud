-- =============================================================================
-- MIGRATION — Platform Billing Schema — LOT 2
-- 7venHotel Cloud · Billing Architecture v2.2.3
-- CEPOS GO : 2026-09-26
-- Réf. architecture : https://claude.ai/artifact/Gi3QB2yZyM7Msy2fVp3s2D (v2.2.3)
-- =============================================================================
-- Périmètre autorisé :
--   24 tables Billing
--   3 vues / matview
--   3 partial UNIQUE indexes
--   4 CHECK constraints (nommés)
--   1 function fn_sync_provider_code
--   1 trigger trg_provider_account_code
-- =============================================================================
-- INTERDICTIONS :
--   Aucune modification PMS
--   Aucune modification CONFIG (platform_plans, platform_modules)
--   Aucune FK croisée Billing → CONFIG
--   Aucun seed
--   Aucune migration de données existantes
--   Tenant 22222222-... STRICTEMENT INTANGIBLE
-- =============================================================================
-- Montants : TOUJOURS en centimes INTEGER — JAMAIS DECIMAL
-- Cross-domain FK autorisé : subscription_snapshots → abonnements(id) UNIQUEMENT
-- Idempotent : IF NOT EXISTS partout — sans seed
-- Transactionnel : BEGIN/COMMIT atomique
-- =============================================================================

BEGIN;

-- =============================================================================
-- BLOC 0 — PRE-ASSERTIONS
-- Vérifie que les dépendances PMS existent et que les tables Billing sont absentes
-- =============================================================================

DO $$
BEGIN
  -- Dépendances PMS requises
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] table tenants introuvable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='abonnements') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] table abonnements introuvable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='utilisateurs') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] table utilisateurs introuvable';
  END IF;
  -- Les tables CONFIG doivent être intactes
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_plans') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] table CONFIG platform_plans introuvable — Layer 6 absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_modules') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] table CONFIG platform_modules introuvable — Layer 6 absent';
  END IF;
  -- Aucune table Billing ne doit exister (anti-collision)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_billing_plans') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] platform_billing_plans existe déjà — migration déjà appliquée ?';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_billing_modules') THEN
    RAISE EXCEPTION '[LOT2 PRE-ASSERT] platform_billing_modules existe déjà — migration déjà appliquée ?';
  END IF;
  RAISE NOTICE '[LOT2] ✓ PRE-ASSERTIONS OK';
END $$;

-- =============================================================================
-- BLOC 1 — PLAN DOMAIN
-- platform_billing_plans, platform_plan_versions, platform_plan_prices,
-- platform_billing_modules, plan_version_modules, platform_entitlements
-- =============================================================================

-- 01 — platform_billing_plans
-- Catalogue des plans Billing. Distinct de platform_plans (CONFIG Layer 6).
-- PK UUID (vs VARCHAR PK dans CONFIG). Aucun seed ici.
CREATE TABLE IF NOT EXISTS platform_billing_plans (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(50)  NOT NULL UNIQUE,
  label         VARCHAR(100) NOT NULL,
  actif         BOOLEAN      NOT NULL DEFAULT true,
  cree_le       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  mis_a_jour_le TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 02 — platform_billing_modules
-- Catalogue des modules Billing. Distinct de platform_modules (CONFIG Layer 6).
-- PK UUID (vs VARCHAR PK dans CONFIG). Aucun seed ici.
CREATE TABLE IF NOT EXISTS platform_billing_modules (
  id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code    VARCHAR(50)  NOT NULL UNIQUE,
  label   VARCHAR(100) NOT NULL,
  actif   BOOLEAN      NOT NULL DEFAULT true,
  cree_le TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 03 — platform_plan_versions
-- Versionnage des plans. Une seule version published par plan (invariant DB §8).
CREATE TABLE IF NOT EXISTS platform_plan_versions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID        NOT NULL REFERENCES platform_billing_plans(id) ON DELETE RESTRICT,
  version_number  INTEGER     NOT NULL,
  label           VARCHAR(100) NOT NULL,
  trial_days      INTEGER     NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  statut          VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (statut IN ('draft', 'published', 'deprecated')),
  published_at    TIMESTAMPTZ,
  deprecated_at   TIMESTAMPTZ,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version_number)
);

-- 04 — platform_plan_prices
-- Prix par version, periodicite, devise.
CREATE TABLE IF NOT EXISTS platform_plan_prices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id  UUID        NOT NULL REFERENCES platform_plan_versions(id) ON DELETE CASCADE,
  periodicite      VARCHAR(20) NOT NULL CHECK (periodicite IN ('mensuel', 'annuel')),
  devise           VARCHAR(3)  NOT NULL,
  montant_centimes INTEGER     NOT NULL CHECK (montant_centimes >= 0),
  actif            BOOLEAN     NOT NULL DEFAULT true,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_version_id, periodicite, devise)
);

-- 05 — plan_version_modules
-- Junction : version de plan ↔ modules Billing inclus
CREATE TABLE IF NOT EXISTS plan_version_modules (
  plan_version_id UUID    NOT NULL REFERENCES platform_plan_versions(id) ON DELETE CASCADE,
  module_id       UUID    NOT NULL REFERENCES platform_billing_modules(id) ON DELETE CASCADE,
  inclus          BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (plan_version_id, module_id)
);

-- 06 — platform_entitlements
-- Quotas et limites par version de plan. Valeur -1 = illimité.
CREATE TABLE IF NOT EXISTS platform_entitlements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_version_id UUID        NOT NULL REFERENCES platform_plan_versions(id) ON DELETE CASCADE,
  code            VARCHAR(50) NOT NULL,
  valeur          INTEGER     NOT NULL,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_version_id, code)
);

-- =============================================================================
-- BLOC 2 — TAX DOMAIN
-- tax_configurations, tax_contexts
-- =============================================================================

-- 07 — tax_configurations
-- Configurations fiscales par juridiction. Taux en NUMERIC(5,2) pour le catalogue.
-- Le taux réel appliqué est snapshotté dans tax_contexts (immuable).
CREATE TABLE IF NOT EXISTS tax_configurations (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(30)   NOT NULL UNIQUE,
  label                 VARCHAR(100)  NOT NULL,
  juridiction           VARCHAR(10)   NOT NULL,
  taux_pct              NUMERIC(5,2)  NOT NULL CHECK (taux_pct >= 0),
  s_applique_a          VARCHAR(20)   NOT NULL DEFAULT 'all'
                        CHECK (s_applique_a IN ('subscription', 'one_time', 'all')),
  num_fiscal_plateforme VARCHAR(50),
  actif                 BOOLEAN       NOT NULL DEFAULT true,
  cree_le               TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 08 — tax_contexts
-- Snapshot fiscal figé à l'émission de la facture. Immuable.
-- Créée APRÈS platform_invoices — FK inverse déclarée plus bas.
-- (Voir création platform_invoices en BLOC 5)

-- =============================================================================
-- BLOC 3 — PROVIDER CONFIG DOMAIN
-- payment_providers, provider_accounts, provider_webhook_configs,
-- platform_settlement_destinations
-- =============================================================================

-- 09 — payment_providers
-- Registre des providers de paiement. actif=false par défaut (activation explicite).
CREATE TABLE IF NOT EXISTS payment_providers (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(50) NOT NULL UNIQUE,
  label                 VARCHAR(100) NOT NULL,
  devises_supportees    TEXT[]      NOT NULL DEFAULT '{}',
  methodes_supportees   TEXT[]      NOT NULL DEFAULT '{}',
  actif                 BOOLEAN     NOT NULL DEFAULT false,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10 — provider_accounts
-- Comptes provider (credentials chiffrées AES-256, jamais loggées).
-- provider_code = dénormalisation computée forcée par trigger fn_sync_provider_code.
CREATE TABLE IF NOT EXISTS provider_accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id           UUID        NOT NULL REFERENCES payment_providers(id) ON DELETE RESTRICT,
  provider_code         VARCHAR(50) NOT NULL,
  label                 VARCHAR(100) NOT NULL,
  environnement         VARCHAR(10) NOT NULL CHECK (environnement IN ('test', 'live')),
  api_key_chiffree      TEXT,
  webhook_secret_chiffre TEXT,
  merchant_id           VARCHAR(200),
  actif                 BOOLEAN     NOT NULL DEFAULT false,
  cree_le               TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11 — provider_webhook_configs
-- Configuration des endpoints webhook déclarés chez le provider.
CREATE TABLE IF NOT EXISTS provider_webhook_configs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id UUID        NOT NULL REFERENCES provider_accounts(id) ON DELETE CASCADE,
  endpoint_url        TEXT        NOT NULL,
  events_suivis       TEXT[]      NOT NULL DEFAULT '{}',
  actif               BOOLEAN     NOT NULL DEFAULT true,
  cree_le             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12 — platform_settlement_destinations
-- Comptes récepteurs des virements provider (bank_account, wallet, etc.).
CREATE TABLE IF NOT EXISTS platform_settlement_destinations (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_account_id             UUID        NOT NULL REFERENCES provider_accounts(id) ON DELETE RESTRICT,
  label                           VARCHAR(100) NOT NULL,
  type_destination                VARCHAR(30) NOT NULL
                                  CHECK (type_destination IN ('bank_account', 'mobile_money_wallet', 'stripe_balance')),
  provider_destination_reference  VARCHAR(200) NOT NULL UNIQUE,
  devise_principale               VARCHAR(3)  NOT NULL,
  est_defaut                      BOOLEAN     NOT NULL DEFAULT false,
  actif                           BOOLEAN     NOT NULL DEFAULT true,
  cree_le                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- BLOC 4 — SUBSCRIPTION DOMAIN
-- subscription_snapshots
-- (abonnements est une table PMS existante — dépendance FK uniquement)
-- =============================================================================

-- 13 — subscription_snapshots
-- Snapshot figé du contrat souscrit. Les entitlements/prix ne changent jamais rétroactivement.
-- Seul cross-domain FK Billing → PMS autorisé : subscription_id → abonnements(id)
CREATE TABLE IF NOT EXISTS subscription_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id  UUID        NOT NULL REFERENCES abonnements(id) ON DELETE RESTRICT,
  plan_version_id  UUID        NOT NULL REFERENCES platform_plan_versions(id) ON DELETE RESTRICT,
  plan_price_id    UUID        NOT NULL REFERENCES platform_plan_prices(id) ON DELETE RESTRICT,
  plan_code        VARCHAR(50) NOT NULL,
  periodicite      VARCHAR(20) NOT NULL CHECK (periodicite IN ('mensuel', 'annuel')),
  devise           VARCHAR(3)  NOT NULL,
  montant_centimes INTEGER     NOT NULL CHECK (montant_centimes >= 0),
  entitlements_json JSONB      NOT NULL DEFAULT '{}',
  modules_json     JSONB       NOT NULL DEFAULT '{}',
  actif_depuis     DATE        NOT NULL,
  actif_jusqu      DATE,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, actif_depuis)
);

-- =============================================================================
-- BLOC 5 — BILLING DOMAIN
-- billing_periods, platform_invoices, tax_contexts (FK inverse), platform_invoice_items
-- =============================================================================

-- 14 — billing_periods
-- Période facturable. fin_periode calculé par l'application (+ INTERVAL '1 month'|'1 year').
CREATE TABLE IF NOT EXISTS billing_periods (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id           UUID        NOT NULL REFERENCES abonnements(id) ON DELETE RESTRICT,
  snapshot_id               UUID        NOT NULL REFERENCES subscription_snapshots(id) ON DELETE RESTRICT,
  debut_periode             DATE        NOT NULL,
  fin_periode               DATE        NOT NULL,
  statut                    VARCHAR(20) NOT NULL DEFAULT 'ouvert'
                            CHECK (statut IN ('ouvert', 'facture_generee', 'clos')),
  montant_attendu_centimes  INTEGER     NOT NULL CHECK (montant_attendu_centimes >= 0),
  devise                    VARCHAR(3)  NOT NULL,
  cree_le                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, debut_periode)
);

-- 15 — platform_invoices
-- Facture générée pour une billing_period. Overpayment interdit (CHECK DB).
-- montant_paye mis à jour transactionnellement via SELECT FOR UPDATE.
CREATE TABLE IF NOT EXISTS platform_invoices (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                    VARCHAR(30) NOT NULL UNIQUE,
  tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id           UUID        NOT NULL REFERENCES abonnements(id) ON DELETE RESTRICT,
  billing_period_id         UUID        NOT NULL UNIQUE REFERENCES billing_periods(id) ON DELETE RESTRICT,
  snapshot_id               UUID        NOT NULL REFERENCES subscription_snapshots(id) ON DELETE RESTRICT,
  statut                    VARCHAR(30) NOT NULL DEFAULT 'brouillon'
                            CHECK (statut IN ('brouillon','emise','partiellement_payee','payee','en_retard','annulee','void')),
  montant_ht_centimes       INTEGER     NOT NULL CHECK (montant_ht_centimes >= 0),
  montant_taxe_centimes     INTEGER     NOT NULL DEFAULT 0 CHECK (montant_taxe_centimes >= 0),
  montant_ttc_centimes      INTEGER     NOT NULL CHECK (montant_ttc_centimes >= 0),
  montant_paye_centimes     INTEGER     NOT NULL DEFAULT 0 CHECK (montant_paye_centimes >= 0),
  montant_restant_centimes  INTEGER     NOT NULL,
  devise                    VARCHAR(3)  NOT NULL,
  date_emission             DATE,
  date_echeance             DATE,
  date_paiement_complet     DATE,
  idempotency_key           VARCHAR(100) UNIQUE,
  cree_le                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_invoice_ttc CHECK (montant_ttc_centimes = montant_ht_centimes + montant_taxe_centimes),
  CONSTRAINT chk_paye_lte_ttc CHECK (montant_paye_centimes <= montant_ttc_centimes)
);

-- 08 (suite) — tax_contexts
-- Snapshot fiscal figé à l'émission. Immuable après création.
CREATE TABLE IF NOT EXISTS tax_contexts (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            UUID          NOT NULL UNIQUE REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  tax_config_id         UUID          NOT NULL REFERENCES tax_configurations(id) ON DELETE RESTRICT,
  juridiction           VARCHAR(10)   NOT NULL,
  taux_pct_applique     NUMERIC(5,2)  NOT NULL,
  num_fiscal_plateforme VARCHAR(50),
  num_fiscal_tenant     VARCHAR(50),
  cree_le               TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 16 — platform_invoice_items
-- Lignes de facture. type_ligne='taxe' INTERDIT (taxe portée par colonnes ht/taxe/ttc).
CREATE TABLE IF NOT EXISTS platform_invoice_items (
  id                      UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id              UUID           NOT NULL REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  ordre                   INTEGER        NOT NULL,
  type_ligne              VARCHAR(20)    NOT NULL
                          CHECK (type_ligne IN ('subscription', 'module', 'prorata', 'remise')),
  description             VARCHAR(200)   NOT NULL,
  quantite                NUMERIC(10,4)  NOT NULL DEFAULT 1.0,
  prix_unitaire_centimes  INTEGER        NOT NULL,
  montant_ht_centimes     INTEGER        NOT NULL CHECK (montant_ht_centimes >= 0),
  taux_taxe_pct           NUMERIC(5,2)   NOT NULL DEFAULT 0,
  montant_taxe_centimes   INTEGER        NOT NULL DEFAULT 0 CHECK (montant_taxe_centimes >= 0),
  montant_ttc_centimes    INTEGER        NOT NULL CHECK (montant_ttc_centimes >= 0),
  devise                  VARCHAR(3)     NOT NULL,
  CONSTRAINT chk_item_ttc CHECK (montant_ttc_centimes = montant_ht_centimes + montant_taxe_centimes)
);

-- =============================================================================
-- BLOC 6 — PAYMENT DOMAIN
-- platform_payment_methods, platform_webhooks, platform_payment_intents,
-- platform_payments, platform_refunds, platform_settlements
-- =============================================================================

-- 17 — platform_payment_methods
-- Méthodes de paiement tokenisées par tenant. Aucune donnée brute de carte.
CREATE TABLE IF NOT EXISTS platform_payment_methods (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_code                     VARCHAR(50) NOT NULL,
  provider_payment_method_reference VARCHAR(200) NOT NULL UNIQUE,
  type_methode                      VARCHAR(30) NOT NULL
                                    CHECK (type_methode IN ('card', 'mobile_money', 'bank_transfer')),
  actif                             BOOLEAN     NOT NULL DEFAULT true,
  cree_le                           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 18 — platform_webhooks
-- Source de vérité pour les événements provider.
-- Idempotence : UNIQUE(provider_code, provider_event_id).
-- platform_payments référence webhook_event_id → ce table doit exister avant payments.
CREATE TABLE IF NOT EXISTS platform_webhooks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code     VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(200) NOT NULL,
  type_evenement    VARCHAR(50) NOT NULL,
  payload           JSONB       NOT NULL DEFAULT '{}',
  statut            VARCHAR(20) NOT NULL DEFAULT 'recu'
                    CHECK (statut IN ('recu', 'traite', 'erreur', 'ignore')),
  traite_a          TIMESTAMPTZ,
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_code, provider_event_id)
);

-- 19 — platform_payment_intents
-- Intent de paiement côté provider (checkout session). Distinct du webhook.
CREATE TABLE IF NOT EXISTS platform_payment_intents (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                UUID        NOT NULL REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  tenant_id                 UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider_code             VARCHAR(50) NOT NULL,
  provider_intent_reference VARCHAR(200) UNIQUE,
  montant_centimes          INTEGER     NOT NULL CHECK (montant_centimes > 0),
  devise                    VARCHAR(3)  NOT NULL,
  statut                    VARCHAR(20) NOT NULL DEFAULT 'created'
                            CHECK (statut IN ('created', 'processing', 'succeeded', 'failed', 'cancelled', 'expired')),
  checkout_url              TEXT,
  idempotency_key           VARCHAR(100) UNIQUE,
  expire_a                  TIMESTAMPTZ,
  cree_le                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 20 — platform_payments
-- Paiement confirmé. Source de vérité = webhook_event_id (jamais le redirect navigateur).
-- N paiements par invoice (paiements partiels autorisés).
CREATE TABLE IF NOT EXISTS platform_payments (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  invoice_id                  UUID        NOT NULL REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  intent_id                   UUID        REFERENCES platform_payment_intents(id) ON DELETE SET NULL,
  webhook_event_id            UUID        NOT NULL REFERENCES platform_webhooks(id) ON DELETE RESTRICT,
  provider_code               VARCHAR(50) NOT NULL,
  provider_payment_reference  VARCHAR(200) NOT NULL UNIQUE,
  statut                      VARCHAR(30) NOT NULL DEFAULT 'initiated'
                              CHECK (statut IN ('initiated','pending','succeeded','failed','cancelled','refunded','partially_refunded')),
  montant_centimes            INTEGER     NOT NULL CHECK (montant_centimes > 0),
  montant_rembourse_centimes  INTEGER     NOT NULL DEFAULT 0 CHECK (montant_rembourse_centimes >= 0),
  devise                      VARCHAR(3)  NOT NULL,
  confirme_a                  TIMESTAMPTZ,
  idempotency_key             VARCHAR(100) UNIQUE,
  cree_le                     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 21 — platform_refunds
-- Remboursement individuel. N refunds par payment.
-- Invariant SUM(refunds) ≤ payment.montant enforced via SELECT FOR UPDATE (applicatif).
CREATE TABLE IF NOT EXISTS platform_refunds (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id                UUID        NOT NULL REFERENCES platform_payments(id) ON DELETE RESTRICT,
  webhook_event_id          UUID        REFERENCES platform_webhooks(id) ON DELETE SET NULL,
  initie_par                UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,
  provider_refund_reference VARCHAR(200) NOT NULL UNIQUE,
  montant_centimes          INTEGER     NOT NULL CHECK (montant_centimes > 0),
  devise                    VARCHAR(3)  NOT NULL,
  statut                    VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (statut IN ('pending', 'succeeded', 'failed')),
  motif                     VARCHAR(200),
  confirme_a                TIMESTAMPTZ,
  idempotency_key           VARCHAR(100) UNIQUE,
  cree_le                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 22 — platform_settlements
-- Événement payout provider. 0..1 settlement par payment.
-- CHECK : montant_net = brut - frais (invariant DB §5).
CREATE TABLE IF NOT EXISTS platform_settlements (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id                    UUID        NOT NULL UNIQUE REFERENCES platform_payments(id) ON DELETE RESTRICT,
  destination_id                UUID        NOT NULL REFERENCES platform_settlement_destinations(id) ON DELETE RESTRICT,
  webhook_event_id              UUID        REFERENCES platform_webhooks(id) ON DELETE SET NULL,
  provider_code                 VARCHAR(50) NOT NULL,
  provider_settlement_reference VARCHAR(200) NOT NULL UNIQUE,
  montant_brut_centimes         INTEGER     NOT NULL CHECK (montant_brut_centimes >= 0),
  frais_provider_centimes       INTEGER     NOT NULL DEFAULT 0 CHECK (frais_provider_centimes >= 0),
  montant_net_centimes          INTEGER     NOT NULL,
  devise                        VARCHAR(3)  NOT NULL,
  statut                        VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (statut IN ('pending', 'settled', 'failed', 'reversed')),
  settle_a                      TIMESTAMPTZ,
  cree_le                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settlement_net CHECK (montant_net_centimes = montant_brut_centimes - frais_provider_centimes)
);

-- =============================================================================
-- BLOC 7 — OPERATIONS DOMAIN
-- dunning_events
-- (platform_webhooks déjà créée en BLOC 6)
-- =============================================================================

-- 23 — dunning_events
-- Événements de relance de paiement. UNIQUE(invoice_id, type_action) pour idempotence.
CREATE TABLE IF NOT EXISTS dunning_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID        NOT NULL REFERENCES platform_invoices(id) ON DELETE RESTRICT,
  type_action  VARCHAR(50) NOT NULL,
  statut       VARCHAR(20) NOT NULL DEFAULT 'programme'
               CHECK (statut IN ('programme', 'envoye', 'echoue')),
  execute_a    TIMESTAMPTZ,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, type_action)
);

-- 24 — [abonnements est une table PMS existante]
-- Référencée par : subscription_snapshots, billing_periods, platform_invoices
-- FK croisée billing→PMS autorisée uniquement pour ces références.
-- Ne pas modifier la table abonnements.

-- =============================================================================
-- BLOC 8 — DB INVARIANTS
-- Trigger : fn_sync_provider_code + trg_provider_account_code
-- Partial UNIQUE indexes : uq_plan_one_published, uq_provider_account_active,
--                          uq_settlement_dest_default
-- NOTE : chk_invoice_ttc, chk_paye_lte_ttc, chk_item_ttc, chk_settlement_net
--        sont déclarés inline dans CREATE TABLE ci-dessus — nommés conformément
--        à l'architecture v2.2.3.
-- =============================================================================

-- Trigger fn_sync_provider_code
-- Force provider_accounts.provider_code = payment_providers.code
-- Ne peut pas être contourné par l'application.
CREATE OR REPLACE FUNCTION fn_sync_provider_code()
RETURNS TRIGGER AS $$
BEGIN
  NEW.provider_code := (SELECT code FROM payment_providers WHERE id = NEW.provider_id);
  IF NEW.provider_code IS NULL THEN
    RAISE EXCEPTION 'provider_id % not found in payment_providers', NEW.provider_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_provider_account_code
  BEFORE INSERT OR UPDATE ON provider_accounts
  FOR EACH ROW EXECUTE FUNCTION fn_sync_provider_code();

-- Invariant 1 : une seule version published par plan
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_one_published
  ON platform_plan_versions(plan_id)
  WHERE statut = 'published';

-- Invariant 2 : un seul compte actif par provider/environnement
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_account_active
  ON provider_accounts(provider_code, environnement)
  WHERE actif = true;

-- Invariant 3 : une seule destination default par provider_account
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_dest_default
  ON platform_settlement_destinations(provider_account_id)
  WHERE est_defaut = true;

-- =============================================================================
-- BLOC 9 — VUES
-- v_billing_reconciliation, v_tenant_entitlements_current,
-- mv_platform_billing_dashboard
-- =============================================================================

-- v_billing_reconciliation
-- Réconciliation factures / paiements / settlements / remboursements
CREATE OR REPLACE VIEW v_billing_reconciliation AS
SELECT
  i.id                    AS invoice_id,
  i.numero,
  i.tenant_id,
  i.statut                AS invoice_statut,
  i.montant_ht_centimes,
  i.montant_taxe_centimes,
  i.montant_ttc_centimes,
  i.montant_paye_centimes,
  i.montant_restant_centimes,
  i.devise,
  i.date_emission,
  COALESCE(SUM(p.montant_centimes) FILTER (WHERE p.statut = 'succeeded'), 0)
    AS total_payments_confirmes_centimes,
  COALESCE(SUM(s.montant_brut_centimes) FILTER (WHERE s.statut = 'settled'), 0)
    AS total_gross_settled_centimes,
  COALESCE(SUM(s.montant_net_centimes) FILTER (WHERE s.statut = 'settled'), 0)
    AS total_net_settled_centimes,
  COALESCE(SUM(s.frais_provider_centimes) FILTER (WHERE s.statut = 'settled'), 0)
    AS total_frais_provider_centimes,
  COALESCE(SUM(r.montant_centimes) FILTER (WHERE r.statut = 'succeeded'), 0)
    AS total_rembourse_centimes,
  CASE
    WHEN i.montant_paye_centimes >= i.montant_ttc_centimes THEN 'reconcilie'
    WHEN i.montant_paye_centimes > 0                       THEN 'partiel'
    WHEN i.statut = 'en_retard'                            THEN 'en_retard'
    WHEN i.statut IN ('annulee', 'void')                   THEN 'annule'
    ELSE 'non_paye'
  END AS statut_reconciliation
FROM platform_invoices i
LEFT JOIN platform_payments p ON p.invoice_id = i.id
LEFT JOIN platform_settlements s ON s.payment_id = p.id
LEFT JOIN platform_refunds r ON r.payment_id = p.id
GROUP BY
  i.id, i.numero, i.tenant_id, i.statut,
  i.montant_ht_centimes, i.montant_taxe_centimes, i.montant_ttc_centimes,
  i.montant_paye_centimes, i.montant_restant_centimes, i.devise, i.date_emission;

-- v_tenant_entitlements_current
-- Entitlements courants de chaque tenant (snapshot actif = actif_jusqu IS NULL)
CREATE OR REPLACE VIEW v_tenant_entitlements_current AS
SELECT
  a.tenant_id,
  a.id                    AS subscription_id,
  a.statut                AS subscription_statut,
  ss.id                   AS snapshot_id,
  ss.plan_code,
  ss.periodicite,
  ss.devise,
  ss.montant_centimes     AS montant_snapshote_centimes,
  ss.entitlements_json,
  ss.modules_json,
  ss.actif_depuis
FROM abonnements a
JOIN subscription_snapshots ss ON ss.subscription_id = a.id
  AND ss.actif_jusqu IS NULL;

-- mv_platform_billing_dashboard
-- Vue matérialisée : MRR, ARR, Gross Revenue, Net Revenue, Outstanding.
-- Doit être REFRESH MATERIALIZED VIEW manuellement ou via cron.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_platform_billing_dashboard AS
SELECT
  -- MRR = SUM(snapshot HT / 12 si annuel, ou snapshot HT si mensuel), statut=active uniquement
  COALESCE((
    SELECT SUM(
      CASE ss.periodicite
        WHEN 'annuel' THEN ss.montant_centimes / 12
        ELSE ss.montant_centimes
      END
    )
    FROM abonnements a
    JOIN subscription_snapshots ss ON ss.subscription_id = a.id AND ss.actif_jusqu IS NULL
    WHERE a.statut = 'actif'
  ), 0) AS mrr_centimes,
  -- ARR = MRR × 12
  COALESCE((
    SELECT SUM(
      CASE ss.periodicite
        WHEN 'annuel' THEN ss.montant_centimes / 12
        ELSE ss.montant_centimes
      END
    ) * 12
    FROM abonnements a
    JOIN subscription_snapshots ss ON ss.subscription_id = a.id AND ss.actif_jusqu IS NULL
    WHERE a.statut = 'actif'
  ), 0) AS arr_centimes,
  -- Gross Revenue = SUM(payments.montant WHERE statut='succeeded')
  COALESCE((
    SELECT SUM(montant_centimes)
    FROM platform_payments
    WHERE statut = 'succeeded'
  ), 0) AS gross_revenue_centimes,
  -- Net Revenue = SUM(settlements.montant_net WHERE statut='settled')
  COALESCE((
    SELECT SUM(montant_net_centimes)
    FROM platform_settlements
    WHERE statut = 'settled'
  ), 0) AS net_revenue_centimes,
  -- Outstanding = SUM(invoices.montant_restant WHERE statut IN (...))
  COALESCE((
    SELECT SUM(montant_restant_centimes)
    FROM platform_invoices
    WHERE statut IN ('emise', 'partiellement_payee', 'en_retard')
  ), 0) AS outstanding_centimes,
  NOW() AS calcule_a;

-- Index sur la matview pour REFRESH CONCURRENTLY (futur)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_billing_dashboard_unique
  ON mv_platform_billing_dashboard((calcule_a IS NOT NULL));

-- =============================================================================
-- BLOC 10 — INDEXES PERFORMANCE
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_billing_plans_actif
  ON platform_billing_plans(actif) WHERE actif = true;

CREATE INDEX IF NOT EXISTS idx_plan_versions_plan_id
  ON platform_plan_versions(plan_id);

CREATE INDEX IF NOT EXISTS idx_plan_versions_statut
  ON platform_plan_versions(statut) WHERE statut = 'published';

CREATE INDEX IF NOT EXISTS idx_sub_snapshots_sub_id
  ON subscription_snapshots(subscription_id);

CREATE INDEX IF NOT EXISTS idx_sub_snapshots_actif
  ON subscription_snapshots(subscription_id) WHERE actif_jusqu IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_periods_sub
  ON billing_periods(subscription_id);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant
  ON platform_invoices(tenant_id);

CREATE INDEX IF NOT EXISTS idx_invoices_statut
  ON platform_invoices(statut) WHERE statut IN ('emise','partiellement_payee','en_retard');

CREATE INDEX IF NOT EXISTS idx_payments_invoice
  ON platform_payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_payments_statut
  ON platform_payments(statut) WHERE statut = 'succeeded';

CREATE INDEX IF NOT EXISTS idx_settlements_statut
  ON platform_settlements(statut) WHERE statut = 'settled';

CREATE INDEX IF NOT EXISTS idx_webhooks_event
  ON platform_webhooks(provider_code, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_refunds_payment
  ON platform_refunds(payment_id);

CREATE INDEX IF NOT EXISTS idx_dunning_invoice
  ON dunning_events(invoice_id);

-- =============================================================================
-- BLOC 11 — MIGRATION REGISTRY
-- Enregistrer dans _migrations
-- =============================================================================

INSERT INTO _migrations (nom)
VALUES ('003_platform_billing.sql')
ON CONFLICT (nom) DO NOTHING;

-- =============================================================================
-- BLOC 12 — POST-ASSERTIONS
-- Vérifier que les 24 tables, 3 vues, 9 invariants ont bien été créés
-- =============================================================================

DO $$
DECLARE
  nb_tables    INT := 0;
  nb_views     INT := 0;
  nb_matviews  INT := 0;
  nb_indexes   INT := 0;
  nb_checks    INT := 0;
  nb_fn        INT := 0;
  nb_trg       INT := 0;
BEGIN
  -- Compter les 23 tables Billing nouvelles (abonnements est la 24ème — dépendance PMS)
  SELECT COUNT(*) INTO nb_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN (
    'platform_billing_plans','platform_plan_versions','platform_plan_prices',
    'platform_billing_modules','plan_version_modules','platform_entitlements',
    'tax_configurations','tax_contexts',
    'payment_providers','provider_accounts','provider_webhook_configs',
    'subscription_snapshots',
    'billing_periods','platform_invoices','platform_invoice_items',
    'platform_payment_methods','platform_payment_intents','platform_payments',
    'platform_refunds','platform_settlement_destinations','platform_settlements',
    'platform_webhooks','dunning_events'
  );
  IF nb_tables < 23 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] Seulement % / 23 tables Billing créées', nb_tables;
  END IF;

  -- Vues
  SELECT COUNT(*) INTO nb_views
  FROM pg_views
  WHERE schemaname = 'public'
  AND viewname IN ('v_billing_reconciliation','v_tenant_entitlements_current');
  IF nb_views < 2 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] Seulement % / 2 vues créées', nb_views;
  END IF;

  SELECT COUNT(*) INTO nb_matviews
  FROM pg_matviews
  WHERE schemaname = 'public'
  AND matviewname = 'mv_platform_billing_dashboard';
  IF nb_matviews < 1 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] mv_platform_billing_dashboard absente';
  END IF;

  -- Indexes partiels
  SELECT COUNT(*) INTO nb_indexes
  FROM pg_indexes
  WHERE schemaname = 'public'
  AND indexname IN ('uq_plan_one_published','uq_provider_account_active','uq_settlement_dest_default');
  IF nb_indexes < 3 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] Seulement % / 3 index partiels créés', nb_indexes;
  END IF;

  -- CHECK constraints nommées
  SELECT COUNT(*) INTO nb_checks
  FROM pg_constraint
  WHERE contype = 'c'
  AND conname IN ('chk_paye_lte_ttc','chk_settlement_net','chk_invoice_ttc','chk_item_ttc');
  IF nb_checks < 4 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] Seulement % / 4 CHECK constraints créées', nb_checks;
  END IF;

  -- Fonction trigger
  SELECT COUNT(*) INTO nb_fn
  FROM pg_proc WHERE proname = 'fn_sync_provider_code';
  IF nb_fn < 1 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] fn_sync_provider_code absente';
  END IF;

  -- Trigger
  SELECT COUNT(*) INTO nb_trg
  FROM pg_trigger WHERE tgname = 'trg_provider_account_code';
  IF nb_trg < 1 THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] trg_provider_account_code absent';
  END IF;

  -- Vérifier CONFIG intact
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_plans') THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] platform_plans (CONFIG) a disparu !';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='platform_modules') THEN
    RAISE EXCEPTION '[LOT2 POST-ASSERT] platform_modules (CONFIG) a disparu !';
  END IF;

  RAISE NOTICE '[LOT2] ✓ POST-ASSERTIONS OK';
  RAISE NOTICE '[LOT2]   Tables Billing   : %/23 créées', nb_tables;
  RAISE NOTICE '[LOT2]   Vues             : %/2 créées', nb_views;
  RAISE NOTICE '[LOT2]   Matview          : %/1 créée', nb_matviews;
  RAISE NOTICE '[LOT2]   Index partiels   : %/3 créés', nb_indexes;
  RAISE NOTICE '[LOT2]   CHECK constraints: %/4 créées', nb_checks;
  RAISE NOTICE '[LOT2]   Trigger fn       : %/1 créée', nb_fn;
  RAISE NOTICE '[LOT2]   Trigger          : %/1 créé', nb_trg;
  RAISE NOTICE '[LOT2]   CONFIG intact    : platform_plans ✓  platform_modules ✓';
END $$;

COMMIT;
