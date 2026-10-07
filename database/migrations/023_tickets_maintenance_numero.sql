-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 023 — Numérotation des tickets de maintenance (HELICONIA-READY-01)
--
-- Défaut constaté : POST /maintenance/tickets échouait systématiquement (500,
-- « l'opérateur n'existe pas : text + integer »). Le trigger generer_numero_ticket
-- calculait LPAD(COUNT(*)::TEXT + 1, …) : le cast s'applique avant l'addition.
-- Aucun ticket n'avait jamais pu être créé (0 ligne en base).
--
-- Second défaut, identique à la migration 020 (bons_achat) : numéro calculé PAR
-- HÔTEL mais contrainte UNIQUE GLOBALE → collision inter-tenant dès le premier
-- ticket du deuxième hôtel. Unicité ramenée à (hotel_id, numero_ticket).
-- Aucune donnée modifiée.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generer_numero_ticket() RETURNS TRIGGER AS $$
DECLARE seq TEXT;
BEGIN
  SELECT LPAD((COUNT(*) + 1)::TEXT, 3, '0') INTO seq FROM tickets_maintenance WHERE hotel_id = NEW.hotel_id;
  NEW.numero_ticket := 'TKT-' || TO_CHAR(NOW(), 'YY') || '-' || seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_numero_hotel ON tickets_maintenance (hotel_id, numero_ticket);
ALTER TABLE tickets_maintenance DROP CONSTRAINT IF EXISTS tickets_maintenance_numero_ticket_key;
