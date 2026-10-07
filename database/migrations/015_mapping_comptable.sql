-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 015 — Mapping comptable (LOT-OHADA-01)
--
-- EVENT → JOURNAL → COMPTE DÉBIT → COMPTE CRÉDIT → TAXE → CONDITIONS
--
-- Les comptes ne sont jamais codés en dur dans les routes métier : le moteur
-- (accounting.engine.js) lit ce mapping, paramétrable par hôtel.
--
-- mode_taxe :
--   'aucune'  — montant porté tel quel au débit et au crédit
--   'incluse' — montant TTC ; la taxe est extraite (HT = TTC / (1 + taux))
--   'en_sus'  — montant HT ; la taxe est ajoutée (TTC = HT × (1 + taux))
-- cote_taxe : côté où la taxe est portée ('credit' ventes → 443x ; 'debit' achats → 445x).
--             Le côté opposé reçoit le TTC (compte de tiers / trésorerie).
-- conditions : sous-ensemble d'attributs de l'événement requis (ex {"mode_paiement":"especes"}).
--              Le mapping actif de plus forte priorité dont les conditions correspondent gagne.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS uq_journaux_id_scope ON journaux_comptables (id, tenant_id, hotel_id);

CREATE TABLE IF NOT EXISTS mappings_comptables (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id          UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  evenement_type    VARCHAR(40) NOT NULL CHECK (evenement_type IN (
                      'HEBERGEMENT', 'RESTAURANT', 'ROOM_SERVICE', 'PAIEMENT', 'CAISSE_DECAISSEMENT',
                      'CAISSE_APPORT', 'CHARGE', 'ACHAT', 'ARRHES', 'ANNULATION', 'AVOIR')),
  libelle           VARCHAR(150) NOT NULL,
  journal_id        UUID NOT NULL,
  compte_debit_id   UUID NOT NULL,
  compte_credit_id  UUID NOT NULL,
  compte_taxe_id    UUID,
  mode_taxe         TEXT NOT NULL DEFAULT 'aucune' CHECK (mode_taxe IN ('aucune', 'incluse', 'en_sus')),
  cote_taxe         TEXT CHECK (cote_taxe IN ('debit', 'credit')),
  taux_taxe         NUMERIC(5,2) CHECK (taux_taxe IS NULL OR taux_taxe >= 0),  -- NULL = config_fiscale.taux_tva_normal
  conditions        JSONB NOT NULL DEFAULT '{}',
  priorite          INTEGER NOT NULL DEFAULT 0,
  actif             BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mis_a_jour_le     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, hotel_id, evenement_type, priorite),
  FOREIGN KEY (journal_id,       tenant_id, hotel_id) REFERENCES journaux_comptables (id, tenant_id, hotel_id),
  FOREIGN KEY (compte_debit_id,  tenant_id, hotel_id) REFERENCES comptes_syscohada   (id, tenant_id, hotel_id),
  FOREIGN KEY (compte_credit_id, tenant_id, hotel_id) REFERENCES comptes_syscohada   (id, tenant_id, hotel_id),
  FOREIGN KEY (compte_taxe_id,   tenant_id, hotel_id) REFERENCES comptes_syscohada   (id, tenant_id, hotel_id),
  CHECK (compte_debit_id <> compte_credit_id),
  CHECK (mode_taxe = 'aucune' OR (compte_taxe_id IS NOT NULL AND cote_taxe IS NOT NULL)),
  CHECK (jsonb_typeof(conditions) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_mappings_evenement ON mappings_comptables (tenant_id, hotel_id, evenement_type) WHERE actif;
