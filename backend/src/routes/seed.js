'use strict'

const bcrypt = require('bcryptjs')
const { Client } = require('pg')

module.exports = async function seedRoute(fastify) {

  fastify.post('/seed-init', async (request, reply) => {
    const { secret } = request.body || {}
    if (secret !== 'seed-7venhotel-2026') {
      return reply.status(403).send({ erreur: 'Secret invalide' })
    }

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })

    const logs = []

    try {
      await client.connect()
      logs.push('✅ Connecté')

      const adminHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || 'Admin@2024!', 12)
      const demoHash  = await bcrypt.hash('demo123', 12)

      // ── UTILISATEURS ──────────────────────────────────────────────
      const users = [
        ['33333333-3333-3333-3333-333333333333', 'superadmin@demo.com', adminHash, 'Super', 'Admin', 'super_admin'],
        ['44444444-4444-4444-4444-444444444444', 'manager@demo.com',    demoHash,  'Marie', 'Laurent',  'manager'],
        ['55555555-5555-5555-5555-555555555555', 'reception@demo.com',  demoHash,  'Pierre','Moreau',   'reception'],
        ['66666666-6666-6666-6666-666666666666', 'housekeeping@demo.com',demoHash, 'Fatou', 'Diallo',   'housekeeping'],
        ['77777777-7777-7777-7777-777777777777', 'restaurant@demo.com', demoHash,  'Jean',  'Baron',    'restaurant'],
        ['88888888-8888-8888-8888-888888888888', 'accounting@demo.com', demoHash,  'Sophie','Renard',   'comptabilite'],
      ]
      for (const [id, email, hash, prenom, nom, role] of users) {
        await client.query(`
          INSERT INTO utilisateurs (id, tenant_id, hotel_id, email, mot_de_passe_hash, prenom, nom, role, actif)
          VALUES ($1,'11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',$2,$3,$4,$5,$6,true)
          ON CONFLICT (id) DO UPDATE SET mot_de_passe_hash = $3, actif = true
        `, [id, email, hash, prenom, nom, role])
      }
      logs.push('✅ 6 utilisateurs créés')

      // ── TYPES DE CHAMBRE ──────────────────────────────────────────
      const typesChambre = [
        ['tc-std-001', 'Standard', 'Chambre confortable avec vue sur jardin', 2, 45000, 1],
        ['tc-sup-001', 'Supérieure', 'Chambre spacieuse avec vue partielle ville', 2, 65000, 2],
        ['tc-del-001', 'Deluxe', 'Chambre luxueuse avec balcon et vue ville', 2, 85000, 2],
        ['tc-jun-001', 'Junior Suite', 'Suite avec salon séparé', 3, 120000, 3],
        ['tc-exe-001', 'Suite Exécutive', 'Suite prestige avec jacuzzi et terrasse', 2, 200000, 4],
        ['tc-pre-001', 'Suite Présidentielle', 'Suite royale avec butler service', 4, 400000, 5],
      ]
      for (const [id, nom, desc, capacite, tarif, etoiles] of typesChambre) {
        await client.query(`
  INSERT INTO types_chambre (id, hotel_id, nom, description, capacite_adultes, tarif_base)
  VALUES ($1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5)
  ON CONFLICT (id) DO NOTHING
`, [id, nom, desc, capacite, tarif])
      }
      logs.push('✅ 6 types de chambre créés')

      // ── CHAMBRES ──────────────────────────────────────────────────
      const chambres = [
        // Étage 1 - Standard
        ['ch-101','101',1,'tc-std-001','libre_propre'],
        ['ch-102','102',1,'tc-std-001','occupee'],
        ['ch-103','103',1,'tc-std-001','libre_propre'],
        ['ch-104','104',1,'tc-std-001','sale'],
        ['ch-105','105',1,'tc-std-001','libre_propre'],
        // Étage 2 - Supérieure
        ['ch-201','201',2,'tc-sup-001','libre_propre'],
        ['ch-202','202',2,'tc-sup-001','occupee'],
        ['ch-203','203',2,'tc-sup-001','libre_propre'],
        ['ch-204','204',2,'tc-del-001','libre_propre'],
        ['ch-205','205',2,'tc-del-001','nettoyage'],
        // Étage 3 - Deluxe
        ['ch-301','301',3,'tc-del-001','libre_propre'],
        ['ch-302','302',3,'tc-del-001','occupee'],
        ['ch-303','303',3,'tc-del-001','libre_propre'],
        ['ch-304','304',3,'tc-jun-001','libre_propre'],
        ['ch-305','305',3,'tc-jun-001','occupee'],
        // Étage 4 - Junior Suites
        ['ch-401','401',4,'tc-jun-001','libre_propre'],
        ['ch-402','402',4,'tc-jun-001','libre_propre'],
        ['ch-403','403',4,'tc-exe-001','occupee'],
        ['ch-404','404',4,'tc-exe-001','libre_propre'],
        // Étage 5 - Suites
        ['ch-501','501',5,'tc-exe-001','libre_propre'],
        ['ch-502','502',5,'tc-pre-001','libre_propre'],
      ]
      for (const [id, numero, etage, typeId, statut] of chambres) {
        await client.query(`
          INSERT INTO chambres (id, hotel_id, tenant_id, numero, etage, type_chambre_id, statut)
          VALUES ($1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5)
          ON CONFLICT (id) DO UPDATE SET statut = $5
        `, [id, numero, etage, typeId, statut])
      }
      logs.push('✅ 21 chambres créées')

      // ── CLIENTS ───────────────────────────────────────────────────
      const clients = [
        ['cl-001','Jean-Baptiste','Nkomo','jb.nkomo@email.com','+237 699 001 001','Cameroun','VIP'],
        ['cl-002','Amina','Diallo','amina.diallo@email.com','+221 77 002 002','Sénégal','regular'],
        ['cl-003','Marc','Dupont','marc.dupont@email.com','+33 6 03 03 03 03','France','regular'],
        ['cl-004','Fatima','Al-Rashid','f.alrashid@email.com','+971 50 004 004','Émirats','VIP'],
        ['cl-005','Emmanuel','Eto','emmanuel.eto@email.com','+237 677 005 005','Cameroun','regular'],
        ['cl-006','Sarah','Johnson','sarah.j@email.com','+1 555 006 006','USA','regular'],
        ['cl-007','Kwame','Asante','kwame.asante@email.com','+233 20 007 007','Ghana','regular'],
        ['cl-008','Isabelle','Fontaine','i.fontaine@email.com','+33 7 08 08 08 08','France','VIP'],
        ['cl-009','Mohammed','Benali','m.benali@email.com','+212 6 09 09 09 09','Maroc','regular'],
        ['cl-010','Grace','Okonkwo','grace.ok@email.com','+234 80 010 010 10','Nigeria','regular'],
      ]
      for (const [id, prenom, nom, email, tel, pays, segment] of clients) {
        await client.query(`
          INSERT INTO clients (id, hotel_id, tenant_id, prenom, nom, email, telephone, pays, segment, actif)
          VALUES ($1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6,$7,true)
          ON CONFLICT (id) DO NOTHING
        `, [id, prenom, nom, email, tel, pays, segment])
      }
      logs.push('✅ 10 clients créés')

      // ── RÉSERVATIONS ──────────────────────────────────────────────
      const today = new Date()
      const d = (offset) => {
        const dt = new Date(today)
        dt.setDate(dt.getDate() + offset)
        return dt.toISOString().split('T')[0]
      }
      const reservations = [
        ['rv-001','cl-001','ch-403',d(-2),d(3),'arrivee',200000,'XAF'],
        ['rv-002','cl-002','ch-302',d(-1),d(2),'arrivee',85000,'XAF'],
        ['rv-003','cl-003','ch-102',d(-3),d(0),'depart_aujourd_hui',45000,'XAF'],
        ['rv-004','cl-004','ch-501',d(1),d(5),'confirmee',200000,'XAF'],
        ['rv-005','cl-005','ch-201',d(0),d(3),'confirmee',65000,'XAF'],
        ['rv-006','cl-006','ch-305',d(2),d(6),'confirmee',120000,'XAF'],
        ['rv-007','cl-007','ch-101',d(3),d(5),'confirmee',45000,'XAF'],
        ['rv-008','cl-008','ch-404',d(-5),d(-1),'annulee',200000,'XAF'],
        ['rv-009','cl-009','ch-203',d(4),d(7),'confirmee',65000,'XAF'],
        ['rv-010','cl-010','ch-304',d(1),d(4),'confirmee',120000,'XAF'],
      ]
      for (const [id, clientId, chambreId, arrivee, depart, statut, tarif, devise] of reservations) {
        const nuits = Math.max(1, Math.round((new Date(depart) - new Date(arrivee)) / 86400000))
        const total = tarif * nuits
        await client.query(`
          INSERT INTO reservations (id, hotel_id, tenant_id, client_id, chambre_id, statut,
            date_arrivee, date_depart, nombre_adultes, tarif_nuit, devise,
            total_hebergement, total_general, source, creee_par)
          VALUES ($1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
            $2,$3,$4,$5,$6,2,$7,$8,$9,$9,'direct','44444444-4444-4444-4444-444444444444')
          ON CONFLICT (id) DO NOTHING
        `, [id, clientId, chambreId, statut, arrivee, depart, tarif, devise, total])
      }
      logs.push('✅ 10 réservations créées')

      // ── ARTICLES MENU ─────────────────────────────────────────────
      const menu = [
        ['mn-001','Petit-déjeuner continental','Croissant, jus, café','petit_dejeuner',3500,true],
        ['mn-002','Buffet petit-déjeuner','Buffet complet','petit_dejeuner',6500,true],
        ['mn-003','Salade Niçoise','Salade fraîche','entree',4500,true],
        ['mn-004','Soupe de poisson','Soupe maison','entree',3000,true],
        ['mn-005','Poulet DG','Plat camerounais signature','plat',8500,true],
        ['mn-006','Ndolé bœuf','Plat traditionnel','plat',7500,true],
        ['mn-007','Poisson braisé','Tilapia grillé','plat',9000,true],
        ['mn-008','Entrecôte grillée','300g, frites','plat',14000,true],
        ['mn-009','Mousse au chocolat','Dessert maison','dessert',2500,true],
        ['mn-010','Plateau de fruits','Fruits de saison','dessert',3500,true],
        ['mn-011','Eau minérale 50cl','','boisson',800,true],
        ['mn-012','Jus de fruits frais','Mangue, goyave ou ananas','boisson',2000,true],
        ['mn-013','Bière locale 65cl','Castel ou 33Export','boisson',2500,true],
        ['mn-014','Vin rouge verre','Bordeaux','boisson',4500,true],
      ]
      for (const [id, nom, desc, categorie, prix, dispo] of menu) {
        await client.query(`
          INSERT INTO articles_menu (id, hotel_id, tenant_id, nom, description, categorie, prix, disponible)
          VALUES ($1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO NOTHING
        `, [id, nom, desc, categorie, prix, dispo])
      }
      logs.push('✅ 14 articles menu créés')

      // ── TÂCHES MÉNAGE ─────────────────────────────────────────────
      const taches = [
        ['tm-001','ch-104','nettoyage_depart','haute','ouverte','Nettoyage après départ client Dupont'],
        ['tm-002','ch-205','nettoyage_sejour','normale','en_cours','Ménage quotidien chambre occupée'],
        ['tm-003','ch-302','inspection','normale','ouverte','Inspection avant arrivée VIP'],
        ['tm-004','ch-101','nettoyage_sejour','basse','terminee','Nettoyage effectué'],
      ]
      for (const [id, chambreId, type, priorite, statut, desc] of taches) {
        await client.query(`
          INSERT INTO taches_menage (id, hotel_id, tenant_id, chambre_id, type_tache, priorite, statut, description, date_tache)
          VALUES ($1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6,CURRENT_DATE)
          ON CONFLICT (id) DO NOTHING
        `, [id, chambreId, type, priorite, statut, desc])
      }
      logs.push('✅ 4 tâches ménage créées')

      // ── TICKETS MAINTENANCE ───────────────────────────────────────
      const tickets = [
        ['tk-001','ch-202','Climatisation défaillante','La clim ne refroidit plus','technique','urgente','ouvert'],
        ['tk-002','ch-305','Robinet qui fuit','Fuite sous le lavabo','plomberie','normale','en_cours'],
        ['tk-003','ch-101','Ampoule grillée','Lampe de chevet','electricite','basse','resolu'],
        ['tk-004',null,'Ascenseur bruit anormal','Bruit lors de la montée','technique','haute','ouvert'],
      ]
      for (const [id, chambreId, titre, desc, categorie, priorite, statut] of tickets) {
        await client.query(`
          INSERT INTO tickets_maintenance (id, hotel_id, tenant_id, chambre_id, titre, description, categorie, priorite, statut, signale_par)
          VALUES ($1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6,$7,'55555555-5555-5555-5555-555555555555')
          ON CONFLICT (id) DO NOTHING
        `, [id, chambreId, titre, desc, categorie, priorite, statut])
      }
      logs.push('✅ 4 tickets maintenance créés')

      // ── TAXES ─────────────────────────────────────────────────────
      await client.query(`
        INSERT INTO taxes (id, hotel_id, tenant_id, nom, taux, type, applicable_a, actif)
        VALUES
          ('tx-001','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','TVA','19.25','pourcentage','hebergement',true),
          ('tx-002','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Taxe de séjour','1000','fixe','hebergement',true)
        ON CONFLICT (id) DO NOTHING
      `)
      logs.push('✅ 2 taxes créées')

      // ── ANALYTICS QUOTIDIENNES ────────────────────────────────────
      for (let i = 30; i >= 0; i--) {
        const dt = d(-i)
        const occ = 60 + Math.floor(Math.random() * 35)
        const rev = Math.floor((occ / 100) * 21 * 85000 * (0.8 + Math.random() * 0.4))
        await client.query(`
          INSERT INTO analytics_quotidiennes (hotel_id, date, taux_occupation, chambres_occupees, chambres_disponibles, revenu_hebergement, revenu_restaurant, revenu_total, arrivees, departs)
          VALUES ('22222222-2222-2222-2222-222222222222',$1,$2,$3,21,$4,$5,$6,$7,$8)
          ON CONFLICT (hotel_id, date) DO UPDATE SET taux_occupation=$2, revenu_total=$6
        `, [dt, occ, Math.floor(occ/100*21), rev, Math.floor(rev*0.15), Math.floor(rev*1.15),
           Math.floor(Math.random()*5)+1, Math.floor(Math.random()*5)+1])
      }
      logs.push('✅ 31 jours analytics créés')

      await client.end()
      logs.push('🎉 Seed complet terminé !')
      reply.send({ succes: true, logs })

    } catch (err) {
      logs.push(`❌ Erreur : ${err.message}`)
      try { await client.end() } catch {}
      reply.status(500).send({ succes: false, erreur: err.message, logs })
    }
  })
}
