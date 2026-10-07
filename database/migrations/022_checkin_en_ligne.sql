-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 022 — Check-in en ligne (LOT-GUEST-01)
--
-- Modèle minimal, SANS dossier parallèle : le check-in en ligne est une pré-arrivée
-- qui alimente les objets PMS existants (clients : identité / pièce ; reservations :
-- heure d'arrivée prévue, préférences). L'arrivée physique reste le check-in PMS
-- (réception) qui active le portail chambre.
--
--   checkins_en_ligne : un lien par réservation (UNIQUE), jeton stocké HACHÉ (SHA-256),
--                       expiration, usage unique (statut 'complete'), traçabilité.
--   reservations.checkin_en_ligne_le : visible par tous les modules PMS.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS checkins_en_ligne (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id  UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  statut          TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'complete')),
  expire_le       TIMESTAMPTZ NOT NULL,
  genere_par      UUID REFERENCES utilisateurs(id),
  genere_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  complete_le     TIMESTAMPTZ,
  ip_completion   TEXT,
  donnees         JSONB
);
CREATE INDEX IF NOT EXISTS idx_checkins_en_ligne_hotel ON checkins_en_ligne (tenant_id, hotel_id);

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS checkin_en_ligne_le TIMESTAMPTZ;
