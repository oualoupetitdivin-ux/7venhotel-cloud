-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 005 — Charges opérationnelles
--
-- Périmètre LOT-DB-01
-- Source : backend/src/routes/charges.route.js
--
-- Tables créées :
--   categories_charges — catégories de dépenses (loyer, salaires, maintenance…)
--   charges            — dépenses saisies, validées, payées
--
-- INVARIANTS FSM : saisie → validee → payee
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS categories_charges (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  nom      TEXT NOT NULL,
  icone    TEXT,
  ordre    INTEGER NOT NULL DEFAULT 0,

  cree_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_charges_hotel ON categories_charges (hotel_id);

-- ── charges ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS charges (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id       UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  tenant_id      UUID REFERENCES tenants(id),

  categorie_id   UUID REFERENCES categories_charges(id) ON DELETE SET NULL,

  libelle        TEXT NOT NULL,
  montant        NUMERIC(12,2) NOT NULL CHECK (montant > 0),
  devise         TEXT NOT NULL DEFAULT 'XAF',
  date_charge    DATE NOT NULL DEFAULT CURRENT_DATE,
  piece_jointe_url TEXT,
  notes          TEXT,

  statut         TEXT NOT NULL DEFAULT 'saisie'
                   CHECK (statut IN ('saisie', 'validee', 'payee')),
  validee_par    UUID REFERENCES utilisateurs(id),

  cree_par       UUID NOT NULL REFERENCES utilisateurs(id),
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charges_hotel  ON charges (hotel_id);
CREATE INDEX IF NOT EXISTS idx_charges_tenant ON charges (tenant_id);
CREATE INDEX IF NOT EXISTS idx_charges_statut ON charges (hotel_id, statut);
CREATE INDEX IF NOT EXISTS idx_charges_date   ON charges (hotel_id, date_charge);
