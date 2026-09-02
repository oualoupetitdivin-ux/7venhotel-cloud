-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — Fidélité & Offres
--
-- Historique des mouvements de points, offres/promotions par hôtel, et
-- règles de calcul des points (une ligne par hôtel).
--
-- Apply via Railway Run Command:
--   psql $DATABASE_URL -f migration_fidelite_offres.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Historique des mouvements de points fidélité
CREATE TABLE IF NOT EXISTS points_fidelite_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type_mouvement VARCHAR(20) NOT NULL, -- 'credit','debit'
  points        INTEGER NOT NULL,
  solde_apres   INTEGER NOT NULL,
  motif         VARCHAR(200),          -- 'checkout reservation REF-001', 'échange cadeau'
  reference_id  UUID,                  -- reservation_id ou autre
  cree_le       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_points_fidelite_log_client ON points_fidelite_log(client_id, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_points_fidelite_log_hotel  ON points_fidelite_log(hotel_id);

-- Offres & Promotions
CREATE TABLE IF NOT EXISTS offres (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  titre         VARCHAR(200) NOT NULL,
  description   TEXT,
  type_offre    VARCHAR(30) DEFAULT 'remise_pct',
  -- 'remise_pct','remise_fixe','nuit_gratuite','upgrade'
  valeur        NUMERIC(10,2),         -- % ou montant selon type
  date_debut    DATE,
  date_fin      DATE,
  conditions    TEXT,                  -- texte libre : "min 3 nuits", "niveau Gold+"
  niveau_requis VARCHAR(20),           -- null = tous, 'silver','gold'
  actif         BOOLEAN DEFAULT true,
  cree_le       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offres_hotel ON offres(hotel_id);

-- Règles de fidélité (1 ligne par hôtel suffit)
CREATE TABLE IF NOT EXISTS regles_fidelite (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      UUID NOT NULL UNIQUE REFERENCES hotels(id) ON DELETE CASCADE,
  points_par_nuit     INTEGER DEFAULT 10,
  points_par_1000_xaf INTEGER DEFAULT 5,
  seuil_silver  INTEGER DEFAULT 200,   -- points pour passer Silver
  seuil_gold    INTEGER DEFAULT 500,   -- points pour passer Gold
  cree_le       TIMESTAMPTZ DEFAULT NOW(),
  modifie_le    TIMESTAMPTZ DEFAULT NOW()
);
