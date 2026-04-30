-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION — Tables portail client
-- À appliquer via Railway Run Command :
--   psql $DATABASE_URL -f migration_portail_client.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colonne session_token sur sessions_chambre ────────────────────────────
-- Le token QR (colonne `token`) est utilisé UNE SEULE FOIS pour l'accès initial.
-- session_token est généré lors de cet échange et utilisé pour toutes les
-- requêtes API suivantes (header Authorization: Bearer {session_token}).
-- session_expire est plus court que expire_le du token QR (4h glissantes).
ALTER TABLE sessions_chambre
  ADD COLUMN IF NOT EXISTS session_token  VARCHAR(128) UNIQUE,
  ADD COLUMN IF NOT EXISTS session_expire TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_session_token
  ON sessions_chambre(session_token)
  WHERE session_token IS NOT NULL;

-- ── 2. Table messages ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  expediteur_type VARCHAR(20) NOT NULL CHECK (expediteur_type IN ('client', 'staff', 'systeme')),
  expediteur_id   UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  corps           TEXT NOT NULL CHECK (length(corps) > 0 AND length(corps) <= 2000),
  lu              BOOLEAN DEFAULT FALSE,
  lu_le           TIMESTAMPTZ,
  cree_le         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_reservation
  ON messages(reservation_id, cree_le DESC);

CREATE INDEX IF NOT EXISTS idx_messages_hotel_non_lu
  ON messages(hotel_id, lu)
  WHERE lu = FALSE;

-- ── 3. Table demandes_service ────────────────────────────────────────────────
CREATE TYPE IF NOT EXISTS statut_demande AS ENUM
  ('nouvelle', 'en_cours', 'traitee', 'annulee');

CREATE TABLE IF NOT EXISTS demandes_service (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id        UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  chambre_id      UUID REFERENCES chambres(id) ON DELETE SET NULL,
  type_service    VARCHAR(100) NOT NULL,  -- menage, roomservice, maintenance, autre
  description     TEXT,
  statut          statut_demande DEFAULT 'nouvelle',
  traitee_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  traitee_le      TIMESTAMPTZ,
  notes_staff     TEXT,
  cree_le         TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demandes_service_reservation
  ON demandes_service(reservation_id);

CREATE INDEX IF NOT EXISTS idx_demandes_service_hotel_statut
  ON demandes_service(hotel_id, statut)
  WHERE statut IN ('nouvelle', 'en_cours');

-- ── 4. Table evaluations_sejour ──────────────────────────────────────────────
-- UNIQUE(reservation_id) : une seule évaluation par séjour, enforced en DB.
CREATE TABLE IF NOT EXISTS evaluations_sejour (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id          UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id    UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  note_globale      SMALLINT NOT NULL CHECK (note_globale BETWEEN 1 AND 5),
  note_proprete     SMALLINT CHECK (note_proprete BETWEEN 1 AND 5),
  note_service      SMALLINT CHECK (note_service BETWEEN 1 AND 5),
  note_confort      SMALLINT CHECK (note_confort BETWEEN 1 AND 5),
  commentaire       TEXT CHECK (length(commentaire) <= 2000),
  recommanderait    BOOLEAN,
  visible_public    BOOLEAN DEFAULT FALSE,   -- activé par le staff après modération
  reponse_hotel     TEXT,
  reponse_le        TIMESTAMPTZ,
  cree_le           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_hotel
  ON evaluations_sejour(hotel_id, cree_le DESC);
