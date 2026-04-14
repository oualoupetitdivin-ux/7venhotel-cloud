# 7venHotel Cloud — Système de Gestion Hôtelière SaaS

> Plateforme hôtelière multi-tenant enterprise-grade · Langue par défaut : **Français** · Devise : **XAF**

---

## 📋 Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Prérequis](#prérequis)
3. [Installation rapide](#installation-rapide)
4. [Configuration détaillée](#configuration-détaillée)
5. [Base de données](#base-de-données)
6. [Démarrage](#démarrage)
7. [Déploiement Hostinger](#déploiement-hostinger)
8. [Architecture](#architecture)
9. [Comptes démo](#comptes-démo)
10. [Variables d'environnement](#variables-denvironnement)

---

## Vue d'ensemble

**7venHotel Cloud** est un système complet de gestion hôtelière (PMS) SaaS multi-tenant.

### Modules inclus

| Module | Description |
|--------|-------------|
| 🏨 **Staff Portal** | Tableau de bord, réservations, planning, chambres |
| 🌐 **Moteur Réservation** | Booking engine public avec paiement |
| 👤 **Portail Client** | Espace client avec réservations & factures |
| 📱 **Portail Chambre QR** | Accès via QR code dynamique |
| 🤖 **Ouwalou AI** | Assistant IA (Anthropic Claude) |
| 🧹 **Housekeeping** | Kanban + tâches agent |
| 🔧 **Maintenance** | Tickets avec workflow |
| 🍽 **Restaurant POS** | Caisse + KDS cuisine |
| 💳 **Facturation** | Factures PDF + taxes |
| 📊 **Analytique** | KPIs hôteliers complets |

### Stack technique

```
Frontend  : Next.js 14 + TailwindCSS + Chart.js
Backend   : Node.js + Fastify
Base de données : PostgreSQL
Cache     : Redis
IA        : Anthropic Claude (API)
```

---

## Prérequis

| Logiciel | Version minimale |
|----------|-----------------|
| Node.js  | 18.x ou supérieur |
| PostgreSQL | 14.x ou supérieur |
| Redis    | 6.x ou supérieur |
| npm      | 9.x ou supérieur |

---

## Installation rapide

```bash
# 1. Cloner / copier le projet
cd /public_html/ocs7venHotel

# 2. Lancer le setup automatique
node scripts/setup.js

# 3. Configurer la base de données dans .env
nano .env

# 4. Créer la base de données
createdb ocs7venhotel

# 5. Appliquer le schéma + données initiales
npm run db:migrate
npm run db:seed

# 6. Démarrer (développement)
npm run dev
```

L'application sera disponible sur :
- **Frontend** : http://localhost:3000
- **API** : http://localhost:3001

---

## Configuration détaillée

### 1. Créer le fichier .env

```bash
cp .env.example .env
nano .env
```

Les paramètres **obligatoires** à modifier :

```env
# Base de données (OBLIGATOIRE)
DB_HOST=localhost
DB_NAME=ocs7venhotel
DB_USER=votre_utilisateur_postgres
DB_PASSWORD=votre_mot_de_passe_postgres

# JWT (OBLIGATOIRE — généré automatiquement par setup.js)
JWT_SECRET=...
JWT_REFRESH_SECRET=...

# URL de production (OBLIGATOIRE)
APP_URL=https://votre-domaine.com
NEXT_PUBLIC_API_URL=https://votre-domaine.com/api/v1
```

Les paramètres **optionnels** (pour activer des fonctionnalités) :

```env
# IA Ouwalou (activer Ouwalou AI)
ANTHROPIC_API_KEY=sk-ant-...

# Email (pour les confirmations)
SMTP_HOST=smtp.hostinger.com
SMTP_USER=noreply@votre-domaine.com
SMTP_PASS=...
```

---

## Base de données

### Création

```bash
# Créer la base de données
sudo -u postgres psql -c "CREATE DATABASE ocs7venhotel;"
sudo -u postgres psql -c "CREATE USER ocs7venhotel_user WITH PASSWORD 'motdepasse';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ocs7venhotel TO ocs7venhotel_user;"
```

### Migration du schéma

```bash
npm run db:migrate
```

Ce script applique le fichier `database/migrations/001_schema_complet.sql` qui crée :
- 25+ tables PostgreSQL avec contraintes
- Types énumérés (statuts, priorités, rôles)
- Triggers automatiques (numérotation, timestamps)
- Vues utilitaires

### Données initiales

```bash
npm run db:seed
```

Crée :
- Tenant démo : *Groupe Hôtelier Royal Cameroun*
- Hôtel démo : *Hôtel Royal Yaoundé* (142 chambres, 5★)
- 6 comptes utilisateurs démo
- Permissions RBAC complètes
- Taxes (TVA 19.25%, taxe séjour, service)
- Menu restaurant (16 articles)
- Taux de change (11 devises)

---

## Démarrage

### Développement

```bash
# Les deux serveurs en parallèle
npm run dev

# Ou séparément :
cd backend  && npm run dev   # Port 3001
cd frontend && npm run dev   # Port 3000
```

### Production

```bash
# 1. Build du frontend
cd frontend && npm run build

# 2. Démarrer avec PM2
pm2 start ecosystem.config.js --env production

# 3. Sauvegarder la configuration PM2
pm2 save
pm2 startup
```

---

## Déploiement Hostinger

### Prérequis Hostinger VPS

1. **VPS Ubuntu 22.04** minimum (plan Business recommandé)
2. **Node.js 18+** installé
3. **PostgreSQL 14+** installé
4. **Redis 6+** installé
5. **Nginx** installé
6. **PM2** installé globalement : `npm install -g pm2`

### Étapes de déploiement

```bash
# 1. Transférer les fichiers (depuis votre machine locale)
scp -r ./public_html/ocs7venHotel user@votre-vps:/var/www/

# 2. Sur le serveur
ssh user@votre-vps
cd /var/www/ocs7venHotel

# 3. Setup
node scripts/setup.js

# 4. Configurer .env avec les vraies valeurs
nano .env

# 5. Database
createdb ocs7venhotel
npm run db:migrate
npm run db:seed

# 6. Build frontend
cd frontend && npm run build && cd ..

# 7. Nginx
sudo cp config/nginx.conf /etc/nginx/sites-available/7venhotel
# Modifier les chemins dans le fichier nginx.conf
sudo ln -s /etc/nginx/sites-available/7venhotel /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. SSL (Let's Encrypt)
sudo certbot --nginx -d votre-domaine.com

# 9. Démarrer avec PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### Vérification

```bash
# Status des services
pm2 status

# Logs en temps réel
pm2 logs

# Test API
curl https://votre-domaine.com/api/v1/health
```

---

## Architecture

```
public_html/ocs7venHotel/
├── frontend/                    # Next.js 14 App Router
│   └── src/
│       ├── app/                 # Pages (Auth, Dashboard, Modules...)
│       │   ├── auth/            # Connexion
│       │   ├── dashboard/       # Tableau de bord
│       │   ├── reservations/    # Gestion réservations
│       │   ├── menage/          # Housekeeping kanban
│       │   ├── restaurant/      # POS
│       │   ├── ai/              # Ouwalou AI
│       │   ├── booking/         # Moteur réservation public
│       │   ├── client-portal/   # Espace client
│       │   └── room-portal/     # Portail chambre QR
│       ├── components/          # Composants réutilisables
│       ├── lib/                 # API client, utils, store
│       └── locales/             # fr.json, en.json
│
├── backend/                     # Fastify API
│   └── src/
│       ├── server.js            # Point d'entrée
│       ├── plugins/             # DB, Redis, Auth
│       └── routes/              # 16 modules API
│           ├── auth.js          # JWT + sessions
│           ├── reservations.js  # CRUD + check-in/out + QR
│           ├── ai.js            # Ouwalou (Anthropic)
│           └── ...
│
├── database/
│   ├── migrations/              # Schema PostgreSQL
│   └── seeds/                   # Données initiales
│
├── uploads/                     # Fichiers uploadés
├── logs/                        # Journaux applicatifs
├── config/                      # Nginx, SSL
├── scripts/                     # Setup automatisé
├── .env.example                 # Template configuration
├── ecosystem.config.js          # Configuration PM2
└── README.md                    # Ce fichier
```

---

## Comptes démo

Après `npm run db:seed` :

| Email | Mot de passe | Rôle | Accès |
|-------|-------------|------|-------|
| superadmin@demo.com | demo123 | Super Admin | Plateforme complète |
| manager@demo.com | demo123 | Manager | Hôtel complet |
| reception@demo.com | demo123 | Réception | Réservations + clients |
| housekeeping@demo.com | demo123 | Housekeeping | Ménage + chambres |
| restaurant@demo.com | demo123 | Restaurant | POS + cuisine |
| accounting@demo.com | demo123 | Comptabilité | Facturation + analytique |

**Portail client** : http://localhost:3000/client-portal/connexion
- client@demo.com / demo123

**Moteur réservation** : http://localhost:3000/booking

**Portail chambre QR** : http://localhost:3000/room-portal/demo

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DB_HOST` | ✅ | Hôte PostgreSQL |
| `DB_NAME` | ✅ | Nom de la base |
| `DB_USER` | ✅ | Utilisateur PostgreSQL |
| `DB_PASSWORD` | ✅ | Mot de passe PostgreSQL |
| `JWT_SECRET` | ✅ | Secret JWT (min 64 car.) |
| `APP_URL` | ✅ | URL publique de l'app |
| `NEXT_PUBLIC_API_URL` | ✅ | URL de l'API backend |
| `ANTHROPIC_API_KEY` | ⚡ | Clé API Anthropic (Ouwalou) |
| `REDIS_HOST` | ⚡ | Hôte Redis (localhost par défaut) |
| `SMTP_HOST` | 📧 | Serveur SMTP (emails) |
| `DEFAULT_CURRENCY` | 📋 | Devise (défaut: XAF) |
| `DEFAULT_TIMEZONE` | 📋 | Fuseau (défaut: Africa/Douala) |
| `DEFAULT_LANGUAGE` | 📋 | Langue (défaut: fr) |

✅ = Obligatoire · ⚡ = Requis pour fonctionnalité · 📧 = Pour emails · 📋 = Optionnel (valeur par défaut)

---

## Support

- 📧 support@7venhotel.com
- 📖 Documentation : /help-center
- 🤖 Assistant IA : /ai (Ouwalou)

---

*7venHotel Cloud v1.0.0 — Système de Gestion Hôtelière SaaS Multi-tenant*
*Langue par défaut : Français · Devise : XAF · Fuseau : Africa/Douala*
