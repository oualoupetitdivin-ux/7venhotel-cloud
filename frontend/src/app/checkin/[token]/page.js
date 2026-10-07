'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// ─────────────────────────────────────────────────────────────────────────────
// /checkin/[token] — Check-in en ligne (LOT-GUEST-01)
// Lien à usage unique envoyé au client. Les données alimentent la fiche client et la
// réservation PMS ; l'arrivée physique reste validée par la réception.
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

const LIBELLES_DOC = { passeport: 'Passeport', cni: "Carte nationale d'identité", permis: 'Permis de conduire', titre_sejour: 'Titre de séjour' }
const MOTIFS = {
  CHECKIN_DEJA_EFFECTUE: 'Votre check-in en ligne a déjà été effectué. Présentez-vous simplement à la réception.',
  LIEN_EXPIRE: 'Ce lien a expiré. Contactez l\'hôtel pour en recevoir un nouveau.',
  RESERVATION_TENTATIVE: 'Votre réservation est en attente de confirmation du paiement. Le check-in sera possible dès sa confirmation.',
  RESERVATION_ANNULEE: 'Cette réservation a été annulée.',
  RESERVATION_ARRIVEE: 'Vous êtes déjà enregistré à l\'hôtel.',
  RESERVATION_TERMINEE: 'Ce séjour est terminé.',
}

const CHAMPS = [
  ['prenom', 'Prénom', 'text', true], ['nom', 'Nom', 'text', true],
  ['telephone', 'Téléphone', 'tel', true], ['nationalite', 'Nationalité', 'text', true],
  ['date_naissance', 'Date de naissance', 'date', true],
  ['numero_document', 'Numéro de la pièce', 'text', true],
  ['date_expiration_document', 'Expiration de la pièce', 'date', false],
  ['adresse', 'Adresse', 'text', false], ['ville', 'Ville', 'text', false], ['pays_residence', 'Pays de résidence', 'text', false],
  ['heure_arrivee', 'Heure d\'arrivée prévue', 'time', false],
]

export default function CheckinEnLigne() {
  const { token } = useParams()
  const [etat, setEtat] = useState('chargement')     // chargement | erreur | bloque | formulaire | termine
  const [dossier, setDossier] = useState(null)
  const [form, setForm] = useState({})
  const [erreur, setErreur] = useState('')
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => { charger() }, [token])

  async function charger() {
    setEtat('chargement')
    try {
      const res = await fetch(`${API_URL}/checkin-en-ligne/${encodeURIComponent(token)}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErreur(data.erreur || 'Lien invalide'); setEtat('erreur'); return }
      setDossier(data)
      const c = data.client || {}
      setForm({
        prenom: c.prenom || '', nom: c.nom || '', telephone: c.telephone || '', nationalite: c.nationalite || '',
        date_naissance: c.date_naissance || '', type_document: c.type_document || '', numero_document: c.numero_document || '',
        date_expiration_document: c.date_expiration_document || '', adresse: c.adresse || '', ville: c.ville || '',
        pays_residence: c.pays_residence || '', heure_arrivee: '', preferences: '', acceptation_conditions: false,
      })
      setEtat(data.modifiable ? 'formulaire' : 'bloque')
    } catch {
      setErreur('Connexion impossible — vérifiez votre réseau et réessayez')
      setEtat('erreur')
    }
  }

  async function soumettre(e) {
    e.preventDefault()
    setEnvoi(true); setErreur('')
    try {
      const corps = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''))
      const res = await fetch(`${API_URL}/checkin-en-ligne/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErreur(data.erreur || 'Envoi impossible'); return }
      setEtat('termine')
    } catch {
      setErreur('Connexion impossible — réessayez')
    } finally {
      setEnvoi(false)
    }
  }

  const cadre = (contenu) => (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">{contenu}</div>
    </div>
  )

  if (etat === 'chargement') return cadre(
    <div className="flex justify-center"><div className="w-8 h-8 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin"/></div>
  )

  if (etat === 'erreur') return cadre(
    <div className="bg-[#111827] border border-white/10 rounded-3xl p-8 text-center" data-testid="checkin-erreur">
      <div className="text-5xl mb-4">🔒</div>
      <h1 className="text-xl font-black text-white mb-2">Lien de check-in invalide</h1>
      <p className="text-sm text-gray-400 mb-5">{erreur}</p>
      <button onClick={charger} className="text-blue-400 text-sm">Réessayer</button>
    </div>
  )

  const r = dossier?.reservation || {}
  const entete = (
    <div className="text-center mb-6">
      <div className="inline-flex items-center gap-2 bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold px-4 py-1.5 rounded-full mb-3">
        🛎 Check-in en ligne · {r.hotel}
      </div>
      <h1 className="text-xl font-black text-white">Réservation {r.numero}</h1>
      <p className="text-xs text-gray-400 mt-1">{r.type_chambre ? `${r.type_chambre} · ` : ''}{r.date_arrivee} → {r.date_depart}</p>
    </div>
  )

  if (etat === 'termine') return cadre(
    <div className="bg-[#111827] border border-emerald-500/30 rounded-3xl p-8 text-center" data-testid="checkin-termine">
      <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-3xl mx-auto mb-5">✓</div>
      <h1 className="text-xl font-black text-white mb-2">Check-in en ligne effectué</h1>
      <p className="text-sm text-gray-400">Merci ! À votre arrivée, la réception vous remettra votre clé et l&apos;accès à votre portail chambre.</p>
    </div>
  )

  if (etat === 'bloque') return cadre(
    <div className="bg-[#111827] border border-white/10 rounded-3xl p-8 text-center" data-testid="checkin-bloque">
      {entete}
      <p className="text-sm text-amber-300">{MOTIFS[dossier?.motif_blocage] || 'Le check-in en ligne n\'est pas disponible pour cette réservation.'}</p>
    </div>
  )

  const champ = (nom, libelle, type, requis) => (
    <div key={nom}>
      <label htmlFor={nom} className="text-[10px] text-gray-500 block mb-1 uppercase">{libelle}{requis ? ' *' : ''}</label>
      <input id={nom} name={nom} type={type} required={requis} value={form[nom] || ''}
        onChange={e => setForm(f => ({ ...f, [nom]: e.target.value }))}
        className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"/>
    </div>
  )

  return cadre(
    <form onSubmit={soumettre} className="bg-[#111827] border border-white/10 rounded-3xl p-6" data-testid="checkin-formulaire">
      {entete}
      {erreur && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg mb-4">{erreur}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CHAMPS.slice(0, 5).map(c => champ(...c))}
        <div>
          <label htmlFor="type_document" className="text-[10px] text-gray-500 block mb-1 uppercase">Pièce d&apos;identité *</label>
          <select id="type_document" name="type_document" required value={form.type_document}
            onChange={e => setForm(f => ({ ...f, type_document: e.target.value }))}
            className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none">
            <option value="">— Choisir —</option>
            {(dossier?.types_document || []).map(t => <option key={t} value={t}>{LIBELLES_DOC[t] || t}</option>)}
          </select>
        </div>
        {CHAMPS.slice(5).map(c => champ(...c))}
      </div>
      <div className="mt-3">
        <label htmlFor="preferences" className="text-[10px] text-gray-500 block mb-1 uppercase">Préférences / demandes</label>
        <textarea id="preferences" rows={2} value={form.preferences}
          onChange={e => setForm(f => ({ ...f, preferences: e.target.value }))}
          className="w-full bg-[#1A2235] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"/>
      </div>
      <label className="flex items-start gap-2 mt-4 text-xs text-gray-300">
        <input type="checkbox" name="acceptation_conditions" checked={form.acceptation_conditions}
          onChange={e => setForm(f => ({ ...f, acceptation_conditions: e.target.checked }))} className="mt-0.5"/>
        J&apos;atteste l&apos;exactitude de ces informations et accepte leur transmission à l&apos;hôtel pour mon enregistrement.
      </label>
      <button type="submit" disabled={envoi || !form.acceptation_conditions}
        className="w-full mt-5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl">
        {envoi ? 'Envoi…' : 'Valider mon check-in'}
      </button>
    </form>
  )
}
