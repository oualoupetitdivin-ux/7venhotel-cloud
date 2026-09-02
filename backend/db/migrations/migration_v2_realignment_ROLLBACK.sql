-- =============================================================================
-- ROLLBACK DELTA — lignes_folio · Inverse exact de migration_delta.sql
-- 7venHotel Cloud PMS · Production Railway
--
-- CE FICHIER EST LE ROLLBACK DE migration_delta.sql UNIQUEMENT.
-- Il n'est pas le rollback de migration_v2_realignment.sql (ancienne migration
-- avec rename — désormais obsolète et non utilisée).
--
-- Supprime UNIQUEMENT ce que migration_delta.sql a ajouté :
--   - Colonnes V2 : sens, hotel_id, reference_id, reference_type, devise,
--                   source_module, cree_par, cree_par_type, metadata,
--                   ligne_corrigee_id
--   - Contraintes : chk_lignes_folio_sens, chk_lignes_folio_cree_par_type,
--                   fk_lignes_folio_hotel_id, fk_lignes_folio_correction
--   - Index       : idx_lignes_folio_* (5 index delta)
--
-- NE TOUCHE PAS :
--   - Les colonnes V1 originales (montant_total, date_facturation,
--     reference_externe, quantite, prix_unitaire, etc.)
--   - Le nom de la table (lignes_folio reste lignes_folio)
--
-- PRÉCAUTION avant exécution :
--   Vérifier qu'aucune donnée V2 ne sera perdue :
--     SELECT COUNT(*) FROM lignes_folio WHERE sens IS NOT NULL;
--     SELECT COUNT(*) FROM lignes_folio WHERE hotel_id IS NOT NULL;
--   Si des données V2 existent → évaluer avant rollback.
--
-- Exécution : psql $DATABASE_URL -f migration_v2_realignment_ROLLBACK.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- ASSERTIONS PRÉALABLES ROLLBACK
-- Vérifie que la migration delta a bien été appliquée avant de rollback.
-- =============================================================================

DO $$
BEGIN

  -- La table doit s'appeler lignes_folio
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lignes_folio'
  ) THEN
    RAISE EXCEPTION '[ROLLBACK PRE-ASSERT] ECHEC : table lignes_folio introuvable.';
  END IF;

  -- La migration delta doit avoir été appliquée (sens doit exister)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'sens'
  ) THEN
    RAISE EXCEPTION
      '[ROLLBACK PRE-ASSERT] ECHEC : colonne sens absente.'
      ' migration_delta.sql a-t-elle été appliquée ?';
  END IF;

  -- Colonnes V1 doivent être intactes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'montant_total'
  ) THEN
    RAISE EXCEPTION '[ROLLBACK PRE-ASSERT] ECHEC : colonne montant_total absente — état inattendu.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'date_facturation'
  ) THEN
    RAISE EXCEPTION '[ROLLBACK PRE-ASSERT] ECHEC : colonne date_facturation absente — état inattendu.';
  END IF;

  RAISE NOTICE '[ROLLBACK PRE-ASSERT] ✓ Assertions préalables OK.';

END $$;


-- =============================================================================
-- ÉTAPE 1 — SUPPRIMER LES INDEX V2
-- IF EXISTS → idempotent.
-- Noms exacts créés par migration_delta.sql BLOC 7.
-- =============================================================================

DROP INDEX IF EXISTS idx_lignes_folio_correction_unique;
DROP INDEX IF EXISTS idx_lignes_folio_reference;
DROP INDEX IF EXISTS idx_lignes_folio_hotel_sens;
DROP INDEX IF EXISTS idx_lignes_folio_hotel_date;
DROP INDEX IF EXISTS idx_lignes_folio_folio_id;


-- =============================================================================
-- ÉTAPE 2 — SUPPRIMER LES CONTRAINTES V2
-- Ordre : FK self-ref en premier (ligne_corrigee_id référence la table elle-même),
--         puis CHECK sens et cree_par_type, puis FK hotel_id.
-- =============================================================================

ALTER TABLE lignes_folio
  DROP CONSTRAINT IF EXISTS fk_lignes_folio_correction;

ALTER TABLE lignes_folio
  DROP CONSTRAINT IF EXISTS chk_lignes_folio_sens;

ALTER TABLE lignes_folio
  DROP CONSTRAINT IF EXISTS chk_lignes_folio_cree_par_type;

ALTER TABLE lignes_folio
  DROP CONSTRAINT IF EXISTS fk_lignes_folio_hotel_id;


-- =============================================================================
-- ÉTAPE 3 — SUPPRIMER LES COLONNES V2
-- Ordre : ligne_corrigee_id en premier (FK self-ref déjà supprimée).
-- IF EXISTS → idempotent.
-- Les colonnes V1 (montant_total, date_facturation, etc.) ne sont pas touchées.
-- =============================================================================

ALTER TABLE lignes_folio
  DROP COLUMN IF EXISTS ligne_corrigee_id,
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS cree_par_type,
  DROP COLUMN IF EXISTS cree_par,
  DROP COLUMN IF EXISTS source_module,
  DROP COLUMN IF EXISTS devise,
  DROP COLUMN IF EXISTS reference_type,
  DROP COLUMN IF EXISTS reference_id,
  DROP COLUMN IF EXISTS hotel_id,
  DROP COLUMN IF EXISTS sens;


-- =============================================================================
-- ASSERTIONS FINALES ROLLBACK
-- =============================================================================

DO $$
BEGIN

  -- Colonnes V2 doivent être absentes
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio'
    AND   column_name IN (
      'sens', 'hotel_id', 'reference_id', 'reference_type',
      'devise', 'source_module', 'cree_par', 'cree_par_type',
      'metadata', 'ligne_corrigee_id'
    )
  ) THEN
    RAISE EXCEPTION '[ROLLBACK POST-ASSERT] ECHEC : au moins une colonne V2 encore présente.';
  END IF;

  -- Colonnes V1 toujours intactes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'montant_total') THEN
    RAISE EXCEPTION '[ROLLBACK POST-ASSERT] ECHEC : montant_total disparu — état corrompu.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'date_facturation') THEN
    RAISE EXCEPTION '[ROLLBACK POST-ASSERT] ECHEC : date_facturation disparu — état corrompu.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'reference_externe') THEN
    RAISE EXCEPTION '[ROLLBACK POST-ASSERT] ECHEC : reference_externe disparu — état corrompu.';
  END IF;

  -- Table toujours lignes_folio
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lignes_folio') THEN
    RAISE EXCEPTION '[ROLLBACK POST-ASSERT] ECHEC : table lignes_folio introuvable.';
  END IF;

  RAISE NOTICE '[ROLLBACK POST-ASSERT] ✓ Rollback delta OK — état V1 restauré.';
  RAISE NOTICE 'Prochaine étape : redéployer le build Railway pre-V2.';

END $$;


COMMIT;
