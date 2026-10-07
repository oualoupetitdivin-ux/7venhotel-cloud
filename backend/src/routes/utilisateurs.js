'use strict'
const crypto = require('crypto')

// ─────────────────────────────────────────────────────────────────────────────
// QA-01 — Création / modification de comptes : le corps de requête était inséré tel quel
// ({ ...req.body }). Démontré en réel : un manager pouvait créer un compte `super_admin`
// (jeton de portée PLATEFORME), rattacher un compte à l'hôtel d'un autre tenant, et en
// modification déplacer un compte vers un autre tenant ; la réponse renvoyait le hash du
// mot de passe. Les comptes créés n'avaient pas d'hôtel (inutilisables).
// Désormais : liste blanche de champs, rôles assignables (jamais super_admin), hôtel imposé
// et vérifié dans le tenant, mot de passe ≥ 8 (généré sinon), changement à la 1re connexion.
// ─────────────────────────────────────────────────────────────────────────────
const ROLES_ASSIGNABLES = ['manager', 'reception', 'housekeeping', 'restaurant', 'comptabilite', 'technicien']
const COLONNES_PUBLIQUES = ['id', 'email', 'prenom', 'nom', 'role', 'actif', 'hotel_id', 'telephone', 'doit_changer_mdp', 'derniere_connexion']

function erreur(reply, status, code, message) { return reply.status(status).send({ erreur: message, code }) }

module.exports = async function utilisateursRoutes(fastify) {
  const pre = [fastify.authentifier, fastify.verifierRole(['super_admin', 'manager']), fastify.resolveTenantContext]

  // Hôtel du compte : celui du manager ; pour le super_admin, un hôtel DU tenant ciblé
  async function hotelAutorise(req, hotelIdDemande) {
    if (req.user.role !== 'super_admin') {
      if (hotelIdDemande && hotelIdDemande !== req.user.hotel_id) return undefined   // refus explicite
      return req.user.hotel_id || null
    }
    const hotels = await fastify.db('hotels').where({ tenant_id: req.tenantId }).pluck('id')
    if (hotelIdDemande) return hotels.includes(hotelIdDemande) ? hotelIdDemande : undefined
    return hotels.length === 1 ? hotels[0] : null
  }

  fastify.get('/', { preHandler: pre }, async (req, reply) => {
    const users = await fastify.db('utilisateurs')
      .where({ tenant_id: req.tenantId })
      .select('id', 'email', 'prenom', 'nom', 'role', 'actif', 'derniere_connexion', 'avatar_url', 'hotel_id')
      .orderBy('nom')
    reply.send({ utilisateurs: users })
  })

  fastify.post('/', { preHandler: pre }, async (req, reply) => {
    // ── Enforcement quota utilisateurs ───────────────────────────────────────
    const [subCtx, nbUsers] = await Promise.all([
      fastify.policy.loadSubscriptionContext(req.tenantId),
      fastify.db('utilisateurs').where({ tenant_id: req.tenantId, actif: true }).count('id AS nb').first(),
    ])
    const policyResult = await fastify.policy.evaluate('utilisateur.create', {
      plan:             subCtx.plan,
      nb_utilisateurs:  parseInt(nbUsers?.nb || 0),
      max_utilisateurs: subCtx.max_utilisateurs,
    })
    if (!policyResult.allowed) {
      req.log.warn({ tenant_id: req.tenantId, policy: 'utilisateur.create', result: policyResult }, 'POLICY_DENIED')
      return reply.status(403).send(policyResult)
    }

    const b = req.body || {}
    const prenom = String(b.prenom || '').trim(), nom = String(b.nom || '').trim()
    const email  = String(b.email || '').trim().toLowerCase()
    const role   = b.role || 'reception'
    if (!prenom || !nom || !email.includes('@')) return erreur(reply, 400, 'CHAMPS_REQUIS', 'Prénom, nom et email valides requis')
    if (!ROLES_ASSIGNABLES.includes(role)) return erreur(reply, 403, 'ROLE_NON_ASSIGNABLE', `Rôle non assignable : ${role}`)

    const hotelId = await hotelAutorise(req, b.hotel_id)
    if (hotelId === undefined) return erreur(reply, 403, 'HOTEL_HORS_TENANT', "L'hôtel indiqué n'appartient pas à ce tenant")
    if (!hotelId) return erreur(reply, 400, 'HOTEL_REQUIS', 'Hôtel du compte requis')

    let motDePasseTemporaire = null
    let mdp = b.mot_de_passe ? String(b.mot_de_passe) : null
    if (mdp && mdp.length < 8) return erreur(reply, 400, 'MDP_TROP_COURT', 'Mot de passe : 8 caractères minimum')
    if (!mdp) { mdp = crypto.randomBytes(9).toString('base64url'); motDePasseTemporaire = mdp }

    const data = {
      tenant_id: req.tenantId, hotel_id: hotelId, prenom, nom, email, role,
      telephone: b.telephone ? String(b.telephone).trim() : null,
      mot_de_passe_hash: await fastify.hashMotDePasse(mdp),
      doit_changer_mdp: true,          // mot de passe choisi par un tiers → changement à la 1re connexion
      actif: true,
    }

    let user
    try {
      ;[user] = await fastify.db('utilisateurs').insert(data).returning(['id', 'email', 'prenom', 'nom', 'role', 'hotel_id'])
    } catch (err) {
      if (err.constraint === 'utilisateurs_tenant_id_email_key' || (err.message || '').includes('dupliquée')) {
        return reply.status(409).send({ erreur: 'Cet email est déjà utilisé dans ce tenant', code: 'EMAIL_DUPLIQUE' })
      }
      throw err
    }

    // Invalider le cache quota du tenant
    await fastify.cache.del(`tenant:${req.tenantId}:subscription`)

    await fastify.db('logs_audit').insert({
      tenant_id: req.tenantId,
      utilisateur_id: req.user.id,
      action: 'UTILISATEUR_CREE',
      module: 'utilisateurs',
      ressource_type: 'utilisateur',
      ressource_id: user.id,
      nouvelles_valeurs: JSON.stringify({ email: user.email, role: user.role }),
      ip_address: req.ip,
    }).catch(() => {})

    reply.status(201).send({ message: 'Utilisateur créé', utilisateur: user, mot_de_passe_temporaire: motDePasseTemporaire })
  })

  fastify.put('/:id', { preHandler: pre }, async (req, reply) => {
    const b = req.body || {}
    const data = {}
    for (const k of ['prenom', 'nom', 'telephone']) if (b[k] !== undefined) data[k] = b[k] === null ? null : String(b[k]).trim()
    if (b.email !== undefined) data.email = String(b.email).trim().toLowerCase()
    if (b.actif !== undefined) data.actif = !!b.actif
    if (b.role !== undefined) {
      if (!ROLES_ASSIGNABLES.includes(b.role)) return erreur(reply, 403, 'ROLE_NON_ASSIGNABLE', `Rôle non assignable : ${b.role}`)
      data.role = b.role
    }
    if (b.hotel_id !== undefined) {
      const h = await hotelAutorise(req, b.hotel_id)
      if (!h || (req.user.role !== 'super_admin' && h !== b.hotel_id)) return erreur(reply, 403, 'HOTEL_HORS_TENANT', "L'hôtel indiqué n'appartient pas à ce tenant")
      data.hotel_id = h
    }
    if (b.mot_de_passe) {
      if (String(b.mot_de_passe).length < 8) return erreur(reply, 400, 'MDP_TROP_COURT', 'Mot de passe : 8 caractères minimum')
      data.mot_de_passe_hash = await fastify.hashMotDePasse(String(b.mot_de_passe))
      data.doit_changer_mdp = true
    }
    if (!Object.keys(data).length) return erreur(reply, 400, 'AUCUN_CHAMP', 'Aucun champ modifiable fourni')

    // Lecture avant modification pour audit diff
    const avant = await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .select('email', 'role', 'actif')
      .first()
    if (!avant) return reply.status(404).send({ erreur: 'Utilisateur introuvable' })
    // Un super_admin (compte plateforme) ne se modifie pas depuis la gestion du personnel
    if (avant.role === 'super_admin') return erreur(reply, 403, 'COMPTE_PLATEFORME', 'Compte plateforme non modifiable ici')

    const [updated] = await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .update(data)
      .returning(COLONNES_PUBLIQUES)

    await fastify.db('logs_audit').insert({
      tenant_id: req.tenantId,
      utilisateur_id: req.user.id,
      action: 'UTILISATEUR_MODIFIE',
      module: 'utilisateurs',
      ressource_type: 'utilisateur',
      ressource_id: req.params.id,
      anciennes_valeurs: JSON.stringify(avant),
      nouvelles_valeurs: JSON.stringify({ role: data.role, actif: data.actif }),
      ip_address: req.ip,
    }).catch(() => {})

    reply.send({ message: 'Utilisateur mis à jour', utilisateur: updated })
  })

  fastify.delete('/:id', { preHandler: pre }, async (req, reply) => {
    const avant = await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .select('email', 'role')
      .first()
    if (!avant) return reply.status(404).send({ erreur: 'Utilisateur introuvable' })
    if (avant.role === 'super_admin') return erreur(reply, 403, 'COMPTE_PLATEFORME', 'Compte plateforme non modifiable ici')
    if (req.params.id === req.user.id) return erreur(reply, 409, 'AUTO_DESACTIVATION', 'Vous ne pouvez pas désactiver votre propre compte')

    await fastify.db('utilisateurs')
      .where({ id: req.params.id, tenant_id: req.tenantId })
      .update({ actif: false })

    await fastify.db('logs_audit').insert({
      tenant_id: req.tenantId,
      utilisateur_id: req.user.id,
      action: 'UTILISATEUR_DESACTIVE',
      module: 'utilisateurs',
      ressource_type: 'utilisateur',
      ressource_id: req.params.id,
      anciennes_valeurs: JSON.stringify(avant),
      nouvelles_valeurs: JSON.stringify({ actif: false }),
      ip_address: req.ip,
    }).catch(() => {})

    reply.send({ message: 'Utilisateur désactivé' })
  })
}
