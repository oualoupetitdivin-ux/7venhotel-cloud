// ── Store d'authentification (Zustand) ───────────────────────────────
import { create } from 'zustand'

// ── Source de vérité unique pour les redirections post-login ──────────
// Priorité : doit_changer_mdp > manager sans hôtel > destination par rôle
// Utilisée dans : page.js, connexion/page.js, changer-mot-de-passe/page.js, onboarding/page.js
const DESTINATIONS_PAR_ROLE = {
  super_admin:  '/platform/dashboard',
  manager:      '/dashboard',
  reception:    '/timeline',
  housekeeping: '/menage',
  restaurant:   '/restaurant',
  comptabilite: '/facturation',
  technicien:   '/maintenance',
}

export function resolvePostLoginDestination(user, hotel) {
  if (!user) return '/auth/connexion'

  if (user.doit_changer_mdp === true) {
    return '/auth/changer-mot-de-passe?force=1'
  }

  if (user.role === 'manager' && !hotel?.id) {
    return '/onboarding'
  }

  return DESTINATIONS_PAR_ROLE[user.role] || '/dashboard'
}

const LS_KEYS = ['7vh_token','7vh_refresh_token','7vh_user','7vh_hotel','7vh_hotel_id']

function clearLocalStorage() {
  try { LS_KEYS.forEach(k => localStorage.removeItem(k)) } catch {}
}

export const useAuthStore = create((set, get) => ({
  user:      null,
  hotel:     null,
  token:     null,
  loading:   false,
  // _hydrated : true dès qu'init() a terminé (succès ou échec).
  // Permet aux guards de distinguer "en cours d'hydration" vs "pas de session".
  // Sans ce flag, un token présent mais user absent bloque le guard en boucle.
  _hydrated: false,

  init() {
    if (typeof window === 'undefined') return
    if (get()._hydrated) return

    let token = null, user = null, hotel = null
    try {
      token = localStorage.getItem('7vh_token') || null
      user  = JSON.parse(localStorage.getItem('7vh_user')  || 'null')
      hotel = JSON.parse(localStorage.getItem('7vh_hotel') || 'null')
    } catch {
      clearLocalStorage()
      token = null; user = null; hotel = null
    }

    if (token && !user) {
      clearLocalStorage()
      token = null
    }

    set({ token, user, hotel, _hydrated: true })
  },

  setSession({ token, token_rafraichissement, utilisateur, hotel }) {
    localStorage.setItem('7vh_token',         token)
    localStorage.setItem('7vh_refresh_token', token_rafraichissement || '')
    localStorage.setItem('7vh_user',          JSON.stringify(utilisateur))
    localStorage.setItem('7vh_hotel',         JSON.stringify(hotel))
    if (hotel?.id) localStorage.setItem('7vh_hotel_id', hotel.id)
    // _hydrated=true : après setSession, l'état est connu et valide
    set({ token, user: utilisateur, hotel, _hydrated: true })
  },

  logout() {
    clearLocalStorage()
    // _hydrated reste true : on connaît l'état (déconnecté)
    set({ token: null, user: null, hotel: null, _hydrated: true })
  },

  get isAuthenticated() { return !!get().token && !!get().user },
  get currency()        { return get().hotel?.devise || get().user?.currency || 'XAF' },
  get timezone()        { return get().hotel?.fuseau_horaire || 'Africa/Douala' },
}))

// ── Formatage devise ─────────────────────────────────────────────────
const CURRENCY_LOCALES = {
  XAF: 'fr-CM', XOF: 'fr-SN', EUR: 'fr-FR', USD: 'en-US',
  GBP: 'en-GB', MAD: 'fr-MA', NGN: 'en-NG', ZAR: 'en-ZA',
  CAD: 'fr-CA', CHF: 'fr-CH', JPY: 'ja-JP', CNY: 'zh-CN'
}

export function fmt(amount, currency = null) {
  const cur = currency || (typeof window !== 'undefined'
    ? localStorage.getItem('7vh_hotel') && JSON.parse(localStorage.getItem('7vh_hotel'))?.devise
    : null) || 'XAF'

  if (['XAF', 'XOF'].includes(cur)) {
    return Math.round(amount).toLocaleString('fr-FR') + ' ' + cur
  }
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[cur] || 'fr-FR', {
      style: 'currency', currency: cur,
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(amount)
  } catch {
    return amount.toLocaleString() + ' ' + cur
  }
}

// ── Formatage dates ───────────────────────────────────────────────────
export function fmtDate(date, options = {}) {
  if (!date) return '—'
  const d = new Date(date)
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', ...options
  })
}

export function fmtDateTime(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}

export function fmtTime(date) {
  if (!date) return '—'
  return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// ── i18n simple ───────────────────────────────────────────────────────
let currentLocale = {}

export async function loadLocale(lang = 'fr') {
  const localeData = await import(`../locales/${lang}.json`)
  currentLocale = localeData.default
}

export function t(key, fallback = '') {
  const keys = key.split('.')
  let val = currentLocale
  for (const k of keys) {
    if (val && typeof val === 'object') val = val[k]
    else return fallback || key
  }
  return val || fallback || key
}

// ── Couleurs statut ───────────────────────────────────────────────────
export const STATUT_RESERVATION_COULEUR = {
  tentative:          'badge-purple',
  confirmee:          'badge-blue',
  arrivee:            'badge-green',
  depart_aujourd_hui: 'badge-amber',
  annulee:            'badge-red',
  no_show:            'badge-gray',
}

export const STATUT_CHAMBRE_COULEUR = {
  libre_propre: 'badge-green',
  occupee:      'badge-blue',
  sale:         'badge-amber',
  nettoyage:    'badge-purple',
  inspection:   'badge-purple',
  hors_service: 'badge-red',
}

export const PRIORITE_COULEUR = {
  basse:   'badge-gray',
  normale: 'badge-blue',
  haute:   'badge-amber',
  urgente: 'badge-red',
}

// ── Indicatifs téléphoniques ──────────────────────────────────────────
export const INDICATIFS_PAYS = [
  { code: '+237', pays: 'Cameroun',       drapeau: '🇨🇲' },
  { code: '+225', pays: 'Côte d\'Ivoire', drapeau: '🇨🇮' },
  { code: '+221', pays: 'Sénégal',        drapeau: '🇸🇳' },
  { code: '+212', pays: 'Maroc',          drapeau: '🇲🇦' },
  { code: '+33',  pays: 'France',         drapeau: '🇫🇷' },
  { code: '+1',   pays: 'USA/Canada',     drapeau: '🇺🇸' },
  { code: '+44',  pays: 'Royaume-Uni',    drapeau: '🇬🇧' },
  { code: '+234', pays: 'Nigeria',        drapeau: '🇳🇬' },
  { code: '+27',  pays: 'Afrique du Sud', drapeau: '🇿🇦' },
  { code: '+49',  pays: 'Allemagne',      drapeau: '🇩🇪' },
  { code: '+39',  pays: 'Italie',         drapeau: '🇮🇹' },
  { code: '+34',  pays: 'Espagne',        drapeau: '🇪🇸' },
  { code: '+243', pays: 'RD Congo',       drapeau: '🇨🇩' },
  { code: '+241', pays: 'Gabon',          drapeau: '🇬🇦' },
  { code: '+20',  pays: 'Égypte',         drapeau: '🇪🇬' },
  { code: '+971', pays: 'Émirats Arabes', drapeau: '🇦🇪' },
  { code: '+91',  pays: 'Inde',           drapeau: '🇮🇳' },
  { code: '+86',  pays: 'Chine',          drapeau: '🇨🇳' },
  { code: '+55',  pays: 'Brésil',         drapeau: '🇧🇷' },
]
