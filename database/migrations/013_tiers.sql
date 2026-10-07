-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 013 — Tiers comptables (LOT-OHADA-01)
--
-- Un tiers comptable est un compte auxiliaire rattaché à un compte collectif
-- (411 clients, 401 fournisseurs, 421 personnel, 44x État...).
-- Il ne duplique PAS l'identité métier : il RÉFÉRENCE clients / fournisseurs
-- existants (client_id / fournisseur_id), un seul tiers par entité métier.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tiers (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id             UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type_tiers           TEXT NOT NULL CHECK (type_tiers IN ('client','fournisseur','personnel','etat','associe','autre')),
  code                 VARCHAR(30) NOT NULL,
  nom                  VARCHAR(200) NOT NULL,
  compte_collectif_id  UUID NOT NULL,
  client_id            UUID REFERENCES clients(id) ON DELETE RESTRICT,
  fournisseur_id       UUID REFERENCES fournisseurs(id) ON DELETE RESTRICT,
  actif                BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hotel_id, code),
  UNIQUE (id, tenant_id, hotel_id),
  -- Le compte collectif doit appartenir au même tenant/hôtel
  FOREIGN KEY (compte_collectif_id, tenant_id, hotel_id)
    REFERENCES comptes_syscohada (id, tenant_id, hotel_id),
  CHECK (client_id IS NULL OR type_tiers = 'client'),
  CHECK (fournisseur_id IS NULL OR type_tiers = 'fournisseur')
);

-- Pas de doublon de tiers pour une même entité métier
CREATE UNIQUE INDEX IF NOT EXISTS uq_tiers_client      ON tiers (hotel_id, client_id)      WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tiers_fournisseur ON tiers (hotel_id, fournisseur_id) WHERE fournisseur_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiers_hotel ON tiers (tenant_id, hotel_id);

-- Le client / fournisseur lié doit appartenir au même hôtel que le tiers
CREATE OR REPLACE FUNCTION fn_tiers_controle_hotel() RETURNS trigger AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM clients WHERE id = NEW.client_id AND hotel_id = NEW.hotel_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'TIERS_CLIENT_HORS_PERIMETRE: client % hors tenant/hotel', NEW.client_id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.fournisseur_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM fournisseurs WHERE id = NEW.fournisseur_id AND hotel_id = NEW.hotel_id) THEN
    RAISE EXCEPTION 'TIERS_FOURNISSEUR_HORS_PERIMETRE: fournisseur % hors hotel', NEW.fournisseur_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tiers_controle_hotel ON tiers;
CREATE TRIGGER trg_tiers_controle_hotel
  BEFORE INSERT OR UPDATE ON tiers
  FOR EACH ROW EXECUTE FUNCTION fn_tiers_controle_hotel();
