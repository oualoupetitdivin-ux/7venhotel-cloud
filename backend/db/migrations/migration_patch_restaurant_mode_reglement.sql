-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION PATCH — mode_reglement sur commandes_restaurant
-- À appliquer avant déploiement du module restaurant v2
--   psql $DATABASE_URL -f migration_patch_restaurant_mode_reglement.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE commandes_restaurant
  ADD COLUMN IF NOT EXISTS mode_reglement VARCHAR(20)
    NOT NULL DEFAULT 'chambre'
    CHECK (mode_reglement IN ('chambre', 'immediat'));

-- DEFAULT 'chambre' : compatibilité avec les commandes existantes
-- Les commandes walk_in doivent avoir 'immediat' — enforced par le code applicatif
-- Une contrainte DB CHECK (type_client != 'walk_in' OR mode_reglement = 'immediat')
-- est possible mais omise pour permettre la migration des données existantes.

COMMENT ON COLUMN commandes_restaurant.mode_reglement IS
'chambre = charge différée sur folio | immediat = paiement sur place (obligatoire pour walk_in)';

COMMIT;
