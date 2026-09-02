-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — Phase 1 / Périmètre A — LOT A1 : Catalogue produits & Menu
--
-- Ajoute les catégories de menu et enrichit articles_menu pour supporter
-- le suivi de stock, le coût de revient et l'archivage (soft delete).
--
-- Apply via Railway Run Command:
--   psql $DATABASE_URL -f migration_catalogue.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Catégories de menu ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories_menu (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID NOT NULL REFERENCES hotels(id),
  nom        VARCHAR(100) NOT NULL,
  ordre      INT DEFAULT 0,
  actif      BOOLEAN DEFAULT true,
  cree_le    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_menu_hotel ON categories_menu(hotel_id);

-- ── Enrichissement articles_menu ────────────────────────────────────────────
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS categorie_id UUID REFERENCES categories_menu(id);
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS unite VARCHAR(50) DEFAULT 'unité';
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS stock_actuel NUMERIC(10,2) DEFAULT 0;
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS stock_minimum NUMERIC(10,2) DEFAULT 0;
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS actif BOOLEAN DEFAULT true;
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS hotel_id UUID REFERENCES hotels(id);
ALTER TABLE articles_menu ADD COLUMN IF NOT EXISTS cout_revient NUMERIC(12,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_menu_categorie_id ON articles_menu(categorie_id);

COMMENT ON COLUMN articles_menu.stock_actuel  IS 'Quantité en stock, mise à jour par mouvements_stock (LOT A2)';
COMMENT ON COLUMN articles_menu.stock_minimum IS 'Seuil déclenchant une alerte de réapprovisionnement';
COMMENT ON COLUMN articles_menu.cout_revient  IS 'Coût de revient unitaire, distinct du prix de vente (prix)';
