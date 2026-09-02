'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// routes/platform.route.js — Opérateur Plateforme SaaS (super_admin uniquement)
//
// Toutes les routes requièrent scope='platform' (décorateur scopePlateforme).
// Aucune route ici n'est accessible à un rôle exploitation (manager, réception…).
//
// Données exposées : métriques agrégées multi-tenant, jamais données brutes clients.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function platformRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.scopePlateforme]

  // ── GET /platform/dashboard ── Cockpit opérateur complet ─────────────────
  fastify.get('/dashboard', { preHandler: pre }, async (req, reply) => {
    const cacheKey = 'platform:dashboard:v2'
    const cached = await fastify.cache.get(cacheKey)
    if (cached) return reply.send(cached)

    const aujourd_hui = new Date().toISOString().split('T')[0]
    const il_y_a_7j   = new Date(Date.now() -  7 * 86400000).toISOString().split('T')[0]
    const il_y_a_30j  = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]

    const [
      tenantsParStatut,
      abonnementsQ,
      hotelsQ,
      chambresQ,
      reservationsJourQ,
      reservationsActivesQ,
      paiementsJourQ,
      paiements30jQ,
      ticketsUrgentsQ,
      derniersLogsQ,
      iaConso,
      kpi7jQ,
      geoQ,
    ] = await Promise.all([
      fastify.db('tenants').select('statut').count('id AS nb').groupBy('statut'),
      fastify.db('abonnements').select('plan', 'statut').sum('montant_mensuel AS mrr').count('id AS nb').groupBy('plan', 'statut'),
      fastify.db('hotels').count('id AS total').first(),
      fastify.db('chambres').count('id AS total').first(),
      fastify.db('reservations').whereRaw('DATE(cree_le) = ?', [aujourd_hui]).count('id AS nb').first(),
      fastify.db('reservations').whereIn('statut', ['arrivee', 'depart_aujourd_hui']).count('id AS nb').first(),
      fastify.db('paiements').where('statut', 'valide').whereRaw("DATE(COALESCE(traite_le, cree_le)) = ?", [aujourd_hui]).sum('montant AS total').first(),
      fastify.db('paiements').where('statut', 'valide').whereRaw("DATE(COALESCE(traite_le, cree_le)) >= ?", [il_y_a_30j]).sum('montant AS total').first(),
      fastify.db('tickets_maintenance').where('priorite', 'urgente').whereNotIn('statut', ['resolu', 'ferme']).count('id AS nb').first(),
      fastify.db('logs_audit').select('action', 'module', 'cree_le').orderBy('cree_le', 'desc').limit(8),
      fastify.db('historique_ia').count('id AS total').first().catch(() => ({ total: 0 })),
      fastify.db('analytics_quotidiennes').where('date', '>=', il_y_a_7j).avg('taux_occupation AS occ').avg('revenu_total AS rev').first().catch(() => null),
      fastify.db('tenants AS t').leftJoin('hotels AS h', 'h.tenant_id', 't.id').select('t.pays', fastify.db.raw('COUNT(h.id) as nb_hotels'), fastify.db.raw('COUNT(DISTINCT t.id) as nb_tenants')).groupBy('t.pays').orderBy('nb_hotels', 'desc'),
    ])

    // Tenants
    const ts = { actif: 0, essai: 0, suspendu: 0 }
    for (const r of tenantsParStatut) ts[r.statut] = parseInt(r.nb || 0)
    const nbTenants = Object.values(ts).reduce((a, b) => a + b, 0)

    // MRR
    const mrr = abonnementsQ.filter(r => r.statut === 'actif').reduce((s, r) => s + parseFloat(r.mrr || 0), 0)
    const plans = {}
    for (const r of abonnementsQ) {
      if (!plans[r.plan]) plans[r.plan] = { nb: 0, mrr: 0 }
      plans[r.plan].nb  += parseInt(r.nb || 0)
      plans[r.plan].mrr += parseFloat(r.mrr || 0)
    }

    const result = {
      horodatage: new Date().toISOString(),
      tenants:    { total: nbTenants, actifs: ts.actif, essai: ts.essai, suspendus: ts.suspendu },
      infrastructure: {
        hotels:           parseInt(hotelsQ?.total || 0),
        chambres_totales: parseInt(chambresQ?.total || 0),
        clients_actifs:   parseInt(reservationsActivesQ?.nb || 0),
      },
      saas: {
        mrr_xaf:  Math.round(mrr),
        arr_xaf:  Math.round(mrr * 12),
        plans,
        ca_30j:   Math.round(parseFloat(paiements30jQ?.total || 0)),
      },
      activite_live: {
        reservations_jour:  parseInt(reservationsJourQ?.nb || 0),
        encaissements_jour: Math.round(parseFloat(paiementsJourQ?.total || 0)),
        checkouts_actifs:   parseInt(reservationsActivesQ?.nb || 0),
        tokens_ia_total:    parseInt(iaConso?.total || 0),
      },
      performance: {
        occ_moy_7j_pct: kpi7jQ?.occ ? Math.round(parseFloat(kpi7jQ.occ)) : null,
        rev_moy_7j:     kpi7jQ?.rev ? Math.round(parseFloat(kpi7jQ.rev)) : null,
      },
      alertes: {
        tickets_urgents: parseInt(ticketsUrgentsQ?.nb || 0),
        tenants_suspendus: ts.suspendu,
      },
      couverture_geo: geoQ.map(r => ({
        pays: r.pays, nb_hotels: parseInt(r.nb_hotels || 0), nb_tenants: parseInt(r.nb_tenants || 0),
      })),
      activite_stream: derniersLogsQ.map(l => ({
        action: l.action, module: l.module, cree_le: l.cree_le,
      })),
    }

    await fastify.cache.set(cacheKey, result, 30)
    return reply.send(result)
  })

  // ── GET /platform/tenants ─────────────────────────────────────────────────
  // Liste complète des tenants avec stats et abonnement.
  fastify.get('/tenants', { preHandler: pre }, async (req, reply) => {
    const { statut, page = 1, limite = 20 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    let query = fastify.db('tenants AS t')
      .leftJoin(
        fastify.db.raw(`(
          SELECT DISTINCT ON (tenant_id)
            tenant_id, plan, statut, max_hotels, max_chambres,
            max_utilisateurs, montant_mensuel, devise, date_fin
          FROM abonnements
          ORDER BY tenant_id,
            CASE WHEN statut = 'actif' THEN 0 WHEN statut = 'essai' THEN 1 ELSE 2 END,
            cree_le DESC
        ) AS a`),
        'a.tenant_id', 't.id'
      )
      .leftJoin(
        fastify.db('hotels').count('id AS nb').select('tenant_id').groupBy('tenant_id').as('h'),
        'h.tenant_id', 't.id'
      )
      .leftJoin(
        fastify.db('utilisateurs').count('id AS nb').select('tenant_id').groupBy('tenant_id').as('u'),
        'u.tenant_id', 't.id'
      )
      .select(
        't.id', 't.nom', 't.slug', 't.pays', 't.email_contact',
        't.statut', 't.devise_defaut', 't.cree_le',
        'a.plan', 'a.statut AS abonnement_statut',
        'a.max_hotels', 'a.max_chambres', 'a.max_utilisateurs',
        'a.montant_mensuel', 'a.devise AS abonnement_devise',
        'a.date_fin AS abonnement_fin',
        fastify.db.raw('COALESCE(h.nb::int, 0) AS nb_hotels'),
        fastify.db.raw('COALESCE(u.nb::int, 0) AS nb_utilisateurs'),
      )
      .orderBy('t.cree_le', 'desc')

    if (statut) query = query.where('t.statut', statut)

    const [tenants, compteurRows] = await Promise.all([
      query.limit(parseInt(limite)).offset(offset),
      fastify.db('tenants').count('id AS total').modify(q => {
        if (statut) q.where('statut', statut)
      }).first(),
    ])

    return reply.send({
      tenants,
      pagination: {
        page:   parseInt(page),
        limite: parseInt(limite),
        total:  parseInt(compteurRows?.total || 0),
      },
    })
  })

  // ── GET /platform/tenants/:id ─────────────────────────────────────────────
  // Profil détaillé d'un tenant avec hôtels, utilisateurs, abonnement.
  fastify.get('/tenants/:id', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params

    const [tenant, abonnement, hotels, utilisateurs] = await Promise.all([
      fastify.db('tenants').where({ id }).first(),
      fastify.db('abonnements').where({ tenant_id: id }).first(),
      fastify.db('hotels').where({ tenant_id: id }).select('id', 'nom', 'actif', 'cree_le'),
      fastify.db('utilisateurs').where({ tenant_id: id, actif: true })
        .select('id', 'email', 'prenom', 'nom', 'role', 'derniere_connexion'),
    ])

    if (!tenant) return reply.status(404).send({ erreur: 'Tenant introuvable' })

    return reply.send({ tenant, abonnement, hotels, utilisateurs })
  })

  // ── PATCH /platform/tenants/:id/suspend ──────────────────────────────────
  // ── PATCH /platform/tenants/:id/suspend ──────────────────────────────────
  // Délègue au TenantLifecycleEngine — garantit : audit strict + révocation sessions + cache
  fastify.patch('/tenants/:id/suspend', {
    preHandler: pre,
    config: { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator: (req) => req.user?.id || req.ip } }
  }, async (req, reply) => {
    const { id } = req.params
    const { motif = '' } = req.body || {}

    try {
      const result = await fastify.tenantLifecycle.transition(id, 'suspendre', {
        motif,
        actor: { id: req.user.id, role: req.user.role, ip: req.ip, correlation_id: req.correlationId },
      })
      return reply.send({
        message:            'Tenant suspendu',
        tenant_id:          id,
        sessions_revoquees: result.sessions_revoked,
        etat:               result.transition,
      })
    } catch (err) {
      if (err.code === 'TENANT_INTROUVABLE')   return reply.status(404).send({ erreur: err.message, code: err.code })
      if (err.code === 'TRANSITION_INTERDITE') return reply.status(409).send({ erreur: err.message, code: err.code })
      if (err.code === 'AUDIT_WRITE_FAILURE')  return reply.status(500).send({ erreur: 'Audit requis impossible — opération annulée', code: err.code })
      throw err
    }
  })

  // ── PATCH /platform/tenants/:id/activate ─────────────────────────────────
  fastify.patch('/tenants/:id/activate', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params

    try {
      const result = await fastify.tenantLifecycle.transition(id, 'activer', {
        actor: { id: req.user.id, role: req.user.role, ip: req.ip, correlation_id: req.correlationId },
      })
      return reply.send({
        message:   'Tenant activé',
        tenant_id: id,
        etat:      result.transition,
      })
    } catch (err) {
      if (err.code === 'TENANT_INTROUVABLE')   return reply.status(404).send({ erreur: err.message, code: err.code })
      if (err.code === 'TRANSITION_INTERDITE') return reply.status(409).send({ erreur: err.message, code: err.code })
      throw err
    }
  })

  // ── GET /platform/tenants/:id/lifecycle ───────────────────────────────────
  // Profil lifecycle complet : état, transitions disponibles, utilisation, plan.
  fastify.get('/tenants/:id/lifecycle', { preHandler: pre }, async (req, reply) => {
    const profile = await fastify.tenantLifecycle.getLifecycleProfile(req.params.id)
    if (!profile) return reply.status(404).send({ erreur: 'Tenant introuvable', code: 'TENANT_INTROUVABLE' })
    return reply.send(profile)
  })

  // ── GET /platform/billing/mrr ─────────────────────────────────────────────
  // Monthly Recurring Revenue agrégé par plan.
  fastify.get('/billing/mrr', { preHandler: pre }, async (req, reply) => {
    const rows = await fastify.db('abonnements')
      .where('statut', 'actif')
      .select('plan', 'devise')
      .sum('montant_mensuel AS mrr')
      .count('id AS nb_tenants')
      .groupBy('plan', 'devise')
      .orderBy('mrr', 'desc')

    const mrr_total = rows.reduce((sum, r) => sum + parseFloat(r.mrr || 0), 0)

    // Tenants en essai (revenus potentiels)
    const essais = await fastify.db('abonnements')
      .where('statut', 'essai')
      .count('id AS nb')
      .first()

    return reply.send({
      mrr_total_xaf: Math.round(mrr_total),
      arr_projete_xaf: Math.round(mrr_total * 12),
      par_plan: rows.map(r => ({
        plan:       r.plan,
        mrr_xaf:    Math.round(parseFloat(r.mrr || 0)),
        nb_tenants: parseInt(r.nb_tenants || 0),
        devise:     r.devise,
      })),
      tenants_essai: parseInt(essais?.nb || 0),
    })
  })

  // ── GET /platform/audit ───────────────────────────────────────────────────
  // Journal d'audit cross-tenant.
  fastify.get('/audit', { preHandler: pre }, async (req, reply) => {
    const {
      tenant_id, hotel_id, action, module: mod,
      page = 1, limite = 50,
    } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    let query = fastify.db('logs_audit AS la')
      .leftJoin('utilisateurs AS u', 'u.id', 'la.utilisateur_id')
      .leftJoin('tenants AS t',      't.id', 'la.tenant_id')
      .select(
        'la.id', 'la.action', 'la.module', 'la.ressource_type', 'la.ressource_id',
        'la.nouvelles_valeurs', 'la.anciennes_valeurs',
        'la.ip_address', 'la.cree_le',
        'u.email AS utilisateur_email', 'u.role AS utilisateur_role',
        't.nom AS tenant_nom',
      )
      .orderBy('la.cree_le', 'desc')

    if (tenant_id) query = query.where('la.tenant_id', tenant_id)
    if (hotel_id)  query = query.where('la.hotel_id', hotel_id)
    if (action)    query = query.where('la.action', action)
    if (mod)       query = query.where('la.module', mod)

    const [logs, total] = await Promise.all([
      query.limit(parseInt(limite)).offset(offset),
      fastify.db('logs_audit').count('id AS total')
        .modify(q => {
          if (tenant_id) q.where('tenant_id', tenant_id)
          if (hotel_id)  q.where('hotel_id', hotel_id)
          if (action)    q.where('action', action)
          if (mod)       q.where('module', mod)
        }).first(),
    ])

    return reply.send({
      logs,
      pagination: {
        page:   parseInt(page),
        limite: parseInt(limite),
        total:  parseInt(total?.total || 0),
      },
    })
  })

  // ── GET /platform/ai/consumption ─────────────────────────────────────────
  // Consommation IA cross-tenant depuis historique_ia (si disponible).
  fastify.get('/ai/consumption', { preHandler: pre }, async (req, reply) => {
    // Tenter de lire depuis historique_ia — table peut ne pas exister selon migration
    const rows = await fastify.db('historique_ia')
      .select('hotel_id', 'type_analyse')
      .count('id AS nb_appels')
      .groupBy('hotel_id', 'type_analyse')
      .orderBy('nb_appels', 'desc')
      .catch(() => [])  // table absente → tableau vide sans crash

    // Enrichir avec tenant_id depuis hotels
    const hotelIds = [...new Set(rows.map(r => r.hotel_id).filter(Boolean))]
    const hotels = hotelIds.length
      ? await fastify.db('hotels').whereIn('id', hotelIds).select('id', 'nom', 'tenant_id')
      : []
    const hotelMap = Object.fromEntries(hotels.map(h => [h.id, h]))

    const enriched = rows.map(r => ({
      hotel_id:     r.hotel_id,
      hotel_nom:    hotelMap[r.hotel_id]?.nom || null,
      tenant_id:    hotelMap[r.hotel_id]?.tenant_id || null,
      type_analyse: r.type_analyse,
      nb_appels:    parseInt(r.nb_appels || 0),
    }))

    const total_appels = enriched.reduce((s, r) => s + r.nb_appels, 0)

    return reply.send({
      total_appels,
      par_hotel: enriched,
      note: total_appels === 0
        ? 'Aucune donnée IA enregistrée — table historique_ia vide ou absente'
        : null,
    })
  })

  // ── GET /platform/tenants/:id/lifecycle ── DÉJÀ ajouté ci-dessus ────────
  // ── GET /platform/tenants/:id ─────────────────────────────────────────────

  // ── GET /platform/policy/refusals ────────────────────────────────────────
  // Observabilité Policy Engine : liste les refus de politique récents.
  fastify.get('/policy/refusals', { preHandler: pre }, async (req, reply) => {
    const { page = 1, limite = 50 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limite)

    // Les refus policy sont loggués dans logs_audit avec action='POLICY_DENIED' (future)
    // Pour l'instant, on retourne les 403 loggués via logs applicatifs structurés
    // En attendant la colonne policy_code dans logs_audit, on filtre par action QUOTA_*
    const [refusals, total] = await Promise.all([
      fastify.db('logs_audit AS la')
        .leftJoin('tenants AS t', 't.id', 'la.tenant_id')
        .select('la.id', 'la.action', 'la.nouvelles_valeurs', 'la.cree_le', 't.nom AS tenant_nom')
        .where(q => q
          .where('la.action', 'like', 'QUOTA_%')
          .orWhere('la.action', 'like', 'POLICY_%')
          .orWhere('la.action', 'FEATURE_NON_DISPONIBLE')
        )
        .orderBy('la.cree_le', 'desc')
        .limit(parseInt(limite)).offset(offset),
      fastify.db('logs_audit').count('id AS total')
        .where(q => q
          .where('action', 'like', 'QUOTA_%')
          .orWhere('action', 'like', 'POLICY_%')
        ).first(),
    ])

    return reply.send({
      refusals,
      pagination: { page: parseInt(page), limite: parseInt(limite), total: parseInt(total?.total || 0) },
    })
  })

  // ── GET /platform/tenants/:id/quota ──────────────────────────────────────
  // Utilisation des quotas d'un tenant (via Policy Engine).
  fastify.get('/tenants/:id/quota', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params

    const [subCtx, nbHotels, nbUsers, nbSessions] = await Promise.all([
      fastify.policy.loadSubscriptionContext(id),
      fastify.db('hotels').where({ tenant_id: id }).count('id AS nb').first(),
      fastify.db('utilisateurs').where({ tenant_id: id, actif: true }).count('id AS nb').first(),
      fastify.db('sessions_actives').where({ tenant_id: id }).where('expire_le', '>', fastify.db.fn.now()).whereNull('revoque_le').count('jti AS nb').first(),
    ])

    const utilisation = {
      plan:    subCtx.plan,
      statut:  subCtx.statut,
      hotels: {
        actuel: parseInt(nbHotels?.nb || 0),
        max:    subCtx.max_hotels,
        pct:    subCtx.max_hotels > 0 ? Math.round((parseInt(nbHotels?.nb || 0) / subCtx.max_hotels) * 100) : null,
      },
      utilisateurs: {
        actuel: parseInt(nbUsers?.nb || 0),
        max:    subCtx.max_utilisateurs,
        pct:    subCtx.max_utilisateurs > 0 ? Math.round((parseInt(nbUsers?.nb || 0) / subCtx.max_utilisateurs) * 100) : null,
      },
      sessions_actives: parseInt(nbSessions?.nb || 0),
      modules:          subCtx.modules,
    }

    return reply.send(utilisation)
  })

  // ── PATCH /platform/tenants/:id/grace ────────────────────────────────────
  fastify.patch('/tenants/:id/grace', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    const { motif = '' } = req.body || {}
    try {
      const result = await fastify.tenantLifecycle.transition(id, 'grace', {
        motif,
        actor: { id: req.user.id, role: req.user.role, ip: req.ip, correlation_id: req.correlationId },
      })
      return reply.send({
        message:            'Tenant placé en période de grâce',
        tenant_id:          id,
        sessions_revoquees: result.sessions_revoked,
        etat:               result.transition,
      })
    } catch (err) {
      if (err.code === 'TENANT_INTROUVABLE')   return reply.status(404).send({ erreur: err.message, code: err.code })
      if (err.code === 'TRANSITION_INTERDITE') return reply.status(409).send({ erreur: err.message, code: err.code })
      if (err.code === 'AUDIT_WRITE_FAILURE')  return reply.status(500).send({ erreur: 'Audit requis impossible — opération annulée', code: err.code })
      throw err
    }
  })

  // ── PATCH /platform/tenants/:id/resilier ─────────────────────────────────
  fastify.patch('/tenants/:id/resilier', { preHandler: pre }, async (req, reply) => {
    const { id } = req.params
    const { motif = '' } = req.body || {}
    try {
      const result = await fastify.tenantLifecycle.transition(id, 'resilier', {
        motif,
        actor: { id: req.user.id, role: req.user.role, ip: req.ip, correlation_id: req.correlationId },
      })
      return reply.send({
        message:            'Tenant résilié',
        tenant_id:          id,
        sessions_revoquees: result.sessions_revoked,
        etat:               result.transition,
      })
    } catch (err) {
      if (err.code === 'TENANT_INTROUVABLE')   return reply.status(404).send({ erreur: err.message, code: err.code })
      if (err.code === 'TRANSITION_INTERDITE') return reply.status(409).send({ erreur: err.message, code: err.code })
      if (err.code === 'AUDIT_WRITE_FAILURE')  return reply.status(500).send({ erreur: 'Audit requis impossible — opération annulée', code: err.code })
      throw err
    }
  })

  // ── GET /platform/health ─────────────────────────────────────────────────
  // Santé technique détaillée (version enrichie du /health public).
  fastify.get('/health', { preHandler: pre }, async (req, reply) => {
    const debut = Date.now()
    let db_ok = false, db_latence = null

    try {
      const t = Date.now()
      await fastify.db.raw('SELECT 1')
      db_latence = Date.now() - t
      db_ok = true
    } catch {}

    const [nbTenants, nbHotels, nbReservations] = await Promise.all([
      fastify.db('tenants').count('id AS nb').first().catch(() => ({ nb: '?' })),
      fastify.db('hotels').count('id AS nb').first().catch(() => ({ nb: '?' })),
      fastify.db('reservations').count('id AS nb').first().catch(() => ({ nb: '?' })),
    ])

    return reply.send({
      statut:       db_ok ? 'healthy' : 'unhealthy',
      latence_ms:   Date.now() - debut,
      postgresql:   { statut: db_ok ? 'ok' : 'error', latence_ms: db_latence },
      cache:        { type: fastify.cache._type || 'memoire' },
      donnees: {
        tenants:      nbTenants?.nb,
        hotels:       nbHotels?.nb,
        reservations: nbReservations?.nb,
      },
      version:      process.env.APP_VERSION || '1.0.0',
      horodatage:   new Date().toISOString(),
    })
  })
}
