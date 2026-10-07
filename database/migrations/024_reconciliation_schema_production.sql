-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 024 — Réconciliation du schéma de production (HELICONIA-READY-02)
--
-- Constat (diff de schéma local certifié ↔ base Railway, après 002-023) :
--   • lignes_folio sans les colonnes v2 (sens, metadata, reference_id…) : la base
--     Railway a été montée par migrate-production.js, qui applique tout
--     backend/db/migrations par ordre alphabétique en ignorant les erreurs —
--     migration_delta.sql ajoutait ces colonnes, migration_v2_realignment_ROLLBACK.sql
--     (appliqué ensuite) les supprimait.
--   • logs_audit_reservations absente (utilisée à chaque check-in / checkout) :
--     créée historiquement hors migrations.
--   • types_chambre.photos, unicité (hotel_id, email) des clients, vues billing
--     plateforme et numérotation par hôtel absentes ou divergentes.
--
-- Définitions extraites du catalogue de la base locale certifiée
-- (OHADA 122/122, PMS-01 64/64, PMS-02 84/84, GUEST-01 100/100).
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE). Aucune donnée modifiée.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Colonnes
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS sens character varying(10);
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS hotel_id uuid;
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS reference_id uuid;
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS reference_type character varying(50);
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS devise character varying(10) DEFAULT 'XAF'::character varying;
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS source_module character varying(50);
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS cree_par uuid;
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS cree_par_type character varying(20);
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE lignes_folio ADD COLUMN IF NOT EXISTS ligne_corrigee_id uuid;
ALTER TABLE types_chambre ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb;

-- 2. Journal d'audit des transitions de réservation (utilisé par check-in / checkout)
CREATE TABLE IF NOT EXISTS logs_audit_reservations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  reservation_id uuid,
  hotel_id uuid,
  action character varying(50) NOT NULL,
  statut_avant character varying(50),
  statut_apres character varying(50),
  acteur_id uuid,
  acteur_type character varying(20),
  horodatage timestamp with time zone NOT NULL DEFAULT now(),
  ip_address inet,
  donnees_avant jsonb
);

-- 3. Contraintes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_hotel_id_email_unique' AND conrelid = 'clients'::regclass) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_hotel_id_email_unique UNIQUE (hotel_id, email);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_audit_reservations_pkey' AND conrelid = 'logs_audit_reservations'::regclass) THEN
    ALTER TABLE logs_audit_reservations ADD CONSTRAINT logs_audit_reservations_pkey PRIMARY KEY (id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lignes_folio_correction' AND conrelid = 'lignes_folio'::regclass) THEN
    ALTER TABLE lignes_folio ADD CONSTRAINT fk_lignes_folio_correction FOREIGN KEY (ligne_corrigee_id) REFERENCES lignes_folio(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_audit_reservations_reservation_id_fkey' AND conrelid = 'logs_audit_reservations'::regclass) THEN
    ALTER TABLE logs_audit_reservations ADD CONSTRAINT logs_audit_reservations_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_audit_reservations_hotel_id_fkey' AND conrelid = 'logs_audit_reservations'::regclass) THEN
    ALTER TABLE logs_audit_reservations ADD CONSTRAINT logs_audit_reservations_hotel_id_fkey FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_audit_reservations_acteur_id_fkey' AND conrelid = 'logs_audit_reservations'::regclass) THEN
    ALTER TABLE logs_audit_reservations ADD CONSTRAINT logs_audit_reservations_acteur_id_fkey FOREIGN KEY (acteur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lignes_folio_hotel_id' AND conrelid = 'lignes_folio'::regclass) THEN
    ALTER TABLE lignes_folio ADD CONSTRAINT fk_lignes_folio_hotel_id FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lignes_folio_sens' AND conrelid = 'lignes_folio'::regclass) THEN
    ALTER TABLE lignes_folio ADD CONSTRAINT chk_lignes_folio_sens CHECK (((sens)::text = ANY ((ARRAY['debit'::character varying, 'credit'::character varying])::text[]))) NOT VALID;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logs_audit_reservations_acteur_type_check' AND conrelid = 'logs_audit_reservations'::regclass) THEN
    ALTER TABLE logs_audit_reservations ADD CONSTRAINT logs_audit_reservations_acteur_type_check CHECK ((((acteur_type)::text = ANY ((ARRAY['staff'::character varying, 'systeme'::character varying, 'portail'::character varying, 'client'::character varying])::text[])) OR (acteur_type IS NULL)));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lignes_folio_cree_par_type' AND conrelid = 'lignes_folio'::regclass) THEN
    ALTER TABLE lignes_folio ADD CONSTRAINT chk_lignes_folio_cree_par_type CHECK ((((cree_par_type)::text = ANY ((ARRAY['staff'::character varying, 'systeme'::character varying, 'portail'::character varying])::text[])) OR (cree_par_type IS NULL))) NOT VALID;
  END IF;
END $$;

-- 4. Index
CREATE INDEX IF NOT EXISTS idx_lignes_folio_folio_id ON lignes_folio USING btree (folio_id);
CREATE INDEX IF NOT EXISTS idx_lignes_folio_hotel_date ON lignes_folio USING btree (hotel_id, cree_le DESC) WHERE (hotel_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_lignes_folio_hotel_sens ON lignes_folio USING btree (hotel_id, sens, cree_le DESC) WHERE ((hotel_id IS NOT NULL) AND (sens IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_lignes_folio_reference ON lignes_folio USING btree (reference_id, reference_type) WHERE (reference_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lignes_folio_correction_unique ON lignes_folio USING btree (ligne_corrigee_id) WHERE (ligne_corrigee_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_logs_audit_res_reservation ON logs_audit_reservations USING btree (reservation_id);
CREATE INDEX IF NOT EXISTS idx_logs_audit_res_hotel_action ON logs_audit_reservations USING btree (hotel_id, action, horodatage DESC) WHERE (hotel_id IS NOT NULL);

-- 5. Numérotation par hôtel (version certifiée)
CREATE OR REPLACE FUNCTION generer_numero_commande()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE seq TEXT;
BEGIN
  SELECT LPAD((COUNT(*) + 1)::TEXT, 5, '0')
    INTO seq
    FROM commandes_restaurant
   WHERE hotel_id = NEW.hotel_id
     AND DATE(cree_le) = CURRENT_DATE;
  NEW.numero_commande := 'CMD-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || seq;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION generer_numero_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  prefix TEXT := 'RES';
  annee TEXT := TO_CHAR(NOW(), 'YY');
  sequence_num TEXT;
BEGIN
  SELECT LPAD((COUNT(*) + 1)::TEXT, 6, '0')
  INTO sequence_num
  FROM reservations
  WHERE hotel_id = NEW.hotel_id
    AND EXTRACT(YEAR FROM cree_le) = EXTRACT(YEAR FROM NOW());
  NEW.numero_reservation := prefix || annee || sequence_num;
  RETURN NEW;
END;
$function$;

-- 6. Vues de pilotage billing plateforme
CREATE OR REPLACE VIEW v_mrr_by_tenant AS
SELECT a.tenant_id,
    t.nom AS tenant_nom,
    a.id AS subscription_id,
    a.statut AS subscription_statut,
    ss.id AS snapshot_id,
    ss.plan_code,
    ss.periodicite,
    ss.devise,
    ss.montant_centimes AS montant_snapshote_centimes,
        CASE ss.periodicite
            WHEN 'annuel'::text THEN (ss.montant_centimes / 12)
            ELSE ss.montant_centimes
        END AS mrr_centimes,
        CASE ss.periodicite
            WHEN 'annuel'::text THEN ((ss.montant_centimes / 12) * 12)
            ELSE (ss.montant_centimes * 12)
        END AS arr_centimes,
    ss.actif_depuis
   FROM ((abonnements a
     JOIN subscription_snapshots ss ON (((ss.subscription_id = a.id) AND (ss.actif_jusqu IS NULL))))
     JOIN tenants t ON ((t.id = a.tenant_id)))
  WHERE (a.statut = 'actif'::statut_abonnement);
CREATE OR REPLACE VIEW v_tenant_billing_metrics AS
WITH inv_m AS (
         SELECT platform_invoices.tenant_id,
            count(*) AS nb,
            COALESCE(sum(platform_invoices.montant_ttc_centimes), (0)::bigint) AS ttc,
            COALESCE(sum(platform_invoices.montant_paye_centimes), (0)::bigint) AS paye,
            COALESCE(sum(platform_invoices.montant_restant_centimes) FILTER (WHERE ((platform_invoices.statut)::text = ANY ((ARRAY['emise'::character varying, 'partiellement_payee'::character varying, 'en_retard'::character varying])::text[]))), (0)::bigint) AS outstanding,
            count(*) FILTER (WHERE ((platform_invoices.statut)::text = 'payee'::text)) AS nb_payees,
            count(*) FILTER (WHERE ((platform_invoices.statut)::text = 'en_retard'::text)) AS nb_retard
           FROM platform_invoices
          GROUP BY platform_invoices.tenant_id
        ), pay_m AS (
         SELECT platform_payments.tenant_id,
            count(*) FILTER (WHERE ((platform_payments.statut)::text = 'succeeded'::text)) AS nb_ok,
            COALESCE(sum(platform_payments.montant_centimes) FILTER (WHERE ((platform_payments.statut)::text = 'succeeded'::text)), (0)::bigint) AS total,
            count(*) FILTER (WHERE ((platform_payments.statut)::text = ANY ((ARRAY['refunded'::character varying, 'partially_refunded'::character varying])::text[]))) AS nb_remb
           FROM platform_payments
          GROUP BY platform_payments.tenant_id
        ), stt_m AS (
         SELECT p.tenant_id,
            count(s.id) FILTER (WHERE ((s.statut)::text = 'settled'::text)) AS nb,
            COALESCE(sum(s.montant_brut_centimes) FILTER (WHERE ((s.statut)::text = 'settled'::text)), (0)::bigint) AS gross,
            COALESCE(sum(s.montant_net_centimes) FILTER (WHERE ((s.statut)::text = 'settled'::text)), (0)::bigint) AS net,
            COALESCE(sum(s.frais_provider_centimes) FILTER (WHERE ((s.statut)::text = 'settled'::text)), (0)::bigint) AS frais
           FROM (platform_payments p
             LEFT JOIN platform_settlements s ON ((s.payment_id = p.id)))
          GROUP BY p.tenant_id
        ), ref_m AS (
         SELECT p.tenant_id,
            count(r.id) FILTER (WHERE ((r.statut)::text = 'succeeded'::text)) AS nb,
            COALESCE(sum(r.montant_centimes) FILTER (WHERE ((r.statut)::text = 'succeeded'::text)), (0)::bigint) AS total
           FROM (platform_payments p
             LEFT JOIN platform_refunds r ON ((r.payment_id = p.id)))
          GROUP BY p.tenant_id
        ), dun_m AS (
         SELECT i.tenant_id,
            count(d.id) AS nb,
            count(d.id) FILTER (WHERE ((d.statut)::text = 'envoye'::text)) AS envoyes,
            count(d.id) FILTER (WHERE ((d.statut)::text = 'echoue'::text)) AS echoues
           FROM (platform_invoices i
             LEFT JOIN dunning_events d ON ((d.invoice_id = i.id)))
          GROUP BY i.tenant_id
        )
 SELECT t.id AS tenant_id,
    t.nom AS tenant_nom,
    COALESCE(im.nb, (0)::bigint) AS nb_invoices,
    COALESCE(im.ttc, (0)::bigint) AS total_facture_centimes,
    COALESCE(im.paye, (0)::bigint) AS total_paye_centimes,
    COALESCE(im.outstanding, (0)::bigint) AS total_outstanding_centimes,
    COALESCE(im.nb_payees, (0)::bigint) AS nb_invoices_payees,
    COALESCE(im.nb_retard, (0)::bigint) AS nb_invoices_en_retard,
    COALESCE(pm.nb_ok, (0)::bigint) AS nb_payments_ok,
    COALESCE(pm.total, (0)::bigint) AS total_payments_centimes,
    COALESCE(pm.nb_remb, (0)::bigint) AS nb_payments_remb,
    COALESCE(rm.nb, (0)::bigint) AS nb_refunds,
    COALESCE(rm.total, (0)::bigint) AS total_rembourse_centimes,
    COALESCE(sm.nb, (0)::bigint) AS nb_settlements,
    COALESCE(sm.gross, (0)::bigint) AS total_gross_settled_centimes,
    COALESCE(sm.net, (0)::bigint) AS total_net_settled_centimes,
    COALESCE(sm.frais, (0)::bigint) AS total_frais_centimes,
    COALESCE(dm.nb, (0)::bigint) AS nb_dunning_events,
    COALESCE(dm.envoyes, (0)::bigint) AS nb_dunning_envoyes,
    COALESCE(dm.echoues, (0)::bigint) AS nb_dunning_echoues
   FROM (((((tenants t
     LEFT JOIN inv_m im ON ((im.tenant_id = t.id)))
     LEFT JOIN pay_m pm ON ((pm.tenant_id = t.id)))
     LEFT JOIN stt_m sm ON ((sm.tenant_id = t.id)))
     LEFT JOIN ref_m rm ON ((rm.tenant_id = t.id)))
     LEFT JOIN dun_m dm ON ((dm.tenant_id = t.id)));
