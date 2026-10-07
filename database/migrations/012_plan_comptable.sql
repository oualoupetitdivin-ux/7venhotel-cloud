-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 012 — Plan comptable SYSCOHADA (LOT-OHADA-01) — STRUCTURE UNIQUEMENT
--
-- Tables :
--   classes_syscohada           — les 9 classes du plan (structure normative)
--   plan_comptable_referentiel  — référentiel/configuration initiale du PRODUIT
--                                 (chargé par backend/scripts/seed-plan-comptable.js,
--                                 versionné, traçable — ce n'est PAS le texte officiel
--                                 de l'Acte uniforme, seulement un extrait retenu)
--   comptes_syscohada           — plan de comptes PARAMÉTRABLE de chaque hôtel
--                                 (copié depuis le référentiel, extensible)
--
-- Les 9 classes sont structurelles (AUDCIF / SYSCOHADA révisé) : insérées ici.
-- Le détail des comptes reste dans le seed, séparé de la structure.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS classes_syscohada (
  numero   SMALLINT PRIMARY KEY CHECK (numero BETWEEN 1 AND 9),
  libelle  VARCHAR(120) NOT NULL,
  type     TEXT NOT NULL CHECK (type IN ('bilan', 'gestion', 'hao', 'analytique'))
);

INSERT INTO classes_syscohada (numero, libelle, type) VALUES
  (1, 'Comptes de ressources durables',                  'bilan'),
  (2, 'Comptes d''actif immobilisé',                      'bilan'),
  (3, 'Comptes de stocks',                               'bilan'),
  (4, 'Comptes de tiers',                                'bilan'),
  (5, 'Comptes de trésorerie',                           'bilan'),
  (6, 'Comptes de charges des activités ordinaires',     'gestion'),
  (7, 'Comptes de produits des activités ordinaires',    'gestion'),
  (8, 'Comptes des autres charges et des autres produits','hao'),
  (9, 'Comptes des engagements hors bilan et analytiques','analytique')
ON CONFLICT (numero) DO NOTHING;

CREATE TABLE IF NOT EXISTS plan_comptable_referentiel (
  numero          VARCHAR(20) PRIMARY KEY CHECK (numero ~ '^[1-9][0-9]{1,19}$'),
  libelle         VARCHAR(200) NOT NULL,
  classe          SMALLINT NOT NULL REFERENCES classes_syscohada(numero),
  nature          TEXT NOT NULL CHECK (nature IN ('actif','passif','charge','produit','tiers','tresorerie','hors_bilan')),
  sens_normal     CHAR(1) NOT NULL CHECK (sens_normal IN ('D','C')),
  collectif       BOOLEAN NOT NULL DEFAULT FALSE,
  source          VARCHAR(100) NOT NULL,          -- ex : 'SYSCOHADA revise 2017 (extrait produit)'
  version         VARCHAR(20)  NOT NULL,          -- version du référentiel produit
  charge_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (classe = CAST(substr(numero, 1, 1) AS SMALLINT))
);

CREATE TABLE IF NOT EXISTS comptes_syscohada (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  numero          VARCHAR(20) NOT NULL CHECK (numero ~ '^[1-9][0-9]{1,19}$'),
  libelle         VARCHAR(200) NOT NULL,
  classe          SMALLINT NOT NULL REFERENCES classes_syscohada(numero),
  nature          TEXT NOT NULL CHECK (nature IN ('actif','passif','charge','produit','tiers','tresorerie','hors_bilan')),
  sens_normal     CHAR(1) NOT NULL CHECK (sens_normal IN ('D','C')),
  collectif       BOOLEAN NOT NULL DEFAULT FALSE,   -- compte collectif (ex : 411, 401) → tiers auxiliaires
  referentiel_numero VARCHAR(20) REFERENCES plan_comptable_referentiel(numero),  -- NULL = compte créé par l'hôtel
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hotel_id, numero),
  UNIQUE (id, tenant_id, hotel_id),                 -- cible des FK composites (isolation)
  CHECK (classe = CAST(substr(numero, 1, 1) AS SMALLINT))
);
CREATE INDEX IF NOT EXISTS idx_comptes_hotel_numero ON comptes_syscohada (tenant_id, hotel_id, numero);
