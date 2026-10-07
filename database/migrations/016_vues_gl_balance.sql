-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 016 — Vues Grand Livre / Balance (LOT-OHADA-01)
--
-- Seules les écritures VALIDÉES alimentent GL, Balance et états financiers.
-- Toutes les vues exposent tenant_id + hotel_id : les requêtes applicatives
-- filtrent TOUJOURS sur ces deux colonnes (contexte serveur contexteHotel).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_lignes_validees AS
SELECT
  l.id                 AS ligne_id,
  e.tenant_id,
  e.hotel_id,
  e.exercice_id,
  e.periode_id,
  e.id                 AS ecriture_id,
  e.numero_piece,
  e.date_ecriture,
  e.libelle            AS libelle_ecriture,
  e.source,
  e.evenement_type,
  e.reference_type,
  e.reference_id,
  e.ecriture_origine_id,
  j.code               AS journal_code,
  j.libelle            AS journal_libelle,
  l.numero_ligne,
  l.compte_id,
  l.compte_numero,
  c.libelle            AS compte_libelle,
  c.classe,
  l.tiers_id,
  l.libelle            AS libelle_ligne,
  l.debit,
  l.credit
FROM lignes_ecriture l
JOIN ecritures_comptables e ON e.id = l.ecriture_id AND e.statut = 'validee'
JOIN journaux_comptables  j ON j.id = e.journal_id
JOIN comptes_syscohada    c ON c.id = l.compte_id;

-- Grand Livre : solde progressif par compte au sein de l'exercice
CREATE OR REPLACE VIEW v_grand_livre AS
SELECT
  v.*,
  SUM(v.debit - v.credit) OVER (
    PARTITION BY v.tenant_id, v.hotel_id, v.exercice_id, v.compte_numero
    ORDER BY v.date_ecriture, v.numero_piece, v.numero_ligne
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS solde_cumule
FROM v_lignes_validees v;

-- Balance générale par exercice
CREATE OR REPLACE VIEW v_balance AS
SELECT
  v.tenant_id,
  v.hotel_id,
  v.exercice_id,
  v.compte_numero,
  v.compte_libelle,
  v.classe,
  SUM(v.debit)  AS total_debit,
  SUM(v.credit) AS total_credit,
  GREATEST(SUM(v.debit) - SUM(v.credit), 0) AS solde_debiteur,
  GREATEST(SUM(v.credit) - SUM(v.debit), 0) AS solde_crediteur
FROM v_lignes_validees v
GROUP BY v.tenant_id, v.hotel_id, v.exercice_id, v.compte_numero, v.compte_libelle, v.classe;

-- Contrôle d'équilibre global par exercice (doit toujours donner ecart = 0)
CREATE OR REPLACE VIEW v_controle_equilibre AS
SELECT
  e.tenant_id,
  e.hotel_id,
  e.exercice_id,
  COUNT(*)                              AS nb_ecritures,
  SUM(e.total_debit)                    AS total_debit,
  SUM(e.total_credit)                   AS total_credit,
  SUM(e.total_debit) - SUM(e.total_credit) AS ecart
FROM ecritures_comptables e
WHERE e.statut = 'validee'
GROUP BY e.tenant_id, e.hotel_id, e.exercice_id;
