'use client'
import { useState, useEffect } from 'react'
import AppLayout from '@/components/layout/AppLayout'
import { ecaAPI, diagnosticAPI } from '@/lib/api'
import { fmtDateTime } from '@/lib/utils'
import toast from 'react-hot-toast'

const CONFIDENCE_CONFIG = {
  ELEVEE:  { label: 'Élevée',        css: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  MODEREE: { label: 'Satisfaisante', css: 'bg-blue-500/20 text-blue-400 border-blue-500/30'         },
  LIMITEE: { label: 'Partielle',     css: 'bg-amber-500/20 text-amber-400 border-amber-500/30'      },
}

const URGENCY_CSS = {
  CRITIQUE: 'text-red-400',
  ELEVEE:   'text-orange-400',
  MODEREE:  'text-amber-400',
  FAIBLE:   'text-emerald-400',
}

const LEVER_LABELS = {
  CHARGES_REDUCTION:        'Réduction des charges',
  REVENUE_GROWTH:           'Croissance du chiffre d\'affaires',
  BFR_OPTIMISATION:         'Optimisation du besoin en fonds de roulement',
  DETTE_CT_RESTRUCTURATION: 'Restructuration des dettes court terme',
}

const BRIDGE_STATUS_CONFIG = {
  COMPLETED: { label: 'Disponible',     css: 'bg-emerald-500/20 text-emerald-400' },
  SUBMITTED: { label: 'En cours',       css: 'bg-blue-500/20 text-blue-400'       },
  FAILED:    { label: 'Échec',          css: 'bg-red-500/20 text-red-400'         },
  PENDING:   { label: 'En préparation', css: 'bg-[var(--bg-4)] text-[var(--text-3)]' },
}

export default function DiagnosticPage() {
  const [ecaContextId, setEcaContextId] = useState(undefined)
  const [diagnostic,   setDiagnostic]   = useState(undefined)
  const [loading,      setLoading]      = useState(true)
  const [computing,    setComputing]    = useState(false)

  useEffect(() => { charger() }, [])

  async function charger() {
    try {
      setLoading(true)

      // Étape 1 — Résoudre l'ECA courant depuis le tenant authentifié (B11-01)
      const ecaRes = await ecaAPI.getCurrent()
      const ecaId  = ecaRes.data.eca_context_id
      setEcaContextId(ecaId)

      if (!ecaId) {
        setDiagnostic(null)
        return
      }

      // Étape 2 — Charger le diagnostic courant pour cet ECA
      const diagRes = await diagnosticAPI.getCurrent(ecaId)
      setDiagnostic(diagRes.data.data)
    } catch {
      toast.error('Impossible de charger le diagnostic')
      setEcaContextId(null)
      setDiagnostic(null)
    } finally {
      setLoading(false)
    }
  }

  async function lancerDiagnostic() {
    if (!ecaContextId) return
    try {
      setComputing(true)
      await diagnosticAPI.compute(ecaContextId)
      const diagRes = await diagnosticAPI.getCurrent(ecaContextId)
      setDiagnostic(diagRes.data.data)
      toast.success('Diagnostic mis à jour')
    } catch {
      toast.error('Erreur lors du calcul du diagnostic')
    } finally {
      setComputing(false)
    }
  }

  if (loading) return (
    <AppLayout titre="Diagnostic IA" sousTitre="Intelligence analytique CEPOS">
      <div className="space-y-4">
        <div className="skeleton h-32 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_,i) => <div key={i} className="skeleton h-48 rounded-xl" />)}
        </div>
      </div>
    </AppLayout>
  )

  // Aucun ECA : tenant n'a pas encore calculé de contexte comptable
  if (ecaContextId === null) return (
    <AppLayout titre="Diagnostic IA" sousTitre="Intelligence analytique CEPOS">
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <span className="text-5xl opacity-20">📊</span>
        <div className="text-sm font-semibold text-[var(--text-1)]">Aucun contexte comptable disponible</div>
        <div className="text-xs text-[var(--text-3)] text-center max-w-xs">
          Veuillez calculer un ECA avant d'utiliser le Diagnostic.
        </div>
      </div>
    </AppLayout>
  )

  const d    = diagnostic
  const conf = d ? (CONFIDENCE_CONFIG[d.data_confidence] ?? null) : null

  return (
    <AppLayout titre="Diagnostic IA" sousTitre="Intelligence analytique CEPOS">
      <div className="space-y-5">

        {/* ─── ZONE A — VERDICT ─────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="space-y-2.5">
            {d ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                    d.status === 'SUSPENDED'
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  }`}>
                    {d.status === 'SUSPENDED' ? 'SUSPENDU' : 'DIAGNOSTIQUÉ'}
                  </span>
                  {conf && (
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${conf.css}`}>
                      Confiance : {conf.label}
                    </span>
                  )}
                  <span className="text-xs text-[var(--text-4)]">v{d.version}</span>
                </div>
                <p className="text-base font-semibold text-[var(--text-0)] leading-snug">
                  {d.narrative?.constat ?? 'Diagnostic disponible.'}
                </p>
                {d.computed_at && (
                  <div className="text-xs text-[var(--text-4)]">
                    Calculé le {fmtDateTime(d.computed_at)}
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full border border-[var(--border-1)] text-[var(--text-3)] inline-block">
                  AUCUN DIAGNOSTIC
                </span>
                <p className="text-sm text-[var(--text-3)]">
                  Aucun Diagnostic disponible pour cet ECA.
                </p>
              </>
            )}
          </div>
        </div>

        {/* ─── ZONE B — COMPRÉHENSION ───────────────────────────────────── */}
        {d && (
          <div className="card p-5">
            <div className="card-title mb-4">Analyse détaillée</div>
            {d.status === 'SUSPENDED' ? (
              <div className="space-y-3">
                {d.narrative?.suspension_reason && (
                  <div className="flex gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <span className="text-amber-400 text-sm mt-0.5 flex-shrink-0">⚠</span>
                    <p className="text-sm text-[var(--text-1)]">{d.narrative.suspension_reason}</p>
                  </div>
                )}
                <p className="text-xs text-[var(--text-4)]">
                  Améliorez la qualité de vos données financières et relancez l'analyse.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {d.narrative?.causalite && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-4)] mb-1.5">Cause identifiée</div>
                    <p className="text-sm text-[var(--text-1)]">{d.narrative.causalite}</p>
                  </div>
                )}
                {d.narrative?.urgence && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-4)] mb-1.5">Niveau d'urgence</div>
                    <p className={`text-sm font-medium ${URGENCY_CSS[d.urgency] ?? 'text-[var(--text-1)]'}`}>
                      {d.narrative.urgence}
                    </p>
                  </div>
                )}
                {d.narrative?.confiance && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-4)] mb-1.5">Qualité des données</div>
                    <p className="text-sm text-[var(--text-3)]">{d.narrative.confiance}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── ZONE C — ACTION ──────────────────────────────────────────── */}
        <div className="card p-5">
          <div className="card-title mb-4">Actions disponibles</div>
          <div className="space-y-4">

            {d?.bridges?.length > 0 && (
              <div className="space-y-3">
                {d.narrative?.ouverture && (
                  <p className="text-sm text-[var(--text-2)]">{d.narrative.ouverture}</p>
                )}
                <div className="space-y-1.5">
                  {d.bridges.map((bridge, i) => {
                    const bConf = BRIDGE_STATUS_CONFIG[bridge.status] ?? BRIDGE_STATUS_CONFIG.PENDING
                    return (
                      <div key={i} className="flex items-center justify-between p-3 bg-[var(--bg-3)] border border-[var(--border-1)] rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-sm opacity-70">🔬</span>
                          <span className="text-sm text-[var(--text-1)]">
                            {LEVER_LABELS[bridge.lever_type] ?? bridge.lever_type}
                          </span>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${bConf.css}`}>
                          {bConf.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <button
              onClick={lancerDiagnostic}
              disabled={computing}
              className="btn btn-primary w-full"
            >
              {computing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Calcul en cours...
                </span>
              ) : d ? 'Recalculer le diagnostic' : 'Lancer le diagnostic'}
            </button>

            {!d && (
              <p className="text-xs text-center text-[var(--text-4)]">
                Le moteur analyse vos signaux financiers et identifie les causes principales.
              </p>
            )}

          </div>
        </div>

      </div>
    </AppLayout>
  )
}
