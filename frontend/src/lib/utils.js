// ── Store d'authentification (Zustand) ───────────────────────────────
import { create } from 'zustand'

export const useAuthStore = create((set, get) => ({
  user:    null,
  hotel:   null,
  token:   null,
  loading: false,

  init() {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('7vh_token')
    const user  = JSON.parse(localStorage.getItem('7vh_user') || 'null')
    const hotel = JSON.parse(localStorage.getItem('7vh_hotel') || 'null')
    if (token && user) set({ token, user, hotel })
  },

  setSession({ token, token_rafraichissement, utilisateur, hotel }) {
    localStorage.setItem('7vh_token',         token)
    localStorage.setItem('7vh_refresh_token', token_rafraichissement || '')
    localStorage.setItem('7vh_user',          JSON.stringify(utilisateur))
    localStorage.setItem('7vh_hotel',         JSON.stringify(hotel))
    if (hotel?.id) localStorage.setItem('7vh_hotel_id', hotel.id)
    set({ token, user: utilisateur, hotel })
  },

  logout() {
    ['7vh_token','7vh_refresh_token','7vh_user','7vh_hotel','7vh_hotel_id']
      .forEach(k => localStorage.removeItem(k))
    set({ token: null, user: null, hotel: null })
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
  const module = await import(`../locales/${lang}.json`)
  currentLocale = module.default
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
