-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 009 — Module Événements (salles & réservations événementielles)
--
-- Périmètre LOT-DB-01
-- Source : backend/src/routes/evenements.route.js
--
-- Tables créées :
--   salles_evenements — salles de réunion/réception de l'hôtel
--   evenements        — réservations de salles pour événements
--
-- INVARIANTS FSM evenements.statut :
--   demande → confirme → en_cours → termine | annule
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS salles_evenements (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id           UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  nom                TEXT NOT NULL,
  capacite           INTEGER NOT NULL DEFAULT 10,
  superficie_m2      NUMERIC(8,2),
  equipements        TEXT,
  prix_demi_journee  NUMERIC(12,2),
  prix_journee       NUMERIC(12,2),
  description        TEXT,
  actif              BOOLEAN NOT NULL DEFAULT TRUE,

  cree_le            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salles_evenements_hotel       ON salles_evenements (hotel_id);
CREATE INDEX IF NOT EXISTS idx_salles_evenements_hotel_actif ON salles_evenements (hotel_id, actif);

-- ── evenements ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evenements (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id                UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  numero_evenement         TEXT NOT NULL,
  salle_id                UUID REFERENCES salles_evenements(id) ON DELETE SET NULL,
  client_id               UUID REFERENCES clients(id) ON DELETE SET NULL,

  nom_organisateur         TEXT NOT NULL,
  telephone_organisateur  TEXT,
  email_organisateur       TEXT,
  type_evenement           TEXT,
  titre                    TEXT NOT NULL,

  date_debut               DATE NOT NULL,
  date_fin                 DATE NOT NULL,
  heure_debut              TIME,
  heure_fin                TIME,
  nombre_participants      INTEGER NOT NULL DEFAULT 0,

  formule                  TEXT NOT NULL DEFAULT 'journee'
                             CHECK (formule IN ('demi_journee', 'journee')),
  montant_ht               NUMERIC(12,2) NOT NULL DEFAULT 0,
  montant_ttc              NUMERIC(12,2) NOT NULL DEFAULT 0,
  acompte                  NUMERIC(12,2) NOT NULL DEFAULT 0,
  solde_restant            NUMERIC(12,2) NOT NULL DEFAULT 0,

  statut                   TEXT NOT NULL DEFAULT 'demande'
                             CHECK (statut IN ('demande', 'confirme', 'en_cours', 'termine', 'annule')),
  notes                    TEXT,
  modifie_le               TIMESTAMPTZ,

  cree_le                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (hotel_id, numero_evenement)
);

CREATE INDEX IF NOT EXISTS idx_evenements_hotel  ON evenements (hotel_id);
CREATE INDEX IF NOT EXISTS idx_evenements_statut ON evenements (hotel_id, statut);
CREATE INDEX IF NOT EXISTS idx_evenements_dates  ON evenements (hotel_id, date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_evenements_salle  ON evenements (salle_id)
  WHERE salle_id IS NOT NULL;
