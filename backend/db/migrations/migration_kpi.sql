-- =============================================================================
-- MIGRATION — Système KPI Analytique
-- 7venHotel Cloud · Production-ready · Multi-tenant strict
-- =============================================================================

BEGIN;

-- =============================================================================
-- PHASE 1 — CATALOGUE KPI
-- formule_sql : documentation des calculs, pas exécutée directement
-- Le job lit les tables kpi_daily_* — pas les formules du catalogue
-- =============================================================================

CREATE TABLE IF NOT EXISTS kpi_catalog (
  code          VARCHAR(50) PRIMARY KEY,
  label         VARCHAR(150) NOT NULL,
  description   TEXT,
  formule_sql   TEXT NOT NULL,
  unite         VARCHAR(20),
  categorie     VARCHAR(50),
  granularite   VARCHAR(20) DEFAULT 'day',
  actif         BOOLEAN DEFAULT TRUE,
  cree_le       TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO kpi_catalog (code, label, description, formule_sql, unite, categorie) VALUES

-- Hébergement
('OCC_RATE',
 'Taux d''occupation',
 'Pourcentage de chambres occupées par rapport aux chambres disponibles',
 'SELECT chambres_occupees::decimal / NULLIF(chambres_disponibles,0) FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 '%', 'hebergement'),

('ADR',
 'Average Daily Rate — Prix moyen par chambre',
 'Revenu hébergement divisé par le nombre de nuitées réelles',
 'SELECT revenu_hebergement / NULLIF(nb_nuitees,0) FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 'XAF', 'hebergement'),

('REVPAR',
 'Revenue Per Available Room',
 'Revenu hébergement divisé par le nombre de chambres disponibles',
 'SELECT revenu_hebergement / NULLIF(chambres_disponibles,0) FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 'XAF', 'hebergement'),

('NB_NUITEES',
 'Nombre de nuitées consommées',
 'Nombre de nuits effectivement séjournées par les clients',
 'SELECT nb_nuitees FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 'nuits', 'hebergement'),

('CA_HEBERGEMENT',
 'Chiffre d''affaires hébergement',
 'Somme des revenus hébergement (folio_lignes type nuitee)',
 'SELECT revenu_hebergement FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 'XAF', 'hebergement'),

-- Restaurant
('CA_RESTAURANT',
 'Chiffre d''affaires restaurant',
 'Somme des commandes servies (hôtel + externe)',
 'SELECT chiffre_affaires FROM kpi_daily_restaurant WHERE hotel_id=? AND date_jour=?',
 'XAF', 'restaurant'),

('PANIER_MOYEN_RESTO',
 'Panier moyen restaurant',
 'CA restaurant divisé par le nombre de commandes',
 'SELECT chiffre_affaires / NULLIF(nb_commandes,0) FROM kpi_daily_restaurant WHERE hotel_id=? AND date_jour=?',
 'XAF', 'restaurant'),

-- Finance
('CASH_ENCAISSE',
 'Cash encaissé',
 'Somme des paiements confirmés (espèces + carte + virement)',
 'SELECT cash_encaisse FROM kpi_daily_finance WHERE hotel_id=? AND date_jour=?',
 'XAF', 'finance'),

('SOLDE_EN_ATTENTE',
 'Solde en attente',
 'Total des débits folio non encore réglés',
 'SELECT solde_du FROM kpi_daily_finance WHERE hotel_id=? AND date_jour=?',
 'XAF', 'finance'),

('RESULTAT_BRUT',
 'Résultat brut',
 'Total crédits moins total débits sur la période',
 'SELECT total_credits - total_debits FROM kpi_daily_finance WHERE hotel_id=? AND date_jour=?',
 'XAF', 'finance')

ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- PHASE 2 — TABLES ANALYTIQUES JOURNALIÈRES
-- PRIMARY KEY(hotel_id, date_jour) — UPSERT idempotent
-- =============================================================================

CREATE TABLE IF NOT EXISTS kpi_daily_hebergement (
  hotel_id              UUID    NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date_jour             DATE    NOT NULL,
  chambres_disponibles  INT     NOT NULL DEFAULT 0,
  chambres_occupees     INT     NOT NULL DEFAULT 0,
  nb_nuitees            INT     NOT NULL DEFAULT 0,
  revenu_hebergement    DECIMAL(12,2) NOT NULL DEFAULT 0,
  nb_arrivees           INT     NOT NULL DEFAULT 0,
  nb_departs            INT     NOT NULL DEFAULT 0,
  nb_annulations        INT     NOT NULL DEFAULT 0,
  calcule_le            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (hotel_id, date_jour)
);

CREATE TABLE IF NOT EXISTS kpi_daily_restaurant (
  hotel_id              UUID    NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date_jour             DATE    NOT NULL,
  nb_commandes          INT     NOT NULL DEFAULT 0,
  chiffre_affaires      DECIMAL(12,2) NOT NULL DEFAULT 0,
  nb_clients_hotel      INT     NOT NULL DEFAULT 0,
  nb_clients_externe    INT     NOT NULL DEFAULT 0,
  calcule_le            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (hotel_id, date_jour)
);

CREATE TABLE IF NOT EXISTS kpi_daily_finance (
  hotel_id              UUID    NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date_jour             DATE    NOT NULL,
  total_debits          DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_credits         DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_encaisse         DECIMAL(12,2) NOT NULL DEFAULT 0,
  mobile_money_encaisse DECIMAL(12,2) NOT NULL DEFAULT 0,
  solde_du              DECIMAL(12,2) NOT NULL DEFAULT 0,
  nb_paiements_valides  INT     NOT NULL DEFAULT 0,
  nb_paiements_echec    INT     NOT NULL DEFAULT 0,
  calcule_le            TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (hotel_id, date_jour)
);

-- Index pour les requêtes de plage de dates (dashboard, drilldown)
CREATE INDEX IF NOT EXISTS idx_kpi_heb_hotel_date
  ON kpi_daily_hebergement(hotel_id, date_jour DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_resto_hotel_date
  ON kpi_daily_restaurant(hotel_id, date_jour DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_fin_hotel_date
  ON kpi_daily_finance(hotel_id, date_jour DESC);

-- =============================================================================
-- PHASE 4 — VUES KPI (calculs dérivés)
-- Calculés depuis les tables agrégées — pas depuis les tables sources
-- NULLIF sur tous les diviseurs — jamais de division par zéro
-- =============================================================================

CREATE OR REPLACE VIEW v_kpi_hebergement AS
SELECT
  hotel_id,
  date_jour,
  chambres_disponibles,
  chambres_occupees,
  nb_nuitees,
  revenu_hebergement,
  nb_arrivees,
  nb_departs,
  nb_annulations,
  -- KPIs calculés
  ROUND(
    chambres_occupees::DECIMAL / NULLIF(chambres_disponibles, 0) * 100,
    2
  )                                                               AS occ_rate_pct,
  ROUND(
    revenu_hebergement / NULLIF(nb_nuitees, 0),
    0
  )                                                               AS adr,
  ROUND(
    revenu_hebergement / NULLIF(chambres_disponibles, 0),
    0
  )                                                               AS revpar
FROM kpi_daily_hebergement;

CREATE OR REPLACE VIEW v_kpi_restaurant AS
SELECT
  hotel_id,
  date_jour,
  nb_commandes,
  chiffre_affaires,
  nb_clients_hotel,
  nb_clients_externe,
  ROUND(
    chiffre_affaires / NULLIF(nb_commandes, 0),
    0
  )                                                               AS panier_moyen
FROM kpi_daily_restaurant;

CREATE OR REPLACE VIEW v_kpi_finance AS
SELECT
  hotel_id,
  date_jour,
  total_debits,
  total_credits,
  cash_encaisse,
  mobile_money_encaisse,
  solde_du,
  nb_paiements_valides,
  nb_paiements_echec,
  ROUND(total_credits - total_debits, 0)                          AS resultat_brut,
  ROUND(
    CASE WHEN total_debits > 0
      THEN (total_credits / NULLIF(total_debits, 0)) * 100
      ELSE 0
    END,
    1
  )                                                               AS taux_recouvrement_pct
FROM kpi_daily_finance;

-- Vue combinée pour l'overview dashboard (une ligne par hotel+date)
CREATE OR REPLACE VIEW v_kpi_overview AS
SELECT
  h.hotel_id,
  h.date_jour,
  h.occ_rate_pct,
  h.adr,
  h.revpar,
  h.revenu_hebergement                                            AS ca_hebergement,
  COALESCE(r.chiffre_affaires, 0)                                 AS ca_restaurant,
  COALESCE(r.panier_moyen, 0)                                     AS panier_moyen_resto,
  COALESCE(f.cash_encaisse, 0)                                    AS cash_encaisse,
  COALESCE(f.solde_du, 0)                                         AS solde_du,
  COALESCE(f.resultat_brut, 0)                                    AS resultat_brut,
  h.nb_arrivees,
  h.nb_departs
FROM v_kpi_hebergement h
LEFT JOIN v_kpi_restaurant r USING (hotel_id, date_jour)
LEFT JOIN v_kpi_finance    f USING (hotel_id, date_jour);

COMMIT;
