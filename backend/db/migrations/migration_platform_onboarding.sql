-- =============================================================================
-- MIGRATION — Platform Onboarding Layer 5A
-- 7venHotel Cloud · Control Plane SaaS
--
-- OBJECTIF :
--   Ajouter les colonnes nécessaires à l'onboarding SaaS :
--     utilisateurs.is_primary_contact — identifie le manager principal d'un tenant
--     utilisateurs.doit_changer_mdp   — force le changement MDP à la première connexion
--
-- GARANTIES :
--   - Idempotente (IF NOT EXISTS partout)
--   - Additive uniquement — aucun DROP, RENAME, ALTER destructif
--   - Atomique (transaction unique)
--   - Rollback complet si un bloc échoue
--   - Index UNIQUE partiel : un seul contact principal par tenant (enforcement DB)
--
-- Prérequis :
--   migration_platform_foundations.sql doit être appliquée (table utilisateurs présente)
--
-- Exécution :
--   psql $DATABASE_URL -f migration_platform_onboarding.sql
--
-- Rollback manuel :
--   ALTER TABLE utilisateurs DROP COLUMN IF EXISTS is_primary_contact;
--   ALTER TABLE utilisateurs DROP COLUMN IF EXISTS doit_changer_mdp;
--   DROP INDEX IF EXISTS idx_utilisateurs_primary_contact;
-- =============================================================================

BEGIN;

-- =============================================================================
-- BLOC 1 — ASSERTIONS PRÉALABLES
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'utilisateurs'
  ) THEN
    RAISE EXCEPTION '[ONBOARDING] ECHEC PRE-ASSERT: table utilisateurs introuvable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) THEN
    RAISE EXCEPTION '[ONBOARDING] ECHEC PRE-ASSERT: table tenants introuvable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'abonnements'
  ) THEN
    RAISE EXCEPTION '[ONBOARDING] ECHEC PRE-ASSERT: table abonnements introuvable';
  END IF;

  RAISE NOTICE '[ONBOARDING] Assertions préalables OK ✓';
END $$;

-- =============================================================================
-- BLOC 2 — is_primary_contact
--
-- Identifie le manager principal (contact contractuel) d'un tenant.
-- DEFAULT false — les utilisateurs existants ne sont pas affectés.
--
-- L'index UNIQUE partiel (WHERE is_primary_contact = true) garantit au niveau DB
-- qu'il ne peut exister qu'un seul contact principal par tenant.
-- Cette contrainte est plus forte qu'une contrainte applicative.
-- =============================================================================

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS is_primary_contact BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN utilisateurs.is_primary_contact IS
'Contact principal (manager) du tenant. Un seul par tenant (index UNIQUE partiel). '
'Positionné à true lors du provisioning SA. Utilisé pour les communications contractuelles.';

-- Index UNIQUE partiel : un seul is_primary_contact=true par tenant_id
-- WHERE is_primary_contact = true → les lignes false ne participent pas à la contrainte
-- Rétrocompatible : lignes existantes ont DEFAULT false → aucune collision
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'utilisateurs'
      AND indexname = 'idx_utilisateurs_primary_contact'
  ) THEN
    CREATE UNIQUE INDEX idx_utilisateurs_primary_contact
      ON utilisateurs(tenant_id)
      WHERE is_primary_contact = true;
    RAISE NOTICE '[ONBOARDING] Index idx_utilisateurs_primary_contact créé ✓';
  ELSE
    RAISE NOTICE '[ONBOARDING] Index idx_utilisateurs_primary_contact déjà présent — no-op ✓';
  END IF;
END $$;

-- =============================================================================
-- BLOC 3 — doit_changer_mdp
--
-- Indique que l'utilisateur doit changer son mot de passe à la prochaine connexion.
-- Positionné à true lors du provisioning (MDP temporaire généré par le SA).
-- Remis à false après changement par l'utilisateur (route /auth/changer-mdp).
-- DEFAULT false — les utilisateurs existants ne sont pas affectés.
-- =============================================================================

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS doit_changer_mdp BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN utilisateurs.doit_changer_mdp IS
'Si true : l''utilisateur doit changer son MDP à la prochaine connexion. '
'Positionné à true lors du provisioning SA avec MDP temporaire. '
'Remis à false après changement (route /auth/changer-mdp).';

-- =============================================================================
-- BLOC 4 — INDEX PERFORMANCE
-- Requêtes fréquentes après onboarding : recherche par tenant + rôle
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_utilisateurs_tenant_role
  ON utilisateurs(tenant_id, role)
  WHERE actif = true;

COMMENT ON INDEX idx_utilisateurs_tenant_role IS
'Performance : liste des utilisateurs actifs par tenant et rôle. '
'Utilisé par provision-manager (vérification quota), IAM, et analytics.';

-- =============================================================================
-- BLOC 5 — ASSERTIONS POST-MIGRATION
-- =============================================================================

DO $$
BEGIN
  -- Colonne is_primary_contact
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'utilisateurs'
      AND column_name  = 'is_primary_contact'
  ) THEN
    RAISE EXCEPTION '[ONBOARDING POST-ASSERT] is_primary_contact absent — migration échouée';
  END IF;

  -- Colonne doit_changer_mdp
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'utilisateurs'
      AND column_name  = 'doit_changer_mdp'
  ) THEN
    RAISE EXCEPTION '[ONBOARDING POST-ASSERT] doit_changer_mdp absent — migration échouée';
  END IF;

  -- Index unique contact principal
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'utilisateurs'
      AND indexname = 'idx_utilisateurs_primary_contact'
  ) THEN
    RAISE EXCEPTION '[ONBOARDING POST-ASSERT] idx_utilisateurs_primary_contact absent — migration échouée';
  END IF;

  RAISE NOTICE '[ONBOARDING] ✓ Migration terminée avec succès';
  RAISE NOTICE '[ONBOARDING]   is_primary_contact       : colonne créée ✓';
  RAISE NOTICE '[ONBOARDING]   doit_changer_mdp         : colonne créée ✓';
  RAISE NOTICE '[ONBOARDING]   idx_utilisateurs_primary_contact : index unique créé ✓';
  RAISE NOTICE '[ONBOARDING]   idx_utilisateurs_tenant_role     : index perf créé ✓';
END $$;

COMMIT;
