-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — Phase 1 / Périmètre A — LOT A2 : Stock & Mouvements
--
-- Journal des mouvements de stock (entrée, sortie, perte, inventaire, transfert)
-- + colonne article_id sur lignes_commande, nécessaire pour que le trigger de
-- déstockage automatique (restaurant.js, passage en_preparation) puisse
-- retrouver quel article_menu correspond à chaque ligne de commande.
--
-- Apply via Railway Run Command:
--   psql $DATABASE_URL -f migration_stock.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── lignes_commande.article_id ──────────────────────────────────────────────
-- Nullable : les lignes historiques sans article_id ne bloquent rien, elles
-- sont simplement ignorées par le trigger de déstockage (pas d'article à décompter).
ALTER TABLE lignes_commande ADD COLUMN IF NOT EXISTS article_id UUID REFERENCES articles_menu(id);

CREATE INDEX IF NOT EXISTS idx_lignes_commande_article_id ON lignes_commande(article_id);

-- ── Mouvements de stock ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mouvements_stock (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       UUID NOT NULL REFERENCES hotels(id),
  article_id     UUID NOT NULL REFERENCES articles_menu(id),
  type_mouvement VARCHAR(30) NOT NULL, -- entree, sortie, perte, inventaire, transfert
  quantite       NUMERIC(10,2) NOT NULL,
  stock_avant    NUMERIC(10,2),
  stock_apres    NUMERIC(10,2),
  motif          TEXT,
  bon_achat_id   UUID,   -- FK logique vers bons_achat (créée dans migration_achats.sql)
  commande_id    UUID REFERENCES commandes_restaurant(id),
  cree_par       UUID REFERENCES utilisateurs(id),
  cree_le        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mouvements_stock_hotel_article ON mouvements_stock(hotel_id, article_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_stock_hotel_date    ON mouvements_stock(hotel_id, cree_le DESC);
CREATE INDEX IF NOT EXISTS idx_mouvements_stock_bon_achat     ON mouvements_stock(bon_achat_id);

COMMENT ON COLUMN mouvements_stock.bon_achat_id IS 'Référence logique vers bons_achat.id (table créée par migration_achats.sql) — pas de contrainte FK physique car l''ordre d''application peut varier';
