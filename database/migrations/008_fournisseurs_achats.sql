-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 008 — Fournisseurs, Bons d'achat & Mouvements de stock
--
-- Périmètre LOT-DB-01
-- Sources :
--   backend/src/routes/fournisseurs.route.js
--   backend/src/routes/achats.route.js
--
-- Tables créées :
--   fournisseurs      — répertoire des fournisseurs par hôtel
--   bons_achat        — commandes passées aux fournisseurs
--   lignes_bon_achat  — lignes articles d'un bon d'achat
--   mouvements_stock  — traçabilité entrées/sorties/ajustements de stock
--
-- Prérequis : migration 006 (articles_menu.stock_actuel, unite, actif)
--
-- INVARIANTS FSM bons_achat :
--   brouillon → valide → recu / recu_partiel / annule
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fournisseurs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  nom           TEXT NOT NULL,
  contact_nom   TEXT,
  telephone     TEXT,
  email         TEXT,
  adresse       TEXT,
  actif         BOOLEAN NOT NULL DEFAULT TRUE,

  cree_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fournisseurs_hotel       ON fournisseurs (hotel_id);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_hotel_actif ON fournisseurs (hotel_id, actif);

-- ── bons_achat ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bons_achat (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  numero_bon      TEXT NOT NULL,
  fournisseur_id  UUID NOT NULL REFERENCES fournisseurs(id),

  statut          TEXT NOT NULL DEFAULT 'brouillon'
                    CHECK (statut IN ('brouillon', 'valide', 'recu', 'recu_partiel', 'annule')),
  date_reception  TIMESTAMPTZ,

  cree_par        UUID NOT NULL REFERENCES utilisateurs(id),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bons_achat_numero_hotel
  ON bons_achat (hotel_id, numero_bon);

CREATE INDEX IF NOT EXISTS idx_bons_achat_hotel       ON bons_achat (hotel_id);
CREATE INDEX IF NOT EXISTS idx_bons_achat_fournisseur ON bons_achat (fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_bons_achat_statut      ON bons_achat (hotel_id, statut);

-- ── lignes_bon_achat ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lignes_bon_achat (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bon_achat_id        UUID NOT NULL REFERENCES bons_achat(id) ON DELETE CASCADE,
  article_id          UUID NOT NULL REFERENCES articles_menu(id),

  quantite_commandee  NUMERIC(10,3) NOT NULL CHECK (quantite_commandee > 0),
  quantite_recue      NUMERIC(10,3) NOT NULL DEFAULT 0,
  prix_unitaire       NUMERIC(10,2) NOT NULL,

  cree_le             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lignes_bon_achat_bon     ON lignes_bon_achat (bon_achat_id);
CREATE INDEX IF NOT EXISTS idx_lignes_bon_achat_article ON lignes_bon_achat (article_id);

-- ── mouvements_stock ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mouvements_stock (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  article_id      UUID NOT NULL REFERENCES articles_menu(id),

  type_mouvement  TEXT NOT NULL
                    CHECK (type_mouvement IN ('entree', 'sortie', 'ajustement')),
  quantite        NUMERIC(10,3) NOT NULL,
  stock_avant     NUMERIC(10,3) NOT NULL,
  stock_apres     NUMERIC(10,3) NOT NULL,
  motif           TEXT,

  bon_achat_id    UUID REFERENCES bons_achat(id) ON DELETE SET NULL,
  cree_par        UUID REFERENCES utilisateurs(id),
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mouvements_stock_article ON mouvements_stock (article_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_stock_hotel   ON mouvements_stock (hotel_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_stock_bon     ON mouvements_stock (bon_achat_id)
  WHERE bon_achat_id IS NOT NULL;
