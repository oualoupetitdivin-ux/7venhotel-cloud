-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — Phase 1 / Périmètre A — LOT A3 : Fournisseurs & Approvisionnement
--
-- Fournisseurs, bons d'achat et leurs lignes. La réception d'un bon d'achat
-- génère des mouvements_stock (type=entree) — voir achats.route.js.
--
-- Apply via Railway Run Command:
--   psql $DATABASE_URL -f migration_achats.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fournisseurs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fournisseurs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               UUID NOT NULL REFERENCES hotels(id),
  nom                    VARCHAR(200) NOT NULL,
  contact_nom            VARCHAR(100),
  telephone              VARCHAR(30),
  email                  VARCHAR(200),
  adresse                TEXT,
  delai_livraison_jours  INT DEFAULT 3,
  actif                  BOOLEAN DEFAULT true,
  cree_le                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fournisseurs_hotel ON fournisseurs(hotel_id);

-- ── Bons d'achat ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bons_achat (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               UUID NOT NULL REFERENCES hotels(id),
  numero_bon             VARCHAR(50) UNIQUE,
  fournisseur_id         UUID NOT NULL REFERENCES fournisseurs(id),
  statut                 VARCHAR(30) DEFAULT 'brouillon', -- brouillon, envoye, recu_partiel, recu, annule
  date_commande          DATE,
  date_livraison_prevue  DATE,
  date_reception         TIMESTAMPTZ,
  notes                  TEXT,
  cree_par               UUID REFERENCES utilisateurs(id),
  cree_le                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bons_achat_hotel        ON bons_achat(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bons_achat_fournisseur   ON bons_achat(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_bons_achat_statut        ON bons_achat(hotel_id, statut);

-- ── Lignes de bon d'achat ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lignes_bon_achat (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bon_achat_id        UUID NOT NULL REFERENCES bons_achat(id),
  article_id          UUID NOT NULL REFERENCES articles_menu(id),
  quantite_commandee  NUMERIC(10,2) NOT NULL,
  prix_unitaire       NUMERIC(12,2) NOT NULL,
  quantite_recue      NUMERIC(10,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lignes_bon_achat_bon     ON lignes_bon_achat(bon_achat_id);
CREATE INDEX IF NOT EXISTS idx_lignes_bon_achat_article ON lignes_bon_achat(article_id);
