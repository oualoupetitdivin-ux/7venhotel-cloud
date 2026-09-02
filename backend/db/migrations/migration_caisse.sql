-- =============================================================================
-- MIGRATION — Caisse & Clôture journalière (Phase 1, Périmètre B)
-- 7venHotel Cloud · Production-ready · Multi-tenant strict
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sessions_caisse (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id            UUID NOT NULL REFERENCES hotels(id),
  tenant_id           UUID NOT NULL,
  statut              VARCHAR(20) NOT NULL DEFAULT 'ouverte'
                         CHECK (statut IN ('ouverte', 'cloturee')),
  fond_ouverture      NUMERIC(14,2) NOT NULL DEFAULT 0,
  montant_theorique   NUMERIC(14,2),
  montant_compte      NUMERIC(14,2),
  ecart               NUMERIC(14,2),
  ouverte_le          TIMESTAMPTZ DEFAULT NOW(),
  ouverte_par         UUID REFERENCES utilisateurs(id),
  fermee_le           TIMESTAMPTZ,
  fermee_par          UUID REFERENCES utilisateurs(id),
  notes_cloture       TEXT
);

-- Une seule session ouverte à la fois par hôtel
CREATE UNIQUE INDEX IF NOT EXISTS sessions_caisse_ouverte_idx
  ON sessions_caisse(hotel_id) WHERE statut = 'ouverte';

CREATE INDEX IF NOT EXISTS idx_sessions_caisse_hotel_date
  ON sessions_caisse(hotel_id, ouverte_le DESC);

CREATE TABLE IF NOT EXISTS mouvements_caisse (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES sessions_caisse(id),
  hotel_id        UUID NOT NULL REFERENCES hotels(id),
  type_mouvement  VARCHAR(30) NOT NULL
                     CHECK (type_mouvement IN ('fond_initial', 'encaissement', 'decaissement', 'retrait')),
  montant         NUMERIC(14,2) NOT NULL,
  reference       TEXT,
  paiement_id     UUID REFERENCES paiements(id),
  libelle         TEXT,
  cree_par        UUID REFERENCES utilisateurs(id),
  cree_le         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_session
  ON mouvements_caisse(session_id, cree_le);

CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_hotel
  ON mouvements_caisse(hotel_id, cree_le DESC);

COMMIT;
