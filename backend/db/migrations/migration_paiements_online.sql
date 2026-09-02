-- Migration: table paiements_online pour tracking des transactions CinetPay
-- À appliquer APRÈS migration_portail_client.sql

CREATE TABLE IF NOT EXISTS paiements_online (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id          UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id    UUID REFERENCES reservations(id) ON DELETE SET NULL,
  transaction_id    VARCHAR(100) NOT NULL UNIQUE,  -- ID généré par nous, envoyé à CinetPay
  cinetpay_id       VARCHAR(200),                  -- ID retourné par CinetPay
  montant           NUMERIC(12,2) NOT NULL,
  devise            VARCHAR(10) NOT NULL DEFAULT 'XAF',
  statut            VARCHAR(50) NOT NULL DEFAULT 'en_attente',
    -- en_attente | reussi | echoue | annule | rembourse
  provider          VARCHAR(50),                   -- MTN, ORANGE, VISA, etc.
  customer_email    VARCHAR(255),
  customer_name     VARCHAR(255),
  customer_phone    VARCHAR(50),
  metadata          JSONB DEFAULT '{}',
  cinetpay_data     JSONB DEFAULT '{}',            -- payload brut du webhook
  expire_le         TIMESTAMPTZ,
  paye_le           TIMESTAMPTZ,
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paiements_online_hotel    ON paiements_online(hotel_id);
CREATE INDEX IF NOT EXISTS idx_paiements_online_resa     ON paiements_online(reservation_id);
CREATE INDEX IF NOT EXISTS idx_paiements_online_statut   ON paiements_online(statut);
CREATE INDEX IF NOT EXISTS idx_paiements_online_txid     ON paiements_online(transaction_id);
