-- ────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Module Arrhes / Garanties de réservation
-- Crée la table garanties_reservation + politique d'annulation
-- ────────────────────────────────────────────────────────────────────────────

-- Table principale : une garantie par réservation
CREATE TABLE IF NOT EXISTS garanties_reservation (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            UUID        NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id      UUID        NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,

  -- Montants
  montant_demande     NUMERIC(15,2) NOT NULL,          -- Montant total demandé en arrhes
  taux_applique       NUMERIC(5,2)  NOT NULL DEFAULT 30, -- % du total réservation appliqué
  montant_recu        NUMERIC(15,2) NOT NULL DEFAULT 0, -- Montant effectivement reçu
  devise              VARCHAR(3)  NOT NULL DEFAULT 'XAF',

  -- Statut
  -- en_attente : arrhes demandées, paiement en cours
  -- partielle  : paiement partiel reçu
  -- complete   : arrhes entièrement reçues
  -- remboursee : annulation avec remboursement
  -- acquise    : annulation tardive, arrhes conservées par l'hôtel
  -- annulee    : garantie annulée (réservation annulée avant versement)
  statut              VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                      CHECK (statut IN ('en_attente','partielle','complete','remboursee','acquise','annulee')),

  -- Paiement
  mode_paiement       VARCHAR(30),  -- especes | mobile_money | virement | carte
  reference_paiement  VARCHAR(100), -- numéro transaction mobile money, etc.
  echeance_paiement   DATE,         -- date limite de versement

  -- Annulation / remboursement
  montant_rembourse   NUMERIC(15,2) DEFAULT 0,
  motif_remboursement TEXT,
  pct_remboursement   NUMERIC(5,2), -- % remboursé selon politique

  -- Traçabilité
  notes               TEXT,
  traite_par          UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  confirme_le         TIMESTAMPTZ,
  rembourse_le        TIMESTAMPTZ,

  cree_le             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (reservation_id)  -- une seule garantie par réservation
);

CREATE INDEX IF NOT EXISTS idx_garanties_hotel    ON garanties_reservation(hotel_id);
CREATE INDEX IF NOT EXISTS idx_garanties_statut   ON garanties_reservation(statut);
CREATE INDEX IF NOT EXISTS idx_garanties_echeance ON garanties_reservation(echeance_paiement);

-- ────────────────────────────────────────────────────────────────────────────
-- Politique d'annulation par hôtel
-- Stockée en JSONB dans parametres_supplementaires de parametres_hotel
-- Structure attendue :
-- {
--   "arrhes": {
--     "actives": true,
--     "taux": 30,                   -- % du total à verser en arrhes
--     "montant_minimum": 10000,     -- montant minimum en devise hôtel
--     "delai_paiement_jours": 3,    -- jours pour verser après réservation
--     "politique_annulation": [
--       { "jours_avant": 14, "remboursement_pct": 100 },
--       { "jours_avant": 7,  "remboursement_pct": 50  },
--       { "jours_avant": 3,  "remboursement_pct": 0   }
--     ]
--   }
-- }
-- Mise à jour via PUT /arrhes/config — aucune colonne supplémentaire requise.
-- ────────────────────────────────────────────────────────────────────────────
