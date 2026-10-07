import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

// LOT-GUEST-01 — importé par booking/résultats (photos), chambres, facturation (PDF), réservations,
// réglages, mais jamais exporté : les URL devenaient "undefined/...". Origine = API_URL sans /api/v1.
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '')

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

// ── Intercepteur requête — injection token JWT ────────────────────────
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('7vh_token')
    if (token) config.headers['Authorization'] = `Bearer ${token}`

    const hotelId = localStorage.getItem('7vh_hotel_id')
    if (hotelId) config.headers['X-Hotel-ID'] = hotelId
  }
  return config
})

// ── Intercepteur réponse — gestion erreurs globale ────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response } = error

    if (response?.status === 401) {
      // Tentative de rafraîchissement du token
      const refresh = localStorage.getItem('7vh_refresh_token')
      if (refresh && !error.config._retry) {
        error.config._retry = true
        try {
          const { data } = await axios.post(`${API_URL}/auth/rafraichir`, {
            token_rafraichissement: refresh
          })
          localStorage.setItem('7vh_token', data.token)
          error.config.headers['Authorization'] = `Bearer ${data.token}`
          return api(error.config)
        } catch {
          // Rafraîchissement échoué → déconnexion
          localStorage.removeItem('7vh_token')
          localStorage.removeItem('7vh_refresh_token')
          localStorage.removeItem('7vh_user')
          window.location.href = '/auth/connexion'
        }
      }
    }

    return Promise.reject(error)
  }
)

// ── Instance client (portail client connecté — token 7vh_client_token) ───────
// Distincte de l'instance staff pour ne pas mélanger les JWT.
const clientApi = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
})

clientApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('7vh_client_token')
    if (token) config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

clientApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('7vh_client_token')
      window.location.href = '/client-portal/connexion'
    }
    return Promise.reject(error)
  }
)

// ── Helpers ───────────────────────────────────────────────────────────

export const authAPI = {
  connexion:         (data) => api.post('/auth/connexion', data),
  deconnexion:       ()     => api.post('/auth/deconnexion'),
  moi:               ()     => api.get('/auth/moi'),
  changerMotDePasse: (data) => api.post('/auth/changer-mot-de-passe', data),
  clientConnexion:   (data) => api.post('/auth/client/connexion', data),
}

export const reservationsAPI = {
  lister:   (params) => api.get('/reservations', { params }),
  obtenir:  (id)     => api.get(`/reservations/${id}`),
  creer:    (data)   => api.post('/reservations', data),
  // QA-01 : backend = POST /:id/annuler avec { raison } (les écrans envoient { motif }) ; PUT /:id n'existe pas
  annuler:  (id, d)  => api.post(`/reservations/${id}/annuler`, { raison: d?.raison ?? d?.motif }),
  confirmer:(id)     => api.post(`/reservations/${id}/confirmer`),
  alertes:  ()       => api.get('/reservations/alertes'),
  checkin:  (id)     => api.post(`/reservations/${id}/checkin`),
  checkout: (id)     => api.post(`/reservations/${id}/checkout`),
  timeline: (params) => api.get('/reservations/timeline', { params }),
}

export const chambresAPI = {
  lister:       (params) => api.get('/chambres', { params }),
  obtenir:      (id)     => api.get(`/chambres/${id}`),
  disponibles:  (params) => api.get('/chambres/disponibles', { params }),
  changerStatut:(id, d)  => api.put(`/chambres/${id}/statut`, d),
  // QA-01 — méthodes appelées par l'écran Chambres, jamais définies
  creer:        (d)      => api.post('/chambres', d),
  modifier:     (id, d)  => api.put(`/chambres/${id}`, d),
  supprimer:    (id, d)  => api.delete(`/chambres/${id}`, { data: d }),
  uploaderImage:(id, fichier) => { const fd = new FormData(); fd.append('fichier', fichier)
                                   return api.post(`/uploads/chambres/${id}/images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  supprimerImage:(id, imageId) => api.delete(`/uploads/chambres/${id}/images/${imageId}`),
  definirImagePrincipale:(id, imageId) => api.put(`/uploads/chambres/${id}/images/${imageId}/principale`),
}

export const clientsAPI = {
  lister:   (params) => api.get('/clients', { params }),
  obtenir:  (id)     => api.get(`/clients/${id}`),
  creer:    (data)   => api.post('/clients', data),
  modifier: (id, d)  => api.put(`/clients/${id}`, d),
}

export const menageAPI = {
  taches:      (params) => api.get('/menage/taches', { params }),
  kanban:      ()       => api.get('/menage/kanban'),
  creerTache:  (data)   => api.post('/menage/taches', data),
  changerStatut:(id,d)  => api.put(`/menage/taches/${id}/statut`, d),
  assigner:    (id, d)  => api.put(`/menage/taches/${id}/assigner`, d),
  performance: (date)   => api.get('/menage/performance', { params: { date } }),
  agents:      ()       => api.get('/menage/agents'),
}

export const maintenanceAPI = {
  tickets:      (params) => api.get('/maintenance/tickets', { params }),
  obtenir:      (id)     => api.get(`/maintenance/tickets/${id}`),
  creer:        (data)   => api.post('/maintenance/tickets', data),
  modifier:     (id, d)  => api.put(`/maintenance/tickets/${id}`, d),
}

export const restaurantAPI = {
  menu:           ()      => api.get('/restaurant/menu'),
  commandes:      (p)     => api.get('/restaurant/commandes', { params: p }),
  cuisine:        ()      => api.get('/restaurant/cuisine'),
  creerCommande:  (data)  => api.post('/restaurant/commandes', data),
  changerStatut:  (id, d) => api.put(`/restaurant/commandes/${id}/statut`, d),
  creerArticle:   (data)  => api.post('/restaurant/articles', data),
  reservationsActives: () => api.get('/restaurant/reservations-actives'),
  performance:    (date)  => api.get('/restaurant/performance', { params: { date } }),
}

export const facturationAPI = {
  factures:      (p)    => api.get('/facturation/factures', { params: p }),
  // QA-01 — folio / paiements appelés par Réservations et Facturation, jamais définis
  folioReservation:     (resId)   => api.get(`/facturation/folio/${resId}`),
  factureParReservation:(resId)   => api.get(`/facturation/factures/par-reservation/${resId}`),
  paiementsFolio:       (folioId) => api.get('/facturation/paiements', { params: folioId ? { folio_id: folioId } : {} }),
  paiement:             (d)       => api.post('/facturation/paiement', d),
  confirmerPaiement:    (d)       => api.post('/facturation/paiement/confirm', d),
  taxes:         ()     => api.get('/facturation/taxes'),
  creerTaxe:     (data) => api.post('/facturation/taxes', data),
  modifierTaxe:  (id,d) => api.put(`/facturation/taxes/${id}`, d),
}

export const analyticsAPI = {
  dashboard:     () => api.get('/analytics/dashboard'),
  quotidiennes:  (p) => api.get('/analytics/quotidiennes', { params: p }),
  mensuelles:    () => api.get('/analytics/mensuelles'),
  pnl:             (p) => api.get('/analytics/pnl', { params: p }),
  kpiHospitality:  (p) => api.get('/analytics/kpi-hospitality', { params: p }),
  revenusVentiles: (p) => api.get('/analytics/revenus-ventiles', { params: p }),
  fbAnalyse:       (p) => api.get('/analytics/fb-analyse', { params: p }),
  stockAnalyse:    (p) => api.get('/analytics/stock-analyse', { params: p }),
  achatsAnalyse:   (p) => api.get('/analytics/achats-analyse', { params: p }),
}

export const aiAPI = {
  chat:           (data) => api.post('/ai/chat', data),
  analyser:       (type) => api.post('/ai/analyser', { type }),
  alertes:        ()     => api.get('/ai/alertes'),
  recommandations:()     => api.get('/ai/recommandations'),
  marquerLue:     (id)   => api.put(`/ai/alertes/${id}/lire`),
  previsions:     ()     => api.get('/ai/previsions'),
}

export const uploadsAPI = {
  uploadImage:   (chambreId, file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/uploads/chambres/${chambreId}/images`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  supprimerImage:(chambreId, imageId) => api.delete(`/uploads/chambres/${chambreId}/images/${imageId}`),
}

export const bookingAPI = {
  disponibilite: (slug, p) => api.get(`/booking/disponibilite/${slug}`, { params: p }),
  reserver:      (data)    => api.post('/booking/reserver', data),
}

export const portailClientAPI = {
  reservations: ()     => clientApi.get('/client/reservations'),
  factures:     ()     => clientApi.get('/client/factures'),
  profil:       ()     => clientApi.get('/client/profil'),
  modifierProfil:(d)   => clientApi.put('/client/profil', d),
  folio:        (id)   => clientApi.get(`/client/reservations/${id}/folio`),
  checkinEnLigne: (id) => clientApi.post(`/client/reservations/${id}/checkin-en-ligne`),
}

export const portailInboxAPI = {
  inbox:        ()                      => api.get('/portail/inbox'),
  messages:     (reservationId)         => api.get(`/portail/inbox/${reservationId}`),
  reply:        (reservationId, corps)  => api.post(`/portail/inbox/${reservationId}/reply`, { corps }),
  appels:       ()                      => api.get('/portail/appels'),
  traiterAppel: (id)                    => api.put(`/portail/appels/${id}/traiter`, {}),
  demandes:     ()                      => api.get('/portail/demandes'),
  statutDemande:(id, statut)            => api.put(`/portail/demandes/${id}/statut`, { statut }),
}

export const hotelsAPI = {
  lister:           () => api.get('/hotels'),
  obtenir:          (id) => api.get(`/hotels/${id}`),
  majParametres:    (id, d) => api.put(`/hotels/${id}/parametres`, d),
  mettreAJour:      (id, d) => api.patch(`/hotels/${id}`, d),
  uploadImageFond:  (id, fichier) => { const fd = new FormData(); fd.append('fichier', fichier)
                                       return api.post(`/hotels/${id}/image-fond`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  modules:          () => api.get('/hotels/modules'),
  uploadLogo:       (id, fichier) => { const fd = new FormData(); fd.append('fichier', fichier)
                                       return api.post(`/hotels/${id}/logo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  supprimerLogo:    (id) => api.delete(`/hotels/${id}/logo`),
}

export const utilisateursAPI = {
  lister:   (p) => api.get('/utilisateurs', { params: p }),
  creer:    (d) => api.post('/utilisateurs', d),
  modifier: (id, d) => api.put(`/utilisateurs/${id}`, d),
  supprimer:(id)    => api.delete(`/utilisateurs/${id}`),
}

// ─────────────────────────────────────────────────────────────────────────────
// QA-01 — Clients API des modules d'exploitation. Les écrans (types de chambre,
// onboarding, arrhes, caisse, charges, catalogue, stock, achats, fournisseurs,
// fidélité, événements, notifications, ECA, diagnostic) importaient ces objets,
// jamais exportés : chaque écran plantait à l'exécution. Chemins = routes backend réelles.
// ─────────────────────────────────────────────────────────────────────────────
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } }

export const typesChambreAPI = {
  lister:         ()        => api.get('/types-chambre'),
  obtenir:        (id)      => api.get(`/types-chambre/${id}`),
  creer:          (d)       => api.post('/types-chambre', d),
  modifier:       (id, d)   => api.put(`/types-chambre/${id}`, d),
  supprimer:      (id)      => api.delete(`/types-chambre/${id}`),
  uploadPhoto:    (id, fd)  => api.post(`/types-chambre/${id}/photos`, fd, multipart),
  supprimerPhoto: (id, url) => api.delete(`/types-chambre/${id}/photos`, { data: { url } }),
}

export const onboardingAPI = {
  creerHotel: (d) => api.post('/onboarding/hotel', d),
}

export const arrhesAPI = {
  config:         ()       => api.get('/arrhes/config'),
  updateConfig:   (d)      => api.put('/arrhes/config', d),
  lister:         (p)      => api.get('/arrhes', { params: p }),
  stats:          ()       => api.get('/arrhes/stats'),
  parReservation: (resId)  => api.get(`/arrhes/reservation/${resId}`),
  obtenir:        (id)     => api.get(`/arrhes/${id}`),
  creer:          (d)      => api.post('/arrhes', d),
  confirmer:      (id, d)  => api.put(`/arrhes/${id}/confirmer`, d),
  rembourser:     (id, d)  => api.put(`/arrhes/${id}/rembourser`, d),
  acquerir:       (id, d)  => api.put(`/arrhes/${id}/acquerir`, d),
}

export const caisseAPI = {
  sessionActive: ()   => api.get('/caisse/session-active'),
  encaissements: ()   => api.get('/caisse/encaissements'),
  ouvrir:        (d)  => api.post('/caisse/ouvrir', d),
  mouvement:     (d)  => api.post('/caisse/mouvement', d),
  cloturer:      (d)  => api.post('/caisse/cloturer', d),
  historique:    (p)  => api.get('/caisse/historique', { params: p }),
  detail:        (id) => api.get(`/caisse/${id}/detail`),
}

export const chargesAPI = {
  categories:      ()      => api.get('/charges/categories'),
  creerCategorie:  (d)     => api.post('/charges/categories', d),
  lister:          (p)     => api.get('/charges', { params: p }),
  totaux:          (p)     => api.get('/charges/totaux', { params: p }),
  creer:           (d)     => api.post('/charges', d),
  modifier:        (id, d) => api.put(`/charges/${id}`, d),
  valider:         (id)    => api.put(`/charges/${id}/valider`),
  supprimer:       (id)    => api.delete(`/charges/${id}`),
}

export const catalogueAPI = {
  categories:         ()      => api.get('/catalogue/categories'),
  creerCategorie:     (d)     => api.post('/catalogue/categories', d),
  modifierCategorie:  (id, d) => api.put(`/catalogue/categories/${id}`, d),
  supprimerCategorie: (id)    => api.delete(`/catalogue/categories/${id}`),
  articles:           (p)     => api.get('/catalogue/articles', { params: p }),
  creerArticle:       (d)     => api.post('/catalogue/articles', d),
  modifierArticle:    (id, d) => api.put(`/catalogue/articles/${id}`, d),
  supprimerArticle:   (id)    => api.delete(`/catalogue/articles/${id}`),
}

export const stockAPI = {
  lister:     ()  => api.get('/stock'),
  alertes:    ()  => api.get('/stock/alertes'),
  mouvement:  (d) => api.post('/stock/mouvement', d),
  historique: (p) => api.get('/stock/historique', { params: p }),
}

export const achatsAPI = {
  bons:     (p)     => api.get('/achats/bons', { params: p }),
  obtenir:  (id)    => api.get(`/achats/bons/${id}`),
  creer:    (d)     => api.post('/achats/bons', d),
  modifier: (id, d) => api.put(`/achats/bons/${id}`, d),
  recevoir: (id, d) => api.post(`/achats/bons/${id}/recevoir`, d),
  annuler:  (id)    => api.delete(`/achats/bons/${id}`),   // backend : annulation d'un bon en brouillon
}

export const fournisseursAPI = {
  lister:    ()      => api.get('/fournisseurs'),
  obtenir:   (id)    => api.get(`/fournisseurs/${id}`),
  creer:     (d)     => api.post('/fournisseurs', d),
  modifier:  (id, d) => api.put(`/fournisseurs/${id}`, d),
  supprimer: (id)    => api.delete(`/fournisseurs/${id}`),
}

export const fideliteAPI = {
  regles:          ()      => api.get('/fidelite/regles'),
  majRegles:       (d)     => api.put('/fidelite/regles', d),
  offres:          ()      => api.get('/fidelite/offres'),
  creerOffre:      (d)     => api.post('/fidelite/offres', d),
  modifierOffre:   (id, d) => api.put(`/fidelite/offres/${id}`, d),
  desactiverOffre: (id)    => api.delete(`/fidelite/offres/${id}`),
  points:          (cid)   => api.get(`/fidelite/clients/${cid}/points`),
}

export const evenementsAPI = {
  salles:     ()      => api.get('/evenements/salles'),
  lister:     (p)     => api.get('/evenements', { params: p }),
  calendrier: (p)     => api.get('/evenements/calendrier', { params: p }),
  creer:      (d)     => api.post('/evenements', d),
  modifier:   (id, d) => api.put(`/evenements/${id}`, d),
}

export const notificationsAPI = {
  alertes: () => api.get('/notifications/alertes'),
}

export const ecaAPI = {
  getCurrent: () => api.get('/eca/current'),
}

export const diagnosticAPI = {
  getCurrent: (ecaId) => api.get('/diagnostics/current', { params: { eca_context_id: ecaId } }),
  compute:    (ecaId) => api.post('/diagnostics', { eca_context_id: ecaId }),
}

export default api
