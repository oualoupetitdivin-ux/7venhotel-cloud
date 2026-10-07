-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 019 — Types d'événements PMS → Finance (LOT-PMS-01)
--
-- Étend la liste des événements acceptés par mappings_comptables (migration 015)
-- pour couvrir les transactions PMS réellement existantes, découvertes à l'audit :
--   SERVICE_ANNEXE        — spa, blanchisserie, transport, téléphone, autres extras du folio
--   TAXE_SEJOUR           — taxe de séjour collectée (≠ TVA, compte de tiers État)
--   ARRHES_IMPUTATION     — imputation des arrhes reçues sur la facture (419 → 411)
--   ARRHES_REMBOURSEMENT  — remboursement d'arrhes au client
--   ARRHES_ACQUISES       — arrhes conservées par l'hôtel (annulation)
--   ECART_CAISSE          — écart constaté à la clôture de caisse
--
-- Aucune donnée modifiée. 011→018 inchangées.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'mappings_comptables'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%evenement_type%'
  LOOP
    EXECUTE format('ALTER TABLE mappings_comptables DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE mappings_comptables ADD CONSTRAINT mappings_comptables_evenement_type_check
  CHECK (evenement_type IN (
    'HEBERGEMENT', 'RESTAURANT', 'ROOM_SERVICE', 'PAIEMENT', 'CAISSE_DECAISSEMENT',
    'CAISSE_APPORT', 'CHARGE', 'ACHAT', 'ARRHES', 'ANNULATION', 'AVOIR',
    'SERVICE_ANNEXE', 'TAXE_SEJOUR', 'ARRHES_IMPUTATION', 'ARRHES_REMBOURSEMENT',
    'ARRHES_ACQUISES', 'ECART_CAISSE'));
