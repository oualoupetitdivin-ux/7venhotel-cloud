-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 011 — Paramétrage comptable (LOT-OHADA-01)
--
-- Tables :
--   exercices_comptables  — exercices fiscaux par tenant/hôtel
--   periodes_comptables   — périodes (mois) d'un exercice
--   config_fiscale        — fiscalité de l'hôtel (TVA, identifiants)
--   regles_numerotation   — séquences de numéros de pièce (par journal et année)
--   journaux_comptables   — journaux (VE, AC, BQ, CA, OD, AN...)
--
-- Isolation : chaque ligne porte tenant_id + hotel_id (modèle certifié LOT-DB-01).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exercices_comptables (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  annee         INTEGER NOT NULL CHECK (annee >= 2000),
  date_debut    DATE NOT NULL,
  date_fin      DATE NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert', 'cloture')),
  libelle       VARCHAR(100),
  devise        VARCHAR(10) NOT NULL DEFAULT 'XAF',
  cloture_le    TIMESTAMPTZ,
  cloture_par   UUID REFERENCES utilisateurs(id),
  cree_par      UUID REFERENCES utilisateurs(id),
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hotel_id, annee),
  CHECK (date_fin > date_debut)
);
CREATE INDEX IF NOT EXISTS idx_exercices_hotel ON exercices_comptables (tenant_id, hotel_id);

CREATE TABLE IF NOT EXISTS periodes_comptables (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exercice_id   UUID NOT NULL REFERENCES exercices_comptables(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id      UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  numero        INTEGER NOT NULL CHECK (numero BETWEEN 1 AND 12),
  libelle       VARCHAR(50) NOT NULL,
  date_debut    DATE NOT NULL,
  date_fin      DATE NOT NULL,
  statut        TEXT NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'cloturee')),
  cloture_le    TIMESTAMPTZ,
  cloture_par   UUID REFERENCES utilisateurs(id),
  UNIQUE (exercice_id, numero),
  CHECK (date_fin >= date_debut)
);
CREATE INDEX IF NOT EXISTS idx_periodes_exercice ON periodes_comptables (exercice_id);
CREATE INDEX IF NOT EXISTS idx_periodes_hotel_dates ON periodes_comptables (tenant_id, hotel_id, date_debut);

CREATE TABLE IF NOT EXISTS config_fiscale (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id                    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  pays                        VARCHAR(100) NOT NULL DEFAULT 'Cameroun',
  regime_fiscal               VARCHAR(20) NOT NULL DEFAULT 'normal'
                                CHECK (regime_fiscal IN ('normal', 'simplifie', 'micro')),
  taux_tva_normal             NUMERIC(5,2) NOT NULL DEFAULT 19.25 CHECK (taux_tva_normal >= 0),
  taux_tva_reduit             NUMERIC(5,2) NOT NULL DEFAULT 0     CHECK (taux_tva_reduit >= 0),
  numero_contribuable         VARCHAR(100),
  numero_rccm                 VARCHAR(100),
  exercice_fiscal_debut_mois  INTEGER NOT NULL DEFAULT 1 CHECK (exercice_fiscal_debut_mois BETWEEN 1 AND 12),
  parametres                  JSONB NOT NULL DEFAULT '{}',
  cree_le                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hotel_id)
);

CREATE TABLE IF NOT EXISTS regles_numerotation (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id           UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type_piece         VARCHAR(10) NOT NULL,           -- code journal
  prefixe            VARCHAR(20) NOT NULL DEFAULT '',
  sequence_annee     INTEGER,
  sequence_courante  INTEGER NOT NULL DEFAULT 0 CHECK (sequence_courante >= 0),
  UNIQUE (tenant_id, hotel_id, type_piece)
);

CREATE TABLE IF NOT EXISTS journaux_comptables (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id                    UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  code                        VARCHAR(10) NOT NULL CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  libelle                     VARCHAR(100) NOT NULL,
  type_journal                TEXT NOT NULL CHECK (type_journal IN ('AC','VE','BQ','CA','OD','AN')),
  compte_contrepartie_defaut  VARCHAR(20),
  actif                       BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hotel_id, code)
);
CREATE INDEX IF NOT EXISTS idx_journaux_hotel ON journaux_comptables (tenant_id, hotel_id);
