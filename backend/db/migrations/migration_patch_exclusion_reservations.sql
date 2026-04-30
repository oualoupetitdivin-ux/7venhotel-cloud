-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION PATCH — Contrainte d'exclusion double booking
-- À appliquer via Railway Run Command :
--   psql $DATABASE_URL -f migration_patch_exclusion_reservations.sql
--
-- Prérequis : extension btree_gist (disponible sur Railway PostgreSQL)
-- Cette contrainte est le dernier rempart contre le double booking :
-- indépendante du code applicatif, enforced par PostgreSQL en toutes circonstances.
--
-- Comportement :
--   INSERT ou UPDATE d'une réservation avec chevauchement sur même chambre
--   → PostgreSQL lève l'erreur 23P01 (exclusion_violation)
--   → Le service la capture et retourne ConflictError('CHAMBRE_NON_DISPONIBLE')
-- ─────────────────────────────────────────────────────────────────────────────

-- Activer l'extension si absente (sans erreur si déjà présente)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Contrainte d'exclusion : pas de chevauchement de dates sur la même chambre
-- pour les réservations non terminales (annulee et no_show exclus)
ALTER TABLE reservations
  ADD CONSTRAINT excl_no_double_booking
  EXCLUDE USING gist (
    chambre_id WITH =,
    daterange(date_arrivee, date_depart, '[)') WITH &&
  )
  WHERE (
    chambre_id IS NOT NULL
    AND statut NOT IN ('annulee', 'no_show')
  );
