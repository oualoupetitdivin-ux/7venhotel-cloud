-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 018 — Clôture comptable (LOT-OHADA-01)
--
--   clotures_comptables — journal des clôtures (période / exercice) avec contrôles
--
-- Verrous en base :
--   • période clôturée  → irréversible (aucune réouverture, aucune modification)
--   • clôture de période → exige : aucune écriture brouillon dans la période,
--                          toutes les périodes antérieures clôturées
--   • exercice clôturé   → irréversible ; exige toutes ses périodes clôturées
--   • écritures dans période/exercice clôturé → refusées (trigger 014)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS clotures_comptables (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  hotel_id          UUID NOT NULL REFERENCES hotels(id),
  exercice_id       UUID NOT NULL REFERENCES exercices_comptables(id),
  periode_id        UUID REFERENCES periodes_comptables(id),
  type_cloture      TEXT NOT NULL CHECK (type_cloture IN ('periode', 'exercice')),
  controles         JSONB NOT NULL,
  total_debit       NUMERIC(18,2) NOT NULL,
  total_credit      NUMERIC(18,2) NOT NULL,
  resultat          NUMERIC(18,2),
  exercice_suivant_id  UUID REFERENCES exercices_comptables(id),
  ecriture_a_nouveau_id UUID REFERENCES ecritures_comptables(id),
  cloture_par       UUID REFERENCES utilisateurs(id),
  cloture_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (total_debit = total_credit),
  CHECK (type_cloture = 'exercice' OR periode_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cloture_periode  ON clotures_comptables (periode_id)  WHERE type_cloture = 'periode';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cloture_exercice ON clotures_comptables (exercice_id) WHERE type_cloture = 'exercice';
CREATE INDEX IF NOT EXISTS idx_clotures_hotel ON clotures_comptables (tenant_id, hotel_id);

CREATE OR REPLACE FUNCTION fn_clotures_immuables() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CLOTURE_IMMUABLE: le journal des clôtures est en ajout seul' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clotures_immuables ON clotures_comptables;
CREATE TRIGGER trg_clotures_immuables
  BEFORE UPDATE OR DELETE ON clotures_comptables
  FOR EACH ROW EXECUTE FUNCTION fn_clotures_immuables();

-- ── Périodes ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_periode_verrou() RETURNS trigger AS $$
BEGIN
  IF OLD.statut = 'cloturee' THEN
    RAISE EXCEPTION 'PERIODE_CLOTUREE_IRREVERSIBLE: période % déjà clôturée', OLD.libelle USING ERRCODE = 'P0001';
  END IF;
  IF NEW.date_debut <> OLD.date_debut OR NEW.date_fin <> OLD.date_fin
     OR NEW.exercice_id <> OLD.exercice_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.hotel_id <> OLD.hotel_id THEN
    RAISE EXCEPTION 'PERIODE_IDENTITE_IMMUABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.statut = 'cloturee' THEN
    IF EXISTS (SELECT 1 FROM ecritures_comptables WHERE periode_id = NEW.id AND statut = 'brouillon') THEN
      RAISE EXCEPTION 'CLOTURE_BROUILLONS_PRESENTS: valider ou supprimer les brouillons de la période' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM periodes_comptables
                WHERE exercice_id = NEW.exercice_id AND numero < NEW.numero AND statut <> 'cloturee') THEN
      RAISE EXCEPTION 'CLOTURE_ORDRE: les périodes antérieures doivent être clôturées' USING ERRCODE = 'P0001';
    END IF;
    NEW.cloture_le := COALESCE(NEW.cloture_le, NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_periode_verrou ON periodes_comptables;
CREATE TRIGGER trg_periode_verrou
  BEFORE UPDATE ON periodes_comptables
  FOR EACH ROW EXECUTE FUNCTION fn_periode_verrou();

-- ── Exercices ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_exercice_verrou() RETURNS trigger AS $$
BEGIN
  IF OLD.statut = 'cloture' THEN
    RAISE EXCEPTION 'EXERCICE_CLOTURE_IRREVERSIBLE: exercice % déjà clôturé', OLD.annee USING ERRCODE = 'P0001';
  END IF;
  IF NEW.date_debut <> OLD.date_debut OR NEW.date_fin <> OLD.date_fin
     OR NEW.tenant_id <> OLD.tenant_id OR NEW.hotel_id <> OLD.hotel_id OR NEW.annee <> OLD.annee THEN
    RAISE EXCEPTION 'EXERCICE_IDENTITE_IMMUABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.statut = 'cloture' AND EXISTS (
       SELECT 1 FROM periodes_comptables WHERE exercice_id = NEW.id AND statut <> 'cloturee') THEN
    RAISE EXCEPTION 'CLOTURE_EXERCICE_PERIODES_OUVERTES: toutes les périodes doivent être clôturées' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.statut = 'cloture' THEN
    NEW.cloture_le := COALESCE(NEW.cloture_le, NOW());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exercice_verrou ON exercices_comptables;
CREATE TRIGGER trg_exercice_verrou
  BEFORE UPDATE ON exercices_comptables
  FOR EACH ROW EXECUTE FUNCTION fn_exercice_verrou();
