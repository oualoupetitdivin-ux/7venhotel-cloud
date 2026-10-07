-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 017 — États financiers (LOT-OHADA-01)
--
--   rubriques_etats    — référentiel produit des rubriques Bilan / Compte de résultat
--                        (préfixes de comptes → rubrique). Chargé par le seed,
--                        versionné. Ne contient AUCUN montant.
--   etats_financiers   — états générés (snapshot JSON + empreinte SHA-256),
--                        insert-only : un état généré n'est jamais réécrit.
--
-- Les montants sont TOUJOURS dérivés de v_balance (écritures validées) par
-- backend/src/engines/etats.engine.js.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rubriques_etats (
  id        SERIAL PRIMARY KEY,
  etat      TEXT NOT NULL CHECK (etat IN ('bilan_actif', 'bilan_passif', 'resultat_charges', 'resultat_produits')),
  code      VARCHAR(10) NOT NULL,
  libelle   VARCHAR(200) NOT NULL,
  prefixes  TEXT[] NOT NULL,
  ordre     INTEGER NOT NULL DEFAULT 0,
  source    VARCHAR(100) NOT NULL,
  version   VARCHAR(20) NOT NULL,
  UNIQUE (etat, code)
);

CREATE TABLE IF NOT EXISTS etats_financiers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  hotel_id        UUID NOT NULL REFERENCES hotels(id),
  exercice_id     UUID NOT NULL REFERENCES exercices_comptables(id),
  type_etat       TEXT NOT NULL CHECK (type_etat IN ('bilan', 'compte_resultat', 'complet')),
  date_arrete     DATE NOT NULL,
  donnees         JSONB NOT NULL,
  empreinte       CHAR(64) NOT NULL,       -- SHA-256 hex des données
  genere_par      UUID REFERENCES utilisateurs(id),
  genere_le       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_etats_hotel_exercice ON etats_financiers (tenant_id, hotel_id, exercice_id, genere_le DESC);

CREATE OR REPLACE FUNCTION fn_etats_financiers_immuables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ETAT_FINANCIER_IMMUABLE: un état généré ne peut être modifié ni supprimé' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_etats_financiers_immuables ON etats_financiers;
CREATE TRIGGER trg_etats_financiers_immuables
  BEFORE UPDATE OR DELETE ON etats_financiers
  FOR EACH ROW EXECUTE FUNCTION fn_etats_financiers_immuables();
