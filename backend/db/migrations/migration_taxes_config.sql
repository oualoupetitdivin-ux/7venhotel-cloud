-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — Configuration fiscale OHADA par hôtel
-- Adds tax rate columns to parametres_hotel so each hotel can configure
-- its own TVA, CSS and taxe de séjour rates independently.
--
-- Apply via Railway Run Command:
--   psql $DATABASE_URL -f migration_taxes_config.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── TVA (Taxe sur la Valeur Ajoutée) ────────────────────────────────────────
ALTER TABLE parametres_hotel
  ADD COLUMN IF NOT EXISTS tva_active   BOOLEAN        DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tva_taux     NUMERIC(5, 4)  DEFAULT 0.1800;  -- 18 %

-- ── CSS (Contribution Spéciale de Solidarité) ───────────────────────────────
ALTER TABLE parametres_hotel
  ADD COLUMN IF NOT EXISTS css_active   BOOLEAN        DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS css_taux     NUMERIC(5, 4)  DEFAULT 0.0100;  -- 1 %

-- ── Taxe de séjour (montant fixe par nuit, en unité monétaire locale) ───────
ALTER TABLE parametres_hotel
  ADD COLUMN IF NOT EXISTS taxe_sejour_active   BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS taxe_sejour_montant  INTEGER  DEFAULT 0;

-- ── N° TVA ───────────────────────────────────────────────────────────────────
-- tva_numero already exists in seed.js — add IF NOT EXISTS to be safe
ALTER TABLE parametres_hotel
  ADD COLUMN IF NOT EXISTS tva_numero   VARCHAR(100);

-- ── Photo d'ambiance hôtel (fond d'écran de l'interface) ─────────────────────
ALTER TABLE parametres_hotel
  ADD COLUMN IF NOT EXISTS image_fond_url  TEXT;

COMMENT ON COLUMN parametres_hotel.tva_taux         IS 'Taux TVA décimal (ex: 0.1800 = 18%)';
COMMENT ON COLUMN parametres_hotel.css_taux         IS 'Taux CSS décimal (ex: 0.0100 = 1%)';
COMMENT ON COLUMN parametres_hotel.taxe_sejour_montant IS 'Montant taxe séjour par nuit en unité monétaire locale';
COMMENT ON COLUMN parametres_hotel.image_fond_url   IS 'URL photo d ambiance affichée en fond d interface';
