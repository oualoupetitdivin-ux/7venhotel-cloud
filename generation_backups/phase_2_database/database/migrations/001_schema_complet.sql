-- ═══════════════════════════════════════════════════════════════════════
-- 7venHotel Cloud — Schéma de base de données PostgreSQL
-- Version: 1.0.0 | Langue: Français
-- ═══════════════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── TYPES ÉNUMÉRÉS ────────────────────────────────────────────────────

CREATE TYPE statut_reservation AS ENUM ('tentative','confirmee','arrivee','depart_aujourd_hui','annulee','no_show');
CREATE TYPE statut_chambre AS ENUM ('libre_propre','occupee','sale','nettoyage','inspection','hors_service','maintenance');
CREATE TYPE statut_tache_hk AS ENUM ('ouverte','assignee','en_cours','terminee','validee');
CREATE TYPE statut_ticket_maintenance AS ENUM ('ouvert','assigne','en_cours','resolu','ferme');
CREATE TYPE priorite AS ENUM ('basse','normale','haute','urgente');
CREATE TYPE statut_commande AS ENUM ('nouvelle','en_preparation','prete','servie','annulee');
CREATE TYPE type_paiement AS ENUM ('carte','especes','chambre','virement','mobile_money');
CREATE TYPE statut_paiement AS ENUM ('en_attente','valide','rembourse','echec');
CREATE TYPE type_taxe AS ENUM ('pourcentage','fixe');
CREATE TYPE role_utilisateur AS ENUM ('super_admin','manager','reception','housekeeping','restaurant','comptabilite','technicien');
CREATE TYPE statut_abonnement AS ENUM ('actif','suspendu','expire','essai');
CREATE TYPE type_extra_folio AS ENUM ('hebergement','restaurant','bar','spa','blanchisserie','transport','telephone','minibar','autre');

-- ── TENANTS (Groupes hôteliers) ───────────────────────────────────────

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  email_contact VARCHAR(255) NOT NULL,
  telephone VARCHAR(50),
  adresse TEXT,
  pays VARCHAR(100) DEFAULT 'Cameroun',
  devise_defaut VARCHAR(10) DEFAULT 'XAF',
  fuseau_horaire VARCHAR(100) DEFAULT 'Africa/Douala',
  langue_defaut VARCHAR(10) DEFAULT 'fr',
  logo_url TEXT,
  statut VARCHAR(50) DEFAULT 'actif',
  parametres JSONB DEFAULT '{}',
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── ABONNEMENTS ───────────────────────────────────────────────────────

CREATE TABLE abonnements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan VARCHAR(50) NOT NULL DEFAULT 'starter', -- starter, professional, enterprise
  statut statut_abonnement DEFAULT 'essai',
  date_debut DATE NOT NULL DEFAULT CURRENT_DATE,
  date_fin DATE,
  max_hotels INTEGER DEFAULT 1,
  max_chambres INTEGER DEFAULT 50,
  max_utilisateurs INTEGER DEFAULT 5,
  montant_mensuel DECIMAL(10,2) DEFAULT 0,
  devise VARCHAR(10) DEFAULT 'XAF',
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── HÔTELS ────────────────────────────────────────────────────────────

CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nom VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  adresse TEXT NOT NULL,
  ville VARCHAR(100) NOT NULL,
  pays VARCHAR(100) DEFAULT 'Cameroun',
  code_postal VARCHAR(20),
  telephone VARCHAR(50),
  email VARCHAR(255),
  site_web VARCHAR(255),
  logo_url TEXT,
  nombre_etoiles INTEGER DEFAULT 3 CHECK (nombre_etoiles BETWEEN 1 AND 5),
  nombre_chambres INTEGER DEFAULT 0,
  nombre_etages INTEGER DEFAULT 1,
  actif BOOLEAN DEFAULT TRUE,
  coordonnees_gps POINT,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- ── PARAMÈTRES HÔTEL ──────────────────────────────────────────────────

CREATE TABLE parametres_hotel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  devise VARCHAR(10) DEFAULT 'XAF',
  fuseau_horaire VARCHAR(100) DEFAULT 'Africa/Douala',
  langue VARCHAR(10) DEFAULT 'fr',
  heure_arrivee TIME DEFAULT '14:00:00',
  heure_depart TIME DEFAULT '12:00:00',
  tva_numero VARCHAR(100),
  registre_commerce VARCHAR(100),
  pied_de_page_facture TEXT,
  modele_facture VARCHAR(50) DEFAULT 'classique',
  couleur_primaire VARCHAR(20) DEFAULT '#3B82F6',
  couleur_secondaire VARCHAR(20) DEFAULT '#8B5CF6',
  activer_portail_client BOOLEAN DEFAULT TRUE,
  activer_portail_chambre BOOLEAN DEFAULT TRUE,
  activer_reservation_ligne BOOLEAN DEFAULT TRUE,
  activer_pos_restaurant BOOLEAN DEFAULT TRUE,
  activer_ia BOOLEAN DEFAULT TRUE,
  parametres_supplementaires JSONB DEFAULT '{}',
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id)
);

-- ── UTILISATEURS ──────────────────────────────────────────────────────

CREATE TABLE utilisateurs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hotel_id UUID REFERENCES hotels(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  mot_de_passe_hash VARCHAR(255) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  telephone VARCHAR(50),
  avatar_url TEXT,
  role role_utilisateur NOT NULL DEFAULT 'reception',
  actif BOOLEAN DEFAULT TRUE,
  derniere_connexion TIMESTAMPTZ,
  token_reinit_mdp VARCHAR(255),
  token_reinit_expire TIMESTAMPTZ,
  parametres_notifications JSONB DEFAULT '{"email": true, "app": true}',
  langue_preferee VARCHAR(10) DEFAULT 'fr',
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- ── PERMISSIONS ───────────────────────────────────────────────────────

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(100) UNIQUE NOT NULL,
  description VARCHAR(255),
  module VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL -- lire, creer, modifier, supprimer, administrer
);

CREATE TABLE role_permissions (
  role role_utilisateur NOT NULL,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_id)
);

-- ── TYPES DE CHAMBRE ──────────────────────────────────────────────────

CREATE TABLE types_chambre (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  nom VARCHAR(100) NOT NULL,
  description TEXT,
  capacite_adultes INTEGER DEFAULT 2,
  capacite_enfants INTEGER DEFAULT 0,
  superficie_m2 DECIMAL(6,2),
  amenagements JSONB DEFAULT '[]',
  tarif_base DECIMAL(10,2) NOT NULL DEFAULT 0,
  devise VARCHAR(10) DEFAULT 'XAF',
  actif BOOLEAN DEFAULT TRUE,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── CHAMBRES ──────────────────────────────────────────────────────────

CREATE TABLE chambres (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type_chambre_id UUID REFERENCES types_chambre(id) ON DELETE SET NULL,
  numero VARCHAR(20) NOT NULL,
  etage INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  statut statut_chambre DEFAULT 'libre_propre',
  statut_menage statut_tache_hk DEFAULT 'validee',
  vue VARCHAR(100),
  lits JSONB DEFAULT '[]', -- [{type: "double", quantite: 1}]
  superficie_m2 DECIMAL(6,2),
  caracteristiques JSONB DEFAULT '[]',
  tarif_specifique DECIMAL(10,2),
  hors_service BOOLEAN DEFAULT FALSE,
  hors_service_raison TEXT,
  notes_internes TEXT,
  qr_session_token VARCHAR(255),
  qr_session_active BOOLEAN DEFAULT FALSE,
  qr_session_expire TIMESTAMPTZ,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, numero)
);

-- ── IMAGES CHAMBRES ───────────────────────────────────────────────────

CREATE TABLE images_chambres (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chambre_id UUID NOT NULL REFERENCES chambres(id) ON DELETE CASCADE,
  url_fichier VARCHAR(500) NOT NULL,
  nom_fichier VARCHAR(255),
  taille_octets INTEGER,
  est_principale BOOLEAN DEFAULT FALSE,
  ordre INTEGER DEFAULT 0,
  legende VARCHAR(255),
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  -- Max 7 images par chambre appliqué au niveau applicatif
  CONSTRAINT max_7_images CHECK (ordre <= 6)
);

-- ── CLIENTS ───────────────────────────────────────────────────────────

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titre VARCHAR(20), -- M., Mme, Dr, Prof.
  prenom VARCHAR(100) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  mot_de_passe_hash VARCHAR(255), -- Pour portail client
  telephone VARCHAR(50),
  indicatif_pays VARCHAR(10) DEFAULT '+237',
  nationalite VARCHAR(100),
  pays_residence VARCHAR(100),
  date_naissance DATE,
  type_document VARCHAR(50), -- passeport, carte_nationale, permis_sejour
  numero_document VARCHAR(100),
  date_expiration_document DATE,
  adresse TEXT,
  ville VARCHAR(100),
  code_postal VARCHAR(20),
  segment VARCHAR(50) DEFAULT 'standard', -- standard, vip, corporate, groupe
  points_fidelite INTEGER DEFAULT 0,
  niveau_fidelite VARCHAR(50) DEFAULT 'bronze', -- bronze, argent, or, platine
  nombre_sejours INTEGER DEFAULT 0,
  revenu_total DECIMAL(12,2) DEFAULT 0,
  devise_revenu VARCHAR(10) DEFAULT 'XAF',
  preferences JSONB DEFAULT '{}',
  notes_internes TEXT,
  actif BOOLEAN DEFAULT TRUE,
  email_verifie BOOLEAN DEFAULT FALSE,
  token_verification VARCHAR(255),
  token_reinit_mdp VARCHAR(255),
  derniere_connexion TIMESTAMPTZ,
  source_acquisition VARCHAR(100) DEFAULT 'direct',
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── RÉSERVATIONS ──────────────────────────────────────────────────────

CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  chambre_id UUID REFERENCES chambres(id) ON DELETE SET NULL,
  numero_reservation VARCHAR(50) UNIQUE NOT NULL,
  statut statut_reservation DEFAULT 'confirmee',
  date_arrivee DATE NOT NULL,
  date_depart DATE NOT NULL,
  nombre_nuits INTEGER GENERATED ALWAYS AS (date_depart - date_arrivee) STORED,
  nombre_adultes INTEGER DEFAULT 2,
  nombre_enfants INTEGER DEFAULT 0,
  tarif_nuit DECIMAL(10,2) NOT NULL,
  devise VARCHAR(10) DEFAULT 'XAF',
  total_hebergement DECIMAL(12,2),
  total_extras DECIMAL(12,2) DEFAULT 0,
  total_taxes DECIMAL(12,2) DEFAULT 0,
  total_general DECIMAL(12,2),
  source VARCHAR(100) DEFAULT 'direct', -- direct, booking, expedia, phone, online
  code_promo VARCHAR(50),
  reduction_pct DECIMAL(5,2) DEFAULT 0,
  regime_repas VARCHAR(50) DEFAULT 'chambre_seule', -- chambre_seule, bb, demi_pension, pension_complete
  arrivee_prevue TIME,
  heure_arrivee_reelle TIMESTAMPTZ,
  heure_depart_reelle TIMESTAMPTZ,
  qr_token VARCHAR(255), -- Token portail chambre
  qr_token_actif BOOLEAN DEFAULT FALSE,
  checkin_en_ligne BOOLEAN DEFAULT FALSE,
  preferences_client TEXT,
  notes_internes TEXT,
  confirmee_par UUID REFERENCES utilisateurs(id),
  creee_par UUID REFERENCES utilisateurs(id),
  annulee_par UUID REFERENCES utilisateurs(id),
  raison_annulation TEXT,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

-- Index critiques réservations
CREATE INDEX idx_reservations_hotel ON reservations(hotel_id);
CREATE INDEX idx_reservations_dates ON reservations(date_arrivee, date_depart);
CREATE INDEX idx_reservations_statut ON reservations(statut);
CREATE INDEX idx_reservations_chambre ON reservations(chambre_id);
CREATE INDEX idx_reservations_client ON reservations(client_id);
CREATE INDEX idx_reservations_numero ON reservations(numero_reservation);

-- ── EXTRAS RÉSERVATION ────────────────────────────────────────────────

CREATE TABLE extras_reservation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  type_extra VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantite INTEGER DEFAULT 1,
  prix_unitaire DECIMAL(10,2) NOT NULL,
  montant_total DECIMAL(12,2),
  date_consommation DATE DEFAULT CURRENT_DATE,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── FOLIOS (Compte client) ────────────────────────────────────────────

CREATE TABLE folios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES hotels(id),
  client_id UUID REFERENCES clients(id),
  numero_folio VARCHAR(50) UNIQUE NOT NULL,
  statut VARCHAR(50) DEFAULT 'ouvert', -- ouvert, cloture
  solde_total DECIMAL(12,2) DEFAULT 0,
  devise VARCHAR(10) DEFAULT 'XAF',
  cloture_le TIMESTAMPTZ,
  cloture_par UUID REFERENCES utilisateurs(id),
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE lignes_folio (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  folio_id UUID NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  type_ligne type_extra_folio DEFAULT 'autre',
  description VARCHAR(255) NOT NULL,
  quantite INTEGER DEFAULT 1,
  prix_unitaire DECIMAL(10,2) NOT NULL,
  montant_total DECIMAL(12,2) NOT NULL,
  date_facturation DATE DEFAULT CURRENT_DATE,
  reference_externe UUID, -- ID commande resto, etc.
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── PAIEMENTS ─────────────────────────────────────────────────────────

CREATE TABLE paiements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  folio_id UUID REFERENCES folios(id) ON DELETE SET NULL,
  hotel_id UUID NOT NULL REFERENCES hotels(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  type_paiement type_paiement NOT NULL DEFAULT 'carte',
  statut statut_paiement DEFAULT 'en_attente',
  montant DECIMAL(12,2) NOT NULL,
  devise VARCHAR(10) DEFAULT 'XAF',
  reference_externe VARCHAR(255),
  methode_detail JSONB DEFAULT '{}',
  reçu_numero VARCHAR(50),
  notes TEXT,
  traite_par UUID REFERENCES utilisateurs(id),
  traite_le TIMESTAMPTZ DEFAULT NOW(),
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── FACTURES ──────────────────────────────────────────────────────────

CREATE TABLE factures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id),
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  numero_facture VARCHAR(50) UNIQUE NOT NULL,
  type_modele VARCHAR(50) DEFAULT 'classique', -- classique, moderne, detaillee, compacte
  statut VARCHAR(50) DEFAULT 'emise', -- brouillon, emise, payee, annulee
  date_emission DATE DEFAULT CURRENT_DATE,
  date_echeance DATE,
  montant_ht DECIMAL(12,2) NOT NULL,
  montant_taxes DECIMAL(12,2) DEFAULT 0,
  montant_ttc DECIMAL(12,2) NOT NULL,
  devise VARCHAR(10) DEFAULT 'XAF',
  lignes JSONB NOT NULL DEFAULT '[]',
  notes_client TEXT,
  notes_internes TEXT,
  url_pdf TEXT,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── TAXES ─────────────────────────────────────────────────────────────

CREATE TABLE taxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  nom VARCHAR(100) NOT NULL,
  code VARCHAR(50) NOT NULL,
  type_taxe type_taxe DEFAULT 'pourcentage',
  valeur DECIMAL(10,4) NOT NULL,
  s_applique_a VARCHAR(100) DEFAULT 'tout', -- tout, hebergement, services, restaurant
  incluse_prix BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  ordre INTEGER DEFAULT 0,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── DEVISES ───────────────────────────────────────────────────────────

CREATE TABLE taux_change (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  devise_base VARCHAR(10) DEFAULT 'XAF',
  devise_cible VARCHAR(10) NOT NULL,
  taux DECIMAL(15,6) NOT NULL,
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── HOUSEKEEPING ──────────────────────────────────────────────────────

CREATE TABLE taches_menage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  chambre_id UUID NOT NULL REFERENCES chambres(id) ON DELETE CASCADE,
  assignee_a UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  superviseur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  statut statut_tache_hk DEFAULT 'ouverte',
  priorite priorite DEFAULT 'normale',
  type_tache VARCHAR(100) DEFAULT 'nettoyage_complet',
  description TEXT,
  heure_debut TIMESTAMPTZ,
  heure_fin TIMESTAMPTZ,
  duree_minutes INTEGER GENERATED ALWAYS AS (
    CASE WHEN heure_debut IS NOT NULL AND heure_fin IS NOT NULL
    THEN EXTRACT(EPOCH FROM (heure_fin - heure_debut)) / 60
    ELSE NULL END
  ) STORED,
  notes TEXT,
  notes_superviseur TEXT,
  photos_apres JSONB DEFAULT '[]',
  date_tache DATE DEFAULT CURRENT_DATE,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_taches_menage_hotel ON taches_menage(hotel_id);
CREATE INDEX idx_taches_menage_chambre ON taches_menage(chambre_id);
CREATE INDEX idx_taches_menage_assignee ON taches_menage(assignee_a);
CREATE INDEX idx_taches_menage_statut ON taches_menage(statut);
CREATE INDEX idx_taches_menage_date ON taches_menage(date_tache);

-- ── TICKETS MAINTENANCE ───────────────────────────────────────────────

CREATE TABLE tickets_maintenance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  chambre_id UUID REFERENCES chambres(id) ON DELETE SET NULL,
  signale_par UUID REFERENCES utilisateurs(id),
  assigne_a UUID REFERENCES utilisateurs(id),
  superviseur_id UUID REFERENCES utilisateurs(id),
  numero_ticket VARCHAR(50) UNIQUE NOT NULL,
  statut statut_ticket_maintenance DEFAULT 'ouvert',
  priorite priorite DEFAULT 'normale',
  categorie VARCHAR(100) NOT NULL, -- climatisation, plomberie, electricite, mobilier, autre
  titre VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  hors_service BOOLEAN DEFAULT FALSE,
  heure_debut TIMESTAMPTZ,
  heure_resolution TIMESTAMPTZ,
  diagnostic TEXT,
  pieces_utilisees TEXT,
  duree_intervention_minutes INTEGER,
  cout_reparation DECIMAL(10,2),
  photos JSONB DEFAULT '[]',
  notes_technicien TEXT,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickets_hotel ON tickets_maintenance(hotel_id);
CREATE INDEX idx_tickets_statut ON tickets_maintenance(statut);
CREATE INDEX idx_tickets_priorite ON tickets_maintenance(priorite);

-- ── RESTAURANT - COMMANDES ────────────────────────────────────────────

CREATE TABLE commandes_restaurant (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  chambre_id UUID REFERENCES chambres(id) ON DELETE SET NULL,
  serveur_id UUID REFERENCES utilisateurs(id),
  numero_commande VARCHAR(50) UNIQUE NOT NULL,
  type_client VARCHAR(50) DEFAULT 'walk_in', -- walk_in, chambre, bar
  numero_table VARCHAR(20),
  numero_chambre VARCHAR(20),
  statut statut_commande DEFAULT 'nouvelle',
  sous_total DECIMAL(12,2) DEFAULT 0,
  taxes DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) DEFAULT 0,
  devise VARCHAR(10) DEFAULT 'XAF',
  mode_paiement type_paiement,
  debitee_folio BOOLEAN DEFAULT FALSE,
  notes TEXT,
  heure_commande TIMESTAMPTZ DEFAULT NOW(),
  heure_preparation TIMESTAMPTZ,
  heure_prete TIMESTAMPTZ,
  heure_servie TIMESTAMPTZ,
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  mis_a_jour_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE lignes_commande (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commande_id UUID NOT NULL REFERENCES commandes_restaurant(id) ON DELETE CASCADE,
  nom_article VARCHAR(255) NOT NULL,
  categorie VARCHAR(100),
  quantite INTEGER DEFAULT 1,
  prix_unitaire DECIMAL(10,2) NOT NULL,
  montant_total DECIMAL(12,2) NOT NULL,
  notes VARCHAR(255),
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── MENU RESTAURANT ───────────────────────────────────────────────────

CREATE TABLE articles_menu (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  categorie VARCHAR(100) NOT NULL,
  nom VARCHAR(255) NOT NULL,
  description TEXT,
  prix DECIMAL(10,2) NOT NULL,
  devise VARCHAR(10) DEFAULT 'XAF',
  disponible BOOLEAN DEFAULT TRUE,
  image_url TEXT,
  ordre INTEGER DEFAULT 0,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── SESSIONS CHAMBRE QR ───────────────────────────────────────────────

CREATE TABLE sessions_chambre (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  chambre_id UUID NOT NULL REFERENCES chambres(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  expire_le TIMESTAMPTZ NOT NULL,
  ip_creation INET,
  derniere_activite TIMESTAMPTZ DEFAULT NOW(),
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON sessions_chambre(token);
CREATE INDEX idx_sessions_actif ON sessions_chambre(actif);

-- ── ANALYTICS JOURNALIÈRES ────────────────────────────────────────────

CREATE TABLE analytics_quotidiennes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  taux_occupation DECIMAL(5,2) DEFAULT 0,
  chambres_occupees INTEGER DEFAULT 0,
  chambres_disponibles INTEGER DEFAULT 0,
  adr DECIMAL(10,2) DEFAULT 0, -- Average Daily Rate
  revpar DECIMAL(10,2) DEFAULT 0, -- Revenue Per Available Room
  revenu_hebergement DECIMAL(12,2) DEFAULT 0,
  revenu_restaurant DECIMAL(12,2) DEFAULT 0,
  revenu_extras DECIMAL(12,2) DEFAULT 0,
  revenu_total DECIMAL(12,2) DEFAULT 0,
  arrivees INTEGER DEFAULT 0,
  departs INTEGER DEFAULT 0,
  reservations_nouvelles INTEGER DEFAULT 0,
  annulations INTEGER DEFAULT 0,
  no_shows INTEGER DEFAULT 0,
  devise VARCHAR(10) DEFAULT 'XAF',
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, date)
);

CREATE TABLE analytics_mensuelles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  annee INTEGER NOT NULL,
  mois INTEGER NOT NULL CHECK (mois BETWEEN 1 AND 12),
  taux_occupation_moyen DECIMAL(5,2) DEFAULT 0,
  adr_moyen DECIMAL(10,2) DEFAULT 0,
  revpar_moyen DECIMAL(10,2) DEFAULT 0,
  revenu_total DECIMAL(14,2) DEFAULT 0,
  nombre_reservations INTEGER DEFAULT 0,
  nombre_nuits INTEGER DEFAULT 0,
  taux_annulation DECIMAL(5,2) DEFAULT 0,
  taux_no_show DECIMAL(5,2) DEFAULT 0,
  duree_sejour_moyenne DECIMAL(5,2) DEFAULT 0,
  donnees_sources JSONB DEFAULT '{}',
  cree_le TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_id, annee, mois)
);

-- ── IA - ALERTES & RECOMMANDATIONS ───────────────────────────────────

CREATE TABLE alertes_ia (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL, -- occupation, maintenance, housekeeping, finance, satisfaction
  titre VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severite VARCHAR(50) DEFAULT 'info', -- info, avertissement, critique
  donnees JSONB DEFAULT '{}',
  lue BOOLEAN DEFAULT FALSE,
  lue_par UUID REFERENCES utilisateurs(id),
  lue_le TIMESTAMPTZ,
  expire_le TIMESTAMPTZ,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recommandations_ia (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  titre VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  impact VARCHAR(100),
  priorite priorite DEFAULT 'normale',
  action_lien VARCHAR(255),
  implementee BOOLEAN DEFAULT FALSE,
  implementee_par UUID REFERENCES utilisateurs(id),
  implementee_le TIMESTAMPTZ,
  donnees_contexte JSONB DEFAULT '{}',
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE historique_ia (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotel_id UUID NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  utilisateur_id UUID REFERENCES utilisateurs(id),
  message_utilisateur TEXT NOT NULL,
  reponse_ia TEXT NOT NULL,
  tokens_utilises INTEGER,
  duree_ms INTEGER,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

-- ── LOGS D'AUDIT ──────────────────────────────────────────────────────

CREATE TABLE logs_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  hotel_id UUID REFERENCES hotels(id),
  utilisateur_id UUID REFERENCES utilisateurs(id),
  action VARCHAR(100) NOT NULL,
  module VARCHAR(100),
  ressource_type VARCHAR(100),
  ressource_id UUID,
  anciennes_valeurs JSONB,
  nouvelles_valeurs JSONB,
  ip_address INET,
  user_agent TEXT,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON logs_audit(tenant_id);
CREATE INDEX idx_audit_hotel ON logs_audit(hotel_id);
CREATE INDEX idx_audit_utilisateur ON logs_audit(utilisateur_id);
CREATE INDEX idx_audit_date ON logs_audit(cree_le);

-- ── FONCTIONS & TRIGGERS ──────────────────────────────────────────────

-- Mise à jour automatique de mis_a_jour_le
CREATE OR REPLACE FUNCTION mettre_a_jour_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.mis_a_jour_le = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Appliquer le trigger à toutes les tables concernées
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','abonnements','hotels','parametres_hotel','utilisateurs','chambres','reservations','taches_menage','tickets_maintenance','commandes_restaurant','factures','clients']
  LOOP
    EXECUTE format('CREATE TRIGGER trigger_maj_timestamp BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION mettre_a_jour_timestamp()', t);
  END LOOP;
END;
$$;

-- Génération automatique numéro réservation
CREATE OR REPLACE FUNCTION generer_numero_reservation()
RETURNS TRIGGER AS $$
DECLARE
  prefix TEXT := 'RES';
  annee TEXT := TO_CHAR(NOW(), 'YY');
  sequence_num TEXT;
BEGIN
  SELECT LPAD(COUNT(*)::TEXT + 1, 6, '0')
  INTO sequence_num
  FROM reservations
  WHERE hotel_id = NEW.hotel_id
    AND EXTRACT(YEAR FROM cree_le) = EXTRACT(YEAR FROM NOW());
  NEW.numero_reservation := prefix || annee || sequence_num;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_numero_reservation
  BEFORE INSERT ON reservations
  FOR EACH ROW
  WHEN (NEW.numero_reservation IS NULL OR NEW.numero_reservation = '')
  EXECUTE FUNCTION generer_numero_reservation();

-- Génération numéro facture
CREATE OR REPLACE FUNCTION generer_numero_facture()
RETURNS TRIGGER AS $$
DECLARE
  annee TEXT := TO_CHAR(NOW(), 'YYYY');
  seq TEXT;
BEGIN
  SELECT LPAD(COUNT(*)::TEXT + 1, 4, '0')
  INTO seq
  FROM factures
  WHERE hotel_id = NEW.hotel_id
    AND EXTRACT(YEAR FROM cree_le) = EXTRACT(YEAR FROM NOW());
  NEW.numero_facture := 'FAC-' || annee || '-' || seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_numero_facture
  BEFORE INSERT ON factures
  FOR EACH ROW
  WHEN (NEW.numero_facture IS NULL OR NEW.numero_facture = '')
  EXECUTE FUNCTION generer_numero_facture();

-- Génération numéro ticket maintenance
CREATE OR REPLACE FUNCTION generer_numero_ticket()
RETURNS TRIGGER AS $$
DECLARE seq TEXT;
BEGIN
  SELECT LPAD(COUNT(*)::TEXT + 1, 3, '0') INTO seq FROM tickets_maintenance WHERE hotel_id = NEW.hotel_id;
  NEW.numero_ticket := 'TKT-' || TO_CHAR(NOW(), 'YY') || seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_numero_ticket
  BEFORE INSERT ON tickets_maintenance
  FOR EACH ROW
  WHEN (NEW.numero_ticket IS NULL OR NEW.numero_ticket = '')
  EXECUTE FUNCTION generer_numero_ticket();

-- Génération numéro commande
CREATE OR REPLACE FUNCTION generer_numero_commande()
RETURNS TRIGGER AS $$
DECLARE seq TEXT;
BEGIN
  SELECT LPAD(COUNT(*)::TEXT + 1, 5, '0') INTO seq FROM commandes_restaurant WHERE hotel_id = NEW.hotel_id AND DATE(cree_le) = CURRENT_DATE;
  NEW.numero_commande := 'CMD-' || TO_CHAR(NOW(), 'YYMMDD') || '-' || seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_numero_commande
  BEFORE INSERT ON commandes_restaurant
  FOR EACH ROW
  WHEN (NEW.numero_commande IS NULL OR NEW.numero_commande = '')
  EXECUTE FUNCTION generer_numero_commande();

-- ── VUES UTILES ───────────────────────────────────────────────────────

CREATE VIEW vue_reservations_actives AS
SELECT
  r.*,
  c.prenom || ' ' || c.nom AS nom_client,
  c.email AS email_client,
  c.telephone AS telephone_client,
  ch.numero AS numero_chambre,
  ch.etage,
  tc.nom AS type_chambre
FROM reservations r
LEFT JOIN clients c ON r.client_id = c.id
LEFT JOIN chambres ch ON r.chambre_id = ch.id
LEFT JOIN types_chambre tc ON ch.type_chambre_id = tc.id
WHERE r.statut NOT IN ('annulee','no_show');

CREATE VIEW vue_taux_occupation AS
SELECT
  h.id AS hotel_id,
  h.nom AS hotel,
  COUNT(ch.id) AS total_chambres,
  COUNT(CASE WHEN ch.statut = 'occupee' THEN 1 END) AS chambres_occupees,
  ROUND(COUNT(CASE WHEN ch.statut = 'occupee' THEN 1 END) * 100.0 / NULLIF(COUNT(ch.id), 0), 2) AS taux_occupation
FROM hotels h
LEFT JOIN chambres ch ON ch.hotel_id = h.id AND NOT ch.hors_service
GROUP BY h.id, h.nom;
