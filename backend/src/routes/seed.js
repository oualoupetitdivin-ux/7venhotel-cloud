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

      // Vérifier quelles colonnes existent sur les tables clés
      const getColonnes = async (table) => {
        const { rows } = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]
        )
        return rows.map(r => r.column_name)
      }

      const colsChambre    = await getColonnes('chambres')
      const colsClients    = await getColonnes('clients')
      const colsMenu       = await getColonnes('articles_menu')
      const colsTaches     = await getColonnes('taches_menage')
      const colsTickets    = await getColonnes('tickets_maintenance')
      const colsTaxes      = await getColonnes('taxes')
      const colsAnalytics  = await getColonnes('analytics_quotidiennes')
      const colsReservations = await getColonnes('reservations')

      const hasTenant = (cols) => cols.includes('tenant_id')

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
        ['a0000001-0000-0000-0000-000000000001', 'Standard',             'Chambre confortable avec vue sur jardin',          2, 45000],
        ['a0000001-0000-0000-0000-000000000002', 'Supérieure',           'Chambre spacieuse avec vue partielle ville',       2, 65000],
        ['a0000001-0000-0000-0000-000000000003', 'Deluxe',               'Chambre luxueuse avec balcon et vue ville',        2, 85000],
        ['a0000001-0000-0000-0000-000000000004', 'Junior Suite',         'Suite avec salon séparé',                         3, 120000],
        ['a0000001-0000-0000-0000-000000000005', 'Suite Exécutive',      'Suite prestige avec jacuzzi et terrasse',         2, 200000],
        ['a0000001-0000-0000-0000-000000000006', 'Suite Présidentielle', 'Suite royale avec butler service',                4, 400000],
      ]
      for (const [id, nom, desc, capacite, tarif] of typesChambre) {
        await client.query(`
          INSERT INTO types_chambre (id, hotel_id, nom, description, capacite_adultes, tarif_base)
          VALUES ($1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5)
          ON CONFLICT (id) DO NOTHING
        `, [id, nom, desc, capacite, tarif])
      }
      logs.push('✅ 6 types de chambre créés')

      // ── CHAMBRES ──────────────────────────────────────────────────
      const chambres = [
        ['b0000001-0000-0000-0000-000000000001','101',1,'a0000001-0000-0000-0000-000000000001','libre_propre'],
        ['b0000001-0000-0000-0000-000000000002','102',1,'a0000001-0000-0000-0000-000000000001','occupee'],
        ['b0000001-0000-0000-0000-000000000003','103',1,'a0000001-0000-0000-0000-000000000001','libre_propre'],
        ['b0000001-0000-0000-0000-000000000004','104',1,'a0000001-0000-0000-0000-000000000001','sale'],
        ['b0000001-0000-0000-0000-000000000005','105',1,'a0000001-0000-0000-0000-000000000001','libre_propre'],
        ['b0000001-0000-0000-0000-000000000006','201',2,'a0000001-0000-0000-0000-000000000002','libre_propre'],
        ['b0000001-0000-0000-0000-000000000007','202',2,'a0000001-0000-0000-0000-000000000002','occupee'],
        ['b0000001-0000-0000-0000-000000000008','203',2,'a0000001-0000-0000-0000-000000000002','libre_propre'],
        ['b0000001-0000-0000-0000-000000000009','204',2,'a0000001-0000-0000-0000-000000000003','libre_propre'],
        ['b0000001-0000-0000-0000-000000000010','205',2,'a0000001-0000-0000-0000-000000000003','nettoyage'],
        ['b0000001-0000-0000-0000-000000000011','301',3,'a0000001-0000-0000-0000-000000000003','libre_propre'],
        ['b0000001-0000-0000-0000-000000000012','302',3,'a0000001-0000-0000-0000-000000000003','occupee'],
        ['b0000001-0000-0000-0000-000000000013','303',3,'a0000001-0000-0000-0000-000000000003','libre_propre'],
        ['b0000001-0000-0000-0000-000000000014','304',3,'a0000001-0000-0000-0000-000000000004','libre_propre'],
        ['b0000001-0000-0000-0000-000000000015','305',3,'a0000001-0000-0000-0000-000000000004','occupee'],
        ['b0000001-0000-0000-0000-000000000016','401',4,'a0000001-0000-0000-0000-000000000004','libre_propre'],
        ['b0000001-0000-0000-0000-000000000017','402',4,'a0000001-0000-0000-0000-000000000004','libre_propre'],
        ['b0000001-0000-0000-0000-000000000018','403',4,'a0000001-0000-0000-0000-000000000005','occupee'],
        ['b0000001-0000-0000-0000-000000000019','404',4,'a0000001-0000-0000-0000-000000000005','libre_propre'],
        ['b0000001-0000-0000-0000-000000000020','501',5,'a0000001-0000-0000-0000-000000000005','libre_propre'],
        ['b0000001-0000-0000-0000-000000000021','502',5,'a0000001-0000-0000-0000-000000000006','libre_propre'],
      ]
      for (const [id, numero, etage, typeId, statut] of chambres) {
        const cols = hasTenant(colsChambre)
          ? `id, hotel_id, tenant_id, numero, etage, type_chambre_id, statut`
          : `id, hotel_id, numero, etage, type_chambre_id, statut`
        const vals = hasTenant(colsChambre)
          ? `$1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5`
          : `$1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5`
        await client.query(
          `INSERT INTO chambres (${cols}) VALUES (${vals}) ON CONFLICT (id) DO UPDATE SET statut = $5`,
          [id, numero, etage, typeId, statut]
        )
      }
      logs.push('✅ 21 chambres créées')

      // ── CLIENTS ───────────────────────────────────────────────────
      const clients = [
        ['c0000001-0000-0000-0000-000000000001','Jean-Baptiste','Nkomo',    'jb.nkomo@email.com',      '+237 699 001 001','Cameroun','VIP'],
        ['c0000001-0000-0000-0000-000000000002','Amina',        'Diallo',   'amina.diallo@email.com',  '+221 77 002 002', 'Sénégal', 'standard'],
        ['c0000001-0000-0000-0000-000000000003','Marc',         'Dupont',   'marc.dupont@email.com',   '+33 6 03 03 03 03','France', 'standard'],
        ['c0000001-0000-0000-0000-000000000004','Fatima',       'Al-Rashid','f.alrashid@email.com',    '+971 50 004 004', 'Émirats','VIP'],
        ['c0000001-0000-0000-0000-000000000005','Emmanuel',     'Eto',      'emmanuel.eto@email.com',  '+237 677 005 005','Cameroun','standard'],
        ['c0000001-0000-0000-0000-000000000006','Sarah',        'Johnson',  'sarah.j@email.com',       '+1 555 006 006',  'USA',    'standard'],
        ['c0000001-0000-0000-0000-000000000007','Kwame',        'Asante',   'kwame.asante@email.com',  '+233 20 007 007', 'Ghana',  'standard'],
        ['c0000001-0000-0000-0000-000000000008','Isabelle',     'Fontaine', 'i.fontaine@email.com',    '+33 7 08 08 08 08','France','VIP'],
        ['c0000001-0000-0000-0000-000000000009','Mohammed',     'Benali',   'm.benali@email.com',      '+212 6 09 09 09 09','Maroc','standard'],
        ['c0000001-0000-0000-0000-000000000010','Grace',        'Okonkwo',  'grace.ok@email.com',      '+234 80 010 010 10','Nigeria','standard'],
      ]
      for (const [id, prenom, nom, email, tel, pays, segment] of clients) {
        await client.query(`
          INSERT INTO clients (id, hotel_id, tenant_id, prenom, nom, email, telephone, pays_residence, segment, actif)
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
        ['a1000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000018',d(-2),d(3),'arrivee',200000],
        ['a1000001-0000-0000-0000-000000000002','c0000001-0000-0000-0000-000000000002','b0000001-0000-0000-0000-000000000012',d(-1),d(2),'arrivee',85000],
        ['a1000001-0000-0000-0000-000000000003','c0000001-0000-0000-0000-000000000003','b0000001-0000-0000-0000-000000000002',d(-3),d(0),'depart_aujourd_hui',45000],
        ['a1000001-0000-0000-0000-000000000004','c0000001-0000-0000-0000-000000000004','b0000001-0000-0000-0000-000000000020',d(1),d(5),'confirmee',200000],
        ['a1000001-0000-0000-0000-000000000005','c0000001-0000-0000-0000-000000000005','b0000001-0000-0000-0000-000000000006',d(0),d(3),'confirmee',65000],
        ['a1000001-0000-0000-0000-000000000006','c0000001-0000-0000-0000-000000000006','b0000001-0000-0000-0000-000000000015',d(2),d(6),'confirmee',120000],
        ['a1000001-0000-0000-0000-000000000007','c0000001-0000-0000-0000-000000000007','b0000001-0000-0000-0000-000000000001',d(3),d(5),'confirmee',45000],
        ['a1000001-0000-0000-0000-000000000008','c0000001-0000-0000-0000-000000000009','b0000001-0000-0000-0000-000000000008',d(4),d(7),'confirmee',65000],
        ['a1000001-0000-0000-0000-000000000009','c0000001-0000-0000-0000-000000000010','b0000001-0000-0000-0000-000000000014',d(1),d(4),'confirmee',120000],
      ]
      for (const [id, clientId, chambreId, arrivee, depart, statut, tarif] of reservations) {
        const nuits = Math.max(1, Math.round((new Date(depart) - new Date(arrivee)) / 86400000))
        const total = tarif * nuits
        const cols = hasTenant(colsReservations)
          ? `id, hotel_id, tenant_id, client_id, chambre_id, statut, date_arrivee, date_depart, nombre_adultes, tarif_nuit, devise, total_hebergement, total_general, source, creee_par`
          : `id, hotel_id, client_id, chambre_id, statut, date_arrivee, date_depart, nombre_adultes, tarif_nuit, devise, total_hebergement, total_general, source, creee_par`
        const vals = hasTenant(colsReservations)
          ? `$1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6,2,$7,'XAF',$8,$8,'direct','44444444-4444-4444-4444-444444444444'`
          : `$1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5,$6,2,$7,'XAF',$8,$8,'direct','44444444-4444-4444-4444-444444444444'`
        await client.query(
          `INSERT INTO reservations (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING`,
          [id, clientId, chambreId, statut, arrivee, depart, tarif, total]
        )
      }
      logs.push('✅ 9 réservations créées')

      // ── ARTICLES MENU ─────────────────────────────────────────────
      const menu = [
        ['e0000001-0000-0000-0000-000000000001','Petit-déjeuner continental','Croissant, jus, café',        'petit_dejeuner',3500],
        ['e0000001-0000-0000-0000-000000000002','Buffet petit-déjeuner',     'Buffet complet',              'petit_dejeuner',6500],
        ['e0000001-0000-0000-0000-000000000003','Salade Niçoise',            'Salade fraîche',              'entree',4500],
        ['e0000001-0000-0000-0000-000000000004','Soupe de poisson',          'Soupe maison',                'entree',3000],
        ['e0000001-0000-0000-0000-000000000005','Poulet DG',                 'Plat camerounais signature',  'plat',8500],
        ['e0000001-0000-0000-0000-000000000006','Ndolé bœuf',               'Plat traditionnel',           'plat',7500],
        ['e0000001-0000-0000-0000-000000000007','Poisson braisé',            'Tilapia grillé',              'plat',9000],
        ['e0000001-0000-0000-0000-000000000008','Entrecôte grillée',         '300g, frites',                'plat',14000],
        ['e0000001-0000-0000-0000-000000000009','Mousse au chocolat',        'Dessert maison',              'dessert',2500],
        ['e0000001-0000-0000-0000-000000000010','Plateau de fruits',         'Fruits de saison',            'dessert',3500],
        ['e0000001-0000-0000-0000-000000000011','Eau minérale 50cl',         '',                            'boisson',800],
        ['e0000001-0000-0000-0000-000000000012','Jus de fruits frais',       'Mangue, goyave ou ananas',    'boisson',2000],
        ['e0000001-0000-0000-0000-000000000013','Bière locale 65cl',         'Castel ou 33Export',          'boisson',2500],
        ['e0000001-0000-0000-0000-000000000014','Vin rouge verre',           'Bordeaux',                    'boisson',4500],
      ]
      for (const [id, nom, desc, categorie, prix] of menu) {
        const cols = hasTenant(colsMenu)
          ? `id, hotel_id, tenant_id, nom, description, categorie, prix, disponible`
          : `id, hotel_id, nom, description, categorie, prix, disponible`
        const vals = hasTenant(colsMenu)
          ? `$1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,true`
          : `$1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5,true`
        await client.query(
          `INSERT INTO articles_menu (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING`,
          [id, nom, desc, categorie, prix]
        )
      }
      logs.push('✅ 14 articles menu créés')

      // ── TÂCHES MÉNAGE ─────────────────────────────────────────────
      const taches = [
        ['f0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000004','nettoyage_depart','haute',  'ouverte', 'Nettoyage après départ'],
        ['f0000001-0000-0000-0000-000000000002','b0000001-0000-0000-0000-000000000010','nettoyage_sejour','normale','en_cours','Ménage quotidien'],
        ['f0000001-0000-0000-0000-000000000003','b0000001-0000-0000-0000-000000000012','inspection',      'normale','ouverte', 'Inspection avant arrivée VIP'],
        ['f0000001-0000-0000-0000-000000000004','b0000001-0000-0000-0000-000000000001','nettoyage_sejour','basse',  'terminee','Nettoyage effectué'],
      ]
      for (const [id, chambreId, type, priorite, statut, desc] of taches) {
        const cols = hasTenant(colsTaches)
          ? `id, hotel_id, tenant_id, chambre_id, type_tache, priorite, statut, description, date_tache`
          : `id, hotel_id, chambre_id, type_tache, priorite, statut, description, date_tache`
        const vals = hasTenant(colsTaches)
          ? `$1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6,CURRENT_DATE`
          : `$1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5,$6,CURRENT_DATE`
        await client.query(
          `INSERT INTO taches_menage (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING`,
          [id, chambreId, type, priorite, statut, desc]
        )
      }
      logs.push('✅ 4 tâches ménage créées')

      // ── TICKETS MAINTENANCE ───────────────────────────────────────
      const tickets = [
        ['g0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000007','Climatisation défaillante','La clim ne refroidit plus','technique','urgente','ouvert'],
        ['g0000001-0000-0000-0000-000000000002','b0000001-0000-0000-0000-000000000015','Robinet qui fuit',         'Fuite sous le lavabo',    'plomberie','normale','en_cours'],
        ['g0000001-0000-0000-0000-000000000003','b0000001-0000-0000-0000-000000000001','Ampoule grillée',          'Lampe de chevet',         'electricite','basse','resolu'],
        ['g0000001-0000-0000-0000-000000000004',null,                                  'Ascenseur bruit anormal',  'Bruit lors de la montée', 'technique','haute','ouvert'],
      ]
      for (const [id, chambreId, titre, desc, categorie, priorite, statut] of tickets) {
        const cols = hasTenant(colsTickets)
          ? `id, hotel_id, tenant_id, chambre_id, titre, description, categorie, priorite, statut, signale_par`
          : `id, hotel_id, chambre_id, titre, description, categorie, priorite, statut, signale_par`
        const vals = hasTenant(colsTickets)
          ? `$1,'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$2,$3,$4,$5,$6,$7,'55555555-5555-5555-5555-555555555555'`
          : `$1,'22222222-2222-2222-2222-222222222222',$2,$3,$4,$5,$6,$7,'55555555-5555-5555-5555-555555555555'`
        await client.query(
          `INSERT INTO tickets_maintenance (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING`,
          [id, chambreId, titre, desc, categorie, priorite, statut]
        )
      }
      logs.push('✅ 4 tickets maintenance créés')

      // ── TAXES ─────────────────────────────────────────────────────
      const taxCols = hasTenant(colsTaxes)
        ? `id, hotel_id, tenant_id, nom, taux, type, applicable_a, actif`
        : `id, hotel_id, nom, taux, type, applicable_a, actif`
      const taxVals1 = hasTenant(colsTaxes)
        ? `'h0000001-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','TVA','19.25','pourcentage','hebergement',true`
        : `'h0000001-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','TVA','19.25','pourcentage','hebergement',true`
      const taxVals2 = hasTenant(colsTaxes)
        ? `'h0000001-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Taxe de séjour','1000','fixe','hebergement',true`
        : `'h0000001-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Taxe de séjour','1000','fixe','hebergement',true`
      await client.query(`INSERT INTO taxes (${taxCols}) VALUES (${taxVals1}) ON CONFLICT (id) DO NOTHING`)
      await client.query(`INSERT INTO taxes (${taxCols}) VALUES (${taxVals2}) ON CONFLICT (id) DO NOTHING`)
      logs.push('✅ 2 taxes créées')

      // ── ANALYTICS QUOTIDIENNES ────────────────────────────────────
      for (let i = 30; i >= 0; i--) {
        const dt = d(-i)
        const occ = 60 + Math.floor(Math.random() * 35)
        const rev = Math.floor((occ / 100) * 21 * 85000 * (0.8 + Math.random() * 0.4))
        const hasTenantA = hasTenant(colsAnalytics)
        const aCols = hasTenantA
          ? `hotel_id, tenant_id, date, taux_occupation, chambres_occupees, chambres_disponibles, revenu_hebergement, revenu_restaurant, revenu_total, arrivees, departs`
          : `hotel_id, date, taux_occupation, chambres_occupees, chambres_disponibles, revenu_hebergement, revenu_restaurant, revenu_total, arrivees, departs`
        const aVals = hasTenantA
          ? `'22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',$1,$2,$3,21,$4,$5,$6,$7,$8`
          : `'22222222-2222-2222-2222-222222222222',$1,$2,$3,21,$4,$5,$6,$7,$8`
        await client.query(
          `INSERT INTO analytics_quotidiennes (${aCols}) VALUES (${aVals})
           ON CONFLICT (hotel_id, date) DO UPDATE SET taux_occupation=EXCLUDED.taux_occupation, revenu_total=EXCLUDED.revenu_total`,
          [dt, occ, Math.floor(occ/100*21), rev, Math.floor(rev*0.15), Math.floor(rev*1.15),
           Math.floor(Math.random()*5)+1, Math.floor(Math.random()*5)+1]
        )
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
