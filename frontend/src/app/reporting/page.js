'use client'
import { useState, useCallback } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

const NIVEAUX = [
  { id: 'executif', label: 'Exécutif' },
  { id: 'standard', label: 'Standard' },
  { id: 'detaille', label: 'Détaillé' },
]

function getMoisCourant() {
  return new Date().toISOString().slice(0, 7)
}

function fmt(val, devise = 'XAF') {
  if (val == null || isNaN(Number(val))) return '—'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(val)) + ' ' + devise
}

function fmtNum(val) {
  if (val == null || isNaN(Number(val))) return '—'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(val))
}

function formatMoisLabel(mois) {
  if (!mois) return ''
  const [y, m] = mois.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export default function ReportingMagazinePage() {
  const [mois, setMois]           = useState(getMoisCourant())
  const [niveau, setNiveau]       = useState('standard')
  const [rapport, setRapport]     = useState(null)
  const [narratif, setNarratif]   = useState('')
  const [chargement, setChargement] = useState(false)
  const [genNarratif, setGenNarratif] = useState(false)
  const [erreur, setErreur]       = useState('')

  function getHeaders() {
    const token   = typeof window !== 'undefined' ? localStorage.getItem('7vh_token') : null
    const hotelId = typeof window !== 'undefined' ? localStorage.getItem('7vh_hotel_id') : null
    return {
      'Content-Type': 'application/json',
      ...(token   && { Authorization: `Bearer ${token}` }),
      ...(hotelId && { 'X-Hotel-ID': hotelId }),
    }
  }

  const generer = useCallback(async () => {
    setChargement(true)
    setErreur('')
    setRapport(null)
    setNarratif('')
    try {
      // 1. Données agrégées
      const resData = await fetch(`${API_BASE}/reporting/magazine?mois=${mois}`, {
        headers: getHeaders(),
      })
      if (!resData.ok) throw new Error(`Erreur données (${resData.status})`)
      const { data } = await resData.json()
      setRapport(data)

      // 2. Narratif IA
      setGenNarratif(true)
      const resNarr = await fetch(`${API_BASE}/reporting/narratif`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ data, niveau }),
      })
      if (!resNarr.ok) throw new Error(`Erreur narratif (${resNarr.status})`)
      const { narratif: texte } = await resNarr.json()
      setNarratif(texte)
    } catch (e) {
      setErreur(e.message)
    } finally {
      setChargement(false)
      setGenNarratif(false)
    }
  }, [mois, niveau])

  const regenererNarratif = useCallback(async () => {
    if (!rapport) return
    setGenNarratif(true)
    setErreur('')
    try {
      const res = await fetch(`${API_BASE}/reporting/narratif`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ data: rapport, niveau }),
      })
      if (!res.ok) throw new Error(`Erreur narratif (${res.status})`)
      const { narratif: texte } = await res.json()
      setNarratif(texte)
    } catch (e) {
      setErreur(e.message)
    } finally {
      setGenNarratif(false)
    }
  }, [rapport, niveau])

  const hotel   = rapport?.hotel
  const occ     = rapport?.occupation
  const rev     = rapport?.revenus || []
  const rest    = rapport?.restaurant
  const clients = rapport?.clients
  const devise  = hotel?.devise || 'XAF'

  // Calcul max pour barres revenus
  const maxRevenu = rev.length > 0 ? Math.max(...rev.map(r => Number(r.total) || 0)) : 1

  // Formatage du narratif en paragraphes
  const paragraphesNarratif = narratif
    ? narratif.split('\n').filter(l => l.trim())
    : []

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

        :root {
          --fond-page: #EDECEA;
          --fond-doc: #FFFFFF;
          --bordure: #E0DECB;
          --noir-cacao: #1B0D00;
          --texte-dark: #141412;
          --texte-body: #2B2A27;
          --texte-muted: #6B6A60;
          --vert-inst: #1C6845;
          --vert-light: rgba(28,104,69,0.07);
          --vert-border: rgba(28,104,69,0.22);
          --or-inst: #A07C28;
          --or-light: rgba(160,124,40,0.08);
          --bleu-inst: #2D5B88;
          --bleu-light: rgba(45,91,136,0.07);
          --s-doc: 0 4px 20px -4px rgba(27,13,0,0.05), 0 1px 3px 0 rgba(27,13,0,0.03);
        }

        .mag-shell {
          font-family: 'Plus Jakarta Sans', sans-serif;
          background: var(--fond-page);
          min-height: 100vh;
          padding: 32px 20px 64px;
          color: var(--texte-body);
          -webkit-font-smoothing: antialiased;
        }

        /* ── Contrôles ─────────────────────────────────────────────── */
        .mag-controls {
          max-width: 860px;
          margin: 0 auto 28px;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .mag-controls label {
          font-size: 12px;
          font-weight: 600;
          color: var(--texte-muted);
          white-space: nowrap;
        }

        .mag-input-mois {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          border: 1px solid var(--bordure);
          border-radius: 4px;
          padding: 6px 10px;
          background: #fff;
          color: var(--texte-dark);
          outline: none;
        }
        .mag-input-mois:focus { border-color: var(--vert-inst); }

        .niv-group {
          display: flex;
          gap: 0;
          border: 1px solid var(--bordure);
          border-radius: 4px;
          overflow: hidden;
        }
        .niv-btn {
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          background: #fff;
          color: var(--texte-muted);
          border: none;
          cursor: pointer;
          border-right: 1px solid var(--bordure);
          transition: background 0.15s, color 0.15s;
        }
        .niv-btn:last-child { border-right: none; }
        .niv-btn.active {
          background: var(--vert-inst);
          color: #fff;
        }
        .niv-btn:hover:not(.active) { background: var(--vert-light); color: var(--vert-inst); }

        .btn-generer {
          padding: 7px 20px;
          font-size: 13px;
          font-weight: 700;
          background: var(--vert-inst);
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: opacity 0.15s;
          white-space: nowrap;
        }
        .btn-generer:hover { opacity: 0.88; }
        .btn-generer:disabled { opacity: 0.5; cursor: not-allowed; }

        .btn-pdf {
          margin-left: auto;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          background: var(--or-light);
          color: var(--or-inst);
          border: 1px solid rgba(160,124,40,0.3);
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-pdf:hover { background: rgba(160,124,40,0.15); }

        /* ── Document ──────────────────────────────────────────────── */
        .document-page {
          width: 100%;
          max-width: 860px;
          margin: 0 auto;
          background: var(--fond-doc);
          border: 1px solid var(--bordure);
          border-radius: 4px;
          padding: 64px 72px;
          box-shadow: var(--s-doc);
        }

        @media (max-width: 768px) {
          .document-page { padding: 32px 24px; }
        }

        /* ── Masthead ──────────────────────────────────────────────── */
        .doc-masthead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid var(--noir-cacao);
          padding-bottom: 20px;
          margin-bottom: 36px;
          gap: 16px;
          flex-wrap: wrap;
        }
        .brand-title {
          font-family: 'Cinzel', serif;
          font-size: 18px;
          font-weight: 700;
          color: var(--noir-cacao);
        }
        .brand-sub {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: var(--bleu-inst);
          font-weight: 500;
          margin-top: 3px;
        }
        .doc-meta {
          text-align: right;
          font-family: 'DM Mono', monospace;
          font-size: 10.5px;
          color: var(--texte-muted);
          line-height: 1.6;
        }

        /* ── Section heading ───────────────────────────────────────── */
        .section-label {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vert-inst);
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--vert-border);
        }

        /* ── Métriques occupation ──────────────────────────────────── */
        .metrics-row {
          display: flex;
          gap: 24px;
          margin-bottom: 32px;
          flex-wrap: wrap;
        }
        .metric-card {
          flex: 1;
          min-width: 140px;
          background: var(--vert-light);
          border: 1px solid var(--vert-border);
          border-radius: 4px;
          padding: 16px 20px;
        }
        .metric-value {
          font-family: 'DM Mono', monospace;
          font-size: 26px;
          font-weight: 500;
          color: var(--vert-inst);
          line-height: 1.1;
        }
        .metric-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--texte-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-top: 4px;
        }

        /* ── Barres revenus ────────────────────────────────────────── */
        .revenus-list {
          margin-bottom: 32px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .revenu-row {
          display: grid;
          grid-template-columns: 140px 1fr 100px;
          align-items: center;
          gap: 12px;
        }
        .revenu-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--texte-body);
          text-transform: capitalize;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .revenu-bar-track {
          height: 8px;
          background: rgba(160,124,40,0.1);
          border-radius: 2px;
          overflow: hidden;
        }
        .revenu-bar-fill {
          height: 100%;
          background: var(--or-inst);
          border-radius: 2px;
          transition: width 0.6s ease;
        }
        .revenu-amount {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: var(--or-inst);
          font-weight: 500;
          text-align: right;
          white-space: nowrap;
        }

        /* ── Métriques restaurant ──────────────────────────────────── */
        .rest-row {
          display: flex;
          gap: 20px;
          margin-bottom: 32px;
          flex-wrap: wrap;
        }
        .rest-card {
          flex: 1;
          min-width: 120px;
          background: var(--bleu-light);
          border: 1px solid rgba(45,91,136,0.2);
          border-radius: 4px;
          padding: 14px 18px;
        }
        .rest-value {
          font-family: 'DM Mono', monospace;
          font-size: 22px;
          font-weight: 500;
          color: var(--bleu-inst);
        }
        .rest-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--texte-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-top: 3px;
        }

        /* ── Narratif IA ───────────────────────────────────────────── */
        .narratif-section {
          border-top: 1px solid var(--bordure);
          margin-top: 36px;
          padding-top: 32px;
        }
        .narratif-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
          flex-wrap: wrap;
          gap: 8px;
        }
        .ia-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--bleu-light);
          border: 1px solid rgba(45,91,136,0.25);
          color: var(--bleu-inst);
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          padding: 3px 9px;
          border-radius: 3px;
        }
        .btn-regen {
          padding: 5px 12px;
          font-size: 11px;
          font-weight: 600;
          background: transparent;
          color: var(--bleu-inst);
          border: 1px solid rgba(45,91,136,0.3);
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-regen:hover { background: var(--bleu-light); }
        .btn-regen:disabled { opacity: 0.5; cursor: not-allowed; }

        .narratif-body p {
          font-size: 14.5px;
          line-height: 1.8;
          color: var(--texte-body);
          margin-bottom: 16px;
        }
        .narratif-body p.titre-section {
          font-family: 'Cinzel', serif;
          font-size: 13px;
          font-weight: 700;
          color: var(--vert-inst);
          letter-spacing: 0.05em;
          margin-top: 24px;
          margin-bottom: 8px;
        }

        /* ── Spinner ───────────────────────────────────────────────── */
        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(28,104,69,0.2);
          border-top-color: var(--vert-inst);
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          vertical-align: middle;
          margin-right: 6px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── État vide ─────────────────────────────────────────────── */
        .etat-vide {
          text-align: center;
          padding: 64px 0;
          color: var(--texte-muted);
        }
        .etat-vide .glyph {
          font-size: 48px;
          margin-bottom: 16px;
          opacity: 0.35;
        }
        .etat-vide p {
          font-size: 14px;
          max-width: 320px;
          margin: 0 auto;
          line-height: 1.6;
        }

        /* ── Erreur ────────────────────────────────────────────────── */
        .erreur-bloc {
          background: rgba(158,42,43,0.06);
          border: 1px solid rgba(158,42,43,0.2);
          border-radius: 4px;
          padding: 12px 16px;
          font-size: 13px;
          color: #9E2A2B;
          margin-bottom: 20px;
          font-family: 'DM Mono', monospace;
        }

        /* ── Print ─────────────────────────────────────────────────── */
        @media print {
          .mag-controls, .btn-regen, .btn-pdf, .niv-group, .btn-generer { display: none !important; }
          .mag-shell { background: #fff; padding: 0; }
          .document-page { box-shadow: none; border: none; padding: 40px; max-width: 100%; }
        }
      `}</style>

      <div className="mag-shell">
        {/* ── Contrôles ──────────────────────────────────────────── */}
        <div className="mag-controls">
          <label>Période</label>
          <input
            type="month"
            className="mag-input-mois"
            value={mois}
            onChange={e => setMois(e.target.value)}
            max={getMoisCourant()}
          />

          <label>Niveau</label>
          <div className="niv-group">
            {NIVEAUX.map(n => (
              <button
                key={n.id}
                className={`niv-btn${niveau === n.id ? ' active' : ''}`}
                onClick={() => setNiveau(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>

          <button
            className="btn-generer"
            onClick={generer}
            disabled={chargement}
          >
            {chargement && <span className="spinner" />}
            {chargement ? 'Génération...' : 'Générer le rapport'}
          </button>

          {rapport && (
            <button
              className="btn-pdf"
              onClick={() => {
                alert("Astuce : dans le dialogue d'impression, choisissez « Enregistrer en PDF » comme destination.")
                window.print()
              }}
            >
              Exporter PDF
            </button>
          )}
        </div>

        {/* ── Document ───────────────────────────────────────────── */}
        <div className="document-page">
          {erreur && <div className="erreur-bloc">Erreur : {erreur}</div>}

          {!rapport && !chargement && (
            <div className="etat-vide">
              <div className="glyph">📰</div>
              <p>Sélectionnez une période et un niveau de lecture, puis cliquez sur &laquo; Générer le rapport &raquo;.</p>
            </div>
          )}

          {rapport && (
            <>
              {/* Masthead */}
              <div className="doc-masthead">
                <div>
                  <div className="brand-title">{hotel?.nom || 'Hôtel'}</div>
                  <div className="brand-sub">{hotel?.ville || ''}</div>
                </div>
                <div className="doc-meta">
                  RAPPORT DE PERFORMANCE<br />
                  {formatMoisLabel(rapport.periode?.mois)}<br />
                  Généré le {new Date().toLocaleDateString('fr-FR')}
                </div>
              </div>

              {/* Section Occupation */}
              <div className="section-label">Occupation &amp; Hébergement</div>
              <div className="metrics-row">
                <div className="metric-card">
                  <div className="metric-value">{fmtNum(occ?.total_reservations)}</div>
                  <div className="metric-label">Séjours</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{fmtNum(occ?.total_nuits)}</div>
                  <div className="metric-label">Nuits vendues</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{fmt(occ?.tarif_moyen, devise)}</div>
                  <div className="metric-label">Tarif moyen / nuit</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value">{fmtNum(clients?.nouveaux_clients)}</div>
                  <div className="metric-label">Nouveaux clients</div>
                </div>
              </div>

              {/* Section Revenus */}
              {rev.length > 0 && (
                <>
                  <div className="section-label">Revenus par catégorie</div>
                  <div className="revenus-list">
                    {rev.map((r, i) => {
                      const pct = maxRevenu > 0 ? Math.round((Number(r.total) / maxRevenu) * 100) : 0
                      return (
                        <div className="revenu-row" key={i}>
                          <div className="revenu-label">{r.type_ligne || '—'}</div>
                          <div className="revenu-bar-track">
                            <div className="revenu-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="revenu-amount">{fmt(r.total, devise)}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Section Restaurant */}
              <div className="section-label">Restauration</div>
              <div className="rest-row">
                <div className="rest-card">
                  <div className="rest-value">{fmt(rest?.ca_restaurant, devise)}</div>
                  <div className="rest-label">CA Restaurant</div>
                </div>
                <div className="rest-card">
                  <div className="rest-value">{fmtNum(rest?.commandes)}</div>
                  <div className="rest-label">Commandes</div>
                </div>
                <div className="rest-card">
                  <div className="rest-value">{fmt(rest?.panier_moyen, devise)}</div>
                  <div className="rest-label">Panier moyen</div>
                </div>
              </div>

              {/* Narratif IA */}
              <div className="narratif-section">
                <div className="narratif-header">
                  <span className="ia-badge">Analyse IA · Anthropic</span>
                  <button
                    className="btn-regen"
                    onClick={regenererNarratif}
                    disabled={genNarratif}
                  >
                    {genNarratif ? <><span className="spinner" />Génération...</> : 'Régénérer'}
                  </button>
                </div>

                {genNarratif && !narratif && (
                  <p style={{ color: 'var(--texte-muted)', fontSize: 13 }}>
                    <span className="spinner" /> Rédaction du narratif en cours...
                  </p>
                )}

                {narratif && (
                  <div className="narratif-body">
                    {paragraphesNarratif.map((ligne, i) => {
                      const estTitre = ligne === ligne.toUpperCase() && ligne.length < 80 && ligne.trim().length > 0
                      return (
                        <p key={i} className={estTitre ? 'titre-section' : ''}>
                          {ligne}
                        </p>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
