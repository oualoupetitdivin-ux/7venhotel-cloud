-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 021 — Cohérence du parcours PMS (LOT-PMS-02)
--
-- A1  type_extra_folio + 'arrhes'
--     Le modèle folio représente les règlements par des lignes CRÉDIT typées
--     ('paiement', 'correction', 'remise' — valeurs ajoutées hors migrations suivies).
--     'arrhes' manquait : le crédit folio des arrhes échouait toujours (erreur avalée).
--
-- A2  Cycle de vie du folio (valeurs déjà utilisées par le code, jamais posées) :
--       ouvert     → séjour en cours : toutes lignes
--       en_attente → séjour terminé, solde ≠ 0 : règlements (paiement, arrhes) et corrections seulement
--       cloture    → solde nul : corrections seulement (mécanisme d'avoir prévu)
--     Retour à 'ouvert' interdit. Contrôle en base (le commentaire du service
--     annonçait un trigger qui n'existait pas).
--
-- A3  factures : ventilation du règlement (arrhes imputées, paiements, reste dû).
--     montant_ttc = ventes nettes ; montant_du = ttc − arrhes − paiements = solde folio.
--
-- A7  lignes_bon_achat.taux_tva (NULL = TVA fournisseur inconnue → achat HT seul).
--     Modèle minimal : aucune TVA n'est inventée si la donnée n'est pas saisie.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TYPE type_extra_folio ADD VALUE IF NOT EXISTS 'arrhes';

-- ── A2 : statuts de folio ─────────────────────────────────────────────────────
ALTER TABLE folios DROP CONSTRAINT IF EXISTS chk_folios_statut;
ALTER TABLE folios ADD CONSTRAINT chk_folios_statut CHECK (statut IN ('ouvert', 'en_attente', 'cloture'));

CREATE OR REPLACE FUNCTION fn_lignes_folio_controle_statut() RETURNS trigger AS $$
DECLARE
  st TEXT;
  t  TEXT := NEW.type_ligne::text;
BEGIN
  SELECT statut INTO st FROM folios WHERE id = NEW.folio_id FOR SHARE;
  IF st IS NULL OR st = 'ouvert' THEN
    RETURN NEW;
  END IF;
  IF st = 'en_attente' AND t IN ('paiement', 'arrhes', 'correction') THEN
    RETURN NEW;
  END IF;
  IF st = 'cloture' AND t = 'correction' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'FOLIO_NON_MODIFIABLE: ligne % refusée sur un folio %', t, st USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lignes_folio_controle_statut ON lignes_folio;
CREATE TRIGGER trg_lignes_folio_controle_statut
  BEFORE INSERT ON lignes_folio
  FOR EACH ROW EXECUTE FUNCTION fn_lignes_folio_controle_statut();

CREATE OR REPLACE FUNCTION fn_folios_pas_de_reouverture() RETURNS trigger AS $$
BEGIN
  IF OLD.statut <> 'ouvert' AND NEW.statut = 'ouvert' THEN
    RAISE EXCEPTION 'FOLIO_REOUVERTURE_INTERDITE: folio % (%)', OLD.numero_folio, OLD.statut USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_folios_pas_de_reouverture ON folios;
CREATE TRIGGER trg_folios_pas_de_reouverture
  BEFORE UPDATE OF statut ON folios
  FOR EACH ROW EXECUTE FUNCTION fn_folios_pas_de_reouverture();

-- ── A3 : factures ─────────────────────────────────────────────────────────────
ALTER TABLE factures ADD COLUMN IF NOT EXISTS montant_arrhes NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS montant_paye   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS montant_du     NUMERIC(12,2);

-- ── A7 : TVA d'achat (optionnelle) ────────────────────────────────────────────
ALTER TABLE lignes_bon_achat ADD COLUMN IF NOT EXISTS taux_tva NUMERIC(5,2) CHECK (taux_tva IS NULL OR taux_tva >= 0);
