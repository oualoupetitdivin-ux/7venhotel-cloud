-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 007 — Programme de fidélité
--
-- Périmètre LOT-DB-01
-- Source : backend/src/routes/fidelite.route.js
--
-- Tables créées :
--   regles_fidelite      — paramètres du programme de fidélité (1 ligne / hôtel)
--   points_fidelite_log  — historique des mouvements de points par client
--   offres               — offres de fidélité échangeables
--
-- Prérequis satisfaits (migration 001) :
--   clients.points_fidelite INTEGER DEFAULT 0
--   clients.niveau_fidelite VARCHAR(50) DEFAULT 'bronze'
--
-- INVARIANTS :
--   regles_fidelite : UNIQUE(hotel_id) — utilisé par l'upsert ON CONFLICT.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS regles_fidelite (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id            UUID NOT NULL UNIQUE REFERENCES hotels(id) ON DELETE CASCADE,

  points_par_nuit     INTEGER NOT NULL DEFAULT 10,
  points_par_1000_xaf INTEGER NOT NULL DEFAULT 5,
  seuil_silver        INTEGER NOT NULL DEFAULT 200,
  seuil_gold          INTEGER NOT NULL DEFAULT 500,

  modifie_le          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regles_fidelite_hotel ON regles_fidelite (hotel_id);

-- ── points_fidelite_log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS points_fidelite_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id       UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  type_mouvement TEXT NOT NULL CHECK (type_mouvement IN ('credit', 'debit')),
  points         INTEGER NOT NULL CHECK (points > 0),
  solde_apres    INTEGER NOT NULL,
  motif          TEXT,

  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_log_client ON points_fidelite_log (client_id, hotel_id);
CREATE INDEX IF NOT EXISTS idx_points_log_hotel  ON points_fidelite_log (hotel_id);

-- ── offres ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offres (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id         UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  titre            TEXT NOT NULL,
  description      TEXT,
  type_offre       TEXT,
  points_requis    INTEGER NOT NULL DEFAULT 0,
  valeur_reduction NUMERIC(10,2),
  date_debut       DATE,
  date_fin         DATE,
  actif            BOOLEAN NOT NULL DEFAULT TRUE,

  cree_le          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offres_hotel       ON offres (hotel_id);
CREATE INDEX IF NOT EXISTS idx_offres_hotel_actif ON offres (hotel_id, actif);
