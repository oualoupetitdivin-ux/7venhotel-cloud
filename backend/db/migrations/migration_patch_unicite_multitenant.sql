-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION PATCH — Unicité multi-tenant numéros de réservations et folios
--
-- Problème : reservations.numero_reservation et folios.numero_folio avaient
--   des contraintes UNIQUE globales (une seule numérotation partagée entre
--   tous les hôtels). Le trigger generer_numero_reservation() calcule le
--   numéro par hotel_id (COUNT WHERE hotel_id = NEW.hotel_id), provoquant
--   une collision certaine dès qu'un second tenant veut créer sa première
--   réservation de l'année.
--
-- Fix : remplacer les deux contraintes globales par des contraintes composites
--   (hotel_id, numero_reservation) et (hotel_id, numero_folio).
--
-- Idempotence : DROP IF EXISTS + ADD CONSTRAINT IF NOT EXISTS (via DO block).
-- Rollback : en cas d'assertion finale échouée, COMMIT n'est pas atteint.
--
--   psql $DATABASE_URL -f migration_patch_unicite_multitenant.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Assertion avant ──────────────────────────────────────────────────────────
-- Vérification que le contexte est conforme (migration idempotente mais on
-- signale l'état au lieu de silencieusement passer).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_numero_reservation_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_reservations_hotel_numero'
  ) THEN
    RAISE EXCEPTION
      'État inattendu : ni la contrainte globale ni la contrainte composite '
      'n''existent sur reservations. Vérifier l''état de la table.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folios_numero_folio_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_folios_hotel_numero'
  ) THEN
    RAISE EXCEPTION
      'État inattendu : ni la contrainte globale ni la contrainte composite '
      'n''existent sur folios. Vérifier l''état de la table.';
  END IF;
END $$;

-- ── 1. reservations : UNIQUE global → UNIQUE (hotel_id, numero_reservation) ─
ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_numero_reservation_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_reservations_hotel_numero'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT uq_reservations_hotel_numero
        UNIQUE (hotel_id, numero_reservation);
    RAISE NOTICE 'Contrainte uq_reservations_hotel_numero créée.';
  ELSE
    RAISE NOTICE 'Contrainte uq_reservations_hotel_numero déjà présente — ignorée.';
  END IF;
END $$;

-- ── 2. folios : UNIQUE global → UNIQUE (hotel_id, numero_folio) ─────────────
ALTER TABLE folios
  DROP CONSTRAINT IF EXISTS folios_numero_folio_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_folios_hotel_numero'
  ) THEN
    ALTER TABLE folios
      ADD CONSTRAINT uq_folios_hotel_numero
        UNIQUE (hotel_id, numero_folio);
    RAISE NOTICE 'Contrainte uq_folios_hotel_numero créée.';
  ELSE
    RAISE NOTICE 'Contrainte uq_folios_hotel_numero déjà présente — ignorée.';
  END IF;
END $$;

-- ── Assertion après ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_reservations_hotel_numero'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED : uq_reservations_hotel_numero absent après migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_folios_hotel_numero'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED : uq_folios_hotel_numero absent après migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_numero_reservation_key'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED : contrainte globale reservations_numero_reservation_key toujours présente';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'folios_numero_folio_key'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED : contrainte globale folios_numero_folio_key toujours présente';
  END IF;

  RAISE NOTICE 'Migration multi-tenant numéros réservations/folios — SUCCÈS';
END $$;

COMMIT;
