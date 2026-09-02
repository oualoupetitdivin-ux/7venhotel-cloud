'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { authAPI } from '@/lib/api'
import { useAuthStore, resolvePostLoginDestination } from '@/lib/utils'

export default function ChangerMotDePassePage() {
  const router     = useRouter()
  const { user, hotel, token, setSession } = useAuthStore(s => ({
    user:       s.user,
    hotel:      s.hotel,
    token:      s.token,
    setSession: s.setSession,
  }))

  const [ancienMdp,    setAncienMdp]    = useState('')
  const [nouveauMdp,   setNouveauMdp]   = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [loading,      setLoading]      = useState(false)
  const [erreur,       setErreur]       = useState('')
  const [forceMode,    setForceMode]    = useState(false)

  // ── Hydration du store + guards ───────────────────────────────────
  const { init } = useAuthStore(s => ({ init: s.init }))

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    // Lire ?force=1 depuis l'URL (sans useSearchParams pour éviter Suspense)
    const params = new URLSearchParams(window.location.search)
    setForceMode(params.get('force') === '1')

    try {
      const tok = localStorage.getItem('7vh_token')
      if (!tok) {
        router.replace('/auth/connexion')
        return
      }

      // Si doit_changer_mdp est déjà false et qu'on arrive ici hors force :
      // on laisse passer — l'utilisateur veut changer son MDP volontairement
      // En force mode : si déjà changé, résoudre et rediriger
      if (params.get('force') === '1') {
        const storedUser  = JSON.parse(localStorage.getItem('7vh_user')  || 'null')
        const storedHotel = JSON.parse(localStorage.getItem('7vh_hotel') || 'null')
        if (storedUser && storedUser.doit_changer_mdp === false) {
          router.replace(resolvePostLoginDestination(storedUser, storedHotel))
        }
      }
    } catch {
      router.replace('/auth/connexion')
    }
  }, [router, init])

  async function handleSubmit(e) {
    e.preventDefault()
    setErreur('')

    if (!ancienMdp || !nouveauMdp) {
      setErreur('Tous les champs sont obligatoires')
      return
    }
    if (nouveauMdp.length < 8) {
      setErreur('Le nouveau mot de passe doit faire au moins 8 caractères')
      return
    }
    if (nouveauMdp !== confirmation) {
      setErreur('Les mots de passe ne correspondent pas')
      return
    }
    if (nouveauMdp === ancienMdp) {
      setErreur('Le nouveau mot de passe doit être différent de l\'ancien')
      return
    }

    setLoading(true)
    try {
      await authAPI.changerMotDePasse({
        ancien_mdp:  ancienMdp,
        nouveau_mdp: nouveauMdp,
      })

      // Patcher la session locale : doit_changer_mdp → false
      // Le JWT reste valide, seul ce flag change dans le store
      const refreshToken = localStorage.getItem('7vh_refresh_token') || ''
      const updatedUser  = { ...user, doit_changer_mdp: false }

      setSession({
        token:                  token,
        token_rafraichissement: refreshToken,
        utilisateur:            updatedUser,
        hotel:                  hotel,
      })

      toast.success('Mot de passe mis à jour')

      const destination = resolvePostLoginDestination(updatedUser, hotel)
      router.replace(destination)

    } catch (err) {
      const msg = err.response?.data?.erreur || 'Erreur lors du changement de mot de passe'
      setErreur(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-0)] p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white text-lg font-black shadow-lg shadow-blue-500/30">
            7
          </div>
          <div>
            <div className="text-sm font-black"><span className="text-blue-400">7ven</span>Hotel Cloud</div>
            <div className="text-[9px] text-[var(--text-4)] tracking-widest uppercase">Sécurité du compte</div>
          </div>
        </div>

        {/* Carte */}
        <div className="bg-[var(--bg-1)] border border-[var(--border-0)] rounded-2xl p-8 shadow-xl">

          {/* En-tête */}
          <div className="mb-6">
            {forceMode ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-amber-500/15 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Action requise</span>
                </div>
                <h1 className="text-xl font-black text-[var(--text-0)] mb-1">Sécurisez votre compte</h1>
                <p className="text-xs text-[var(--text-3)] leading-relaxed">
                  Votre compte a été créé avec un mot de passe temporaire. Définissez un mot de passe personnel avant de continuer.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-black text-[var(--text-0)] mb-1">Changer le mot de passe</h1>
                <p className="text-xs text-[var(--text-3)]">
                  Choisissez un nouveau mot de passe sécurisé.
                </p>
              </>
            )}
          </div>

          {/* Erreur */}
          {erreur && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-2.5 rounded-lg mb-5">
              {erreur}
            </div>
          )}

          {/* Formulaire */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--text-2)] mb-1.5">
                {forceMode ? 'Mot de passe temporaire' : 'Mot de passe actuel'}
              </label>
              <input
                type="password"
                className="input w-full"
                placeholder="••••••••"
                value={ancienMdp}
                onChange={e => setAncienMdp(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-2)] mb-1.5">
                Nouveau mot de passe
              </label>
              <input
                type="password"
                className="input w-full"
                placeholder="Minimum 8 caractères"
                value={nouveauMdp}
                onChange={e => setNouveauMdp(e.target.value)}
                autoComplete="new-password"
              />
              {nouveauMdp.length > 0 && nouveauMdp.length < 8 && (
                <p className="text-[10px] text-amber-400 mt-1">
                  {8 - nouveauMdp.length} caractère(s) manquant(s)
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-2)] mb-1.5">
                Confirmer le nouveau mot de passe
              </label>
              <input
                type="password"
                className="input w-full"
                placeholder="••••••••"
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
                autoComplete="new-password"
              />
              {confirmation.length > 0 && confirmation !== nouveauMdp && (
                <p className="text-[10px] text-red-400 mt-1">Les mots de passe ne correspondent pas</p>
              )}
            </div>

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
                  Mise à jour…
                </span>
              ) : (
                forceMode ? 'Définir mon mot de passe →' : 'Changer le mot de passe →'
              )}
            </button>
          </form>

          {/* Politique MDP */}
          <div className="mt-4 p-3 bg-[var(--bg-2)] rounded-lg border border-[var(--border-0)]">
            <p className="text-[10px] text-[var(--text-4)] font-medium mb-1">Politique de mot de passe</p>
            <ul className="text-[10px] text-[var(--text-4)] space-y-0.5">
              <li className={`flex items-center gap-1 ${nouveauMdp.length >= 8 ? 'text-green-400' : ''}`}>
                <span>{nouveauMdp.length >= 8 ? '✓' : '·'}</span> Minimum 8 caractères
              </li>
              <li className={`flex items-center gap-1 ${nouveauMdp !== ancienMdp && nouveauMdp.length > 0 ? 'text-green-400' : ''}`}>
                <span>{nouveauMdp !== ancienMdp && nouveauMdp.length > 0 ? '✓' : '·'}</span> Différent du mot de passe actuel
              </li>
              <li className={`flex items-center gap-1 ${confirmation.length > 0 && confirmation === nouveauMdp ? 'text-green-400' : ''}`}>
                <span>{confirmation.length > 0 && confirmation === nouveauMdp ? '✓' : '·'}</span> Confirmation identique
              </li>
            </ul>
          </div>

        </div>
      </div>
    </div>
  )
}
