-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 004 — Caisse hôtelière
--
-- Périmètre LOT-DB-01
-- Source : backend/src/routes/caisse.route.js
--
-- Tables créées :
--   sessions_caisse   — sessions d'ouverture/clôture de caisse par hôtel
--   mouvements_caisse — encaissements, décaissements et retraits dans une session
--
-- INVARIANTS :
--   1. Une seule session avec statut='ouverte' par hotel_id à tout moment.
--      Garanti par un index UNIQUE partiel.
--   2. fond_ouverture est le montant de départ saisi à l'ouverture.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sessions_caisse (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id         UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  fond_ouverture   NUMERIC(12,2) NOT NULL DEFAULT 0,
  statut           TEXT NOT NULL DEFAULT 'ouverte'
                     CHECK (statut IN ('ouverte', 'cloturee')),

  ouverte_par      UUID NOT NULL REFERENCES utilisateurs(id),
  ouverte_le       DATE NOT NULL DEFAULT CURRENT_DATE,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  montant_theorique NUMERIC(12,2),
  montant_compte    NUMERIC(12,2),
  ecart             NUMERIC(12,2),
  fermee_le         TIMESTAMPTZ,
  fermee_par        UUID REFERENCES utilisateurs(id),
  notes_cloture     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_caisse_ouverte_unique
  ON sessions_caisse (hotel_id)
  WHERE statut = 'ouverte';

CREATE INDEX IF NOT EXISTS idx_sessions_caisse_hotel  ON sessions_caisse (hotel_id);
CREATE INDEX IF NOT EXISTS idx_sessions_caisse_tenant ON sessions_caisse (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_caisse_statut ON sessions_caisse (hotel_id, statut);

-- ── mouvements_caisse ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mouvements_caisse (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL REFERENCES sessions_caisse(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  type_mouvement  TEXT NOT NULL
                    CHECK (type_mouvement IN ('fond_initial', 'decaissement', 'retrait')),
  montant         NUMERIC(12,2) NOT NULL,
  libelle         TEXT NOT NULL,
  reference       TEXT,

  cree_par        UUID REFERENCES utilisateurs(id),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_session ON mouvements_caisse (session_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_caisse_hotel   ON mouvements_caisse (hotel_id);
