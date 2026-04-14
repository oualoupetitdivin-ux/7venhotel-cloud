-- ═══════════════════════════════════════════════════════════════════════
-- 7venHotel Cloud — Données initiales (Seed)
-- ═══════════════════════════════════════════════════════════════════════

-- ── PERMISSIONS SYSTÈME ───────────────────────────────────────────────

INSERT INTO permissions (code, description, module, action) VALUES
-- Réservations
('reservations.lire',      'Voir les réservations',         'reservations', 'lire'),
('reservations.creer',     'Créer une réservation',         'reservations', 'creer'),
('reservations.modifier',  'Modifier une réservation',      'reservations', 'modifier'),
('reservations.supprimer', 'Supprimer une réservation',     'reservations', 'supprimer'),
('reservations.annuler',   'Annuler une réservation',       'reservations', 'administrer'),
-- Chambres
('chambres.lire',          'Voir les chambres',             'chambres', 'lire'),
('chambres.modifier',      'Modifier une chambre',          'chambres', 'modifier'),
('chambres.administrer',   'Administrer les chambres',      'chambres', 'administrer'),
-- Clients
('clients.lire',           'Voir les clients',              'clients', 'lire'),
('clients.creer',          'Créer un client',               'clients', 'creer'),
('clients.modifier',       'Modifier un client',            'clients', 'modifier'),
-- Ménage
('menage.lire',            'Voir les tâches ménage',        'menage', 'lire'),
('menage.creer',           'Créer une tâche ménage',        'menage', 'creer'),
('menage.modifier',        'Modifier une tâche ménage',     'menage', 'modifier'),
('menage.valider',         'Valider le ménage',             'menage', 'administrer'),
-- Maintenance
('maintenance.lire',       'Voir les tickets',              'maintenance', 'lire'),
('maintenance.creer',      'Créer un ticket',               'maintenance', 'creer'),
('maintenance.modifier',   'Modifier un ticket',            'maintenance', 'modifier'),
-- Restaurant
('restaurant.lire',        'Voir les commandes',            'restaurant', 'lire'),
('restaurant.creer',       'Créer une commande',            'restaurant', 'creer'),
('restaurant.modifier',    'Modifier une commande',         'restaurant', 'modifier'),
-- Facturation
('facturation.lire',       'Voir les factures',             'facturation', 'lire'),
('facturation.creer',      'Créer une facture',             'facturation', 'creer'),
('facturation.modifier',   'Modifier une facture',          'facturation', 'modifier'),
-- Analytics
('analytics.lire',         'Voir les statistiques',         'analytics', 'lire'),
-- Paramètres
('parametres.lire',        'Voir les paramètres',           'parametres', 'lire'),
('parametres.modifier',    'Modifier les paramètres',       'parametres', 'modifier'),
-- Staff
('staff.lire',             'Voir le personnel',             'staff', 'lire'),
('staff.administrer',      'Gérer le personnel',            'staff', 'administrer'),
-- Plateforme
('plateforme.administrer', 'Administrer la plateforme',     'plateforme', 'administrer');

-- ── PERMISSIONS PAR RÔLE ──────────────────────────────────────────────

-- Super Admin : toutes les permissions
INSERT INTO role_permissions (role, permission_id)
SELECT 'super_admin', id FROM permissions;

-- Manager : presque tout sauf administration plateforme
INSERT INTO role_permissions (role, permission_id)
SELECT 'manager', id FROM permissions
WHERE code NOT IN ('plateforme.administrer');

-- Réception
INSERT INTO role_permissions (role, permission_id)
SELECT 'reception', id FROM permissions
WHERE code IN ('reservations.lire','reservations.creer','reservations.modifier','reservations.annuler',
               'chambres.lire','clients.lire','clients.creer','clients.modifier',
               'maintenance.creer','restaurant.creer','facturation.lire','menage.lire');

-- Housekeeping
INSERT INTO role_permissions (role, permission_id)
SELECT 'housekeeping', id FROM permissions
WHERE code IN ('menage.lire','menage.creer','menage.modifier','menage.valider','chambres.lire');

-- Restaurant
INSERT INTO role_permissions (role, permission_id)
SELECT 'restaurant', id FROM permissions
WHERE code IN ('restaurant.lire','restaurant.creer','restaurant.modifier',
               'facturation.lire','reservations.lire');

-- Comptabilité
INSERT INTO role_permissions (role, permission_id)
SELECT 'comptabilite', id FROM permissions
WHERE code IN ('facturation.lire','facturation.creer','facturation.modifier',
               'analytics.lire','reservations.lire','clients.lire');

-- Technicien
INSERT INTO role_permissions (role, permission_id)
SELECT 'technicien', id FROM permissions
WHERE code IN ('maintenance.lire','maintenance.creer','maintenance.modifier','chambres.lire');

-- ── TENANT DÉMO ───────────────────────────────────────────────────────

INSERT INTO tenants (id, nom, slug, email_contact, telephone, adresse, pays, devise_defaut) VALUES
('11111111-1111-1111-1111-111111111111',
 'Groupe Hôtelier Royal Cameroun',
 'royal-cameroun',
 'admin@royalcameroun.cm',
 '+237 222 000 000',
 'Rue Charles de Gaulle, Yaoundé',
 'Cameroun',
 'XAF');

-- ── ABONNEMENT DÉMO ───────────────────────────────────────────────────

INSERT INTO abonnements (tenant_id, plan, statut, date_debut, max_hotels, max_chambres, max_utilisateurs) VALUES
('11111111-1111-1111-1111-111111111111', 'enterprise', 'actif', CURRENT_DATE, 5, 500, 50);

-- ── HÔTEL DÉMO ────────────────────────────────────────────────────────

INSERT INTO hotels (id, tenant_id, nom, slug, description, adresse, ville, pays, telephone, email, nombre_etoiles, nombre_chambres, nombre_etages) VALUES
('22222222-2222-2222-2222-222222222222',
 '11111111-1111-1111-1111-111111111111',
 'Hôtel Royal Yaoundé',
 'hotel-royal-yaounde',
 'Hôtel 5 étoiles au cœur de Yaoundé offrant un cadre d''exception alliant modernité et hospitalité africaine.',
 'Avenue Kennedy, Centre-ville',
 'Yaoundé',
 'Cameroun',
 '+237 222 123 456',
 'reception@royalyaounde.cm',
 5,
 142,
 5);

-- Paramètres hôtel
INSERT INTO parametres_hotel (hotel_id, devise, fuseau_horaire, heure_arrivee, heure_depart, tva_numero) VALUES
('22222222-2222-2222-2222-222222222222', 'XAF', 'Africa/Douala', '14:00:00', '12:00:00', 'CM-TXP-2024-001');

-- ── SUPER ADMIN ───────────────────────────────────────────────────────
-- Mot de passe: Admin@2024! (bcrypt hash - sera remplacé au démarrage)

INSERT INTO utilisateurs (id, tenant_id, hotel_id, email, mot_de_passe_hash, prenom, nom, role) VALUES
('33333333-3333-3333-3333-333333333333',
 '11111111-1111-1111-1111-111111111111',
 '22222222-2222-2222-2222-222222222222',
 'superadmin@demo.com',
 '$2b$12$placeholder_will_be_updated_by_setup_script',
 'Super',
 'Admin',
 'super_admin');

-- Utilisateurs démo
INSERT INTO utilisateurs (tenant_id, hotel_id, email, mot_de_passe_hash, prenom, nom, role) VALUES
('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
 'manager@demo.com', '$2b$12$placeholder', 'Marie', 'Laurent', 'manager'),
('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
 'reception@demo.com', '$2b$12$placeholder', 'Pierre', 'Moreau', 'reception'),
('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
 'housekeeping@demo.com', '$2b$12$placeholder', 'Fatou', 'Diallo', 'housekeeping'),
('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
 'restaurant@demo.com', '$2b$12$placeholder', 'Jean-Luc', 'Baron', 'restaurant'),
('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
 'accounting@demo.com', '$2b$12$placeholder', 'Sophie', 'Renard', 'comptabilite');

-- ── TYPES DE CHAMBRE ──────────────────────────────────────────────────

INSERT INTO types_chambre (hotel_id, nom, description, capacite_adultes, superficie_m2, tarif_base, devise) VALUES
('22222222-2222-2222-2222-222222222222', 'Standard', 'Chambre confortable et fonctionnelle', 2, 18, 22000, 'XAF'),
('22222222-2222-2222-2222-222222222222', 'Standard Twin', 'Chambre avec 2 lits simples', 2, 20, 24000, 'XAF'),
('22222222-2222-2222-2222-222222222222', 'Supérieure', 'Chambre spacieuse avec lit king', 2, 24, 28000, 'XAF'),
('22222222-2222-2222-2222-222222222222', 'Deluxe', 'Chambre de luxe avec balcon piscine', 2, 32, 38000, 'XAF'),
('22222222-2222-2222-2222-222222222222', 'Junior Suite', 'Suite avec salon séparé', 3, 45, 55000, 'XAF'),
('22222222-2222-2222-2222-222222222222', 'Suite Royale', 'Suite 2 chambres panoramique', 4, 72, 98000, 'XAF'),
('22222222-2222-2222-2222-222222222222', 'Suite Présidentielle', 'Suite 3 chambres exclusive', 6, 110, 150000, 'XAF');

-- ── TAXES ─────────────────────────────────────────────────────────────

INSERT INTO taxes (hotel_id, nom, code, type_taxe, valeur, s_applique_a, incluse_prix, active, ordre) VALUES
('22222222-2222-2222-2222-222222222222', 'TVA Hôtellerie', 'TVA_HOTEL', 'pourcentage', 19.25, 'hebergement', false, true, 1),
('22222222-2222-2222-2222-222222222222', 'Taxe de séjour', 'TAXE_SEJOUR', 'fixe', 500, 'hebergement', false, true, 2),
('22222222-2222-2222-2222-222222222222', 'Service', 'SERVICE', 'pourcentage', 10, 'restaurant', false, true, 3),
('22222222-2222-2222-2222-222222222222', 'TVA Restaurant', 'TVA_RESTO', 'pourcentage', 19.25, 'restaurant', false, true, 4);

-- ── TAUX DE CHANGE ────────────────────────────────────────────────────

INSERT INTO taux_change (devise_base, devise_cible, taux) VALUES
('XAF', 'EUR', 0.001524),
('XAF', 'USD', 0.001657),
('XAF', 'GBP', 0.001302),
('XAF', 'XOF', 1.000000),
('XAF', 'MAD', 0.016654),
('XAF', 'NGN', 2.476300),
('XAF', 'ZAR', 0.031024),
('XAF', 'CAD', 0.002243),
('XAF', 'CHF', 0.001504),
('XAF', 'JPY', 0.251320),
('XAF', 'CNY', 0.012017);

-- ── MENU RESTAURANT DÉMO ──────────────────────────────────────────────

INSERT INTO articles_menu (hotel_id, categorie, nom, description, prix, devise, ordre) VALUES
-- Petit-déjeuner
('22222222-2222-2222-2222-222222222222', 'Petit-déjeuner', 'Omelette du chef', 'Herbes fraîches, tomates', 3500, 'XAF', 1),
('22222222-2222-2222-2222-222222222222', 'Petit-déjeuner', 'Plateau complet', 'Jus + œuf + viennoiserie + café', 6500, 'XAF', 2),
('22222222-2222-2222-2222-222222222222', 'Petit-déjeuner', 'Café ou thé', 'Chaud ou froid', 800, 'XAF', 3),
-- Entrées
('22222222-2222-2222-2222-222222222222', 'Entrées', 'Foie gras maison', 'Brioche toastée', 9500, 'XAF', 1),
('22222222-2222-2222-2222-222222222222', 'Entrées', 'Salade César', 'Poulet grillé, parmesan', 7500, 'XAF', 2),
('22222222-2222-2222-2222-222222222222', 'Entrées', 'Tartare saumon', 'Sauce citron', 8500, 'XAF', 3),
-- Plats
('22222222-2222-2222-2222-222222222222', 'Plats', 'Entrecôte grillée', 'Sauce béarnaise, frites', 18500, 'XAF', 1),
('22222222-2222-2222-2222-222222222222', 'Plats', 'Ndolé au bœuf', 'Spécialité camerounaise', 13500, 'XAF', 2),
('22222222-2222-2222-2222-222222888282', 'Plats', 'Poulet yassa', 'Recette du chef', 12000, 'XAF', 3),
('22222222-2222-2222-2222-222222222222', 'Plats', 'Tilapia braisé', 'Légumes grillés', 14000, 'XAF', 4),
-- Desserts
('22222222-2222-2222-2222-222222222222', 'Desserts', 'Crème brûlée', 'Vanille bourbon', 4800, 'XAF', 1),
('22222222-2222-2222-2222-222222222222', 'Desserts', 'Fondant chocolat', 'Cœur coulant', 4200, 'XAF', 2),
-- Boissons
('22222222-2222-2222-2222-222222222222', 'Boissons', 'Eau minérale', '50cl × 2', 1200, 'XAF', 1),
('22222222-2222-2222-2222-222222222222', 'Boissons', 'Jus de fruits frais', 'Orange ou ananas', 1800, 'XAF', 2),
('22222222-2222-2222-2222-222222222222', 'Boissons', 'Vin rouge', 'Bouteille 75cl', 8500, 'XAF', 3),
('22222222-2222-2222-2222-222222222222', 'Boissons', 'Bière locale', '33cl', 2000, 'XAF', 4);
