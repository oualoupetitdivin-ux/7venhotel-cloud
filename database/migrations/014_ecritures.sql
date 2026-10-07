-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 014 — Écritures comptables (LOT-OHADA-01)
--
-- Tables : ecritures_comptables (en-tête / pièce), lignes_ecriture
--
-- INVARIANTS GARANTIS PAR LA BASE (pas seulement par le moteur) :
--   I1  Une écriture est insérée en 'brouillon' ; elle devient 'validee' par UPDATE,
--       uniquement si : ≥ 2 lignes, Σ débit = Σ crédit > 0, période et exercice ouverts.
--   I2  Écriture validée = IMMUABLE : UPDATE / DELETE refusés, lignes gelées.
--       Correction = CONTRE-ÉCRITURE (source 'contre_ecriture', ecriture_origine_id).
--   I3  Une ligne porte soit un débit, soit un crédit (strictement positif).
--   I4  Écriture, lignes, comptes, tiers, journal et période appartiennent au même
--       tenant + hôtel (FK composites + contrôles trigger).
--   I5  Aucune écriture dans une période clôturée ou hors des dates de la période.
--   I6  Une écriture ne peut être contre-passée qu'une seule fois.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ecritures_comptables (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id),
  hotel_id             UUID NOT NULL REFERENCES hotels(id),
  exercice_id          UUID NOT NULL REFERENCES exercices_comptables(id),
  periode_id           UUID NOT NULL REFERENCES periodes_comptables(id),
  journal_id           UUID NOT NULL REFERENCES journaux_comptables(id),
  numero_piece         VARCHAR(40) NOT NULL,
  date_ecriture        DATE NOT NULL,
  libelle              VARCHAR(255) NOT NULL,
  statut               TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'validee')),
  source               TEXT NOT NULL CHECK (source IN ('manuelle', 'moteur', 'contre_ecriture', 'a_nouveau')),
  evenement_type       VARCHAR(40),                 -- type d'événement métier (moteur)
  reference_type       VARCHAR(50),                 -- ex : 'folio', 'paiement', 'charge'
  reference_id         VARCHAR(100),                -- identifiant de l'objet métier source
  cle_idempotence      VARCHAR(200),                -- rejeu d'un même événement = même écriture
  ecriture_origine_id  UUID REFERENCES ecritures_comptables(id),
  total_debit          NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit         NUMERIC(18,2) NOT NULL DEFAULT 0,
  cree_par             UUID REFERENCES utilisateurs(id),
  cree_le              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validee_par          UUID REFERENCES utilisateurs(id),
  validee_le           TIMESTAMPTZ,
  UNIQUE (tenant_id, hotel_id, numero_piece),
  CHECK (source <> 'contre_ecriture' OR ecriture_origine_id IS NOT NULL),
  CHECK (statut = 'brouillon' OR (total_debit = total_credit AND total_debit > 0))
);

CREATE INDEX IF NOT EXISTS idx_ecritures_hotel_date    ON ecritures_comptables (tenant_id, hotel_id, date_ecriture);
CREATE INDEX IF NOT EXISTS idx_ecritures_exercice      ON ecritures_comptables (exercice_id, statut);
CREATE INDEX IF NOT EXISTS idx_ecritures_journal       ON ecritures_comptables (journal_id);
CREATE INDEX IF NOT EXISTS idx_ecritures_reference     ON ecritures_comptables (hotel_id, reference_type, reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecritures_idempotence
  ON ecritures_comptables (hotel_id, cle_idempotence) WHERE cle_idempotence IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecritures_contre_passation
  ON ecritures_comptables (ecriture_origine_id) WHERE source = 'contre_ecriture';

CREATE TABLE IF NOT EXISTS lignes_ecriture (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ecriture_id    UUID NOT NULL REFERENCES ecritures_comptables(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  hotel_id       UUID NOT NULL,
  numero_ligne   INTEGER NOT NULL CHECK (numero_ligne >= 1),
  compte_id      UUID NOT NULL,
  compte_numero  VARCHAR(20) NOT NULL,              -- dénormalisé (renseigné par trigger)
  tiers_id       UUID,
  libelle        VARCHAR(255),
  debit          NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  UNIQUE (ecriture_id, numero_ligne),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  FOREIGN KEY (compte_id, tenant_id, hotel_id) REFERENCES comptes_syscohada (id, tenant_id, hotel_id),
  FOREIGN KEY (tiers_id,  tenant_id, hotel_id) REFERENCES tiers (id, tenant_id, hotel_id)
);

CREATE INDEX IF NOT EXISTS idx_lignes_ecriture ON lignes_ecriture (ecriture_id);
CREATE INDEX IF NOT EXISTS idx_lignes_compte   ON lignes_ecriture (tenant_id, hotel_id, compte_numero);
CREATE INDEX IF NOT EXISTS idx_lignes_tiers    ON lignes_ecriture (tiers_id) WHERE tiers_id IS NOT NULL;

-- ── Contrôle de la période / journal (I4, I5) ─────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ecriture_controle_perimetre(e ecritures_comptables) RETURNS void AS $$
DECLARE
  p RECORD;
BEGIN
  SELECT pc.statut AS p_statut, pc.date_debut, pc.date_fin, ex.statut AS e_statut
    INTO p
    FROM periodes_comptables pc
    JOIN exercices_comptables ex ON ex.id = pc.exercice_id
   WHERE pc.id = e.periode_id AND pc.exercice_id = e.exercice_id
     AND pc.tenant_id = e.tenant_id AND pc.hotel_id = e.hotel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERIODE_HORS_PERIMETRE: période % hors exercice/tenant/hôtel', e.periode_id USING ERRCODE = 'P0001';
  END IF;
  IF p.p_statut <> 'ouverte' OR p.e_statut <> 'ouvert' THEN
    RAISE EXCEPTION 'PERIODE_CLOTUREE: aucune écriture possible dans une période ou un exercice clôturé' USING ERRCODE = 'P0001';
  END IF;
  IF e.date_ecriture < p.date_debut OR e.date_ecriture > p.date_fin THEN
    RAISE EXCEPTION 'DATE_HORS_PERIODE: % hors [% ; %]', e.date_ecriture, p.date_debut, p.date_fin USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM journaux_comptables j
                  WHERE j.id = e.journal_id AND j.tenant_id = e.tenant_id AND j.hotel_id = e.hotel_id AND j.actif) THEN
    RAISE EXCEPTION 'JOURNAL_HORS_PERIMETRE: journal % inactif ou hors tenant/hôtel', e.journal_id USING ERRCODE = 'P0001';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── En-tête : insertion (I1, I4, I5, I6) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ecriture_avant_insertion() RETURNS trigger AS $$
BEGIN
  IF NEW.statut <> 'brouillon' THEN
    RAISE EXCEPTION 'ECRITURE_INSERTION_VALIDEE_INTERDITE: une écriture est créée en brouillon puis validée' USING ERRCODE = 'P0001';
  END IF;
  PERFORM fn_ecriture_controle_perimetre(NEW);
  IF NEW.ecriture_origine_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ecritures_comptables o
        WHERE o.id = NEW.ecriture_origine_id AND o.tenant_id = NEW.tenant_id
          AND o.hotel_id = NEW.hotel_id AND o.statut = 'validee') THEN
    RAISE EXCEPTION 'ECRITURE_ORIGINE_INVALIDE: l''écriture d''origine doit être validée et du même hôtel' USING ERRCODE = 'P0001';
  END IF;
  NEW.total_debit  := 0;
  NEW.total_credit := 0;
  NEW.validee_le   := NULL;
  NEW.validee_par  := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ecriture_avant_insertion ON ecritures_comptables;
CREATE TRIGGER trg_ecriture_avant_insertion
  BEFORE INSERT ON ecritures_comptables
  FOR EACH ROW EXECUTE FUNCTION fn_ecriture_avant_insertion();

-- ── En-tête : modification / validation (I1, I2) ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_ecriture_avant_modification() RETURNS trigger AS $$
DECLARE
  s RECORD;
BEGIN
  IF OLD.statut = 'validee' THEN
    RAISE EXCEPTION 'ECRITURE_VALIDEE_IMMUABLE: écriture % validée — correction par contre-écriture uniquement', OLD.numero_piece
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.hotel_id <> OLD.hotel_id OR NEW.numero_piece <> OLD.numero_piece THEN
    RAISE EXCEPTION 'ECRITURE_IDENTITE_IMMUABLE: tenant, hôtel et numéro de pièce ne peuvent changer' USING ERRCODE = 'P0001';
  END IF;
  PERFORM fn_ecriture_controle_perimetre(NEW);

  SELECT COUNT(*) AS n, COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
    INTO s FROM lignes_ecriture WHERE ecriture_id = NEW.id;
  NEW.total_debit  := s.d;
  NEW.total_credit := s.c;

  IF NEW.statut = 'validee' THEN
    IF s.n < 2 THEN
      RAISE EXCEPTION 'ECRITURE_INCOMPLETE: au moins 2 lignes requises' USING ERRCODE = 'P0001';
    END IF;
    IF s.d <> s.c OR s.d = 0 THEN
      RAISE EXCEPTION 'ECRITURE_DESEQUILIBREE: débit % <> crédit %', s.d, s.c USING ERRCODE = 'P0001';
    END IF;
    NEW.validee_le := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ecriture_avant_modification ON ecritures_comptables;
CREATE TRIGGER trg_ecriture_avant_modification
  BEFORE UPDATE ON ecritures_comptables
  FOR EACH ROW EXECUTE FUNCTION fn_ecriture_avant_modification();

-- ── En-tête : suppression (I2) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_ecriture_avant_suppression() RETURNS trigger AS $$
BEGIN
  IF OLD.statut = 'validee' THEN
    RAISE EXCEPTION 'ECRITURE_VALIDEE_IMMUABLE: suppression interdite (pièce %)', OLD.numero_piece USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ecriture_avant_suppression ON ecritures_comptables;
CREATE TRIGGER trg_ecriture_avant_suppression
  BEFORE DELETE ON ecritures_comptables
  FOR EACH ROW EXECUTE FUNCTION fn_ecriture_avant_suppression();

-- ── Lignes : gel si l'écriture parente est validée (I2, I4) ───────────────────
-- FOR SHARE sur l'en-tête : sérialise ajout de ligne et validation concurrente.
CREATE OR REPLACE FUNCTION fn_ligne_ecriture_controle() RETURNS trigger AS $$
DECLARE
  parent RECORD;
  cpt    RECORD;
BEGIN
  SELECT statut, tenant_id, hotel_id INTO parent
    FROM ecritures_comptables WHERE id = COALESCE(NEW.ecriture_id, OLD.ecriture_id) FOR SHARE;

  IF TG_OP = 'DELETE' THEN
    IF FOUND AND parent.statut = 'validee' THEN
      RAISE EXCEPTION 'ECRITURE_VALIDEE_IMMUABLE: ligne d''une écriture validée' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ECRITURE_INTROUVABLE' USING ERRCODE = 'P0001';
  END IF;
  IF parent.statut = 'validee' THEN
    RAISE EXCEPTION 'ECRITURE_VALIDEE_IMMUABLE: ligne d''une écriture validée' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.ecriture_id <> OLD.ecriture_id THEN
    RAISE EXCEPTION 'LIGNE_DEPLACEMENT_INTERDIT' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.tenant_id <> parent.tenant_id OR NEW.hotel_id <> parent.hotel_id THEN
    RAISE EXCEPTION 'LIGNE_HORS_PERIMETRE: tenant/hôtel différent de l''écriture' USING ERRCODE = 'P0001';
  END IF;

  SELECT numero, actif INTO cpt FROM comptes_syscohada
   WHERE id = NEW.compte_id AND tenant_id = NEW.tenant_id AND hotel_id = NEW.hotel_id;
  IF NOT FOUND OR NOT cpt.actif THEN
    RAISE EXCEPTION 'COMPTE_INVALIDE: compte inactif ou hors périmètre' USING ERRCODE = 'P0001';
  END IF;
  NEW.compte_numero := cpt.numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ligne_ecriture_controle ON lignes_ecriture;
CREATE TRIGGER trg_ligne_ecriture_controle
  BEFORE INSERT OR UPDATE OR DELETE ON lignes_ecriture
  FOR EACH ROW EXECUTE FUNCTION fn_ligne_ecriture_controle();
