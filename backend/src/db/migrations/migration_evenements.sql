-- =============================================================================
-- MIGRATION — Module Événementiel (Salles & Événements)
-- 7venHotel Cloud · Multi-tenant strict
-- =============================================================================

BEGIN;

-- ── Salles événementielles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salles_evenements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  nom               VARCHAR(120) NOT NULL,
  capacite          INTEGER NOT NULL DEFAULT 10,
  superficie_m2     INTEGER,
  equipements       TEXT[],
  prix_demi_journee NUMERIC(12,2),
  prix_journee      NUMERIC(12,2),
  description       TEXT,
  actif             BOOLEAN DEFAULT true,
  cree_le           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salles_evenements_hotel ON salles_evenements(hotel_id);

-- ── Événements ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evenements (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  numero_evenement       VARCHAR(30) UNIQUE,
  salle_id               UUID REFERENCES salles_evenements(id),
  client_id              UUID REFERENCES clients(id),
  nom_organisateur       VARCHAR(200) NOT NULL,
  telephone_organisateur VARCHAR(30),
  email_organisateur     VARCHAR(200),
  type_evenement         VARCHAR(60),
  titre                  VARCHAR(200) NOT NULL,
  date_debut             DATE NOT NULL,
  date_fin               DATE NOT NULL,
  heure_debut            TIME,
  heure_fin              TIME,
  nombre_participants    INTEGER DEFAULT 0,
  formule                VARCHAR(20) NOT NULL DEFAULT 'journee'
                            CHECK (formule IN ('demi_journee', 'journee')),
  montant_ht             NUMERIC(12,2) DEFAULT 0,
  montant_ttc            NUMERIC(12,2) DEFAULT 0,
  statut                 VARCHAR(30) NOT NULL DEFAULT 'demande'
                            CHECK (statut IN ('demande', 'confirme', 'en_cours', 'termine', 'annule')),
  acompte                NUMERIC(12,2) DEFAULT 0,
  solde_restant          NUMERIC(12,2) DEFAULT 0,
  notes                  TEXT,
  cree_le                TIMESTAMPTZ DEFAULT NOW(),
  modifie_le              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evenements_hotel_date   ON evenements(hotel_id, date_debut);
CREATE INDEX IF NOT EXISTS idx_evenements_hotel_statut ON evenements(hotel_id, statut);

COMMIT;
