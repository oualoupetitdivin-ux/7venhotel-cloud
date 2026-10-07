-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 010 — Portail client : sessions, messagerie, évaluations
--
-- Périmètre LOT-DB-01
-- Sources :
--   backend/src/services/portail.service.js
--   backend/src/repositories/portail.repository.js
--
-- Tables créées :
--   messages           — messages entre le client et l'hôtel via le portail QR
--   demandes_service   — demandes de service (ménage, room service, etc.)
--   evaluations_sejour — évaluation post-séjour (une seule par réservation)
--
-- Tables modifiées :
--   sessions_chambre   — ajout de session_token et session_expire
--
-- INVARIANTS evaluations_sejour :
--   UNIQUE(reservation_id) — une seule évaluation par séjour.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── ALTER sessions_chambre ─────────────────────────────────────────────────────

ALTER TABLE sessions_chambre
  ADD COLUMN IF NOT EXISTS session_token  VARCHAR(128) UNIQUE,
  ADD COLUMN IF NOT EXISTS session_expire TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_chambre_session_token
  ON sessions_chambre (session_token)
  WHERE session_token IS NOT NULL;

-- ── messages ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  expediteur_type TEXT NOT NULL CHECK (expediteur_type IN ('client', 'hotel')),
  corps           TEXT NOT NULL,
  lu              BOOLEAN NOT NULL DEFAULT FALSE,
  lu_le           TIMESTAMPTZ,

  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_reservation ON messages (reservation_id, hotel_id);
CREATE INDEX IF NOT EXISTS idx_messages_hotel_non_lus
  ON messages (hotel_id, lu)
  WHERE lu = FALSE;

-- ── demandes_service ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS demandes_service (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  chambre_id      UUID REFERENCES chambres(id) ON DELETE SET NULL,

  type_service    TEXT NOT NULL,
  description     TEXT,

  statut          TEXT NOT NULL DEFAULT 'nouvelle'
                    CHECK (statut IN ('nouvelle', 'en_cours', 'traitee', 'annulee')),
  traitee_le      TIMESTAMPTZ,
  mis_a_jour_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demandes_service_reservation  ON demandes_service (reservation_id, hotel_id);
CREATE INDEX IF NOT EXISTS idx_demandes_service_hotel_statut ON demandes_service (hotel_id, statut);

-- ── evaluations_sejour ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evaluations_sejour (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id  UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,

  note_globale    INTEGER NOT NULL CHECK (note_globale BETWEEN 1 AND 5),
  note_proprete   INTEGER          CHECK (note_proprete  BETWEEN 1 AND 5),
  note_service    INTEGER          CHECK (note_service   BETWEEN 1 AND 5),
  note_confort    INTEGER          CHECK (note_confort   BETWEEN 1 AND 5),
  commentaire     TEXT,
  recommanderait  BOOLEAN,

  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_hotel ON evaluations_sejour (hotel_id);
