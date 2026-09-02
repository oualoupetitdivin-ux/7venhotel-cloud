-- =============================================================================
-- MIGRATION — Platform Foundations Layer 1
-- 7venHotel Cloud · Control Plane SaaS
--
-- GARANTIES :
--   - Idempotente (IF NOT EXISTS partout)
--   - Additive uniquement — aucun DROP, RENAME, ALTER destructif
--   - Atomique (transaction unique)
--   - Rollback complet si un bloc échoue
--
-- Exécution :
--   psql $DATABASE_URL -f migration_platform_foundations.sql
--
-- Rollback manuel (si nécessaire) :
--   DROP TABLE IF EXISTS sessions_actives CASCADE;
--   DROP TABLE IF EXISTS platform_metrics_snapshot CASCADE;
--   DROP TRIGGER IF EXISTS trg_prevent_audit_update ON logs_audit;
--   DROP TRIGGER IF EXISTS trg_prevent_audit_delete ON logs_audit;
--   DROP FUNCTION IF EXISTS prevent_audit_modification();
-- =============================================================================

BEGIN;

-- =============================================================================
-- BLOC 1 — ASSERTIONS PRÉALABLES
-- Vérifier que les tables de base existent avant de continuer.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'utilisateurs'
  ) THEN
    RAISE EXCEPTION '[FOUNDATIONS] ECHEC PRE-ASSERT: table utilisateurs introuvable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    RAISE EXCEPTION '[FOUNDATIONS] ECHEC PRE-ASSERT: table tenants introuvable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'logs_audit'
  ) THEN
    RAISE EXCEPTION '[FOUNDATIONS] ECHEC PRE-ASSERT: table logs_audit introuvable';
  END IF;
END $$;

-- =============================================================================
-- BLOC 2 — SESSIONS ACTIVES
-- Permet la révocation de sessions JWT (invariant sécurité critique).
-- Chaque login crée une entrée. Chaque logout / suspension tenant la supprime.
-- Redis est la couche fast-path — cette table est la source de vérité et l'audit.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sessions_actives (
  jti            UUID        PRIMARY KEY,        -- JWT ID — clé de corrélation avec Redis
  utilisateur_id UUID        NOT NULL,
  tenant_id      UUID,                           -- NULL pour super_admin (scope platform)
  scope          VARCHAR(20) NOT NULL DEFAULT 'hotel',  -- 'platform' | 'hotel'
  role           VARCHAR(50) NOT NULL,
  ip_address     INET,
  user_agent     VARCHAR(255),
  expire_le      TIMESTAMPTZ NOT NULL,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoque_le     TIMESTAMPTZ                     -- NULL = active, non-NULL = révoquée manuellement
);

-- Index pour invalidation en masse par tenant (suspension)
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_active
  ON sessions_actives(tenant_id, expire_le)
  WHERE revoque_le IS NULL;

-- Index pour nettoyage des sessions expirées (job quotidien)
CREATE INDEX IF NOT EXISTS idx_sessions_expirées
  ON sessions_actives(expire_le)
  WHERE revoque_le IS NULL;

-- Index pour lookup par utilisateur (révocation individuelle)
CREATE INDEX IF NOT EXISTS idx_sessions_utilisateur
  ON sessions_actives(utilisateur_id, expire_le);

-- =============================================================================
-- BLOC 3 — IMMUABILITÉ logs_audit
-- Trigger BEFORE UPDATE/DELETE empêche toute modification des logs d'audit.
-- Cette protection est indépendante des permissions PostgreSQL — elle s'applique
-- même au superuser, garantissant une conformité OHADA/IFRS réelle.
-- =============================================================================

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'logs_audit est immuable — aucune modification ou suppression autorisée (conformité OHADA/IFRS). '
    'Table: %, Operation: %, Row ID: %',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, 'N/A');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger UPDATE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_prevent_audit_update'
      AND tgrelid = 'logs_audit'::regclass
  ) THEN
    CREATE TRIGGER trg_prevent_audit_update
      BEFORE UPDATE ON logs_audit
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
  END IF;
END $$;

-- Trigger DELETE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_prevent_audit_delete'
      AND tgrelid = 'logs_audit'::regclass
  ) THEN
    CREATE TRIGGER trg_prevent_audit_delete
      BEFORE DELETE ON logs_audit
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
  END IF;
END $$;

-- =============================================================================
-- BLOC 4 — INDEXES PERFORMANCE
-- Optimise les queries fréquentes du control plane SaaS.
-- CONCURRENTLY non utilisé ici pour rester dans la transaction.
-- =============================================================================

-- logs_audit : query /platform/audit (filtrée par tenant + date)
CREATE INDEX IF NOT EXISTS idx_logs_audit_tenant_date
  ON logs_audit(tenant_id, cree_le DESC);

-- logs_audit : query par action (détection anomalies)
CREATE INDEX IF NOT EXISTS idx_logs_audit_action_date
  ON logs_audit(action, cree_le DESC);

-- abonnements : jointure fréquente dans platform dashboard
CREATE INDEX IF NOT EXISTS idx_abonnements_tenant_statut
  ON abonnements(tenant_id, statut);

-- abonnements : aggregation MRR (SUM par plan)
CREATE INDEX IF NOT EXISTS idx_abonnements_plan_statut
  ON abonnements(plan, statut);

-- tenants : filtre par statut (actif/essai/suspendu)
CREATE INDEX IF NOT EXISTS idx_tenants_statut
  ON tenants(statut, cree_le DESC);

-- =============================================================================
-- BLOC 5 — PLATFORM METRICS SNAPSHOT (Read Model)
-- Table de lecture pré-calculée pour le dashboard /platform/dashboard.
-- Remplace les 13 SQL queries par 1 seule lecture de ce snapshot.
-- Mis à jour toutes les 5 minutes par le cron KPI (kpi-aggregation.job.js).
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_metrics_snapshot (
  id          SERIAL      PRIMARY KEY,            -- Toujours 1 seule ligne (UPSERT)
  payload     JSONB       NOT NULL DEFAULT '{}',
  calcule_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insérer la ligne initiale vide si la table est neuve
INSERT INTO platform_metrics_snapshot (id, payload, calcule_le)
VALUES (1, '{"note": "snapshot initial — sera calculé au prochain cron"}', NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- BLOC 6 — ASSERTIONS POST-MIGRATION
-- Vérifier que les objets créés existent bien.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sessions_actives'
  ) THEN
    RAISE EXCEPTION '[FOUNDATIONS POST-ASSERT] sessions_actives non créée';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_prevent_audit_update'
  ) THEN
    RAISE EXCEPTION '[FOUNDATIONS POST-ASSERT] trigger immuabilité audit non créé';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'platform_metrics_snapshot'
  ) THEN
    RAISE EXCEPTION '[FOUNDATIONS POST-ASSERT] platform_metrics_snapshot non créée';
  END IF;

  RAISE NOTICE '[FOUNDATIONS] Migration terminée avec succès ✓';
  RAISE NOTICE '[FOUNDATIONS]   sessions_actives    : créée ✓';
  RAISE NOTICE '[FOUNDATIONS]   audit immuabilité   : trigger actif ✓';
  RAISE NOTICE '[FOUNDATIONS]   indexes performance : créés ✓';
  RAISE NOTICE '[FOUNDATIONS]   metrics snapshot    : créée ✓';
END $$;

COMMIT;
