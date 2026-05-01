-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION PATCH — Support facturation groupe (folio_parent_id)
--   psql $DATABASE_URL -f migration_patch_folio_groupe.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Ajouter la FK self-referencing sur folios
-- NULL = folio standard (comportement inchangé)
-- NON NULL = folio enfant d'un groupe entreprise
ALTER TABLE folios
  ADD COLUMN IF NOT EXISTS folio_parent_id UUID
    REFERENCES folios(id) ON DELETE RESTRICT;

-- Index pour retrouver tous les enfants d'un folio master
CREATE INDEX IF NOT EXISTS idx_folios_parent
  ON folios(folio_parent_id)
  WHERE folio_parent_id IS NOT NULL;

-- Contrainte : un folio parent ne peut pas lui-même être enfant
-- (pas de hiérarchie > 1 niveau — simplifie le calcul de solde)
ALTER TABLE folios
  ADD CONSTRAINT chk_folio_pas_enfant_denfant
    CHECK (folio_parent_id IS NULL OR folio_parent_id != id);

COMMENT ON COLUMN folios.folio_parent_id IS
'NULL = folio individuel standard.
NON NULL = folio enfant (groupe entreprise) — les paiements sont dirigés vers le folio parent.
Un folio parent ne peut pas être lui-même enfant (hiérarchie max 1 niveau).';

COMMIT;
