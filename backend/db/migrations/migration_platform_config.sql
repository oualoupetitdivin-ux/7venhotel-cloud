-- =============================================================================
-- MIGRATION — Platform Configuration Foundation — Layer 6
-- 7venHotel Cloud · Control Plane SaaS
--
-- Tables créées :
--   platform_modules       — registre des modules fonctionnels (thin reference)
--   platform_plans         — plans éditables (promote de plans.config.js)
--   plan_modules           — junction plans ↔ modules
--   platform_feature_flags — flags techniques transverses
--   platform_providers     — providers IA configurables
--   platform_settings      — paramètres globaux clé-valeur
--   tenant_module_overrides — overrides modules par tenant
--   licenses               — licences individuelles (préparation Layer 7)
--
-- Altérations :
--   abonnements + max_ia_mensuel, date_fin
--
-- GARANTIES :
--   - Idempotente (IF NOT EXISTS / ON CONFLICT DO NOTHING partout)
--   - Additive uniquement — aucun DROP, RENAME, ALTER destructif
--   - Atomique (transaction unique)
--   - Seed depuis plans.config.js Phase 1 → Phase 2
--
-- Exécution :
--   psql $DATABASE_URL -f migration_platform_config.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- BLOC 0 — ASSERTIONS PRÉALABLES
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG] ECHEC PRE-ASSERT: table tenants introuvable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'utilisateurs'
  ) THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG] ECHEC PRE-ASSERT: table utilisateurs introuvable';
  END IF;
END $$;

-- =============================================================================
-- BLOC 1 — platform_modules
-- Registre des modules fonctionnels. Thin reference table.
-- Seedée depuis les codes constants de plans.config.js.
-- Pas de CRUD UI — lecture seule pour le SA.
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_modules (
  code        VARCHAR(50)  PRIMARY KEY,
  label       VARCHAR(100) NOT NULL,
  description TEXT,
  categorie   VARCHAR(50)  NOT NULL DEFAULT 'operations',
  actif       BOOLEAN      NOT NULL DEFAULT true,
  cree_le     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed depuis plans.config.js
INSERT INTO platform_modules (code, label, description, categorie) VALUES
  ('portail_qr',          'Portail QR Client',     'Accès client via QR code dans les chambres',               'operations'),
  ('ia_cockpit',          'IA Cockpit',             'Analyse intelligente et recommandations par Ouwalou AI',    'ia'),
  ('restaurant_kds',      'Restaurant KDS',         'Kitchen Display System pour la cuisine',                   'operations'),
  ('facturation_mobile',  'Facturation Mobile',     'Émission de factures depuis mobile',                       'commercial'),
  ('multi_hotel',         'Multi-Hôtel',            'Gestion de plusieurs hôtels dans un même compte tenant',   'operations'),
  ('export_syscohada',    'Export SYSCOHADA',       'Export comptable conforme au référentiel SYSCOHADA/OHADA',  'conformite'),
  ('analytics_avances',   'Analytics Avancés',      'Tableaux de bord et métriques avancées',                   'commercial')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- BLOC 2 — platform_plans
-- Plans d'abonnement éditables. Promote de plans.config.js Phase 1 → Phase 2.
-- prix_mensuel_xaf = prix CATALOGUE actuel (modifiable).
-- Distinct de abonnements.montant_mensuel (snapshot figé à la souscription).
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_plans (
  code                VARCHAR(50)  PRIMARY KEY,
  label               VARCHAR(100) NOT NULL,
  prix_mensuel_xaf    INTEGER      NOT NULL DEFAULT 0,
  max_hotels          INTEGER      NOT NULL DEFAULT 1,
  max_chambres        INTEGER      NOT NULL DEFAULT 20,
  max_utilisateurs    INTEGER      NOT NULL DEFAULT 3,
  quota_ia_mensuel    INTEGER      NOT NULL DEFAULT 0,
  grace_period_days   INTEGER      NOT NULL DEFAULT 0,
  ordre_affichage     INTEGER               DEFAULT 0,
  actif               BOOLEAN      NOT NULL DEFAULT true,
  metadata            JSONB                 DEFAULT '{}',
  cree_le             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  mis_a_jour_le       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed depuis plans.config.js — valeurs exactes de Phase 1
INSERT INTO platform_plans
  (code, label, prix_mensuel_xaf, max_hotels, max_chambres, max_utilisateurs, quota_ia_mensuel, grace_period_days, ordre_affichage)
VALUES
  ('essai',      'Essai gratuit',  0,       1,  20,  3,       5000,   0,  0),
  ('starter',    'Starter',        25000,   1,  30,  5,       10000,  7,  1),
  ('business',   'Business',       75000,   3,  100, 20,      100000, 14, 2),
  ('ohada+',     'OHADA+',         120000,  5,  200, 30,      150000, 21, 3),
  ('enterprise', 'Enterprise',     200000, -1,  -1,  -1,      -1,     30, 4)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- BLOC 3 — plan_modules
-- Junction table plans ↔ modules.
-- Remplace le JSONB modules: { ia_cockpit: false, ... } de plans.config.js.
-- inclus=true → module disponible dans ce plan.
-- Absence de ligne → module non inclus (comportement normal après migration).
-- =============================================================================

CREATE TABLE IF NOT EXISTS plan_modules (
  plan_code     VARCHAR(50)  NOT NULL REFERENCES platform_plans(code) ON DELETE CASCADE,
  module_code   VARCHAR(50)  NOT NULL REFERENCES platform_modules(code) ON DELETE CASCADE,
  inclus        BOOLEAN      NOT NULL DEFAULT true,
  mis_a_jour_le TIMESTAMPTZ           DEFAULT NOW(),
  PRIMARY KEY (plan_code, module_code)
);

-- Seed depuis plans.config.js — toutes les associations
-- essai: portail_qr=true, facturation_mobile=true, reste=false
INSERT INTO plan_modules (plan_code, module_code, inclus) VALUES
  ('essai', 'portail_qr',         true),
  ('essai', 'facturation_mobile', true),
  ('essai', 'ia_cockpit',         false),
  ('essai', 'restaurant_kds',     false),
  ('essai', 'multi_hotel',        false),
  ('essai', 'export_syscohada',   false),
  ('essai', 'analytics_avances',  false),
-- starter: identique à essai
  ('starter', 'portail_qr',         true),
  ('starter', 'facturation_mobile', true),
  ('starter', 'ia_cockpit',         false),
  ('starter', 'restaurant_kds',     false),
  ('starter', 'multi_hotel',        false),
  ('starter', 'export_syscohada',   false),
  ('starter', 'analytics_avances',  false),
-- business: tout sauf export_syscohada
  ('business', 'portail_qr',         true),
  ('business', 'facturation_mobile', true),
  ('business', 'ia_cockpit',         true),
  ('business', 'restaurant_kds',     true),
  ('business', 'multi_hotel',        true),
  ('business', 'export_syscohada',   false),
  ('business', 'analytics_avances',  true),
-- ohada+: tout activé
  ('ohada+', 'portail_qr',         true),
  ('ohada+', 'facturation_mobile', true),
  ('ohada+', 'ia_cockpit',         true),
  ('ohada+', 'restaurant_kds',     true),
  ('ohada+', 'multi_hotel',        true),
  ('ohada+', 'export_syscohada',   true),
  ('ohada+', 'analytics_avances',  true),
-- enterprise: tout activé
  ('enterprise', 'portail_qr',         true),
  ('enterprise', 'facturation_mobile', true),
  ('enterprise', 'ia_cockpit',         true),
  ('enterprise', 'restaurant_kds',     true),
  ('enterprise', 'multi_hotel',        true),
  ('enterprise', 'export_syscohada',   true),
  ('enterprise', 'analytics_avances',  true)
ON CONFLICT (plan_code, module_code) DO NOTHING;

-- =============================================================================
-- BLOC 4 — platform_feature_flags
-- Feature flags techniques transverses.
-- Distinct de plan_modules (commercial/permanent) vs flags (technique/temporaire).
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_feature_flags (
  code          VARCHAR(100) PRIMARY KEY,
  enabled       BOOLEAN      NOT NULL DEFAULT false,
  description   TEXT,
  rollout_pct   INTEGER               DEFAULT 100
                CHECK (rollout_pct BETWEEN 0 AND 100),
  target_plans  TEXT[],
  expire_le     TIMESTAMPTZ,
  cree_le       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed : flags initiaux désactivés
INSERT INTO platform_feature_flags (code, enabled, description) VALUES
  ('maintenance_mode',    false, 'Mode maintenance global — bloque toutes les requêtes tenant'),
  ('new_billing_ui',      false, 'Nouvelle interface facturation (AB test)'),
  ('ai_streaming',        false, 'Streaming des réponses IA (expérimental)'),
  ('multi_currency',      false, 'Support multi-devises (préparation Layer 11)')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- BLOC 5 — platform_providers
-- Providers IA configurables (Anthropic, OpenAI, futurs).
-- IMPORTANT : La clé API réelle vit dans les env vars — JAMAIS en DB.
--             api_key_masked = affichage UI uniquement.
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_providers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(50) UNIQUE NOT NULL,
  label          VARCHAR(100) NOT NULL,
  base_url       VARCHAR(255),
  api_key_masked VARCHAR(40),
  actif          BOOLEAN     NOT NULL DEFAULT true,
  priorite       INTEGER     NOT NULL DEFAULT 1,
  plans_autorises TEXT[],
  metadata       JSONB                DEFAULT '{}',
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed : Anthropic (provider actif par défaut)
INSERT INTO platform_providers (code, label, actif, priorite, api_key_masked, metadata) VALUES
  ('anthropic', 'Anthropic (Claude)', true,  1, 'sk-ant-***...***', '{"model_defaut":"claude-sonnet-4-20250514","sdk":"@anthropic-ai/sdk"}'),
  ('openai',    'OpenAI',             false, 2, 'sk-***...***',     '{"model_defaut":"gpt-4o","sdk":"openai"}')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- BLOC 6 — platform_settings
-- Configuration globale clé-valeur.
-- valeur JSONB supporte string, number, boolean, object, array.
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  cle            VARCHAR(100) PRIMARY KEY,
  valeur         JSONB        NOT NULL,
  type           VARCHAR(20)  NOT NULL DEFAULT 'string'
                 CHECK (type IN ('string','number','boolean','json','array')),
  description    TEXT,
  groupe         VARCHAR(50)  NOT NULL DEFAULT 'operationnel',
  modifiable_ui  BOOLEAN      NOT NULL DEFAULT true,
  cree_le        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  mis_a_jour_le  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed : paramètres initiaux depuis constantes métier
INSERT INTO platform_settings (cle, valeur, type, description, groupe) VALUES
  ('tva_cameroun',          '19.25',  'number',  'Taux TVA Cameroun (%)',               'fiscal'),
  ('tva_maroc',             '20.0',   'number',  'Taux TVA Maroc (%)',                  'fiscal'),
  ('tva_cote_ivoire',       '18.0',   'number',  'Taux TVA Côte d''Ivoire (%)',         'fiscal'),
  ('tva_senegal',           '18.0',   'number',  'Taux TVA Sénégal (%)',                'fiscal'),
  ('tva_rwanda',            '18.0',   'number',  'Taux TVA Rwanda (%)',                 'fiscal'),
  ('devise_defaut',         '"XAF"',  'string',  'Devise par défaut de la plateforme',  'operationnel'),
  ('syscohada_actif',       'true',   'boolean', 'Activer les exports SYSCOHADA/OHADA', 'conformite'),
  ('grace_alerte_jours',    '3',      'number',  'Alerte tenant avant fin de grâce (j)','operationnel'),
  ('mfa_requis_enterprise', 'false',  'boolean', 'MFA obligatoire pour plans enterprise','securite'),
  ('ia_alerte_quota_pct',   '90',     'number',  'Seuil alerte quota IA (%)',           'ia')
ON CONFLICT (cle) DO NOTHING;

-- =============================================================================
-- BLOC 7 — tenant_module_overrides
-- Overrides de modules par tenant.
-- Priorité absolue sur plan_modules lors de l'évaluation PolicyEngine.
-- raison obligatoire (traçabilité).
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenant_module_overrides (
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_code  VARCHAR(50) NOT NULL REFERENCES platform_modules(code),
  enabled      BOOLEAN     NOT NULL,
  raison       TEXT        NOT NULL CHECK (char_length(raison) >= 10),
  actif_depuis DATE        NOT NULL DEFAULT CURRENT_DATE,
  actif_jusqu  DATE,
  cree_par     UUID,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY  (tenant_id, module_code)
);

CREATE INDEX IF NOT EXISTS idx_tenant_module_overrides_tenant
  ON tenant_module_overrides(tenant_id);

-- NOTE Layer 7 : la table licenses sera créée dans migration_subscription_licensing.sql
-- Elle n'appartient pas à Layer 6 — conformément à la doctrine CEPOS.

-- =============================================================================
-- BLOC 8 — ALTER TABLE abonnements
-- Colonnes ajoutées pour Layer 6 :
--   max_ia_mensuel : override quota IA par contrat (gap identifié dans PolicyEngine)
--   date_fin       : date de fin de contrat (NULL = sans terme)
-- =============================================================================

ALTER TABLE abonnements
  ADD COLUMN IF NOT EXISTS max_ia_mensuel  INTEGER,
  ADD COLUMN IF NOT EXISTS date_fin        DATE;

-- =============================================================================
-- BLOC 10 — INDEXES PERFORMANCE
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_plan_modules_plan
  ON plan_modules(plan_code) WHERE inclus = true;

CREATE INDEX IF NOT EXISTS idx_platform_settings_groupe
  ON platform_settings(groupe);

CREATE INDEX IF NOT EXISTS idx_platform_providers_actif
  ON platform_providers(actif, priorite) WHERE actif = true;

-- =============================================================================
-- BLOC 11 — ASSERTIONS POST-MIGRATION
-- =============================================================================

DO $$
DECLARE
  nb_plans    INT;
  nb_modules  INT;
  nb_junctions INT;
BEGIN
  -- Tables créées
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_plans') THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] platform_plans non créée';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_modules') THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] platform_modules non créée';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_modules') THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] plan_modules non créée';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenant_module_overrides') THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] tenant_module_overrides non créée';
  END IF;

  -- Seed data
  SELECT COUNT(*) INTO nb_plans FROM platform_plans;
  SELECT COUNT(*) INTO nb_modules FROM platform_modules;
  SELECT COUNT(*) INTO nb_junctions FROM plan_modules;

  IF nb_plans < 5 THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] Seed plans incomplet (% trouvés, attendu >= 5)', nb_plans;
  END IF;
  IF nb_modules < 7 THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] Seed modules incomplet (% trouvés, attendu >= 7)', nb_modules;
  END IF;
  IF nb_junctions < 35 THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] Seed plan_modules incomplet (% trouvés, attendu >= 35)', nb_junctions;
  END IF;

  -- Colonnes abonnements
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'abonnements' AND column_name = 'max_ia_mensuel'
  ) THEN
    RAISE EXCEPTION '[PLATFORM_CONFIG POST-ASSERT] abonnements.max_ia_mensuel absent';
  END IF;

  RAISE NOTICE '[PLATFORM_CONFIG] ✓ Migration terminée avec succès';
  RAISE NOTICE '[PLATFORM_CONFIG]   platform_plans    : % plans', nb_plans;
  RAISE NOTICE '[PLATFORM_CONFIG]   platform_modules  : % modules', nb_modules;
  RAISE NOTICE '[PLATFORM_CONFIG]   plan_modules      : % associations', nb_junctions;
END $$;

COMMIT;
