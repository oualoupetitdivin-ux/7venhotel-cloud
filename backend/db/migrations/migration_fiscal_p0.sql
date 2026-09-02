-- =============================================================================
-- MIGRATION FISCAL P0 — Alignement ENUM type_extra_folio
-- 7venHotel Cloud PMS · Phase Convergence
--
-- OBJECTIF :
--   Ajouter les valeurs manquantes à l'ENUM type_extra_folio pour permettre :
--   - 'taxe'   : lignes fiscales automatiques créées par creerReservation()
--   - 'remise' : lignes de réduction (moteur fiscal configurable futur)
--
-- RÈGLE PostgreSQL :
--   ALTER TYPE ... ADD VALUE ne peut PAS être dans un bloc BEGIN/COMMIT.
--   IF NOT EXISTS garantit l'idempotence (sûr de ré-exécuter).
--
-- IMPACT :
--   - facturation.validator.js : 'taxe' passe de "valide (DB échoue)" à "valide (DB accepte)"
--   - reservations.service.js  : INSERT lignes_folio type='taxe' devient possible
--   - Aucune donnée existante modifiée
-- =============================================================================

ALTER TYPE type_extra_folio ADD VALUE IF NOT EXISTS 'taxe';
ALTER TYPE type_extra_folio ADD VALUE IF NOT EXISTS 'remise';
