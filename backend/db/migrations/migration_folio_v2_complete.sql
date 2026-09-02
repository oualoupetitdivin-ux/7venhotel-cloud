-- =============================================================================
-- MIGRATION FOLIO V2 COMPLETE — Socle financier Phase 1
-- 7venHotel Cloud PMS · Production Railway
--
-- PÉRIMÈTRE (ÉTAPE 0A) :
--   1. ENUM type_extra_folio : ADD VALUE 'paiement', 'correction'
--   2. TABLE paiements       : 6 colonnes manquantes (mobile money + liaison ledger)
--   3. TABLE logs_financiers : création (absente de tous les schémas précédents)
--   4. FUNCTION get_solde_folio : calcul solde double-entrée en SQL sécurisé
--
-- GARANTIES :
--   - Idempotent (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
--     CREATE OR REPLACE FUNCTION, ADD VALUE IF NOT EXISTS, guards IF NOT EXISTS)
--   - ALTER TYPE ... ADD VALUE hors transaction (contrainte PostgreSQL)
--   - Reste de la migration en transaction atomique
--   - Assertions PRE et POST — tout RAISE EXCEPTION → ROLLBACK automatique
--   - Aucune modification des tables existantes lignes_folio, folios, reservations
--
-- Ordre d'exécution :
--   1. ALTER TYPE (hors transaction — auto-commit)
--   2. BEGIN ... COMMIT (transaction principale)
--
-- Exécution : psql $DATABASE_URL -f migration_folio_v2_complete.sql
-- Précédent : migration_delta.sql (colonnes V2 lignes_folio)
-- Suivant   : migration_folio_immutabilite.sql (triggers immutabilité)
-- =============================================================================


-- =============================================================================
-- BLOC 1 — ENUM type_extra_folio
-- ALTER TYPE ... ADD VALUE ne peut pas être dans un BEGIN/COMMIT.
-- IF NOT EXISTS évite l'erreur si les valeurs existent déjà (idempotent).
-- 'paiement'   : ligne credit issue d'un encaissement
-- 'correction' : écriture inverse annulant une ligne erronée
-- =============================================================================

ALTER TYPE type_extra_folio ADD VALUE IF NOT EXISTS 'paiement';
ALTER TYPE type_extra_folio ADD VALUE IF NOT EXISTS 'correction';


-- =============================================================================
-- TRANSACTION PRINCIPALE
-- =============================================================================

BEGIN;


-- =============================================================================
-- BLOC 2 — ASSERTIONS PRÉALABLES
-- =============================================================================

DO $$
BEGIN

  -- Tables socle existantes
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'paiements') THEN
    RAISE EXCEPTION '[FOLIO-V2 PRE-ASSERT] ECHEC : table paiements introuvable.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lignes_folio') THEN
    RAISE EXCEPTION '[FOLIO-V2 PRE-ASSERT] ECHEC : table lignes_folio introuvable. Lancer migration_delta.sql d''abord.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'folios') THEN
    RAISE EXCEPTION '[FOLIO-V2 PRE-ASSERT] ECHEC : table folios introuvable.';
  END IF;

  -- Colonne sens requise (ajoutée par migration_delta.sql)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'sens') THEN
    RAISE EXCEPTION '[FOLIO-V2 PRE-ASSERT] ECHEC : colonne lignes_folio.sens absente. Lancer migration_delta.sql d''abord.';
  END IF;

  -- Colonne montant_total requise (colonne V1 originale)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lignes_folio' AND column_name = 'montant_total') THEN
    RAISE EXCEPTION '[FOLIO-V2 PRE-ASSERT] ECHEC : colonne lignes_folio.montant_total absente.';
  END IF;

  -- Warnings si colonnes paiements déjà présentes (idempotence)
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'numero_telephone') THEN
    RAISE WARNING '[FOLIO-V2 PRE-ASSERT] paiements.numero_telephone déjà présente — no-op.';
  END IF;

  RAISE NOTICE '[FOLIO-V2 PRE-ASSERT] ✓ Assertions préalables OK.';

END $$;


-- =============================================================================
-- BLOC 3 — COLONNES MANQUANTES SUR paiements
--
-- Contexte :
--   facturation.repository.js confirmerPaiement() et creerPaiement() utilisent
--   ces colonnes. Sans elles, toute opération de paiement crashe en SQL.
--
--   numero_telephone : mobile money (MTN, Orange Money) — numéro payeur
--   idempotency_key  : anti-doublon paiement — UNIQUE sur les valeurs non-null
--   source_module    : traçabilité émetteur (staff | integration_mobile_money)
--   confirme_le      : horodatage de confirmation effective
--   confirme_par     : UUID acteur qui a confirmé (null si webhook système)
--   folio_ligne_id   : lien vers la ligne credit créée lors de la confirmation
-- =============================================================================

ALTER TABLE paiements
  ADD COLUMN IF NOT EXISTS numero_telephone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS idempotency_key  VARCHAR(128),
  ADD COLUMN IF NOT EXISTS source_module    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS confirme_le      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirme_par     UUID,
  ADD COLUMN IF NOT EXISTS folio_ligne_id   UUID;

-- FK vers utilisateurs pour confirme_par (nullable — null si confirmation webhook)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_paiements_confirme_par'
    AND   conrelid = 'paiements'::regclass
  ) THEN
    ALTER TABLE paiements
      ADD CONSTRAINT fk_paiements_confirme_par
        FOREIGN KEY (confirme_par)
        REFERENCES utilisateurs(id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- FK vers lignes_folio pour folio_ligne_id (nullable — définie après confirmation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_paiements_folio_ligne_id'
    AND   conrelid = 'paiements'::regclass
  ) THEN
    ALTER TABLE paiements
      ADD CONSTRAINT fk_paiements_folio_ligne_id
        FOREIGN KEY (folio_ligne_id)
        REFERENCES lignes_folio(id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- Index UNIQUE partiel sur idempotency_key (anti-doublon mobile money)
-- PARTIAL : seules les valeurs non-null sont indexées (paiements carte n'ont pas de clé)
CREATE UNIQUE INDEX IF NOT EXISTS idx_paiements_idempotency_key
  ON paiements(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN paiements.numero_telephone IS 'Numéro payeur mobile money (MTN, Orange). NULL pour paiements carte/espèces.';
COMMENT ON COLUMN paiements.idempotency_key  IS 'Clé anti-doublon mobile money. UNIQUE sur valeurs non-null.';
COMMENT ON COLUMN paiements.source_module    IS 'Module émetteur : staff | integration_mobile_money.';
COMMENT ON COLUMN paiements.confirme_le      IS 'Horodatage de confirmation effective du paiement.';
COMMENT ON COLUMN paiements.confirme_par     IS 'UUID acteur ayant confirmé. NULL si confirmation webhook automatique.';
COMMENT ON COLUMN paiements.folio_ligne_id   IS 'Lien vers la ligne credit créée lors de la confirmation. NULL avant confirmation.';


-- =============================================================================
-- BLOC 4 — TABLE logs_financiers
--
-- Table d'audit financier immuable.
-- INSERT ONLY — trigger d'immutabilité ajouté par migration_folio_immutabilite.sql.
-- Référencée par facturation.repository.js:insererLog() dans chaque opération.
--
-- Séparation de responsabilités :
--   logs_audit     → audit accès/sessions (platform_foundations)
--   logs_financiers → audit opérations ledger (cette migration)
-- =============================================================================

CREATE TABLE IF NOT EXISTS logs_financiers (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id      UUID          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  folio_id      UUID          REFERENCES folios(id) ON DELETE SET NULL,
  paiement_id   UUID          REFERENCES paiements(id) ON DELETE SET NULL,
  action        VARCHAR(50)   NOT NULL,
  source_module VARCHAR(50),
  montant       NUMERIC(12,2),
  solde_apres   NUMERIC(12,2),
  acteur_id     UUID          REFERENCES utilisateurs(id) ON DELETE SET NULL,
  acteur_type   VARCHAR(20)   CHECK (acteur_type IN ('staff', 'systeme', 'portail') OR acteur_type IS NULL),
  payload       JSONB         NOT NULL DEFAULT '{}',
  horodatage    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_financiers_hotel
  ON logs_financiers(hotel_id, horodatage DESC);

CREATE INDEX IF NOT EXISTS idx_logs_financiers_folio
  ON logs_financiers(folio_id)
  WHERE folio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_financiers_paiement
  ON logs_financiers(paiement_id)
  WHERE paiement_id IS NOT NULL;

COMMENT ON TABLE logs_financiers IS
'Journal d''audit immuable des opérations financières (ajout ligne, paiement, correction). INSERT ONLY.';


-- =============================================================================
-- BLOC 5 — FONCTION get_solde_folio
--
-- Calcul du solde d'un folio via ledger double-entrée.
-- Appelée par facturation.repository.js:getSolde() — sans elle, toute
-- consultation ou confirmation de paiement crashe.
--
-- INVARIANTS :
--   - Filtre sens IS NOT NULL (lignes V2 uniquement — V1 ignorées)
--   - COALESCE → retourne toujours 1 ligne, même si folio vide (solde = 0)
--   - SECURITY DEFINER : isolation tenant garantie par p_hotel_id (pas par RLS)
--   - STABLE : result = const dans une transaction (peut être mis en cache par PG)
--
-- Colonnes retournées :
--   folio_id      : UUID du folio calculé (echo du paramètre)
--   hotel_id      : UUID de l'hôtel (echo du paramètre — isolation tenant)
--   total_debits  : somme des charges (sens='debit')
--   total_credits : somme des encaissements (sens='credit')
--   solde_du      : net (positif = client doit payer, négatif = hôtel doit rembourser)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_solde_folio(p_folio_id UUID, p_hotel_id UUID)
RETURNS TABLE (
  folio_id       UUID,
  hotel_id       UUID,
  total_debits   NUMERIC,
  total_credits  NUMERIC,
  solde_du       NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p_folio_id                                                                        AS folio_id,
    p_hotel_id                                                                        AS hotel_id,
    COALESCE(SUM(CASE WHEN sens = 'debit'  THEN montant_total ELSE 0 END), 0)        AS total_debits,
    COALESCE(SUM(CASE WHEN sens = 'credit' THEN montant_total ELSE 0 END), 0)        AS total_credits,
    COALESCE(
      SUM(CASE WHEN sens = 'debit'  THEN  montant_total
               WHEN sens = 'credit' THEN -montant_total
               ELSE 0 END),
      0
    )                                                                                 AS solde_du
  FROM lignes_folio
  WHERE folio_id = p_folio_id
    AND hotel_id = p_hotel_id
    AND sens IS NOT NULL
$$;

COMMENT ON FUNCTION get_solde_folio(UUID, UUID) IS
'Calcule le solde double-entrée d''un folio. Retourne toujours 1 ligne (COALESCE 0 si folio vide). Filtre sens IS NOT NULL (V2 uniquement). Isolation tenant via p_hotel_id.';


-- =============================================================================
-- BLOC 6 — ASSERTIONS FINALES
-- =============================================================================

DO $$
BEGIN

  -- Colonnes paiements
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'numero_telephone') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : paiements.numero_telephone absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'idempotency_key') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : paiements.idempotency_key absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'source_module') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : paiements.source_module absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'confirme_le') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : paiements.confirme_le absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'confirme_par') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : paiements.confirme_par absent.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paiements' AND column_name = 'folio_ligne_id') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : paiements.folio_ligne_id absent.';
  END IF;

  -- Table logs_financiers
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'logs_financiers') THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : table logs_financiers absente.';
  END IF;

  -- Fonction get_solde_folio
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'get_solde_folio' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : fonction get_solde_folio absente.';
  END IF;

  -- Test fonctionnel get_solde_folio sur UUID fantôme (doit retourner 1 ligne avec zéros)
  IF NOT EXISTS (
    SELECT 1 FROM get_solde_folio(
      '00000000-0000-0000-0000-000000000000'::UUID,
      '00000000-0000-0000-0000-000000000000'::UUID
    )
  ) THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : get_solde_folio ne retourne pas de ligne sur folio vide.';
  END IF;

  -- Vérification solde_du = 0 sur folio vide
  PERFORM 1 FROM get_solde_folio(
    '00000000-0000-0000-0000-000000000000'::UUID,
    '00000000-0000-0000-0000-000000000000'::UUID
  ) WHERE solde_du = 0 AND total_debits = 0 AND total_credits = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[FOLIO-V2 POST-ASSERT] ECHEC : get_solde_folio retourne des valeurs non-nulles sur folio vide.';
  END IF;

  RAISE NOTICE '[FOLIO-V2 POST-ASSERT] ✓ Toutes les assertions finales OK.';
  RAISE NOTICE '[FOLIO-V2 POST-ASSERT] ✓ ENUM paiement/correction : vérifier hors transaction (ADD VALUE est transactionnel mais visible seulement après COMMIT).';
  RAISE NOTICE '[FOLIO-V2 POST-ASSERT] ✓ 6 colonnes paiements ajoutées.';
  RAISE NOTICE '[FOLIO-V2 POST-ASSERT] ✓ table logs_financiers créée.';
  RAISE NOTICE '[FOLIO-V2 POST-ASSERT] ✓ get_solde_folio opérationnelle (folio vide → solde 0).';
  RAISE NOTICE '[FOLIO-V2 POST-ASSERT] ✓ COMMIT autorisé.';

END $$;


COMMIT;
