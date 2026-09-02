'use strict'

module.exports = async function analyticsRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.contexteHotel]

  // ── GET /analytics/dashboard ──────────────────────────────────────────────
  // KPI opérationnels temps réel — cache 60s
  // Rôles autorisés : super_admin, manager, reception, comptabilite
  fastify.get('/dashboard', {
    preHandler: [...pre, fastify.verifierRole(['super_admin', 'manager', 'reception', 'comptabilite'])],
  }, async (req, reply) => {
    const cacheKey = `analytics:dash:${req.hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [
      chambresQ,
      reservationsActivesQ,
      arrivees,
      departs,
      revenuFolioQ,
      revenuReservationQ,
      encaissementsQ,
      caRestoQ,
      tachesOuvertes,
      ticketsUrgents,
      chargesJourQ,
      sessionCaisseActive,
      especesJourQ,
    ] = await Promise.all([

      // Chambres disponibles (hors_service exclus)
      fastify.db.raw(
        `SELECT COUNT(*) AS disponibles
         FROM chambres
         WHERE hotel_id = ? AND hors_service = false`,
        [req.hotelId]
      ),

      // VRAI taux occupation : réservations avec client physiquement présent aujourd'hui
      // Statuts 'arrivee' et 'depart_aujourd_hui' = client dans la chambre
      fastify.db.raw(
        `SELECT COUNT(DISTINCT chambre_id) AS occupees
         FROM reservations
         WHERE hotel_id = ?
           AND date_arrivee <= CURRENT_DATE
           AND date_depart > CURRENT_DATE
           AND statut IN ('arrivee', 'depart_aujourd_hui')`,
        [req.hotelId]
      ),

      // Arrivées du jour : reservations attendues ou déjà checkées aujourd'hui
      fastify.db.raw(
        `SELECT COUNT(*) AS total
         FROM reservations
         WHERE hotel_id = ?
           AND date_arrivee = CURRENT_DATE
           AND statut IN ('confirmee', 'arrivee')`,
        [req.hotelId]
      ),

      // Départs du jour : clients dont le départ est aujourd'hui
      fastify.db.raw(
        `SELECT COUNT(*) AS total
         FROM reservations
         WHERE hotel_id = ?
           AND date_depart = CURRENT_DATE
           AND statut IN ('arrivee', 'depart_aujourd_hui')`,
        [req.hotelId]
      ),

      // VRAI revenu jour : lignes_folio avec date_facturation = aujourd'hui
      // Source de vérité financière — ledger immuable
      // JOIN folios conservé : hotel_id sur lignes_folio renseigné post-migration_delta
      // (le WHERE f.hotel_id reste la sécurité sur les lignes antérieures sans hotel_id direct)
      fastify.db.raw(
        `SELECT COALESCE(SUM(lf.montant_total), 0) AS total
         FROM lignes_folio lf
         JOIN folios f ON f.id = lf.folio_id
         WHERE f.hotel_id = ?
           AND lf.date_facturation = CURRENT_DATE
           AND lf.sens = 'debit'
           AND lf.type_ligne NOT IN ('correction', 'remise')`,
        [req.hotelId]
      ),

      // Fallback revenu : somme des tarifs_nuit des réservations actives
      // Utilisé si le ledger folio n'est pas encore alimenté
      fastify.db.raw(
        `SELECT COALESCE(SUM(tarif_nuit), 0) AS total
         FROM reservations
         WHERE hotel_id = ?
           AND date_arrivee <= CURRENT_DATE
           AND date_depart > CURRENT_DATE
           AND statut IN ('arrivee', 'depart_aujourd_hui')`,
        [req.hotelId]
      ),

      // Encaissements réels du jour : paiements confirmés
      // COALESCE(traite_le, cree_le) : traite_le nullable en production —
      // un paiement sans traite_le (ex: initié mais non encore traité) tombe
      // sur cree_le pour ne pas être exclu du décompte journalier.
      fastify.db.raw(
        `SELECT COALESCE(SUM(montant), 0) AS total
         FROM paiements
         WHERE hotel_id = ?
           AND statut = 'valide'
           AND DATE(COALESCE(traite_le, cree_le)) = CURRENT_DATE`,
        [req.hotelId]
      ),

      // CA restaurant du jour : commandes effectivement servies
      fastify.db.raw(
        `SELECT COALESCE(SUM(total), 0) AS total
         FROM commandes_restaurant
         WHERE hotel_id = ?
           AND statut = 'servie'
           AND DATE(heure_servie) = CURRENT_DATE`,
        [req.hotelId]
      ),

      // Tâches ménage non terminées
      fastify.db('taches_menage')
        .where({ hotel_id: req.hotelId })
        .whereNotIn('statut', ['validee'])
        .count('id AS total')
        .first(),

      // Tickets maintenance urgents ouverts
      fastify.db('tickets_maintenance')
        .where({ hotel_id: req.hotelId, priorite: 'urgente' })
        .whereNotIn('statut', ['resolu', 'ferme'])
        .count('id AS total')
        .first(),

      // PHASE1-B — Charges du jour
      fastify.db('charges')
        .where({ hotel_id: req.hotelId, date_charge: fastify.db.raw('CURRENT_DATE') })
        .sum('montant AS total')
        .first(),

      // PHASE1-B — Session de caisse active (statut + total espèces attendu)
      fastify.db('sessions_caisse')
        .where({ hotel_id: req.hotelId, statut: 'ouverte' })
        .first(),

      // PHASE1-B — Encaissements espèces du jour (pour solde_caisse_actif)
      fastify.db.raw(
        `SELECT COALESCE(SUM(montant), 0) AS total
         FROM paiements
         WHERE hotel_id = ?
           AND type_paiement = 'especes'
           AND statut = 'valide'
           AND DATE(COALESCE(traite_le, cree_le)) = CURRENT_DATE`,
        [req.hotelId]
      ),
    ])

    const disponibles = parseInt(chambresQ.rows[0]?.disponibles || 0)
    const occupees    = parseInt(reservationsActivesQ.rows[0]?.occupees || 0)
    const tauxOcc     = disponibles > 0
      ? Math.round((occupees / disponibles) * 10000) / 100
      : 0

    const revenuFolio       = parseFloat(revenuFolioQ.rows[0]?.total || 0)
    const revenuReservation  = parseFloat(revenuReservationQ.rows[0]?.total || 0)
    const revenuJour         = revenuFolio > 0 ? revenuFolio : revenuReservation

    const result = {
      taux_occupation:        tauxOcc,
      chambres_occupees:      occupees,
      chambres_disponibles:   disponibles,
      revenu_jour:            revenuJour,
      revenu_source:          revenuFolio > 0 ? 'folio' : 'reservation',
      encaissements_jour:     parseFloat(encaissementsQ.rows[0]?.total || 0),
      ca_restaurant_jour:     parseFloat(caRestoQ.rows[0]?.total || 0),
      arrivees_aujourd_hui:   parseInt(arrivees.rows[0]?.total || 0),
      departs_aujourd_hui:    parseInt(departs.rows[0]?.total || 0),
      taches_menage_ouvertes: parseInt(tachesOuvertes?.total || 0),
      tickets_urgents:        parseInt(ticketsUrgents?.total || 0),

      // PHASE1-B — Finance opérationnelle
      charges_jour:           parseFloat(chargesJourQ?.total || 0),
      caisse_statut:          sessionCaisseActive ? 'ouverte' : 'fermee',
      caisse_total_especes:   sessionCaisseActive
        ? parseFloat(sessionCaisseActive.fond_ouverture) + parseFloat(especesJourQ.rows[0]?.total || 0)
        : 0,
    }

    await fastify.cache.set(cacheKey, result, 60)
    reply.send(result)
  })

  // ── GET /analytics/quotidiennes ───────────────────────────────────────────
  fastify.get('/quotidiennes', { preHandler: [...pre, fastify.verifierPermission('analytics.lire')] }, async (req, reply) => {
    const { debut, fin } = req.query
    const data = await fastify.db('analytics_quotidiennes')
      .where({ hotel_id: req.hotelId })
      .where('date', '>=', debut || fastify.db.raw("CURRENT_DATE - INTERVAL '30 days'"))
      .where('date', '<=', fin   || fastify.db.raw('CURRENT_DATE'))
      .orderBy('date')
    reply.send({ data })
  })

  // ── GET /analytics/mensuelles ─────────────────────────────────────────────
  fastify.get('/mensuelles', { preHandler: [...pre, fastify.verifierPermission('analytics.lire')] }, async (req, reply) => {
    const data = await fastify.db('analytics_mensuelles')
      .where({ hotel_id: req.hotelId })
      .orderBy('annee', 'desc').orderBy('mois', 'desc').limit(12)
    reply.send({ data })
  })

  // PHASE2-C — Analytics avancé
  //
  // Note schéma : lignes_folio.type_ligne est un ENUM Postgres (type_extra_folio)
  // dont les valeurs réelles sont : hebergement, restaurant, bar, spa,
  // blanchisserie, transport, telephone, minibar, autre, paiement, correction,
  // taxe, remise. Il n'existe PAS de valeur 'extra', 'avoir', 'remboursement'
  // ni 'arrhes' — comparer type_ligne à ces littéraux ferait échouer la requête
  // (cast enum invalide). Le bucket "extras" est donc reconstitué depuis les
  // types de prestations annexes réels (bar/spa/blanchisserie/transport/
  // telephone/minibar/autre), et les exclusions "non-revenu" utilisent
  // ('correction','remise') — 'paiement' est de toute façon exclu par le
  // filtre sens='debit' (les paiements sont journalisés en sens='credit').
  //
  // De même, statut_reservation ne contient pas de valeur 'checkout' — l'état
  // "séjour terminé" réel est 'terminee'.
  const rolesAnalyseAvancee = fastify.verifierRole(['super_admin', 'manager', 'comptabilite'])
  const TYPES_EXTRAS = ['bar', 'spa', 'blanchisserie', 'transport', 'telephone', 'minibar', 'autre']

  function debutFinDefaut(joursDefaut) {
    const maintenant = new Date()
    const fin   = maintenant.toISOString().slice(0, 10)
    const debut = new Date(maintenant.getTime() - joursDefaut * 86400000).toISOString().slice(0, 10)
    return { debut, fin }
  }

  // ── GET /analytics/pnl ──────────────────────────────────────────────────
  // Compte de résultat simplifié (revenus ledger vs charges) sur une période.
  // Défaut : mois courant. Cache 300s.
  fastify.get('/pnl', { preHandler: [...pre, rolesAnalyseAvancee] }, async (req, reply) => {
    const maintenant   = new Date()
    const debutDefaut  = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1).toISOString().slice(0, 10)
    const finDefaut    = maintenant.toISOString().slice(0, 10)
    const debut = req.query.debut || debutDefaut
    const fin   = req.query.fin   || finDefaut

    const cacheKey = `analytics:pnl:${req.hotelId}:${debut}:${fin}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [revenusQ, chargesParCategorieQ] = await Promise.all([
      fastify.db.raw(
        `SELECT
           COALESCE(SUM(montant_total) FILTER (WHERE type_ligne = 'hebergement'), 0) AS hebergement,
           COALESCE(SUM(montant_total) FILTER (WHERE type_ligne = 'restaurant'), 0) AS restaurant,
           COALESCE(SUM(montant_total) FILTER (WHERE type_ligne IN ('bar','spa','blanchisserie','transport','telephone','minibar','autre')), 0) AS extras,
           COALESCE(SUM(montant_total) FILTER (WHERE type_ligne = 'taxe'), 0) AS taxes
         FROM lignes_folio
         WHERE hotel_id = ?
           AND sens = 'debit'
           AND type_ligne NOT IN ('correction', 'remise')
           AND date_facturation BETWEEN ? AND ?`,
        [req.hotelId, debut, fin]
      ),

      fastify.db('charges AS c')
        .leftJoin('categories_charges AS cat', 'cat.id', 'c.categorie_id')
        .where({ 'c.hotel_id': req.hotelId })
        .andWhere('c.date_charge', '>=', debut)
        .andWhere('c.date_charge', '<=', fin)
        .groupBy('cat.id', 'cat.nom')
        .select('cat.nom AS categorie_nom')
        .sum('c.montant AS total_montant'),
    ])

    const r = revenusQ.rows[0] || {}
    const revenus = {
      hebergement: parseFloat(r.hebergement || 0),
      restaurant:  parseFloat(r.restaurant || 0),
      extras:      parseFloat(r.extras || 0),
      taxes:       parseFloat(r.taxes || 0),
    }
    revenus.total = revenus.hebergement + revenus.restaurant + revenus.extras + revenus.taxes

    const categories = chargesParCategorieQ.map(c => ({
      categorie_nom: c.categorie_nom || 'Sans catégorie',
      total_charges: parseFloat(c.total_montant || 0),
    }))
    const totalCharges = categories.reduce((s, c) => s + c.total_charges, 0)

    const resultatBrut = revenus.total - totalCharges
    const margePct = revenus.total > 0 ? Math.round((resultatBrut / revenus.total) * 10000) / 100 : 0

    const result = {
      periode:  { debut, fin },
      revenus,
      charges:  { categories, total: totalCharges },
      resultat: { brut: resultatBrut, marge_pct: margePct },
    }

    await fastify.cache.set(cacheKey, result, 300)
    reply.send(result)
  })

  // ── GET /analytics/kpi-hospitality ──────────────────────────────────────
  // ADR, RevPAR, GOPPAR, taux d'occupation et de conversion.
  // Défaut : 30 derniers jours. Cache 300s.
  fastify.get('/kpi-hospitality', { preHandler: [...pre, rolesAnalyseAvancee] }, async (req, reply) => {
    const { debut: debutDefaut, fin: finDefaut } = debutFinDefaut(30)
    const debut = req.query.debut || debutDefaut
    const fin   = req.query.fin   || finDefaut

    const cacheKey = `analytics:kpihosp:${req.hotelId}:${debut}:${fin}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const nbJours = Math.max(1, Math.round((new Date(fin) - new Date(debut)) / 86400000))

    const [chambresQ, nuiteesQ, revenuHebQ, revenuTotalQ, chargesQ, conversionQ] = await Promise.all([
      fastify.db('chambres')
        .where({ hotel_id: req.hotelId, hors_service: false })
        .count('id AS total').first(),

      // 'terminee' = séjour achevé (checkout réel) — pas de statut 'checkout' dans l'enum
      fastify.db('reservations')
        .where({ hotel_id: req.hotelId })
        .whereIn('statut', ['arrivee', 'depart_aujourd_hui', 'terminee'])
        .andWhere('date_arrivee', '>=', debut)
        .andWhere('date_arrivee', '<=', fin)
        .sum('nombre_nuits AS total').first(),

      fastify.db('lignes_folio')
        .where({ hotel_id: req.hotelId, sens: 'debit', type_ligne: 'hebergement' })
        .andWhere('date_facturation', '>=', debut)
        .andWhere('date_facturation', '<=', fin)
        .sum('montant_total AS total').first(),

      fastify.db('lignes_folio')
        .where({ hotel_id: req.hotelId, sens: 'debit' })
        .andWhere('date_facturation', '>=', debut)
        .andWhere('date_facturation', '<=', fin)
        .sum('montant_total AS total').first(),

      fastify.db('charges')
        .where({ hotel_id: req.hotelId })
        .andWhere('date_charge', '>=', debut)
        .andWhere('date_charge', '<=', fin)
        .sum('montant AS total').first(),

      fastify.db('reservations')
        .where({ hotel_id: req.hotelId })
        .whereIn('statut', ['confirmee', 'terminee', 'annulee'])
        .andWhere('date_arrivee', '>=', debut)
        .andWhere('date_arrivee', '<=', fin)
        .select('statut')
        .count('id AS total')
        .groupBy('statut'),
    ])

    const chambresDisponiblesTotal = parseInt(chambresQ?.total || 0)
    const nuiteesVendues           = parseFloat(nuiteesQ?.total || 0)
    const revenuHebergement        = parseFloat(revenuHebQ?.total || 0)
    const chambresDispoNuits       = chambresDisponiblesTotal * nbJours

    const adr             = nuiteesVendues > 0     ? revenuHebergement / nuiteesVendues     : 0
    const revpar           = chambresDispoNuits > 0 ? revenuHebergement / chambresDispoNuits : 0
    const tauxOccupation    = chambresDispoNuits > 0 ? (nuiteesVendues / chambresDispoNuits) * 100 : 0

    const chargesPeriode       = parseFloat(chargesQ?.total || 0)
    const revenuTotalPeriode   = parseFloat(revenuTotalQ?.total || 0)
    const resultatOperationnel = revenuTotalPeriode - chargesPeriode
    const goppar                = chambresDispoNuits > 0 ? resultatOperationnel / chambresDispoNuits : 0

    const compteurs   = Object.fromEntries(conversionQ.map(r => [r.statut, parseInt(r.total)]))
    const nbConvertie = compteurs.terminee || 0
    const nbDenom      = (compteurs.confirmee || 0) + (compteurs.terminee || 0) + (compteurs.annulee || 0)
    const tauxConversion = nbDenom > 0 ? Math.round((nbConvertie / nbDenom) * 10000) / 100 : 0

    const result = {
      periode: { debut, fin, nb_jours: nbJours },
      adr:              Math.round(adr * 100) / 100,
      revpar:           Math.round(revpar * 100) / 100,
      taux_occupation:  Math.round(tauxOccupation * 100) / 100,
      goppar:           Math.round(goppar * 100) / 100,
      taux_conversion:  tauxConversion,
      chambres_disponibles_total: chambresDisponiblesTotal,
      nuitees_vendues:            nuiteesVendues,
    }

    await fastify.cache.set(cacheKey, result, 300)
    reply.send(result)
  })

  // ── GET /analytics/revenus-ventiles ─────────────────────────────────────
  // Revenus ledger ventilés par catégorie, groupés par jour/semaine/mois.
  // Défaut : 30 derniers jours, granularité jour. Cache 300s.
  fastify.get('/revenus-ventiles', { preHandler: [...pre, rolesAnalyseAvancee] }, async (req, reply) => {
    const granulariteValide = ['jour', 'semaine', 'mois']
    const granularite = granulariteValide.includes(req.query.granularite) ? req.query.granularite : 'jour'

    const { debut: debutDefaut, fin: finDefaut } = debutFinDefaut(30)
    const debut = req.query.debut || debutDefaut
    const fin   = req.query.fin   || finDefaut

    const cacheKey = `analytics:revventiles:${req.hotelId}:${debut}:${fin}:${granularite}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const groupExpr = granularite === 'mois'    ? "date_trunc('month', date_facturation)"
                     : granularite === 'semaine' ? "date_trunc('week', date_facturation)"
                     : 'date_facturation'

    const { rows } = await fastify.db.raw(
      `SELECT
         ${groupExpr} AS date,
         COALESCE(SUM(montant_total) FILTER (WHERE type_ligne = 'hebergement'), 0) AS hebergement,
         COALESCE(SUM(montant_total) FILTER (WHERE type_ligne = 'restaurant'), 0) AS restaurant,
         COALESCE(SUM(montant_total) FILTER (WHERE type_ligne IN ('bar','spa','blanchisserie','transport','telephone','minibar','autre')), 0) AS extras,
         COALESCE(SUM(montant_total) FILTER (WHERE type_ligne = 'taxe'), 0) AS taxes,
         COALESCE(SUM(montant_total), 0) AS total
       FROM lignes_folio
       WHERE hotel_id = ?
         AND sens = 'debit'
         AND type_ligne NOT IN ('correction', 'remise')
         AND date_facturation BETWEEN ? AND ?
       GROUP BY ${groupExpr}
       ORDER BY ${groupExpr}`,
      [req.hotelId, debut, fin]
    )

    const data = rows.map(r => ({
      date:        r.date,
      hebergement: parseFloat(r.hebergement),
      restaurant:  parseFloat(r.restaurant),
      extras:      parseFloat(r.extras),
      taxes:       parseFloat(r.taxes),
      total:       parseFloat(r.total),
    }))

    const result = { data }
    await fastify.cache.set(cacheKey, result, 300)
    reply.send(result)
  })

  // ── GET /analytics/fb-analyse ────────────────────────────────────────────
  // CA restaurant hebdomadaire, top articles, taux de perte stock.
  // Défaut : 30 derniers jours. Cache 300s.
  fastify.get('/fb-analyse', { preHandler: [...pre, rolesAnalyseAvancee] }, async (req, reply) => {
    const { debut: debutDefaut, fin: finDefaut } = debutFinDefaut(30)
    const debut = req.query.debut || debutDefaut
    const fin   = req.query.fin   || finDefaut

    const cacheKey = `analytics:fbanalyse:${req.hotelId}:${debut}:${fin}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [caSemainesQ, topArticlesQ, stockPertesQ] = await Promise.all([
      fastify.db.raw(
        `SELECT DATE_TRUNC('week', heure_servie) AS semaine, COALESCE(SUM(total), 0) AS ca_semaine
         FROM commandes_restaurant
         WHERE hotel_id = ? AND statut = 'servie'
           AND DATE(heure_servie) BETWEEN ? AND ?
         GROUP BY semaine ORDER BY semaine`,
        [req.hotelId, debut, fin]
      ),

      fastify.db.raw(
        `SELECT a.id, a.nom, a.cout_revient, a.prix,
                COALESCE(SUM(lc.quantite), 0) AS qte_vendue,
                COALESCE(SUM(lc.quantite * lc.prix_unitaire), 0) AS ca_article,
                COALESCE(SUM(lc.quantite * (lc.prix_unitaire - a.cout_revient)), 0) AS marge
         FROM lignes_commande lc
         JOIN articles_menu a ON a.id = lc.article_id
         JOIN commandes_restaurant cr ON cr.id = lc.commande_id
         WHERE cr.hotel_id = ? AND cr.statut = 'servie'
           AND DATE(cr.heure_servie) BETWEEN ? AND ?
         GROUP BY a.id ORDER BY ca_article DESC LIMIT 10`,
        [req.hotelId, debut, fin]
      ),

      fastify.db.raw(
        `SELECT
           COALESCE(SUM(quantite) FILTER (WHERE type_mouvement = 'sortie'), 0) AS sorties,
           COALESCE(SUM(quantite) FILTER (WHERE type_mouvement = 'perte'), 0) AS pertes
         FROM mouvements_stock
         WHERE hotel_id = ? AND DATE(cree_le) BETWEEN ? AND ?`,
        [req.hotelId, debut, fin]
      ),
    ])

    const caSemaines = caSemainesQ.rows.map(r => ({ semaine: r.semaine, ca_semaine: parseFloat(r.ca_semaine) }))
    const topArticles = topArticlesQ.rows.map(r => ({
      nom:          r.nom,
      qte_vendue:   parseFloat(r.qte_vendue),
      ca_article:   parseFloat(r.ca_article),
      marge:        parseFloat(r.marge),
      cout_revient: parseFloat(r.cout_revient),
    }))

    const sorties   = parseFloat(stockPertesQ.rows[0]?.sorties || 0)
    const pertes    = parseFloat(stockPertesQ.rows[0]?.pertes || 0)
    const tauxPerte = (sorties + pertes) > 0 ? Math.round((pertes / (sorties + pertes)) * 10000) / 100 : 0

    const result = {
      ca_semaines: caSemaines,
      top_articles: topArticles,
      stock_pertes: { sorties, pertes, taux_perte: tauxPerte },
    }

    await fastify.cache.set(cacheKey, result, 300)
    reply.send(result)
  })

  // ── GET /analytics/stock-analyse ────────────────────────────────────────
  // Valeur stock, consommation 30j, top consommateurs, rotation lente.
  // Pas de paramètres de période (fenêtres fixes 30j/14j). Cache 120s.
  fastify.get('/stock-analyse', { preHandler: [...pre, rolesAnalyseAvancee] }, async (req, reply) => {
    const cacheKey = `analytics:stockanalyse:${req.hotelId}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [valeurStockQ, consommationQ, topConsommateursQ, rotationLenteQ] = await Promise.all([
      fastify.db.raw(
        `SELECT
           COALESCE(SUM(stock_actuel * cout_revient), 0) AS valeur_stock,
           COUNT(*) FILTER (WHERE stock_actuel <= stock_minimum AND stock_minimum > 0) AS articles_en_alerte
         FROM articles_menu WHERE hotel_id = ? AND actif = true`,
        [req.hotelId]
      ),

      fastify.db.raw(
        `SELECT DATE(cree_le) AS jour, COALESCE(SUM(quantite), 0) AS sorties
         FROM mouvements_stock
         WHERE hotel_id = ? AND type_mouvement IN ('sortie', 'perte')
           AND cree_le >= NOW() - INTERVAL '30 days'
         GROUP BY jour ORDER BY jour`,
        [req.hotelId]
      ),

      fastify.db.raw(
        `SELECT a.nom, COALESCE(SUM(ms.quantite * a.cout_revient), 0) AS valeur_consommee
         FROM mouvements_stock ms
         JOIN articles_menu a ON a.id = ms.article_id
         WHERE ms.hotel_id = ? AND ms.type_mouvement = 'sortie'
           AND ms.cree_le >= NOW() - INTERVAL '30 days'
         GROUP BY a.id, a.nom ORDER BY valeur_consommee DESC LIMIT 5`,
        [req.hotelId]
      ),

      fastify.db.raw(
        `SELECT a.id, a.nom, a.stock_actuel, a.cout_revient,
                (a.stock_actuel * a.cout_revient) AS valeur_immobilisee
         FROM articles_menu a
         WHERE a.hotel_id = ? AND a.actif = true AND a.stock_actuel > 0
           AND a.id NOT IN (
             SELECT DISTINCT article_id FROM mouvements_stock
             WHERE hotel_id = ? AND type_mouvement = 'sortie'
               AND cree_le >= NOW() - INTERVAL '14 days'
           )
         ORDER BY valeur_immobilisee DESC LIMIT 10`,
        [req.hotelId, req.hotelId]
      ),
    ])

    const result = {
      valeur_stock:       parseFloat(valeurStockQ.rows[0]?.valeur_stock || 0),
      articles_en_alerte: parseInt(valeurStockQ.rows[0]?.articles_en_alerte || 0),
      consommation_30j:   consommationQ.rows.map(r => ({ jour: r.jour, sorties: parseFloat(r.sorties) })),
      top_consommateurs:  topConsommateursQ.rows.map(r => ({ nom: r.nom, valeur_consommee: parseFloat(r.valeur_consommee) })),
      rotation_lente:     rotationLenteQ.rows.map(r => ({
        id: r.id, nom: r.nom,
        stock_actuel:       parseFloat(r.stock_actuel),
        cout_revient:       parseFloat(r.cout_revient),
        valeur_immobilisee: parseFloat(r.valeur_immobilisee),
      })),
    }

    await fastify.cache.set(cacheKey, result, 120)
    reply.send(result)
  })

  // ── GET /analytics/achats-analyse ───────────────────────────────────────
  // Dépenses par fournisseur, achats mensuels (3 derniers mois fixes),
  // taux de service. Défaut période fournisseurs : 3 derniers mois. Cache 300s.
  fastify.get('/achats-analyse', { preHandler: [...pre, rolesAnalyseAvancee] }, async (req, reply) => {
    const maintenant  = new Date()
    const debutDefaut = new Date(maintenant.getFullYear(), maintenant.getMonth() - 3, maintenant.getDate()).toISOString().slice(0, 10)
    const finDefaut   = maintenant.toISOString().slice(0, 10)
    const debut = req.query.debut || debutDefaut
    const fin   = req.query.fin   || finDefaut

    const cacheKey = `analytics:achatsanalyse:${req.hotelId}:${debut}:${fin}`
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const [fournisseursQ, achatsParMoisQ, tauxServiceQ] = await Promise.all([
      fastify.db.raw(
        `SELECT f.nom, COUNT(DISTINCT ba.id) AS nb_bons,
                COALESCE(SUM(lba.quantite_commandee * lba.prix_unitaire), 0) AS montant_commande,
                COALESCE(SUM(lba.quantite_recue * lba.prix_unitaire), 0) AS montant_recu,
                AVG(EXTRACT(EPOCH FROM (ba.date_reception - ba.date_commande)) / 86400) AS delai_moyen_jours
         FROM bons_achat ba
         JOIN fournisseurs f ON f.id = ba.fournisseur_id
         JOIN lignes_bon_achat lba ON lba.bon_achat_id = ba.id
         WHERE ba.hotel_id = ? AND ba.date_commande BETWEEN ? AND ?
           AND ba.statut IN ('recu', 'recu_partiel')
         GROUP BY f.id, f.nom ORDER BY montant_recu DESC`,
        [req.hotelId, debut, fin]
      ),

      fastify.db.raw(
        `SELECT DATE_TRUNC('month', ba.date_commande) AS mois,
                COALESCE(SUM(lba.quantite_commandee * lba.prix_unitaire), 0) AS montant
         FROM bons_achat ba
         JOIN lignes_bon_achat lba ON lba.bon_achat_id = ba.id
         WHERE ba.hotel_id = ? AND ba.date_commande >= NOW() - INTERVAL '3 months'
         GROUP BY mois ORDER BY mois`,
        [req.hotelId]
      ),

      fastify.db.raw(
        `SELECT
           COALESCE(SUM(lba.quantite_commandee), 0) AS total_commande,
           COALESCE(SUM(lba.quantite_recue), 0) AS total_recu
         FROM lignes_bon_achat lba
         JOIN bons_achat ba ON ba.id = lba.bon_achat_id
         WHERE ba.hotel_id = ? AND ba.statut IN ('recu', 'recu_partiel')
           AND ba.date_commande BETWEEN ? AND ?`,
        [req.hotelId, debut, fin]
      ),
    ])

    const fournisseurs = fournisseursQ.rows.map(r => ({
      nom:               r.nom,
      nb_bons:           parseInt(r.nb_bons),
      montant_commande:  parseFloat(r.montant_commande),
      montant_recu:      parseFloat(r.montant_recu),
      delai_moyen_jours: r.delai_moyen_jours !== null ? Math.round(parseFloat(r.delai_moyen_jours) * 10) / 10 : null,
    }))

    const achatsParMois = achatsParMoisQ.rows.map(r => ({ mois: r.mois, montant: parseFloat(r.montant) }))

    const totalCommande = parseFloat(tauxServiceQ.rows[0]?.total_commande || 0)
    const totalRecu      = parseFloat(tauxServiceQ.rows[0]?.total_recu || 0)
    const tauxService     = totalCommande > 0 ? Math.round((totalRecu / totalCommande) * 10000) / 100 : 0

    const result = { fournisseurs, achats_par_mois: achatsParMois, taux_service: tauxService }

    await fastify.cache.set(cacheKey, result, 300)
    reply.send(result)
  })
}
