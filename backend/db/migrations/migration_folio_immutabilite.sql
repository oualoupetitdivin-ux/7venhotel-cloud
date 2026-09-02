-- =============================================================================
-- MIGRATION FOLIO IMMUTABILITÉ — Socle financier Phase 1
-- 7venHotel Cloud PMS · Production Railway
--
-- PÉRIMÈTRE (ÉTAPE 0B) :
--   - Crée la fonction prevent_folio_modification() dédiée au ledger financier
--   - Applique les triggers BEFORE UPDATE/DELETE sur lignes_folio
--   - Applique les triggers BEFORE UPDATE/DELETE sur logs_financiers
--
-- PRÉREQUIS :
--   - migration_folio_v2_complete.sql exécuté (table logs_financiers créée)
--   - migration_platform_foundations.sql exécuté (prevent_audit_modification existe)
--
-- IMPACT VALIDÉ (audit 2026-06-21) :
--   - Zéro UPDATE/DELETE applicatif sur lignes_folio dans tout le codebase
--   - Zéro migration backfill UPDATE pendante (migration_delta.sql déjà exécutée)
--   - Immutabilité compatible immédiate — risque zéro confirmé
--
-- GARANTIES :
--   - Idempotent (guards pg_trigger IF NOT EXISTS)
--   - Transaction atomique — tout ou rien
--   - Assertions PRE et POST
--
-- Exécution : psql $DATABASE_URL -f migration_folio_immutabilite.sql
-- Précédent : migration_folio_v2_complete.sql
-- =============================================================================

BEGIN;


-- =============================================================================
-- BLOC 1 — ASSERTIONS PRÉALABLES
-- =============================================================================

DO $$
BEGIN

  -- Table lignes_folio doit exister
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lignes_folio') THEN
    RAISE EXCEPTION '[IMM PRE-ASSERT] ECHEC : table lignes_folio introuvable.';
  END IF;

  -- Table logs_financiers doit exister (créée par migration_folio_v2_complete.sql)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'logs_financiers') THEN
    RAISE EXCEPTION '[IMM PRE-ASSERT] ECHEC : table logs_financiers introuvable. Lancer migration_folio_v2_complete.sql d''abord.';
  END IF;

  -- prevent_audit_modification() doit exister (créée par migration_platform_foundations.sql)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'prevent_audit_modification' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION '[IMM PRE-ASSERT] ECHEC : fonction prevent_audit_modification() introuvable. Lancer migration_platform_foundations.sql d''abord.';
  END IF;

  -- Warnings si triggers déjà présents (idempotence)
  IF EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_update'
    AND tgrelid = 'lignes_folio'::regclass) THEN
    RAISE WARNING '[IMM PRE-ASSERT] trigger tg_logs_financiers_immutable_update déjà présent sur lignes_folio — no-op.';
  END IF;

  RAISE NOTICE '[IMM PRE-ASSERT] ✓ Assertions préalables OK.';

END $$;


-- =============================================================================
-- BLOC 2 — FONCTION DÉDIÉE prevent_folio_modification
--
-- Variante de prevent_audit_modification() avec message métier approprié.
-- TG_TABLE_NAME est dynamique — s'adapte à lignes_folio ET logs_financiers.
-- OHADA Plan Comptable : intégrité des écritures financières inviolable.
-- =============================================================================

CREATE OR REPLACE FUNCTION prevent_folio_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    '% est immuable — toute modification ou suppression est interdite (conformité OHADA/IFRS). '
    'Table: %, Operation: %, Ligne ID: %',
    TG_TABLE_NAME, TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, 'N/A');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_folio_modification() IS
'Trigger BEFORE UPDATE/DELETE empêchant toute modification du ledger financier. '
'S''applique à lignes_folio et logs_financiers. Conformité OHADA/IFRS.';


-- =============================================================================
-- BLOC 3 — TRIGGERS SUR lignes_folio
--
-- Nommage : tg_logs_financiers_immutable_{operation}
-- Cohérent avec la référence dans facturation.repository.js:
--   "INSERT ONLY — enforced par trigger DB (tg_logs_financiers_immutable)"
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_update'
      AND tgrelid = 'lignes_folio'::regclass
  ) THEN
    CREATE TRIGGER tg_logs_financiers_immutable_update
      BEFORE UPDATE ON lignes_folio
      FOR EACH ROW EXECUTE FUNCTION prevent_folio_modification();
    RAISE NOTICE '[IMM] ✓ Trigger tg_logs_financiers_immutable_update créé sur lignes_folio.';
  ELSE
    RAISE NOTICE '[IMM] ○ Trigger tg_logs_financiers_immutable_update déjà présent — skip.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_delete'
      AND tgrelid = 'lignes_folio'::regclass
  ) THEN
    CREATE TRIGGER tg_logs_financiers_immutable_delete
      BEFORE DELETE ON lignes_folio
      FOR EACH ROW EXECUTE FUNCTION prevent_folio_modification();
    RAISE NOTICE '[IMM] ✓ Trigger tg_logs_financiers_immutable_delete créé sur lignes_folio.';
  ELSE
    RAISE NOTICE '[IMM] ○ Trigger tg_logs_financiers_immutable_delete déjà présent — skip.';
  END IF;
END $$;


-- =============================================================================
-- BLOC 4 — TRIGGERS SUR logs_financiers
--
-- Le journal d'audit financier est lui-même immuable.
-- Une fois qu'une opération est logguée, la trace ne peut pas être effacée.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_update'
      AND tgrelid = 'logs_financiers'::regclass
  ) THEN
    CREATE TRIGGER tg_logs_financiers_immutable_update
      BEFORE UPDATE ON logs_financiers
      FOR EACH ROW EXECUTE FUNCTION prevent_folio_modification();
    RAISE NOTICE '[IMM] ✓ Trigger tg_logs_financiers_immutable_update créé sur logs_financiers.';
  ELSE
    RAISE NOTICE '[IMM] ○ Trigger tg_logs_financiers_immutable_update déjà présent sur logs_financiers — skip.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_delete'
      AND tgrelid = 'logs_financiers'::regclass
  ) THEN
    CREATE TRIGGER tg_logs_financiers_immutable_delete
      BEFORE DELETE ON logs_financiers
      FOR EACH ROW EXECUTE FUNCTION prevent_folio_modification();
    RAISE NOTICE '[IMM] ✓ Trigger tg_logs_financiers_immutable_delete créé sur logs_financiers.';
  ELSE
    RAISE NOTICE '[IMM] ○ Trigger tg_logs_financiers_immutable_delete déjà présent sur logs_financiers — skip.';
  END IF;
END $$;


-- =============================================================================
-- BLOC 5 — ASSERTIONS FINALES
-- =============================================================================

DO $$
BEGIN

  -- Triggers lignes_folio
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_update'
    AND tgrelid = 'lignes_folio'::regclass) THEN
    RAISE EXCEPTION '[IMM POST-ASSERT] ECHEC : trigger UPDATE manquant sur lignes_folio.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_delete'
    AND tgrelid = 'lignes_folio'::regclass) THEN
    RAISE EXCEPTION '[IMM POST-ASSERT] ECHEC : trigger DELETE manquant sur lignes_folio.';
  END IF;

  -- Triggers logs_financiers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_update'
    AND tgrelid = 'logs_financiers'::regclass) THEN
    RAISE EXCEPTION '[IMM POST-ASSERT] ECHEC : trigger UPDATE manquant sur logs_financiers.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_logs_financiers_immutable_delete'
    AND tgrelid = 'logs_financiers'::regclass) THEN
    RAISE EXCEPTION '[IMM POST-ASSERT] ECHEC : trigger DELETE manquant sur logs_financiers.';
  END IF;

  -- Fonction dédiée
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'prevent_folio_modification' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION '[IMM POST-ASSERT] ECHEC : fonction prevent_folio_modification() absente.';
  END IF;

  RAISE NOTICE '[IMM POST-ASSERT] ✓ 4 triggers immutabilité actifs (2×lignes_folio, 2×logs_financiers).';
  RAISE NOTICE '[IMM POST-ASSERT] ✓ Ledger financier physiquement protégé en DB (OHADA/IFRS).';
  RAISE NOTICE '[IMM POST-ASSERT] ✓ COMMIT autorisé.';

END $$;


COMMIT;
