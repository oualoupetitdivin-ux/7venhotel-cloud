-- =============================================================================
-- MIGRATION — Cockpit Décisionnel Avancé 7venHotel Cloud
-- Phases 2 à 6 : KPI avancés, analytics, drilldown, prédictif, simulateur
-- =============================================================================

BEGIN;

-- =============================================================================
-- CORRECTIFS AUDIT (appliquer avant les nouvelles tables)
-- =============================================================================

-- CORRECTIF 1 : colonne annulee_le manquante sur reservations
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS annulee_le TIMESTAMPTZ;

-- CORRECTIF 2 : colonne traite_le sur paiements (peut être NULL en cas de webhook manqué)
ALTER TABLE paiements
  ADD COLUMN IF NOT EXISTS traite_le TIMESTAMPTZ;

-- CORRECTIF 3 : nb_no_show sur kpi_daily_hebergement
ALTER TABLE kpi_daily_hebergement
  ADD COLUMN IF NOT EXISTS nb_no_show INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenu_perdu_no_show DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS los_moyen DECIMAL(6,2) DEFAULT NULL;  -- Length of Stay

-- CORRECTIF 4 : révision kpi_catalog — LOS + taux_no_show
INSERT INTO kpi_catalog (code, label, description, formule_sql, unite, categorie) VALUES
('LOS',
 'Length of Stay — Durée moyenne de séjour',
 'Nombre moyen de nuits par réservation terminée',
 'SELECT los_moyen FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 'nuits', 'hebergement'),
('TAUX_NO_SHOW',
 'Taux de no-show',
 'Pourcentage de réservations confirmées terminées en no_show',
 'SELECT nb_no_show::decimal / NULLIF(nb_arrivees + nb_no_show, 0) FROM kpi_daily_hebergement WHERE hotel_id=? AND date_jour=?',
 '%', 'hebergement'),
('GOP',
 'Gross Operating Profit',
 'Revenus totaux moins coûts opérationnels (approximatif : total_credits - depenses)',
 'SELECT resultat_brut FROM kpi_daily_finance WHERE hotel_id=? AND date_jour=?',
 'XAF', 'finance'),
('TAUX_RECOUVREMENT',
 'Taux de recouvrement',
 'Montant encaissé / Montant facturé',
 'SELECT total_credits / NULLIF(total_debits, 0) * 100 FROM kpi_daily_finance WHERE hotel_id=? AND date_jour=?',
 '%', 'finance'),
('REVENUE_MIX_HEBERGEMENT',
 'Part hébergement dans le CA total',
 'CA hébergement / (CA hébergement + CA restaurant)',
 'SELECT ca_hebergement / NULLIF(ca_hebergement + ca_restaurant, 0) * 100 FROM v_kpi_overview WHERE hotel_id=? AND date_jour=?',
 '%', 'finance')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- PHASE 3 — TABLE ANALYTIQUE AVANCÉE
-- Granularité : hotel_id × date_jour × segment × canal × type_paiement
-- =============================================================================

CREATE TABLE IF NOT EXISTS kpi_analytics_daily (
  -- Dimensions
  hotel_id          UUID    NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date_jour         DATE    NOT NULL,
  segment           VARCHAR(50)  NOT NULL DEFAULT 'standard',
    -- standard | vip | corporate | groupe | externe (restaurant walk-in)
  canal             VARCHAR(50)  NOT NULL DEFAULT 'direct',
    -- direct | booking | expedia | phone | online | walk_in
  type_paiement     VARCHAR(50)  NOT NULL DEFAULT 'tous',
    -- especes | carte | mobile_money | virement | tous

  -- Métriques hébergement
  nb_reservations         INT            NOT NULL DEFAULT 0,
  nb_nuitees              INT            NOT NULL DEFAULT 0,
  revenu_hebergement      DECIMAL(12,2)  NOT NULL DEFAULT 0,
  nb_no_show              INT            NOT NULL DEFAULT 0,
  revenu_perdu_no_show    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  los_moyen               DECIMAL(6,2)   DEFAULT NULL,

  -- Métriques restaurant
  nb_commandes_resto      INT            NOT NULL DEFAULT 0,
  ca_restaurant           DECIMAL(12,2)  NOT NULL DEFAULT 0,

  -- Métriques financières
  cash_encaisse           DECIMAL(12,2)  NOT NULL DEFAULT 0,
  revenue_comptable       DECIMAL(12,2)  NOT NULL DEFAULT 0,
    -- folio_lignes débits (accrual)
  cash_reel               DECIMAL(12,2)  NOT NULL DEFAULT 0,
    -- paiements validés (cash basis) — séparé du revenue comptable

  calcule_le              TIMESTAMPTZ    DEFAULT NOW(),

  PRIMARY KEY (hotel_id, date_jour, segment, canal, type_paiement)
);

CREATE INDEX IF NOT EXISTS idx_kpi_analytics_hotel_date
  ON kpi_analytics_daily(hotel_id, date_jour DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_analytics_segment
  ON kpi_analytics_daily(hotel_id, segment, date_jour DESC);

CREATE INDEX IF NOT EXISTS idx_kpi_analytics_canal
  ON kpi_analytics_daily(hotel_id, canal, date_jour DESC);

-- =============================================================================
-- PHASE 4 — DATA MARTS DRILLDOWN
-- =============================================================================

-- ── Data mart : RevPAR par chambre ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm_revpar_par_chambre (
  hotel_id        UUID          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date_jour       DATE          NOT NULL,
  chambre_id      UUID          NOT NULL,
  numero_chambre  VARCHAR(20),
  type_chambre    VARCHAR(100),
  etage           INT,
  occupee         BOOLEAN       NOT NULL DEFAULT FALSE,
  revenu_nuit     DECIMAL(12,2) NOT NULL DEFAULT 0,
  revpar_chambre  DECIMAL(12,2) GENERATED ALWAYS AS (revenu_nuit) STORED,
    -- Pour une chambre : RevPAR = revenu réel (elle est soit occupée soit non)
  segment         VARCHAR(50)   DEFAULT NULL,
  canal           VARCHAR(50)   DEFAULT NULL,
  calcule_le      TIMESTAMPTZ   DEFAULT NOW(),
  PRIMARY KEY (hotel_id, date_jour, chambre_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_revpar_chambre_hotel_date
  ON dm_revpar_par_chambre(hotel_id, date_jour DESC);

CREATE INDEX IF NOT EXISTS idx_dm_revpar_chambre_segment
  ON dm_revpar_par_chambre(hotel_id, segment, date_jour DESC)
  WHERE segment IS NOT NULL;

-- =============================================================================
-- PHASE 5 — VUES PRÉDICTIVES (SQL pur — pas de ML, pas de Python)
-- Techniques : moyenne mobile, ratio N/N-1, projection linéaire simple
-- =============================================================================

-- ── Vue : Moyenne mobile 7 jours sur RevPAR ──────────────────────────────────
-- ── Vue : Moyenne mobile 7 jours sur RevPAR ──────────────────────────────────
CREATE OR REPLACE VIEW v_predictif_revpar_7j AS
SELECT
  h.hotel_id,
  h.date_jour,

  -- RevPAR du jour
  ROUND((h.revenu_hebergement / NULLIF(h.chambres_disponibles, 0))::numeric, 0) AS revpar_jour,

  -- Moyenne mobile 7 jours
  ROUND(
    AVG((h.revenu_hebergement / NULLIF(h.chambres_disponibles, 0))::numeric)
      OVER (PARTITION BY h.hotel_id ORDER BY h.date_jour
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
    0
  ) AS revpar_mm7,

  -- Moyenne mobile 30 jours
  ROUND(
    AVG((h.revenu_hebergement / NULLIF(h.chambres_disponibles, 0))::numeric)
      OVER (PARTITION BY h.hotel_id ORDER BY h.date_jour
            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW),
    0
  ) AS revpar_mm30,

  -- Tendance
  ROUND(
    (
      AVG((h.revenu_hebergement / NULLIF(h.chambres_disponibles, 0))::numeric)
        OVER (PARTITION BY h.hotel_id ORDER BY h.date_jour
              ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
    )
    /
    NULLIF(
      AVG((h.revenu_hebergement / NULLIF(h.chambres_disponibles, 0))::numeric)
        OVER (PARTITION BY h.hotel_id ORDER BY h.date_jour
              ROWS BETWEEN 13 PRECEDING AND 7 PRECEDING)
    , 0) * 100 - 100,
    1
  ) AS tendance_pct

FROM kpi_daily_hebergement h;


-- ── Vue : Projection occupation 30 jours ─────────────
CREATE OR REPLACE VIEW v_predictif_projection_30j AS
WITH base AS (
  SELECT
    hotel_id,
    date_jour,
    chambres_occupees::decimal / NULLIF(chambres_disponibles, 0) AS occ_rate,
    ROW_NUMBER() OVER (PARTITION BY hotel_id ORDER BY date_jour) AS n
  FROM kpi_daily_hebergement
),
regression AS (
  SELECT
    hotel_id,
    REGR_SLOPE(occ_rate, n)     AS pente,
    REGR_INTERCEPT(occ_rate, n) AS intercept,
    MAX(n)                      AS n_max,
    MAX(date_jour)              AS derniere_date
  FROM base
  WHERE date_jour >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY hotel_id
)
SELECT
  r.hotel_id,
  CURRENT_DATE + (serie.j || ' days')::INTERVAL AS date_projection,

  GREATEST(
    0,
    LEAST(
      100,
      ROUND(((r.pente * (r.n_max + serie.j) + r.intercept) * 100)::numeric, 1)
    )
  ) AS occ_projetee_pct,

  r.derniere_date AS basee_sur_donnees_jusqu_au

FROM regression r
CROSS JOIN generate_series(1, 30) AS serie(j);

-- =============================================================================
-- PHASE 6 — SIMULATEUR SCÉNARIOS
-- Table des scénarios prédéfinis + vue de simulation
-- =============================================================================

CREATE TABLE IF NOT EXISTS simulateur_scenarios (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID          NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  nom             VARCHAR(100)  NOT NULL,
  description     TEXT,
  est_defaut      BOOLEAN       DEFAULT FALSE,

  -- Paramètres d'entrée
  taux_occupation_cible   DECIMAL(5,2)  NOT NULL,  -- 0-100 %
  adr_cible               DECIMAL(12,2) NOT NULL,  -- Prix moyen chambre
  nb_chambres             INT           NOT NULL,  -- Chambres disponibles
  nb_jours                INT           NOT NULL DEFAULT 30,

  -- Mix revenue
  pct_restaurant          DECIMAL(5,2)  DEFAULT 20,  -- % du CA total venant du resto
  pct_services            DECIMAL(5,2)  DEFAULT 5,   -- % du CA total en services

  -- Coûts opérationnels
  cout_fixe_journalier    DECIMAL(12,2) DEFAULT 0,
  cout_variable_par_nuitee DECIMAL(12,2) DEFAULT 0,

  cree_le         TIMESTAMPTZ   DEFAULT NOW(),
  mis_a_jour_le   TIMESTAMPTZ   DEFAULT NOW()
);

-- 7 scénarios par défaut — insérés via le job seed, pas ici (hotel_id requis)
-- Structure : voir INSERT dans le seed de l'hôtel

COMMENT ON TABLE simulateur_scenarios IS
'Scénarios de simulation revenue. Les 7 scénarios par défaut sont insérés
au moment de la création de l''hôtel (seeder). Un 8e scénario "custom"
peut être créé via POST /ia/scenario.';

-- Vue de calcul du simulateur (SQL pur — zéro JS)
CREATE OR REPLACE VIEW v_simulation_resultats AS
SELECT
  s.id AS scenario_id,
  s.hotel_id,
  s.nom,
  s.nb_jours,
  s.nb_chambres,
  s.taux_occupation_cible,
  s.adr_cible,

  ROUND((s.nb_chambres * (s.taux_occupation_cible / 100))::numeric, 0) AS chambres_occupees_moy,

  ROUND((s.nb_chambres * (s.taux_occupation_cible / 100) * s.nb_jours)::numeric, 0) AS total_nuitees,

  ROUND((s.nb_chambres * (s.taux_occupation_cible / 100) * s.adr_cible * s.nb_jours)::numeric, 0) AS ca_hebergement,

  ROUND((
    (s.nb_chambres * (s.taux_occupation_cible / 100) * s.adr_cible * s.nb_jours)
    / NULLIF(1 - (s.pct_restaurant + s.pct_services) / 100, 0)
  )::numeric, 0) AS ca_total,

  ROUND((
    (s.nb_chambres * (s.taux_occupation_cible / 100) * s.adr_cible * s.nb_jours)
    / NULLIF(s.nb_chambres::decimal * s.nb_jours, 0)
  )::numeric, 0) AS revpar_moyen_periode,

  ROUND((
    s.cout_fixe_journalier * s.nb_jours
    + s.cout_variable_par_nuitee
      * s.nb_chambres * (s.taux_occupation_cible / 100) * s.nb_jours
  )::numeric, 0) AS couts_totaux,

  ROUND((
    (s.nb_chambres * (s.taux_occupation_cible / 100) * s.adr_cible * s.nb_jours)
    - (s.cout_fixe_journalier * s.nb_jours
       + s.cout_variable_par_nuitee
         * s.nb_chambres * (s.taux_occupation_cible / 100) * s.nb_jours)
  )::numeric, 0) AS gop_estime,

  ROUND((
    (
      (s.nb_chambres * (s.taux_occupation_cible / 100) * s.adr_cible * s.nb_jours)
      - (s.cout_fixe_journalier * s.nb_jours
         + s.cout_variable_par_nuitee
           * s.nb_chambres * (s.taux_occupation_cible / 100) * s.nb_jours)
    )
    / NULLIF(
        s.nb_chambres * (s.taux_occupation_cible / 100) * s.adr_cible * s.nb_jours
      , 0) * 100
  )::numeric, 1) AS marge_gop_pct

FROM simulateur_scenarios s;

COMMIT;
