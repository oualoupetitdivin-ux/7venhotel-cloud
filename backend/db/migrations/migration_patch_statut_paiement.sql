-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION PATCH — statut_paiement sur reservations
-- Formalisation du hotfix appliqué manuellement le 2026-06-02
-- ─────────────────────────────────────────────────────────────────────────────
-- Contexte : La route reservations.route.js référence r.statut_paiement
-- mais cette colonne était absente de 001_schema_complet.sql
-- Hotfix appliqué en direct lors du bootstrap local 2026-06-02
-- Ce fichier le formalise pour Railway et les futurs déploiements
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS statut_paiement VARCHAR(30) NOT NULL DEFAULT 'non_paye'
    CHECK (statut_paiement IN ('non_paye', 'acompte', 'paye', 'rembourse'));

CREATE INDEX IF NOT EXISTS idx_reservations_statut_paiement
  ON reservations(hotel_id, statut_paiement)
  WHERE statut_paiement != 'paye';

COMMENT ON COLUMN reservations.statut_paiement IS
'Statut du paiement de la réservation.
non_paye : aucun paiement reçu
acompte  : paiement partiel reçu
paye     : montant total reçu (folio soldé)
rembourse: remboursement effectué suite à annulation';

COMMIT;
