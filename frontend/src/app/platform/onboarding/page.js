'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError, PlatformAPIError } from '@/lib/platform-api'

// ─── Données catalogue plans ─────────────────────────────────────────────────
const PLANS_CATALOGUE = [
  {
    code:    'essai',
    label:   'Essai',
    prix:    0,
    devise:  'XAF',
    hotels:  1,
    chambres: 20,
    users:   3,
    modules: ['Portail QR', 'Facturation mobile'],
    couleur: 'text-gray-300',
    border:  'border-gray-500/40',
    bg:      'bg-gray-500/5',
    bgSel:   'bg-gray-500/15 border-gray-400',
  },
  {
    code:    'starter',
    label:   'Starter',
    prix:    25000,
    devise:  'XAF',
    hotels:  1,
    chambres: 30,
    users:   5,
    modules: ['Portail QR', 'Facturation mobile'],
    couleur: 'text-blue-300',
    border:  'border-blue-500/40',
    bg:      'bg-blue-500/5',
    bgSel:   'bg-blue-500/15 border-blue-400',
  },
  {
    code:    'business',
    label:   'Business',
    prix:    75000,
    devise:  'XAF',
    hotels:  3,
    chambres: 100,
    users:   20,
    modules: ['Portail QR', 'IA Cockpit', 'Restaurant KDS', 'Multi-hôtel', 'Analytics'],
    couleur: 'text-amber-300',
    border:  'border-amber-500/40',
    bg:      'bg-amber-500/5',
    bgSel:   'bg-amber-500/15 border-amber-400',
    badge:   'Populaire',
  },
  {
    code:    'ohada+',
    label:   'OHADA+',
    prix:    120000,
    devise:  'XAF',
    hotels:  5,
    chambres: 200,
    users:   30,
    modules: ['Tout Business', 'Export SYSCOHADA'],
    couleur: 'text-emerald-300',
    border:  'border-emerald-500/40',
    bg:      'bg-emerald-500/5',
    bgSel:   'bg-emerald-500/15 border-emerald-400',
  },
  {
    code:    'enterprise',
    label:   'Enterprise',
    prix:    200000,
    devise:  'XAF',
    hotels:  -1,
    chambres: -1,
    users:   -1,
    modules: ['Tout inclus', 'Illimité'],
    couleur: 'text-purple-300',
    border:  'border-purple-500/40',
    bg:      'bg-purple-500/5',
    bgSel:   'bg-purple-500/15 border-purple-400',
  },
]

const PAYS_OPTIONS = [
  'Cameroun', 'Côte d\'Ivoire', 'Sénégal', 'Maroc', 'Bénin',
  'Burkina Faso', 'Togo', 'Gabon', 'Congo', 'Madagascar',
  'Rwanda', 'Tunisie', 'Mali', 'Niger', 'Autre',
]

const DEVISES_OPTIONS = ['XAF', 'XOF', 'MAD', 'EUR', 'USD']

// ─── Indicateur d'étape ───────────────────────────────────────────────────────
function StepIndicator({ etape }) {
  const etapes = ['Organisation', 'Abonnement', 'Manager', 'Résumé', 'Accès']
  return (
    <div className="flex items-center gap-0 mb-8">
      {etapes.map((label, i) => {
        const n       = i + 1
        const actif   = n === etape
        const termine = n < etape
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${termine ? 'bg-emerald-500 border-emerald-500 text-white'
                  : actif ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                  : 'bg-[var(--bg-3)] border-[var(--border-2)] text-[var(--text-4)]'}`}>
                {termine ? '✓' : n}
              </div>
              <span className={`text-[10px] mt-1 hidden sm:block ${actif ? 'text-[var(--accent)]' : 'text-[var(--text-4)]'}`}>
                {label}
              </span>
            </div>
            {i < etapes.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-12 mx-1 ${termine ? 'bg-emerald-500' : 'bg-[var(--border-2)]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Étape 1 — Organisation ───────────────────────────────────────────────────
function EtapeOrganisation({ data, onChange, onNext }) {
  const [erreurs, setErreurs] = useState({})

  function valider() {
    const e = {}
    if (!data.nom?.trim())           e.nom           = 'Nom obligatoire'
    if (!data.pays?.trim())          e.pays          = 'Pays obligatoire'
    if (!data.email_contact?.trim()) e.email_contact = 'Email obligatoire'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email_contact.trim()))
                                     e.email_contact = 'Format email invalide'
    setErreurs(e)
    return Object.keys(e).length === 0
  }

  function handleNext() {
    if (valider()) onNext()
  }

  function champ(label, key, type = 'text', placeholder = '') {
    return (
      <div>
        <label className="block text-xs font-medium text-[var(--text-3)] mb-1">{label}</label>
        {key === 'pays' ? (
          <select value={data[key] || ''} onChange={e => onChange(key, e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]
              ${erreurs[key] ? 'border-red-500' : 'border-[var(--border-2)]'}`}>
            <option value="">— Sélectionner —</option>
            {PAYS_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : key === 'devise_defaut' ? (
          <select value={data[key] || 'XAF'} onChange={e => onChange(key, e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border border-[var(--border-2)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]">
            {DEVISES_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        ) : (
          <input type={type} value={data[key] || ''} placeholder={placeholder}
            onChange={e => onChange(key, e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]
              ${erreurs[key] ? 'border-red-500' : 'border-[var(--border-2)]'}`} />
        )}
        {erreurs[key] && <p className="text-xs text-red-400 mt-1">{erreurs[key]}</p>}
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-1)] mb-1">Organisation cliente</h2>
      <p className="text-sm text-[var(--text-3)] mb-6">Informations de l'organisation qui souscrit au service.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {champ('Nom de l\'organisation *', 'nom', 'text', 'Groupe Hôtelier Royal...')}
        {champ('Email de contact *', 'email_contact', 'email', 'contact@organisation.cm')}
        {champ('Pays *', 'pays')}
        {champ('Devise', 'devise_defaut')}
        {champ('Téléphone', 'telephone', 'tel', '+237 6XX XXX XXX')}
        {champ('Adresse', 'adresse', 'text', 'Rue, Ville...')}
      </div>
      <div className="flex justify-end mt-8">
        <button onClick={handleNext}
          className="px-6 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
          Suivant →
        </button>
      </div>
    </div>
  )
}

// ─── Étape 2 — Abonnement ─────────────────────────────────────────────────────
function EtapeAbonnement({ data, onChange, onNext, onPrev }) {
  const [prixNegocie, setPrixNegocie] = useState(false)
  const [erreur, setErreur] = useState('')

  const planSelectionne = PLANS_CATALOGUE.find(p => p.code === data.plan)

  function handleNext() {
    if (!data.plan) { setErreur('Veuillez sélectionner un plan'); return }
    setErreur('')
    onNext()
  }

  function handlePlanSelect(code) {
    const p = PLANS_CATALOGUE.find(pl => pl.code === code)
    onChange('plan', code)
    if (!prixNegocie) onChange('montant_mensuel', p.prix)
    setErreur('')
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-1)] mb-1">Abonnement</h2>
      <p className="text-sm text-[var(--text-3)] mb-6">Sélectionnez le plan catalogue pour cette organisation.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {PLANS_CATALOGUE.map(plan => (
          <button key={plan.code} onClick={() => handlePlanSelect(plan.code)}
            className={`relative p-4 rounded-xl border-2 text-left transition-all cursor-pointer
              ${data.plan === plan.code ? plan.bgSel : `${plan.bg} ${plan.border} hover:border-opacity-70`}`}>
            {plan.badge && (
              <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {plan.badge}
              </span>
            )}
            <div className={`text-sm font-bold mb-1 ${plan.couleur}`}>{plan.label}</div>
            <div className="text-lg font-bold text-[var(--text-1)] mb-2">
              {plan.prix === 0 ? 'Gratuit' : `${plan.prix.toLocaleString()} XAF`}
              {plan.prix > 0 && <span className="text-xs font-normal text-[var(--text-4)]">/mois</span>}
            </div>
            <div className="text-xs text-[var(--text-4)] space-y-0.5">
              <div>{plan.hotels === -1 ? '∞ hôtels' : `${plan.hotels} hôtel${plan.hotels > 1 ? 's' : ''}`}</div>
              <div>{plan.chambres === -1 ? '∞ chambres' : `${plan.chambres} chambres`}</div>
              <div>{plan.users === -1 ? '∞ utilisateurs' : `${plan.users} utilisateurs`}</div>
            </div>
            <div className="mt-2 pt-2 border-t border-[var(--border-2)]">
              {plan.modules.map(m => (
                <div key={m} className="text-[10px] text-[var(--text-4)] flex items-center gap-1">
                  <span className="text-emerald-400">✓</span> {m}
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>

      {erreur && <p className="text-sm text-red-400 mb-4">{erreur}</p>}

      {planSelectionne && (
        <div className="rounded-lg border border-[var(--border-2)] bg-[var(--bg-2)] p-4 mb-4">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="prix-negocie" checked={prixNegocie}
              onChange={e => { setPrixNegocie(e.target.checked); if (!e.target.checked) onChange('montant_mensuel', planSelectionne.prix) }}
              className="rounded" />
            <label htmlFor="prix-negocie" className="text-sm text-[var(--text-2)] cursor-pointer">
              Prix négocié (différent du catalogue)
            </label>
          </div>
          {prixNegocie && (
            <div className="mt-3 flex items-center gap-3">
              <input type="number" value={data.montant_mensuel ?? planSelectionne.prix}
                onChange={e => onChange('montant_mensuel', parseFloat(e.target.value) || 0)}
                min={0}
                className="w-40 px-3 py-2 rounded-lg bg-[var(--bg-3)] border border-[var(--border-2)] text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]" />
              <span className="text-sm text-[var(--text-3)]">XAF/mois</span>
              {(data.montant_mensuel !== planSelectionne.prix) && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Prix négocié
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button onClick={onPrev}
          className="px-5 py-2.5 rounded-lg border border-[var(--border-2)] text-sm text-[var(--text-2)] hover:bg-[var(--bg-3)] transition-colors">
          ← Retour
        </button>
        <button onClick={handleNext}
          className="px-6 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
          Suivant →
        </button>
      </div>
    </div>
  )
}

// ─── Étape 3 — Manager ────────────────────────────────────────────────────────
function EtapeManager({ data, onChange, onNext, onPrev }) {
  const [erreurs, setErreurs]       = useState({})
  const [mdpManuel, setMdpManuel]   = useState(false)
  const [mdpVisible, setMdpVisible] = useState(false)

  function valider() {
    const e = {}
    if (!data.prenom?.trim()) e.prenom = 'Prénom obligatoire'
    if (!data.nom?.trim())    e.nom    = 'Nom obligatoire'
    if (!data.email?.trim())  e.email  = 'Email obligatoire'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()))
                              e.email  = 'Format email invalide'
    if (mdpManuel && !data.mot_de_passe?.trim()) e.mot_de_passe = 'Mot de passe obligatoire'
    setErreurs(e)
    return Object.keys(e).length === 0
  }

  function handleNext() {
    if (!mdpManuel) onChange('mot_de_passe', null)
    if (valider()) onNext()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-1)] mb-1">Manager principal</h2>
      <p className="text-sm text-[var(--text-3)] mb-6">Ce compte sera le contact principal et administrateur de l'organisation.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {['prenom', 'nom'].map(key => (
          <div key={key}>
            <label className="block text-xs font-medium text-[var(--text-3)] mb-1">
              {key === 'prenom' ? 'Prénom *' : 'Nom *'}
            </label>
            <input type="text" value={data[key] || ''} onChange={e => onChange(key, e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]
                ${erreurs[key] ? 'border-red-500' : 'border-[var(--border-2)]'}`} />
            {erreurs[key] && <p className="text-xs text-red-400 mt-1">{erreurs[key]}</p>}
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-[var(--text-3)] mb-1">Email *</label>
          <input type="email" value={data.email || ''} onChange={e => onChange('email', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg bg-[var(--bg-3)] border text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]
              ${erreurs.email ? 'border-red-500' : 'border-[var(--border-2)]'}`} />
          {erreurs.email && <p className="text-xs text-red-400 mt-1">{erreurs.email}</p>}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border-2)] bg-[var(--bg-2)] p-4">
        <div className="flex items-center gap-3">
          <input type="checkbox" id="mdp-manuel" checked={mdpManuel}
            onChange={e => { setMdpManuel(e.target.checked); if (!e.target.checked) onChange('mot_de_passe', null) }}
            className="rounded" />
          <label htmlFor="mdp-manuel" className="text-sm text-[var(--text-2)] cursor-pointer">
            Définir le mot de passe manuellement
          </label>
        </div>
        {!mdpManuel && (
          <p className="text-xs text-[var(--text-4)] mt-2 ml-6">
            Un mot de passe temporaire sécurisé sera généré automatiquement et affiché une seule fois.
          </p>
        )}
        {mdpManuel && (
          <div className="mt-3 ml-6 relative">
            <input type={mdpVisible ? 'text' : 'password'} value={data.mot_de_passe || ''}
              onChange={e => onChange('mot_de_passe', e.target.value)}
              placeholder="Mot de passe..."
              className={`w-full pr-10 px-3 py-2 rounded-lg bg-[var(--bg-3)] border text-sm text-[var(--text-1)] outline-none focus:border-[var(--accent)]
                ${erreurs.mot_de_passe ? 'border-red-500' : 'border-[var(--border-2)]'}`} />
            <button type="button" onClick={() => setMdpVisible(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-4)] hover:text-[var(--text-2)] text-xs">
              {mdpVisible ? '🙈' : '👁'}
            </button>
            {erreurs.mot_de_passe && <p className="text-xs text-red-400 mt-1">{erreurs.mot_de_passe}</p>}
          </div>
        )}
      </div>

      <div className="flex justify-between mt-8">
        <button onClick={onPrev}
          className="px-5 py-2.5 rounded-lg border border-[var(--border-2)] text-sm text-[var(--text-2)] hover:bg-[var(--bg-3)] transition-colors">
          ← Retour
        </button>
        <button onClick={handleNext}
          className="px-6 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
          Suivant →
        </button>
      </div>
    </div>
  )
}

// ─── Étape 4 — Résumé ─────────────────────────────────────────────────────────
function EtapeResume({ org, abo, mgr, loading, erreur, onSubmit, onPrev }) {
  const plan = PLANS_CATALOGUE.find(p => p.code === abo.plan)

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-1)] mb-1">Résumé</h2>
      <p className="text-sm text-[var(--text-3)] mb-6">Vérifiez les informations avant de créer le compte client.</p>

      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-2)] bg-[var(--bg-2)] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-4)] mb-3">Organisation</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-[var(--text-3)]">Nom</dt>         <dd className="text-[var(--text-1)] font-medium">{org.nom}</dd>
            <dt className="text-[var(--text-3)]">Pays</dt>        <dd className="text-[var(--text-1)]">{org.pays}</dd>
            <dt className="text-[var(--text-3)]">Email</dt>       <dd className="text-[var(--text-1)]">{org.email_contact}</dd>
            <dt className="text-[var(--text-3)]">Devise</dt>      <dd className="text-[var(--text-1)]">{org.devise_defaut || 'XAF'}</dd>
            {org.telephone && <><dt className="text-[var(--text-3)]">Tél.</dt><dd className="text-[var(--text-1)]">{org.telephone}</dd></>}
          </dl>
        </div>

        <div className="rounded-xl border border-[var(--border-2)] bg-[var(--bg-2)] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-4)] mb-3">Abonnement</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-[var(--text-3)]">Plan</dt>
            <dd><span className={`font-bold ${plan?.couleur || 'text-[var(--text-1)]'}`}>{plan?.label || abo.plan}</span></dd>
            <dt className="text-[var(--text-3)]">Montant</dt>
            <dd className="text-[var(--text-1)]">
              {(abo.montant_mensuel ?? plan?.prix ?? 0).toLocaleString()} XAF/mois
              {abo.montant_mensuel !== undefined && abo.montant_mensuel !== plan?.prix && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">négocié</span>
              )}
            </dd>
            <dt className="text-[var(--text-3)]">Hôtels max</dt>   <dd className="text-[var(--text-1)]">{plan?.hotels === -1 ? '∞' : plan?.hotels}</dd>
            <dt className="text-[var(--text-3)]">Utilisateurs</dt> <dd className="text-[var(--text-1)]">{plan?.users === -1 ? '∞' : plan?.users}</dd>
          </dl>
        </div>

        <div className="rounded-xl border border-[var(--border-2)] bg-[var(--bg-2)] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-4)] mb-3">Manager principal</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-[var(--text-3)]">Nom complet</dt> <dd className="text-[var(--text-1)] font-medium">{mgr.prenom} {mgr.nom}</dd>
            <dt className="text-[var(--text-3)]">Email</dt>       <dd className="text-[var(--text-1)]">{mgr.email}</dd>
            <dt className="text-[var(--text-3)]">Mot de passe</dt>
            <dd className="text-[var(--text-3)] italic text-xs">{mgr.mot_de_passe ? 'Défini manuellement' : 'Généré automatiquement'}</dd>
          </dl>
        </div>
      </div>

      {erreur && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
          {erreur}
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button onClick={onPrev} disabled={loading}
          className="px-5 py-2.5 rounded-lg border border-[var(--border-2)] text-sm text-[var(--text-2)] hover:bg-[var(--bg-3)] disabled:opacity-50 transition-colors">
          ← Retour
        </button>
        <button onClick={onSubmit} disabled={loading}
          className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
          {loading ? (
            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Création en cours…</>
          ) : (
            '✓ Créer le compte client'
          )}
        </button>
      </div>
    </div>
  )
}

// ─── Étape 5 — Accès générés ──────────────────────────────────────────────────
function EtapeAcces({ resultat, onNouvelOnboarding }) {
  const router = useRouter()
  const [mdpVisible, setMdpVisible]  = useState(false)
  const [copie, setCopie]            = useState(false)

  async function copierMdp() {
    try {
      await navigator.clipboard.writeText(resultat.mot_de_passe_temporaire)
      setCopie(true)
      setTimeout(() => setCopie(false), 2500)
    } catch {
      // Clipboard API non disponible (HTTP ou iframe) — fallback silencieux
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-xl">✓</div>
        <div>
          <h2 className="text-lg font-semibold text-emerald-300">Client activé avec succès</h2>
          <p className="text-sm text-[var(--text-3)]">L'organisation est prête à utiliser 7venHotel Cloud.</p>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 mb-4 space-y-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
          <span className="text-[var(--text-3)]">Organisation</span>
          <span className="text-[var(--text-1)] font-medium">{resultat.tenant?.nom}</span>
          <span className="text-[var(--text-3)]">Statut</span>
          <span className="text-emerald-300 font-semibold">{resultat.tenant?.statut}</span>
          <span className="text-[var(--text-3)]">Plan</span>
          <span className="text-[var(--text-1)]">{resultat.abonnement?.plan}</span>
          <span className="text-[var(--text-3)]">Manager</span>
          <span className="text-[var(--text-1)]">{resultat.manager?.prenom} {resultat.manager?.nom}</span>
          <span className="text-[var(--text-3)]">Email connexion</span>
          <span className="text-[var(--text-1)] font-mono text-xs">{resultat.manager?.email}</span>
        </div>
      </div>

      {resultat.mot_de_passe_temporaire && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 mb-4">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3">
            Mot de passe temporaire
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-lg bg-[var(--bg-3)] border border-[var(--border-2)] px-3 py-2 font-mono text-sm text-[var(--text-1)]">
              {mdpVisible ? resultat.mot_de_passe_temporaire : '••••••••••••••••'}
            </div>
            <button onClick={() => setMdpVisible(v => !v)}
              className="px-3 py-2 rounded-lg border border-[var(--border-2)] text-xs text-[var(--text-3)] hover:bg-[var(--bg-3)]">
              {mdpVisible ? 'Masquer' : 'Afficher'}
            </button>
            <button onClick={copierMdp}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors
                ${copie ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-[var(--bg-3)] border border-[var(--border-2)] text-[var(--text-2)] hover:bg-[var(--bg-2)]'}`}>
              {copie ? '✓ Copié' : 'Copier'}
            </button>
          </div>
          <p className="text-xs text-amber-400/80 mt-3">
            Ce mot de passe ne sera plus jamais affiché. Transmettez-le de façon sécurisée au manager.
            Le manager devra le modifier à sa première connexion.
          </p>
        </div>
      )}

      <div className="flex gap-3 mt-6 flex-wrap">
        <button
          onClick={() => router.push(`/platform/tenants/${resultat.tenant?.id}`)}
          className="px-5 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity">
          Voir la fiche tenant →
        </button>
        <button onClick={onNouvelOnboarding}
          className="px-5 py-2.5 rounded-lg border border-[var(--border-2)] text-sm text-[var(--text-2)] hover:bg-[var(--bg-3)] transition-colors">
          Onboarder un autre client
        </button>
        <button onClick={() => router.push('/platform/tenants')}
          className="px-5 py-2.5 rounded-lg border border-[var(--border-2)] text-sm text-[var(--text-2)] hover:bg-[var(--bg-3)] transition-colors">
          Liste des tenants
        </button>
      </div>
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function PlatformOnboarding() {
  const { token, init } = useAuthStore()

  const [etape,   setEtape]   = useState(1)
  const [loading, setLoading] = useState(false)
  const [erreur,  setErreur]  = useState('')
  const [resultat, setResultat] = useState(null)

  const [org, setOrg] = useState({ devise_defaut: 'XAF' })
  const [abo, setAbo] = useState({})
  const [mgr, setMgr] = useState({})

  // Pattern Layer 4 — hydration Zustand
  useEffect(() => { init() }, [])
  useEffect(() => {
    if (token === undefined) return
  }, [token])

  function updateOrg(key, val) { setOrg(prev => ({ ...prev, [key]: val })) }
  function updateAbo(key, val) { setAbo(prev => ({ ...prev, [key]: val })) }
  function updateMgr(key, val) { setMgr(prev => ({ ...prev, [key]: val })) }

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setErreur('')
    let tenantId = null

    try {
      // ── Étape A : Créer le tenant ──────────────────────────────────────────
      const r1 = await platformAPI.createTenant({
        nom:           org.nom,
        pays:          org.pays,
        email_contact: org.email_contact,
        devise_defaut: org.devise_defaut || 'XAF',
        telephone:     org.telephone || undefined,
        adresse:       org.adresse   || undefined,
      })
      tenantId = r1.tenant.id

      // ── Étape B : Assigner l'abonnement ───────────────────────────────────
      const r2 = await platformAPI.createSubscription(tenantId, {
        plan:            abo.plan,
        montant_mensuel: abo.montant_mensuel,
      })

      // ── Étape C : Provisionner le manager ─────────────────────────────────
      const r3 = await platformAPI.provisionManager(tenantId, {
        prenom:       mgr.prenom,
        nom:          mgr.nom,
        email:        mgr.email,
        mot_de_passe: mgr.mot_de_passe || undefined,
      })

      setResultat({
        tenant:                 r2.tenant_statut !== undefined ? { ...r1.tenant, statut: r2.tenant_statut } : r1.tenant,
        abonnement:             r2.abonnement,
        manager:                r3.manager,
        mot_de_passe_temporaire: r3.mot_de_passe_temporaire || null,
      })
      setEtape(5)

    } catch (err) {
      let msg = 'Une erreur est survenue.'
      if (err instanceof PlatformNetworkError) msg = 'Impossible de joindre le serveur. Vérifiez votre connexion.'
      else if (err instanceof PlatformTimeoutError) msg = 'Le serveur n\'a pas répondu dans les délais.'
      else if (err instanceof PlatformAPIError) msg = err.message
      else if (err?.message) msg = err.message

      // Si le tenant a été créé mais l'abonnement ou le manager a échoué,
      // on informe l'opérateur pour qu'il puisse reprendre manuellement.
      if (tenantId) {
        msg += ` (L'organisation a été créée — ID: ${tenantId}. Vous pouvez compléter l'onboarding depuis la fiche tenant.)`
      }
      setErreur(msg)
    } finally {
      setLoading(false)
    }
  }, [org, abo, mgr])

  function reinitialiser() {
    setEtape(1)
    setOrg({ devise_defaut: 'XAF' })
    setAbo({})
    setMgr({})
    setResultat(null)
    setErreur('')
  }

  return (
    <PlatformLayout>
      <div className="max-w-3xl mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--text-1)]">Onboarding client</h1>
          <p className="text-sm text-[var(--text-3)] mt-1">
            Créez un nouveau compte client en 3 étapes sans accès SQL.
          </p>
        </div>

        <StepIndicator etape={etape} />

        <div className="rounded-2xl border border-[var(--border-2)] bg-[var(--bg-2)] p-6">
          {etape === 1 && (
            <EtapeOrganisation data={org} onChange={updateOrg} onNext={() => setEtape(2)} />
          )}
          {etape === 2 && (
            <EtapeAbonnement data={abo} onChange={updateAbo} onNext={() => setEtape(3)} onPrev={() => setEtape(1)} />
          )}
          {etape === 3 && (
            <EtapeManager data={mgr} onChange={updateMgr} onNext={() => setEtape(4)} onPrev={() => setEtape(2)} />
          )}
          {etape === 4 && (
            <EtapeResume
              org={org} abo={abo} mgr={mgr}
              loading={loading} erreur={erreur}
              onSubmit={handleSubmit}
              onPrev={() => setEtape(3)}
            />
          )}
          {etape === 5 && resultat && (
            <EtapeAcces resultat={resultat} onNouvelOnboarding={reinitialiser} />
          )}
        </div>
      </div>
    </PlatformLayout>
  )
}
