-- =============================================================================
-- MIGRATION — Charges opérationnelles (Phase 1, Périmètre B)
-- 7venHotel Cloud · Production-ready · Multi-tenant strict
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS categories_charges (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id  UUID NOT NULL REFERENCES hotels(id),
  nom       VARCHAR(100) NOT NULL,
  icone     VARCHAR(10),
  ordre     INT DEFAULT 0,
  cree_le   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_charges_hotel
  ON categories_charges(hotel_id, ordre);

CREATE TABLE IF NOT EXISTS charges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id          UUID NOT NULL REFERENCES hotels(id),
  tenant_id         UUID NOT NULL,
  categorie_id      UUID REFERENCES categories_charges(id),
  libelle           VARCHAR(300) NOT NULL,
  montant           NUMERIC(14,2) NOT NULL,
  devise            VARCHAR(10) DEFAULT 'XAF',
  date_charge       DATE NOT NULL DEFAULT CURRENT_DATE,
  piece_jointe_url  TEXT,
  notes             TEXT,
  statut            VARCHAR(30) NOT NULL DEFAULT 'saisie'
                       CHECK (statut IN ('saisie', 'validee', 'payee')),
  validee_par       UUID REFERENCES utilisateurs(id),
  cree_par          UUID NOT NULL REFERENCES utilisateurs(id),
  cree_le           TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charges_hotel_date
  ON charges(hotel_id, date_charge);

CREATE INDEX IF NOT EXISTS idx_charges_hotel_statut
  ON charges(hotel_id, statut);

COMMIT;
