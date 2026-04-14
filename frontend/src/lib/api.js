import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

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
  modifier: (id, d)  => api.put(`/reservations/${id}`, d),
  annuler:  (id, d)  => api.delete(`/reservations/${id}`, { data: d }),
  checkin:  (id)     => api.post(`/reservations/${id}/checkin`),
  checkout: (id)     => api.post(`/reservations/${id}/checkout`),
  timeline: (params) => api.get('/reservations/timeline', { params }),
}

export const chambresAPI = {
  lister:       (params) => api.get('/chambres', { params }),
  obtenir:      (id)     => api.get(`/chambres/${id}`),
  disponibles:  (params) => api.get('/chambres/disponibles', { params }),
  changerStatut:(id, d)  => api.put(`/chambres/${id}/statut`, d),
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
}

export const facturationAPI = {
  factures:      (p)    => api.get('/facturation/factures', { params: p }),
  creerFacture:  (data) => api.post('/facturation/factures', data),
  taxes:         ()     => api.get('/facturation/taxes'),
  creerTaxe:     (data) => api.post('/facturation/taxes', data),
  modifierTaxe:  (id,d) => api.put(`/facturation/taxes/${id}`, d),
}

export const analyticsAPI = {
  dashboard:     () => api.get('/analytics/dashboard'),
  quotidiennes:  (p) => api.get('/analytics/quotidiennes', { params: p }),
  mensuelles:    () => api.get('/analytics/mensuelles'),
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
  reservations: ()     => api.get('/client/reservations'),
  factures:     ()     => api.get('/client/factures'),
  profil:       ()     => api.get('/client/profil'),
  modifierProfil:(d)   => api.put('/client/profil', d),
}

export const hotelsAPI = {
  lister:           () => api.get('/hotels'),
  obtenir:          (id) => api.get(`/hotels/${id}`),
  majParametres:    (id, d) => api.put(`/hotels/${id}/parametres`, d),
}

export const utilisateursAPI = {
  lister:   (p) => api.get('/utilisateurs', { params: p }),
  creer:    (d) => api.post('/utilisateurs', d),
  modifier: (id, d) => api.put(`/utilisateurs/${id}`, d),
  supprimer:(id)    => api.delete(`/utilisateurs/${id}`),
}

export default api
