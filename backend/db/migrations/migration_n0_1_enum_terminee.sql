-- =============================================================================
-- MIGRATION N0-1 : Correction ENUM statut_reservation
-- 7venHotel Cloud PMS
-- CEPOS NIVEAU 0 — Cycle Financier Complet
--
-- Bug corrigé :
--   checkout() positionne statut = 'terminee'
--   mais 'terminee' est absent de l'ENUM statut_reservation en DB.
--   Résultat : tout checkout lève une erreur PostgreSQL et échoue.
--
-- Portée du correctif :
--   Uniquement la DB. Aucun code applicatif modifié.
--   Le service reservations.service.js référençait déjà 'terminee'
--   dans sa machine d'état (TRANSITIONS_VALIDES). Le service est correct.
--   C'est l'ENUM qui était en retard.
--
-- Impact :
--   - reservations.statut (colonne directe)
--   - vue_reservations_actives.statut (vue hérite automatiquement)
--
-- Idempotent : IF NOT EXISTS permet la ré-exécution sans erreur.
-- =============================================================================

ALTER TYPE statut_reservation ADD VALUE IF NOT EXISTS 'terminee' AFTER 'depart_aujourd_hui';

-- Vérification post-migration
DO $$
DECLARE
  v_existe BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'statut_reservation'::regtype
      AND enumlabel = 'terminee'
  ) INTO v_existe;

  IF v_existe THEN
    RAISE NOTICE '[N0-1] OK -- ''terminee'' present dans statut_reservation';
  ELSE
    RAISE EXCEPTION '[N0-1] ECHEC -- ''terminee'' absent de statut_reservation apres migration';
  END IF;
END $$;
