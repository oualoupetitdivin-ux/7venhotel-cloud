-- =============================================================================
-- MIGRATION FACTURES MULTI-TENANT
-- 7venHotel Cloud PMS
--
-- PROBLÈME :
--   factures.numero_facture a une contrainte UNIQUE globale.
--   Le trigger generer_numero_facture() scope par hotel_id mais la
--   contrainte unique est sur (numero_facture) seul → deux hôtels ne
--   peuvent pas avoir FAC-2026-0001 simultanément → bug multi-tenant.
--
-- CORRECTION :
--   1. Supprimer la contrainte globale
--   2. Ajouter une contrainte composite (hotel_id, numero_facture)
--
-- Idempotent : les IF NOT EXISTS / DO NOTHING permettent de rejouer.
-- =============================================================================

-- Supprimer la contrainte globale si elle existe encore
ALTER TABLE factures
  DROP CONSTRAINT IF EXISTS factures_numero_facture_key;

-- Ajouter la contrainte composite (hotel_id, numero_facture) de façon idempotente
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'factures_hotel_numero_unique'
      AND conrelid = 'factures'::regclass
  ) THEN
    ALTER TABLE factures
      ADD CONSTRAINT factures_hotel_numero_unique
      UNIQUE (hotel_id, numero_facture);
  END IF;
END $$;
