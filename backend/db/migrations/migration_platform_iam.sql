-- =============================================================================
-- MIGRATION — Platform IAM Layer 2
-- 7venHotel Cloud · Identity & Access Management
--
-- Tables créées :
--   platform_impersonation_sessions — sessions d'impersonation super_admin → tenant
--
-- Invariants garantis :
--   • max 5 sessions d'impersonation par admin par jour (policy engine)
--   • chaque session loguée avec IP, raison, durée
--   • révocation immédiate possible
--   • impossible d'escalader ses propres privilèges via impersonation
--
-- Exécution :
--   psql $DATABASE_URL -f migration_platform_iam.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- ASSERTION PRÉALABLE
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sessions_actives'
  ) THEN
    RAISE EXCEPTION '[IAM] ECHEC: sessions_actives introuvable — appliquer migration_platform_foundations.sql en premier';
  END IF;
END $$;

-- =============================================================================
-- TABLE platform_impersonation_sessions
-- Toutes les sessions d'impersonation super_admin → tenant.
-- Immuable par convention — pas de UPDATE/DELETE (audit trail légal).
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_impersonation_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID        NOT NULL,               -- super_admin qui impersonne
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  raison          TEXT        NOT NULL CHECK (char_length(raison) >= 10),  -- raison explicite obligatoire
  jti             UUID        UNIQUE,                 -- JWT de la session impersonation
  ip_address      INET,
  user_agent      VARCHAR(255),
  expire_le       TIMESTAMPTZ NOT NULL,               -- max NOW() + 2h
  revoque_le      TIMESTAMPTZ,                        -- NULL = active
  revoque_par     UUID,                               -- qui a révoqué
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour lookup par admin (limite quotidienne)
CREATE INDEX IF NOT EXISTS idx_impersonation_admin_date
  ON platform_impersonation_sessions(admin_id, cree_le DESC);

-- Index pour lookup par tenant (audit drill-down)
CREATE INDEX IF NOT EXISTS idx_impersonation_tenant
  ON platform_impersonation_sessions(tenant_id, cree_le DESC);

-- Index pour sessions actives uniquement (non révoquées, non expirées)
CREATE INDEX IF NOT EXISTS idx_impersonation_active
  ON platform_impersonation_sessions(expire_le)
  WHERE revoque_le IS NULL;

-- =============================================================================
-- ASSERTION POST-MIGRATION
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'platform_impersonation_sessions'
  ) THEN
    RAISE EXCEPTION '[IAM POST-ASSERT] platform_impersonation_sessions non créée';
  END IF;
  RAISE NOTICE '[IAM] Migration terminée ✓ — platform_impersonation_sessions créée';
END $$;

COMMIT;
