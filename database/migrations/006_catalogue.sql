-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 006 — Catalogue menu (catégories + enrichissement articles)
--
-- Périmètre LOT-DB-01
-- Source : backend/src/routes/catalogue.route.js
--
-- Tables créées :
--   categories_menu — catégories nommées pour articles_menu
--
-- Tables modifiées :
--   articles_menu   — ajout de categorie_id, actif, stock_actuel,
--                     stock_minimum, unite
--   categories_menu — ajout de icone (colonne absente en DB au 2026-09-29)
--
-- NOTES :
--   articles_menu existe déjà (migration 001) avec une colonne legacy
--   `categorie VARCHAR(100) NOT NULL` utilisée par restaurant.js. Conservée.
--   catalogue.route.js maintient les deux colonnes synchronisées via
--   resoudreCategorieLegacy().
-- ══════════════════════════════════════════════════════════════════════════════

-- ── categories_menu ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories_menu (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  nom      VARCHAR(100) NOT NULL,
  icone    TEXT,
  ordre    INTEGER NOT NULL DEFAULT 0,
  actif    BOOLEAN NOT NULL DEFAULT TRUE,

  cree_le  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ajoute icone si la table existait déjà sans cette colonne.
ALTER TABLE categories_menu
  ADD COLUMN IF NOT EXISTS icone TEXT;

CREATE INDEX IF NOT EXISTS idx_categories_menu_hotel ON categories_menu (hotel_id);

-- ── ALTER articles_menu ────────────────────────────────────────────────────────

ALTER TABLE articles_menu
  ADD COLUMN IF NOT EXISTS categorie_id  UUID REFERENCES categories_menu(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actif         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS stock_actuel  NUMERIC(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_minimum NUMERIC(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unite         TEXT NOT NULL DEFAULT 'unité';

CREATE INDEX IF NOT EXISTS idx_articles_menu_categorie_id
  ON articles_menu (categorie_id);

CREATE INDEX IF NOT EXISTS idx_articles_menu_hotel_actif
  ON articles_menu (hotel_id, actif);
