-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 020 — Numéro de bon d'achat unique PAR HÔTEL (LOT-PMS-01)
--
-- Défaut découvert à l'intégration PMS → Finance : la table bons_achat préexistait
-- (migration legacy) avec une contrainte UNIQUE GLOBALE sur numero_bon, alors que
-- achats.route.js numérote par hôtel (BA-<année>-<seq>). Conséquence : le premier
-- bon d'achat de tout nouvel hôtel échouait (500, collision inter-tenant).
--
-- La migration 008 prévoit déjà l'unicité correcte (hotel_id, numero_bon) :
-- on supprime seulement la contrainte globale héritée. Aucune donnée modifiée.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS idx_bons_achat_numero_hotel ON bons_achat (hotel_id, numero_bon);
ALTER TABLE bons_achat DROP CONSTRAINT IF EXISTS bons_achat_numero_bon_key;
