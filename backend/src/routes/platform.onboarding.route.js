'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// platform.onboarding.route.js — Onboarding client SaaS (super_admin uniquement)
//
// Permet de créer un nouveau client depuis le SuperAdmin sans accès SQL.
//
// Parcours :
//   POST /platform/tenants                      → Créer l'organisation
//   POST /platform/tenants/:id/subscription     → Assigner un abonnement
//   POST /platform/tenants/:id/provision-manager → Créer le manager principal
//
// INVARIANTS :
//   ① JWT scope=platform obligatoire sur toutes les routes
//   ② AuditEngine strict sur TENANT_CREE et MANAGER_PROVISIONNE
//   ③ PolicyEngine vérifie le quota utilisateurs avant provision
//   ④ TenantLifecycleEngine gère la transition lead → essai
//   ⑤ Le mot de passe temporaire n'est JAMAIS stocké en clair ni loggué
//   ⑥ Index UNIQUE DB garantit un seul contact principal par tenant
// ─────────────────────────────────────────────────────────────────────────────

const { randomUUID }  = require('crypto')
const { randomBytes } = require('crypto')
const { getPlan }     = require('../engines/plans.config')

// Génère un slug à partir d'un nom (ex: "Groupe Royal" → "groupe-royal")
function slugifier(nom) {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // enlève les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Génère un mot de passe sécurisé de 16 chars URL-safe
function genererMotDePasseTemp() {
  return randomBytes(12).toString('base64url')
}

module.exports = async function platformOnboardingRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.scopePlateforme]

  // ── POST /platform/tenants ────────────────────────────────────────────────
  //
  // Crée une nouvelle organisation cliente. Statut initial : 'lead'.
  // Remplace l'ancien POST /api/v1/tenants (non sécurisé, sans audit).
  //
  // Body :
  //   nom           string  requis
  //   pays          string  requis  (ex: "Cameroun", "CM", "Maroc"…)
  //   email_contact string  requis  (email de l'organisation)
  //   devise_defaut string  optionnel  défaut: XAF
  //   telephone     string  optionnel
  //   adresse       string  optionnel
  //   slug          string  optionnel  auto-généré depuis nom si absent
  //
  fastify.post('/tenants', {
    preHandler: pre,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const {
      nom, pays, email_contact,
      devise_defaut = 'XAF',
      telephone = null,
      adresse   = null,
      slug: slugInput = null,
    } = req.body || {}

    // ── Validation ───────────────────────────────────────────────────────────
    const manquants = []
    if (!nom?.trim())           manquants.push('nom')
    if (!pays?.trim())          manquants.push('pays')
    if (!email_contact?.trim()) manquants.push('email_contact')

    if (manquants.length > 0) {
      return reply.status(400).send({
        erreur: 'Champs obligatoires manquants',
        champs: manquants,
        code:   'VALIDATION_ECHEC',
      })
    }

    // Validation email basique
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_contact.trim())) {
      return reply.status(400).send({
        erreur: 'Format email invalide',
        code:   'EMAIL_FORMAT_INVALIDE',
      })
    }

    const emailNormalise = email_contact.trim().toLowerCase()
    const nomNormalise   = nom.trim()
    const slug           = slugInput?.trim() || slugifier(nomNormalise)

    // ── Unicité email_contact ────────────────────────────────────────────────
    const emailExistant = await fastify.db('tenants')
      .where(fastify.db.raw('LOWER(email_contact) = ?', [emailNormalise]))
      .first()

    if (emailExistant) {
      return reply.status(409).send({
        erreur: `Un tenant utilise déjà l'email "${emailNormalise}"`,
        code:   'EMAIL_DEJA_UTILISE',
      })
    }

    // ── Unicité slug (avec fallback suffixe si collision) ───────────────────
    let slugFinal = slug
    const slugExistant = await fastify.db('tenants').where({ slug }).first()
    if (slugExistant) {
      // Ajouter un suffixe court pour éviter le blocage
      slugFinal = `${slug}-${randomBytes(3).toString('hex')}`
    }

    // ── Création tenant (INSERT avant audit — FK logs_audit.tenant_id → tenants) ─
    const tenantId = randomUUID()

    const [tenant] = await fastify.db('tenants').insert({
      id:            tenantId,
      nom:           nomNormalise,
      slug:          slugFinal,
      email_contact: emailNormalise,
      pays:          pays.trim(),
      devise_defaut: devise_defaut.trim().toUpperCase(),
      telephone:     telephone?.trim() || null,
      adresse:       adresse?.trim()   || null,
      statut:        'lead',
    }).returning('*')

    // Audit APRÈS INSERT — la FK logs_audit.tenant_id → tenants exige que le tenant existe
    await fastify.audit.log({
      event:          'TENANT_CREE',
      actor:          { id: req.user.id, role: req.user.role, ip: req.ip },
      target:         { type: 'tenant', id: tenantId },
      new_state:      { nom: nomNormalise, pays, email_contact: emailNormalise, devise_defaut },
      tenant_id:      tenantId,
      correlation_id: req.correlationId,
      strict:         true,
    })

    req.log.info({
      event:     'TENANT_CREE',
      tenant_id: tenantId,
      nom:       nomNormalise,
    }, 'Nouveau tenant créé')

    return reply.status(201).send({
      message: 'Organisation créée',
      tenant,
    })
  })

  // ── POST /platform/tenants/:id/subscription ───────────────────────────────
  //
  // Assigne un abonnement à un tenant et déclenche la transition lead → essai.
  //
  // Body :
  //   plan             string  requis   (essai | starter | business | ohada+ | enterprise)
  //   montant_mensuel  number  optionnel  défaut = prix catalogue du plan
  //   devise           string  optionnel  défaut = devise_defaut du tenant
  //
  fastify.post('/tenants/:id/subscription', {
    preHandler: pre,
  }, async (req, reply) => {
    const { id } = req.params
    const {
      plan,
      montant_mensuel: montantInput = null,
      devise: deviseInput = null,
    } = req.body || {}

    // ── Validation plan ──────────────────────────────────────────────────────
    if (!plan?.trim()) {
      return reply.status(400).send({
        erreur: 'Le champ "plan" est obligatoire',
        code:   'VALIDATION_ECHEC',
      })
    }

    const planConfig = getPlan(plan.toLowerCase())
    if (!planConfig) {
      return reply.status(400).send({
        erreur: `Plan inconnu : "${plan}". Plans disponibles : essai, starter, business, ohada+, enterprise`,
        code:   'PLAN_INCONNU',
      })
    }

    // ── Vérifier tenant ──────────────────────────────────────────────────────
    const tenant = await fastify.db('tenants').where({ id }).first()
    if (!tenant) {
      return reply.status(404).send({
        erreur: 'Organisation introuvable',
        code:   'TENANT_INTROUVABLE',
      })
    }

    // ── Vérifier doublon abonnement actif ────────────────────────────────────
    const abonnExistant = await fastify.db('abonnements')
      .where({ tenant_id: id })
      .whereIn('statut', ['actif', 'essai'])
      .first()

    if (abonnExistant) {
      return reply.status(409).send({
        erreur:      `Ce tenant a déjà un abonnement ${abonnExistant.statut} (plan: ${abonnExistant.plan})`,
        code:        'ABONNEMENT_DEJA_ACTIF',
        abonnement:  { id: abonnExistant.id, plan: abonnExistant.plan, statut: abonnExistant.statut },
      })
    }

    // ── Résoudre montant et devise ───────────────────────────────────────────
    const montant = montantInput !== null && montantInput !== undefined
      ? parseFloat(montantInput)
      : planConfig.prix_mensuel_xaf

    const devise = deviseInput?.trim().toUpperCase() || tenant.devise_defaut || 'XAF'

    // ── Créer l'abonnement ───────────────────────────────────────────────────
    const [abonnement] = await fastify.db('abonnements').insert({
      tenant_id:        id,
      plan:             plan.toLowerCase(),
      statut:           'essai',
      date_debut:       new Date().toISOString().split('T')[0],
      max_hotels:       planConfig.max_hotels,
      max_chambres:     planConfig.max_chambres,
      max_utilisateurs: planConfig.max_utilisateurs,
      montant_mensuel:  montant,
      devise,
    }).returning('*')

    // ── Transition lifecycle lead → essai ────────────────────────────────────
    // Uniquement si le tenant est en état 'lead' (premier abonnement)
    let transitionResult = null
    if (tenant.statut === 'lead') {
      try {
        transitionResult = await fastify.tenantLifecycle.transition(id, 'activer', {
          motif:  `Abonnement ${plan} assigné`,
          actor:  { id: req.user.id, role: req.user.role, ip: req.ip, correlation_id: req.correlationId },
        })
      } catch (err) {
        // TRANSITION_INTERDITE ne doit pas arriver ici (on a vérifié statut='lead')
        // Si ça arrive, on log mais on ne rollback pas l'abonnement déjà créé
        req.log.error({
          err: err.message,
          tenant_id: id,
          statut_actuel: tenant.statut,
        }, 'Transition lifecycle échouée après création abonnement — abonnement conservé')
      }
    }

    // ── Audit ────────────────────────────────────────────────────────────────
    await fastify.audit.log({
      event:          'ABONNEMENT_ASSIGNE',
      actor:          { id: req.user.id, role: req.user.role, ip: req.ip },
      target:         { type: 'abonnement', id: abonnement.id },
      new_state:      { plan: abonnement.plan, montant_mensuel: montant, devise },
      tenant_id:      id,
      correlation_id: req.correlationId,
    })

    // Invalider le cache subscription du tenant
    await fastify.cache.del(`tenant:${id}:subscription`)

    return reply.status(201).send({
      message:           'Abonnement assigné',
      abonnement,
      tenant_statut:     transitionResult?.tenant?.statut || tenant.statut,
      transition:        transitionResult?.transition || null,
    })
  })

  // ── POST /platform/tenants/:id/provision-manager ──────────────────────────
  //
  // Crée le premier manager (contact principal) d'un tenant.
  // Si aucun mot de passe fourni, génère un mot de passe temporaire et
  // le retourne UNE SEULE FOIS dans la réponse (jamais stocké en clair).
  //
  // Body :
  //   prenom        string  requis
  //   nom           string  requis
  //   email         string  requis
  //   mot_de_passe  string  optionnel  — si absent, généré automatiquement
  //
  // Sécurité : le mot de passe temporaire n'est jamais loggué (response body
  // non inclus dans les logs pino par défaut).
  //
  fastify.post('/tenants/:id/provision-manager', {
    preHandler: pre,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const { id } = req.params
    const {
      prenom,
      nom: nomManager,
      email,
      mot_de_passe: mdpFourni = null,
    } = req.body || {}

    // ── Validation ───────────────────────────────────────────────────────────
    const manquants = []
    if (!prenom?.trim())  manquants.push('prenom')
    if (!nomManager?.trim()) manquants.push('nom')
    if (!email?.trim())   manquants.push('email')

    if (manquants.length > 0) {
      return reply.status(400).send({
        erreur: 'Champs obligatoires manquants',
        champs: manquants,
        code:   'VALIDATION_ECHEC',
      })
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return reply.status(400).send({
        erreur: 'Format email invalide',
        code:   'EMAIL_FORMAT_INVALIDE',
      })
    }

    const emailNormalise = email.trim().toLowerCase()

    // ── Vérifier tenant ──────────────────────────────────────────────────────
    const tenant = await fastify.db('tenants').where({ id }).first()
    if (!tenant) {
      return reply.status(404).send({
        erreur: 'Organisation introuvable',
        code:   'TENANT_INTROUVABLE',
      })
    }

    // ── Vérifier abonnement requis ───────────────────────────────────────────
    const abonnement = await fastify.db('abonnements')
      .where({ tenant_id: id })
      .whereIn('statut', ['actif', 'essai'])
      .first()

    if (!abonnement) {
      return reply.status(400).send({
        erreur: 'Un abonnement actif ou essai est requis avant de provisionner un manager',
        code:   'ABONNEMENT_REQUIS',
      })
    }

    // ── Vérifier quota utilisateurs (PolicyEngine) ───────────────────────────
    const [subCtx, nbUsers] = await Promise.all([
      fastify.policy.loadSubscriptionContext(id),
      fastify.db('utilisateurs').where({ tenant_id: id, actif: true }).count('id AS nb').first(),
    ])

    const policyResult = await fastify.policy.evaluate('utilisateur.create', {
      plan:             subCtx.plan,
      nb_utilisateurs:  parseInt(nbUsers?.nb || 0),
      max_utilisateurs: subCtx.max_utilisateurs,
    })

    if (!policyResult.allowed) {
      return reply.status(403).send({ ...policyResult, code: policyResult.code || 'QUOTA_UTILISATEURS' })
    }

    // ── Unicité email dans le tenant ─────────────────────────────────────────
    const emailExistant = await fastify.db('utilisateurs')
      .where({ tenant_id: id })
      .where(fastify.db.raw('LOWER(email) = ?', [emailNormalise]))
      .first()

    if (emailExistant) {
      return reply.status(409).send({
        erreur: `L'email "${emailNormalise}" est déjà utilisé dans cette organisation`,
        code:   'EMAIL_DEJA_UTILISE',
      })
    }

    // ── Préparer le mot de passe ─────────────────────────────────────────────
    const mdpGenere       = !mdpFourni
    const mdpTemporaire   = mdpGenere ? genererMotDePasseTemp() : mdpFourni
    const mdpHash         = await fastify.hashMotDePasse(mdpTemporaire)

    // ── Audit avant INSERT (fail-closed) ─────────────────────────────────────
    const managerId = randomUUID()

    await fastify.audit.log({
      event:          'MANAGER_PROVISIONNE',
      actor:          { id: req.user.id, role: req.user.role, ip: req.ip },
      target:         { type: 'utilisateur', id: managerId },
      new_state:      { email: emailNormalise, role: 'manager', is_primary_contact: true, mdp_genere: mdpGenere },
      tenant_id:      id,
      correlation_id: req.correlationId,
      strict:         true,
    })

    // ── Créer le manager ─────────────────────────────────────────────────────
    const [manager] = await fastify.db('utilisateurs').insert({
      id:                 managerId,
      tenant_id:          id,
      email:              emailNormalise,
      prenom:             prenom.trim(),
      nom:                nomManager.trim(),
      role:               'manager',
      actif:              true,
      mot_de_passe_hash:  mdpHash,
      is_primary_contact: true,
      doit_changer_mdp:   mdpGenere,   // force changement si MDP était temporaire
    }).returning(['id', 'email', 'prenom', 'nom', 'role', 'is_primary_contact', 'doit_changer_mdp'])

    // Invalider le cache quota du tenant
    await fastify.cache.del(`tenant:${id}:subscription`)

    req.log.info({
      event:      'MANAGER_PROVISIONNE',
      tenant_id:  id,
      manager_id: managerId,
      mdp_genere: mdpGenere,
    }, 'Manager principal provisionné')

    // ── Réponse — mot de passe temporaire retourné UNE SEULE FOIS ────────────
    return reply.status(201).send({
      message:  'Manager principal créé',
      manager,
      ...(mdpGenere && { mot_de_passe_temporaire: mdpTemporaire }),
      instructions: mdpGenere
        ? 'Ce mot de passe ne sera plus jamais affiché. Le manager devra le modifier à sa première connexion.'
        : 'Le manager peut se connecter avec le mot de passe fourni.',
    })
  })
}
