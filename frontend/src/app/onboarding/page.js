'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { onboardingAPI } from '@/lib/api'
import { useAuthStore, resolvePostLoginDestination } from '@/lib/utils'

// ── Données de référence ──────────────────────────────────────────────
const PAYS_LISTE = [
  'Cameroun', 'Côte d\'Ivoire', 'Sénégal', 'Mali', 'Burkina Faso',
  'Niger', 'Tchad', 'Congo', 'Gabon', 'République Centrafricaine',
  'RD Congo', 'Bénin', 'Togo', 'Guinée', 'Madagascar',
  'Maroc', 'Tunisie', 'Algérie', 'Égypte', 'Kenya',
  'Éthiopie', 'Ghana', 'Nigéria', 'Afrique du Sud', 'France',
  'Belgique', 'Suisse', 'Canada', 'Autre',
]

const DEVISES = [
  { code: 'XAF', label: 'XAF — Franc CFA (CEMAC)' },
  { code: 'XOF', label: 'XOF — Franc CFA (UEMOA)' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'USD', label: 'USD — Dollar américain' },
  { code: 'GBP', label: 'GBP — Livre sterling' },
  { code: 'MAD', label: 'MAD — Dirham marocain' },
  { code: 'NGN', label: 'NGN — Naira nigérian' },
  { code: 'ZAR', label: 'ZAR — Rand sud-africain' },
  { code: 'CAD', label: 'CAD — Dollar canadien' },
]

const FUSEAUX = [
  { value: 'Africa/Douala',     label: 'Douala / Yaoundé (UTC+1)' },
  { value: 'Africa/Abidjan',    label: 'Abidjan / Dakar (UTC+0)' },
  { value: 'Africa/Lagos',      label: 'Lagos / Kinshasa (UTC+1)' },
  { value: 'Africa/Nairobi',    label: 'Nairobi (UTC+3)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (UTC+2)' },
  { value: 'Africa/Cairo',      label: 'Le Caire (UTC+2)' },
  { value: 'Africa/Casablanca', label: 'Casablanca (UTC+1)' },
  { value: 'Europe/Paris',      label: 'Paris (UTC+1/+2)' },
  { value: 'America/Toronto',   label: 'Toronto (UTC-5/-4)' },
]

// ── Étapes du wizard ──────────────────────────────────────────────────
const ETAPES = [
  { num: 1, label: 'Hôtel',         actif: true  },
  { num: 2, label: 'Fiscalité',     actif: false },
  { num: 3, label: 'Utilisateurs',  actif: false },
  { num: 4, label: 'Config PMS',    actif: false },
]

// ── Indicateur d'étapes ───────────────────────────────────────────────
function StepIndicator({ etapeActuelle }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {ETAPES.map((etape, i) => (
        <div key={etape.num} className="flex items-center">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            etape.num === etapeActuelle
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
              : etape.num < etapeActuelle
              ? 'text-green-400'
              : 'text-[var(--text-4)]'
          }`}>
            {etape.num < etapeActuelle ? (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            ) : etape.num === etapeActuelle ? (
              <div className="w-3 h-3 rounded-full bg-white/30 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
            ) : (
              <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
            <span className={etape.num !== etapeActuelle ? 'opacity-50' : ''}>{etape.label}</span>
          </div>
          {i < ETAPES.length - 1 && (
            <div className={`w-6 h-px mx-1 ${etape.num < etapeActuelle ? 'bg-green-500/50' : 'bg-[var(--border-1)]'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Champ de formulaire ───────────────────────────────────────────────
function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[var(--text-2)] mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[var(--text-4)] mt-1">{hint}</p>}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter()
  const { user, hotel, token, setSession, init } = useAuthStore(s => ({
    user:       s.user,
    hotel:      s.hotel,
    token:      s.token,
    setSession: s.setSession,
    init:       s.init,
  }))

  const [loading, setLoading] = useState(false)
  const [erreur,  setErreur]  = useState('')

  // ── Champs formulaire étape 1 ─────────────────────────────────────
  const [nom,            setNom]           = useState('')
  const [ville,          setVille]         = useState('')
  const [pays,           setPays]          = useState('Cameroun')
  const [adresse,        setAdresse]       = useState('')
  const [nbChambres,     setNbChambres]    = useState('')
  const [devise,         setDevise]        = useState('XAF')
  const [fuseauHoraire,  setFuseauHoraire] = useState('Africa/Douala')

  // ── Hydration + guards ────────────────────────────────────────────
  useEffect(() => { init() }, [init])

  useEffect(() => {
    try {
      const tok       = localStorage.getItem('7vh_token')
      const storedUser  = JSON.parse(localStorage.getItem('7vh_user')  || 'null')
      const storedHotel = JSON.parse(localStorage.getItem('7vh_hotel') || 'null')

      if (!tok || !storedUser) {
        router.replace('/auth/connexion')
        return
      }

      // Guard : doit changer son MDP d'abord
      if (storedUser.doit_changer_mdp === true) {
        router.replace('/auth/changer-mot-de-passe?force=1')
        return
      }

      // Guard : déjà un hôtel → dashboard (pas d'onboarding nécessaire)
      if (storedHotel?.id) {
        router.replace('/dashboard')
        return
      }

      // Guard : seul le manager peut être ici
      if (storedUser.role !== 'manager') {
        router.replace(resolvePostLoginDestination(storedUser, storedHotel))
        return
      }
    } catch {
      router.replace('/auth/connexion')
    }
  }, [router, init])

  // ── Soumission étape 1 ────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    setErreur('')

    if (!nom.trim()) {
      setErreur('Le nom de l\'hôtel est obligatoire')
      return
    }
    if (!ville.trim()) {
      setErreur('La ville est obligatoire')
      return
    }
    const nb = parseInt(nbChambres, 10)
    if (!nbChambres || isNaN(nb) || nb < 1) {
      setErreur('Le nombre de chambres doit être un entier supérieur à 0')
      return
    }

    setLoading(true)
    try {
      const { data } = await onboardingAPI.creerHotel({
        nom:             nom.trim(),
        ville:           ville.trim(),
        pays,
        adresse:         adresse.trim(),
        nombre_chambres: nb,
        devise,
        fuseau_horaire:  fuseauHoraire,
      })

      // Remplacer la session avec le nouveau token (hotel_id défini)
      setSession({
        token:                  data.token,
        token_rafraichissement: data.token_rafraichissement,
        utilisateur:            data.utilisateur,
        hotel:                  data.hotel,
      })

      toast.success(`Hôtel "${data.hotel.nom}" créé avec succès !`)

      // Toujours /dashboard — hotel_id maintenant défini, doit_changer_mdp false
      router.replace(resolvePostLoginDestination(data.utilisateur, data.hotel))

    } catch (err) {
      const code = err.response?.data?.code
      const msg  = err.response?.data?.erreur

      if (code === 'HOTEL_DEJA_ASSIGNE') {
        setErreur('Un hôtel est déjà associé à votre compte. Rechargez la page.')
      } else if (code === 'QUOTA_DEPASSE') {
        setErreur('Votre plan ne permet pas la création d\'un hôtel supplémentaire.')
      } else if (code === 'TENANT_SUSPENDU') {
        setErreur('Votre compte est suspendu. Contactez le support.')
      } else if (code === 'TENANT_ABONNEMENT_REQUIS') {
        setErreur('Un abonnement actif est requis pour créer un hôtel.')
      } else {
        setErreur(msg || 'Une erreur est survenue. Veuillez réessayer.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Rendu avant hydration ─────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-0)]">
        <div className="w-6 h-6 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg-0)] flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-2xl">

        {/* En-tête */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-lg font-black shadow-lg shadow-blue-500/30">
            7
          </div>
          <div>
            <div className="text-sm font-black"><span className="text-blue-400">7ven</span>Hotel Cloud</div>
            <div className="text-[9px] text-[var(--text-4)] tracking-widest uppercase">Configuration initiale</div>
          </div>
        </div>

        {/* Indicateur d'étapes */}
        <StepIndicator etapeActuelle={1} />

        {/* Titre de l'étape */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-[var(--text-0)] mb-1">
            Créez votre premier hôtel
          </h1>
          <p className="text-sm text-[var(--text-3)]">
            Ces informations vous permettront d&apos;accéder à votre espace de gestion PMS.
          </p>
        </div>

        {/* Formulaire étape 1 */}
        <div className="bg-[var(--bg-1)] border border-[var(--border-0)] rounded-2xl p-8 shadow-xl">

          {erreur && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-2.5 rounded-lg mb-6">
              {erreur}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Ligne 1 : Nom + Ville */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nom de l'hôtel" required>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="ex: Hôtel Le Baobab"
                  value={nom}
                  onChange={e => setNom(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Ville" required>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="ex: Douala"
                  value={ville}
                  onChange={e => setVille(e.target.value)}
                />
              </Field>
            </div>

            {/* Ligne 2 : Pays + Nombre de chambres */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Pays">
                <select
                  className="input w-full"
                  value={pays}
                  onChange={e => setPays(e.target.value)}
                >
                  {PAYS_LISTE.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nombre de chambres" required hint="Peut être modifié plus tard">
                <input
                  type="number"
                  className="input w-full"
                  placeholder="ex: 25"
                  min="1"
                  max="9999"
                  value={nbChambres}
                  onChange={e => setNbChambres(e.target.value)}
                />
              </Field>
            </div>

            {/* Adresse */}
            <Field label="Adresse" hint="Rue, quartier, code postal — optionnel">
              <input
                type="text"
                className="input w-full"
                placeholder="ex: Rue de la Paix, Quartier Bonanjo"
                value={adresse}
                onChange={e => setAdresse(e.target.value)}
              />
            </Field>

            {/* Ligne 3 : Devise + Fuseau horaire */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Devise de facturation">
                <select
                  className="input w-full"
                  value={devise}
                  onChange={e => setDevise(e.target.value)}
                >
                  {DEVISES.map(d => (
                    <option key={d.code} value={d.code}>{d.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Fuseau horaire">
                <select
                  className="input w-full"
                  value={fuseauHoraire}
                  onChange={e => setFuseauHoraire(e.target.value)}
                >
                  {FUSEAUX.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Bouton submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-lg w-full justify-center mt-2 disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Création en cours…
                </span>
              ) : (
                'Créer mon hôtel et accéder au PMS →'
              )}
            </button>
          </form>
        </div>

        {/* Étapes futures */}
        <div className="mt-6 bg-[var(--bg-1)] border border-[var(--border-0)] rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-4)] mb-3">
            Prochaines étapes (disponibles dans les paramètres de l&apos;hôtel)
          </p>
          <div className="grid grid-cols-3 gap-3">
            {ETAPES.slice(1).map(etape => (
              <div key={etape.num} className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--bg-2)] border border-[var(--border-0)] opacity-50">
                <svg className="w-3.5 h-3.5 text-[var(--text-4)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <div>
                  <p className="text-[10px] font-semibold text-[var(--text-3)]">{etape.num}. {etape.label}</p>
                  <p className="text-[9px] text-[var(--text-4)]">Bientôt disponible</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[10px] text-[var(--text-4)] mt-4">
          Ces paramètres peuvent être modifiés à tout moment dans{' '}
          <span className="text-[var(--text-3)]">Paramètres → Hôtel</span>.
        </p>

      </div>
    </div>
  )
}
