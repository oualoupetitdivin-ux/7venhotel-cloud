-- =============================================================================
-- MIGRATION DELTA — lignes_folio · Colonnes V2 manquantes
-- 7venHotel Cloud PMS · Production Railway
--
-- ÉTAT RÉEL DE PRODUCTION AUDITÉ :
--   Table existante   : lignes_folio
--   Colonnes présentes (non touchées) :
--     id, folio_id, type_ligne, description,
--     quantite, prix_unitaire, montant_total,
--     date_facturation, reference_externe, cree_le
--
--   Colonnes ajoutées par cette migration :
--     Bloc 2 : sens
--     Bloc 3 : hotel_id  (+ backfill depuis folios.hotel_id)
--     Bloc 4 : reference_id, reference_type, devise,
--              source_module, cree_par, cree_par_type, metadata
--     Bloc 5 : ligne_corrigee_id
--
-- GARANTIES :
--   - Pas de RENAME de table
--   - Pas de DROP COLUMN
--   - Pas de modification de montant_total, date_facturation, reference_externe
--   - Idempotent (ADD COLUMN IF NOT EXISTS, guards IF NOT EXISTS sur FK/CHECK)
--   - Atomique (une transaction, assertions avant et après)
--   - Zéro downtime Railway
--
-- Exécution : psql $DATABASE_URL -f migration_delta.sql
-- Rollback  : psql $DATABASE_URL -f migration_v2_realignment_ROLLBACK.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- BLOC 1 — ASSERTIONS PRÉALABLES
-- Tout RAISE EXCEPTION → ROLLBACK automatique, base intacte.
-- =============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lignes_folio'
  ) THEN
    RAISE EXCEPTION '[DELTA PRE-ASSERT] ECHEC : table lignes_folio introuvable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'montant_total'
  ) THEN
    RAISE EXCEPTION '[DELTA PRE-ASSERT] ECHEC : colonne montant_total absente — schema divergent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'reference_externe'
  ) THEN
    RAISE EXCEPTION '[DELTA PRE-ASSERT] ECHEC : colonne reference_externe absente — schema divergent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'folio_id'
  ) THEN
    RAISE EXCEPTION '[DELTA PRE-ASSERT] ECHEC : colonne folio_id absente — schema divergent.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'folios'
  ) THEN
    RAISE EXCEPTION '[DELTA PRE-ASSERT] ECHEC : table folios introuvable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hotels'
  ) THEN
    RAISE EXCEPTION '[DELTA PRE-ASSERT] ECHEC : table hotels introuvable.';
  END IF;

  -- Warnings si colonnes déjà présentes (idempotence — pas bloquant)
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'sens') THEN
    RAISE WARNING '[DELTA PRE-ASSERT] sens déjà présente — no-op.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'hotel_id') THEN
    RAISE WARNING '[DELTA PRE-ASSERT] hotel_id déjà présente — no-op.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM lignes_folio;
  IF v_count > 0 THEN
    RAISE NOTICE '[DELTA PRE-ASSERT] % ligne(s) existante(s) — backfill hotel_id sera appliqué.', v_count;
  ELSE
    RAISE NOTICE '[DELTA PRE-ASSERT] Table vide — backfill = no-op.';
  END IF;

  RAISE NOTICE '[DELTA PRE-ASSERT] ✓ Assertions préalables OK.';

END $$;


-- =============================================================================
-- BLOC 2 — ADD COLUMN sens
-- Sens comptable : 'debit' (charge) | 'credit' (paiement/correction)
-- CHECK ajouté séparément en BLOC 6. NOT VALID = pas de scan historique.
-- =============================================================================

ALTER TABLE lignes_folio
  ADD COLUMN IF NOT EXISTS sens VARCHAR(10);

COMMENT ON COLUMN lignes_folio.sens IS
'Sens comptable V2 : ''debit'' = charge, ''credit'' = paiement ou correction. NULL sur lignes antérieures.';


-- =============================================================================
-- BLOC 3 — ADD COLUMN hotel_id + BACKFILL
-- Isolation tenant directe — supprime le besoin de JOIN folios dans le KPI.
-- FK NOT VALID : ne scanne pas les NULL historiques.
-- =============================================================================

ALTER TABLE lignes_folio
  ADD COLUMN IF NOT EXISTS hotel_id UUID;

-- Backfill idempotent : WHERE hotel_id IS NULL seulement
UPDATE lignes_folio lf
SET    hotel_id = f.hotel_id
FROM   folios f
WHERE  lf.folio_id = f.id
AND    lf.hotel_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lignes_folio_hotel_id'
    AND   conrelid = 'lignes_folio'::regclass
  ) THEN
    ALTER TABLE lignes_folio
      ADD CONSTRAINT fk_lignes_folio_hotel_id
        FOREIGN KEY (hotel_id)
        REFERENCES hotels(id)
        ON DELETE CASCADE
        NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN lignes_folio.hotel_id IS
'Isolation tenant directe V2. Backfillé depuis folios.hotel_id. FK NOT VALID.';


-- =============================================================================
-- BLOC 4 — ADD COLUMNs traçabilité ledger
-- Requises par restaurant.js et facturation.service.js.
-- Toutes nullable ou avec DEFAULT safe — insertion sur table existante sans risque.
-- =============================================================================

ALTER TABLE lignes_folio
  ADD COLUMN IF NOT EXISTS reference_id    UUID,
  ADD COLUMN IF NOT EXISTS reference_type  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS devise          VARCHAR(10)  DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS source_module   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cree_par        UUID,
  ADD COLUMN IF NOT EXISTS cree_par_type   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS metadata        JSONB        DEFAULT '{}';

-- CHECK cree_par_type — NOT VALID (lignes historiques NULL admis)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_lignes_folio_cree_par_type'
    AND   conrelid = 'lignes_folio'::regclass
  ) THEN
    ALTER TABLE lignes_folio
      ADD CONSTRAINT chk_lignes_folio_cree_par_type
        CHECK (cree_par_type IN ('staff', 'systeme', 'portail') OR cree_par_type IS NULL)
        NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN lignes_folio.reference_id   IS 'UUID entité source V2 (commande, paiement…).';
COMMENT ON COLUMN lignes_folio.reference_type IS 'Type entité : commande_restaurant | paiement | folio_ligne | reservation.';
COMMENT ON COLUMN lignes_folio.devise         IS 'Devise. Défaut XAF.';
COMMENT ON COLUMN lignes_folio.source_module  IS 'Module émetteur : restaurant | facturation | portail | systeme.';
COMMENT ON COLUMN lignes_folio.cree_par       IS 'UUID acteur. NULL si système.';
COMMENT ON COLUMN lignes_folio.cree_par_type  IS 'Type acteur : staff | systeme | portail.';
COMMENT ON COLUMN lignes_folio.metadata       IS 'Données contextuelles JSONB. Défaut {}.';


-- =============================================================================
-- BLOC 5 — ADD COLUMN ligne_corrigee_id + FK self-ref
-- Trace la ligne corrigée. DEFERRABLE évite les problèmes d'ordre d'insertion.
-- =============================================================================

ALTER TABLE lignes_folio
  ADD COLUMN IF NOT EXISTS ligne_corrigee_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lignes_folio_correction'
    AND   conrelid = 'lignes_folio'::regclass
  ) THEN
    ALTER TABLE lignes_folio
      ADD CONSTRAINT fk_lignes_folio_correction
        FOREIGN KEY (ligne_corrigee_id)
        REFERENCES lignes_folio(id)
        ON DELETE RESTRICT
        DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

COMMENT ON COLUMN lignes_folio.ligne_corrigee_id IS
'FK self-ref vers la ligne corrigée. NULL si non-correction. Unicité via index BLOC 7.';


-- =============================================================================
-- BLOC 6 — CHECK CONSTRAINT sur sens
-- NOT VALID : lignes historiques NULL non scannées.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_lignes_folio_sens'
    AND   conrelid = 'lignes_folio'::regclass
  ) THEN
    ALTER TABLE lignes_folio
      ADD CONSTRAINT chk_lignes_folio_sens
        CHECK (sens IN ('debit', 'credit'))
        NOT VALID;
  END IF;
END $$;


-- =============================================================================
-- BLOC 7 — INDEX V2
-- IF NOT EXISTS → idempotent.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_lignes_folio_folio_id
  ON lignes_folio(folio_id);

CREATE INDEX IF NOT EXISTS idx_lignes_folio_hotel_date
  ON lignes_folio(hotel_id, cree_le DESC)
  WHERE hotel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lignes_folio_hotel_sens
  ON lignes_folio(hotel_id, sens, cree_le DESC)
  WHERE hotel_id IS NOT NULL AND sens IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lignes_folio_reference
  ON lignes_folio(reference_id, reference_type)
  WHERE reference_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lignes_folio_correction_unique
  ON lignes_folio(ligne_corrigee_id)
  WHERE ligne_corrigee_id IS NOT NULL;


-- =============================================================================
-- BLOC 8 — ASSERTIONS FINALES
-- Tout RAISE EXCEPTION → ROLLBACK automatique avant COMMIT.
-- =============================================================================

DO $$
BEGIN

  -- Colonnes V2 ajoutées
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'sens') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : sens absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'hotel_id') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : hotel_id absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'reference_id') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : reference_id absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'reference_type') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : reference_type absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'devise') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : devise absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'source_module') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : source_module absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'cree_par') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : cree_par absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'cree_par_type') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : cree_par_type absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'metadata') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : metadata absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'ligne_corrigee_id') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : ligne_corrigee_id absent.';
  END IF;

  -- Colonnes V1 garanties intactes
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'montant_total') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : montant_total disparu — état corrompu.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'date_facturation') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : date_facturation disparu — état corrompu.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lignes_folio' AND column_name = 'reference_externe') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : reference_externe disparu — état corrompu.';
  END IF;

  -- Table toujours lignes_folio
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lignes_folio') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : table lignes_folio introuvable.';
  END IF;

  -- Contrainte sens
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_lignes_folio_sens' AND conrelid = 'lignes_folio'::regclass) THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : contrainte chk_lignes_folio_sens absente.';
  END IF;

  -- Index KPI critique
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
    WHERE tablename = 'lignes_folio' AND indexname = 'idx_lignes_folio_hotel_sens') THEN
    RAISE EXCEPTION '[DELTA POST-ASSERT] ECHEC : index idx_lignes_folio_hotel_sens absent.';
  END IF;

  RAISE NOTICE '[DELTA POST-ASSERT] ✓ Toutes les assertions finales OK — COMMIT autorisé.';

END $$;


COMMIT;
