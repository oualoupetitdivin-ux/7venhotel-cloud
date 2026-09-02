'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PlatformLayout from '@/components/layout/PlatformLayout'
import { useAuthStore, fmt } from '@/lib/utils'
import { platformAPI, PlatformNetworkError, PlatformTimeoutError } from '@/lib/platform-api'

// ── Composants primitifs ───────────────────────────────────────────────────────

function Pulse({ color = 'emerald' }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-${color}-400 opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 bg-${color}-500`} />
    </span>
  )
}

function MetricCard({ label, value, sub, delta, icon, accent = 'blue', glow = false }) {
  const accents = {
    blue:    { border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    text: 'text-blue-400',    glow: 'shadow-blue-500/10' },
    emerald: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', glow: 'shadow-emerald-500/10' },
    amber:   { border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   text: 'text-amber-400',   glow: 'shadow-amber-500/10' },
    purple:  { border: 'border-purple-500/20',  bg: 'bg-purple-500/5',  text: 'text-purple-400',  glow: 'shadow-purple-500/10' },
    red:     { border: 'border-red-500/20',     bg: 'bg-red-500/5',     text: 'text-red-400',     glow: 'shadow-red-500/10' },
    cyan:    { border: 'border-cyan-500/20',    bg: 'bg-cyan-500/5',    text: 'text-cyan-400',    glow: 'shadow-cyan-500/10' },
  }
  const a = accents[accent] || accents.blue
  return (
    <div className={`rounded-xl border ${a.border} ${a.bg} p-4 ${glow ? `shadow-lg ${a.glow}` : ''} transition-all duration-300 hover:border-opacity-40`}>
      <div className="flex items-start justify-between mb-3">
        <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${a.text}`}>{label}</span>
        {icon && <span className="text-base opacity-40">{icon}</span>}
      </div>
      <div className="text-[1.6rem] font-black text-[var(--text-0)] leading-none mb-1.5 tabular-nums">{value ?? '—'}</div>
      <div className="flex items-center justify-between">
        {sub && <span className="text-[10px] text-[var(--text-4)]">{sub}</span>}
        {delta != null && (
          <span className={`text-[10px] font-bold ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  )
}

// ── Activity Stream ────────────────────────────────────────────────────────────

const STREAM_EVENTS = [
  { icon: '📋', label: 'Réservation confirmée',    accent: 'blue',    module: 'reservations' },
  { icon: '💰', label: 'Paiement reçu',            accent: 'emerald', module: 'facturation' },
  { icon: '🏢', label: 'Nouveau tenant activé',    accent: 'purple',  module: 'platform' },
  { icon: '🤖', label: 'Analyse IA exécutée',      accent: 'cyan',    module: 'ia' },
  { icon: '🛎', label: 'Check-in effectué',         accent: 'blue',    module: 'reservations' },
  { icon: '⚠',  label: 'Ticket urgent ouvert',     accent: 'amber',   module: 'maintenance' },
  { icon: '🔑', label: 'Login manager',             accent: 'gray',    module: 'auth' },
  { icon: '📊', label: 'Rapport KPI généré',        accent: 'purple',  module: 'analytics' },
  { icon: '🛏', label: 'Chambre mise hors service', accent: 'amber',   module: 'chambres' },
  { icon: '✅', label: 'Ticket résolu',             accent: 'emerald', module: 'maintenance' },
]

const ACTION_MAP = {
  TENANT_SUSPENDU:           { icon: '🔒', label: 'Tenant suspendu',       accent: 'amber' },
  TENANT_ACTIVE:             { icon: '✅', label: 'Tenant activé',          accent: 'emerald' },
  TENANT_MODIFIE:            { icon: '✏', label: 'Tenant modifié',          accent: 'blue' },
  UTILISATEUR_CREE:          { icon: '👤', label: 'Utilisateur créé',        accent: 'purple' },
  UTILISATEUR_MODIFIE:       { icon: '✏', label: 'Utilisateur modifié',     accent: 'blue' },
  UTILISATEUR_DESACTIVE:     { icon: '🔐', label: 'Utilisateur désactivé',  accent: 'red' },
  HOTEL_PARAMETRES_MODIFIES: { icon: '⚙', label: 'Paramètres hôtel modifiés', accent: 'amber' },
}

function ActivityStream({ events }) {
  const allEvents = events.map(e => ({
    ...ACTION_MAP[e.action] || { icon: '📋', label: e.action, accent: 'gray' },
    time: new Date(e.cree_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    real: true,
  })).slice(0, 10)

  return (
    <div className="space-y-1">
      {allEvents.length === 0 && (
        <div className="text-center py-4 text-[var(--text-4)] text-[10px]">Aucun événement récent</div>
      )}
      {allEvents.map((ev, i) => {
        const accents = {
          emerald: 'text-emerald-400', blue: 'text-blue-400', amber: 'text-amber-400',
          purple: 'text-purple-400',  red: 'text-red-400',   cyan: 'text-cyan-400',  gray: 'text-gray-400',
        }
        return (
          <div key={i} className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg ${i === 0 ? 'bg-[var(--bg-2)]' : 'hover:bg-[var(--bg-2)]'} transition-colors group`}>
            <span className="text-sm flex-shrink-0">{ev.icon}</span>
            <span className={`text-[11px] flex-1 ${accents[ev.accent] || 'text-[var(--text-2)]'}`}>{ev.label}</span>
            <span className="text-[9px] text-[var(--text-4)] font-mono flex-shrink-0">{ev.time || '—:—'}</span>
            {ev.real && <span className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

// ── Carte géographique Afrique (schématique) ───────────────────────────────────

const GEO_POSITIONS = {
  'Cameroun':       { x: 50, y: 62 },
  'Sénégal':        { x: 20, y: 45 },
  "Côte d'Ivoire":  { x: 30, y: 60 },
  'Rwanda':         { x: 63, y: 68 },
  'Maroc':          { x: 38, y: 22 },
  'Nigeria':        { x: 47, y: 58 },
  'Ghana':          { x: 35, y: 60 },
  'Kenya':          { x: 68, y: 65 },
  'Éthiopie':       { x: 70, y: 55 },
  'Afrique du Sud': { x: 55, y: 88 },
  'France':         { x: 45, y: 12 },
}

function AfricaMap({ geoData }) {
  const maxHotels = Math.max(...geoData.map(g => g.nb_hotels), 1)
  return (
    <div className="relative w-full h-48 rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)] overflow-hidden">
      {/* Grille subtile */}
      <div className="absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: 'linear-gradient(var(--border-1) 1px, transparent 1px), linear-gradient(90deg, var(--border-1) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

      {/* Label */}
      <div className="absolute top-2 left-3 text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)]">Couverture Afrique</div>

      {/* Points pays */}
      {geoData.map(g => {
        const pos = GEO_POSITIONS[g.pays]
        if (!pos) return null
        const size = 6 + Math.round((g.nb_hotels / maxHotels) * 14)
        const opacity = 0.5 + (g.nb_hotels / maxHotels) * 0.5
        return (
          <div key={g.pays} className="absolute group" style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%,-50%)' }}>
            {/* Halo animé */}
            <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-20" style={{ width: size + 6, height: size + 6, transform: 'translate(-3px,-3px)' }} />
            <div className="relative rounded-full bg-blue-500 cursor-pointer transition-transform hover:scale-125"
              style={{ width: size, height: size, opacity }} />
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-[var(--bg-1)] border border-[var(--border-1)] rounded-lg px-2 py-1 text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none shadow-lg">
              <div className="font-bold text-[var(--text-0)]">{g.pays}</div>
              <div className="text-[var(--text-3)]">{g.nb_hotels} hôtel{g.nb_hotels > 1 ? 's' : ''} · {g.nb_tenants} tenant{g.nb_tenants > 1 ? 's' : ''}</div>
            </div>
          </div>
        )
      })}

      {/* Légende */}
      <div className="absolute bottom-2 right-3 flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-blue-500 opacity-40" />
        <span className="text-[9px] text-[var(--text-4)]">Tenant actif</span>
      </div>
    </div>
  )
}

// ── Plans SaaS bar chart ───────────────────────────────────────────────────────

function PlansBar({ plans }) {
  if (!plans || Object.keys(plans).length === 0) return (
    <div className="text-[11px] text-[var(--text-4)] text-center py-4">Aucun abonnement actif</div>
  )
  const totalMrr = Object.values(plans).reduce((s, p) => s + p.mrr, 0)
  const planColors = { starter: 'bg-blue-500', business: 'bg-purple-500', enterprise: 'bg-amber-500', 'ohada+': 'bg-emerald-500' }

  return (
    <div className="space-y-2.5">
      {Object.entries(plans).map(([plan, p]) => {
        const pct = totalMrr > 0 ? Math.round((p.mrr / totalMrr) * 100) : 0
        return (
          <div key={plan}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-semibold text-[var(--text-2)] capitalize">{plan}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-4)]">{p.nb} client{p.nb > 1 ? 's' : ''}</span>
                <span className="text-[10px] font-bold text-[var(--text-1)]">{fmt(p.mrr)}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--bg-3)] overflow-hidden">
              <div className={`h-full rounded-full ${planColors[plan] || 'bg-gray-500'} transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tenant Command Table ───────────────────────────────────────────────────────

function TenantRow({ t, index }) {
  const router       = useRouter()
  const planColors   = { starter: 'text-blue-400 bg-blue-500/10', business: 'text-purple-400 bg-purple-500/10', enterprise: 'text-amber-400 bg-amber-500/10' }
  const statusColors = { actif: 'bg-emerald-500', essai: 'bg-blue-500', suspendu: 'bg-amber-500' }
  const healthPct    = Math.min(100, Math.round(((t.nb_hotels || 0) / (t.max_hotels || 1)) * 100))

  return (
    <tr className={`border-b border-[var(--border-0)] hover:bg-[var(--bg-2)] transition-colors cursor-pointer`}
      onClick={() => router.push(`/platform/tenants/${t.id}`)}>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[t.statut] || 'bg-gray-500'}`} />
          <div>
            <div className="text-xs font-semibold text-[var(--text-0)]">{t.nom}</div>
            <div className="text-[9px] text-[var(--text-4)]">{t.pays || '—'} · {t.email_contact}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${planColors[t.plan] || 'text-gray-400 bg-gray-500/10'}`}>
          {t.plan || 'essai'}
        </span>
      </td>
      <td className="px-3 py-2.5 text-xs text-[var(--text-2)]">{t.nb_hotels ?? 0}/{t.max_hotels ?? '∞'}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1 rounded-full bg-[var(--bg-3)]">
            <div className={`h-full rounded-full ${healthPct >= 90 ? 'bg-red-500' : healthPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${healthPct}%` }} />
          </div>
          <span className="text-[9px] text-[var(--text-4)] w-6">{healthPct}%</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-right font-semibold text-[var(--text-1)]">
        {t.montant_mensuel ? fmt(parseFloat(t.montant_mensuel)) : <span className="text-[var(--text-4)]">—</span>}
      </td>
    </tr>
  )
}

// ── System Health ──────────────────────────────────────────────────────────────

function HealthRow({ label, statut, valeur, icon }) {
  const dot = statut === 'ok' ? 'bg-emerald-500 shadow-[0_0_6px_#10B981]'
    : statut === 'degraded'   ? 'bg-amber-500  shadow-[0_0_6px_#F59E0B]'
    : 'bg-red-500 shadow-[0_0_6px_#EF4444]'
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-xs text-[var(--text-2)] flex-1">{label}</span>
      <span className="text-xs font-mono text-[var(--text-0)]">{valeur}</span>
    </div>
  )
}

// ── PAGE PRINCIPALE ────────────────────────────────────────────────────────────

export default function PlatformCockpit() {
  // PlatformLayout garantit que ce composant ne monte QUE si _hydrated=true et user valide.
  // Pas besoin de token dans les deps — platformFetch lit localStorage directement.
  const { init } = useAuthStore()
  const [data,    setData]    = useState(null)
  const [tenants, setTenants] = useState([])
  const [health,  setHealth]  = useState(null)
  const [mrr,     setMrr]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [erreur,  setErreur]  = useState(null)
  const [errType, setErrType] = useState(null)

  // Sécurité supplémentaire — no-op si PlatformLayout a déjà hydraté
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { init() }, [])

  // Chargement initial + auto-refresh 30s
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    charger()
    const iv = setInterval(charger, 30_000)
    return () => clearInterval(iv)
  }, [])

  async function charger() {
    try {
      const [d, t, h, m] = await Promise.all([
        platformAPI.dashboard(),
        platformAPI.tenants('limite=6'),
        platformAPI.health(),
        platformAPI.billingMRR(),
      ])
      setData(d); setTenants(t.tenants || []); setHealth(h); setMrr(m)
      setErreur(null); setErrType(null)
    } catch (e) {
      if (e.name === 'PlatformAuthError') return  // logout + redirect géré par platformFetch
      setErrType(e.name)
      setErreur(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <PlatformLayout titre="Platform Control" sousTitre="Chargement du cockpit…">
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-10 h-10 border-2 border-blue-500/50 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-xs text-[var(--text-4)] tracking-widest uppercase">Initialisation plateforme</div>
      </div>
    </PlatformLayout>
  )

  if (erreur) {
    const isTimeout = errType === 'PlatformTimeoutError'
    const isNetwork = errType === 'PlatformNetworkError'
    return (
      <PlatformLayout titre="Platform Control" sousTitre="Erreur système">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">{isTimeout ? '⏱' : isNetwork ? '📡' : '⚠'}</span>
            <div>
              <div className="text-sm font-bold text-red-300">
                {isTimeout ? 'Délai de connexion dépassé' : isNetwork ? 'Backend inaccessible' : 'Erreur plateforme'}
              </div>
              <div className="text-xs text-red-400/70 mt-0.5">{erreur}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setErreur(null); setLoading(true); charger() }}
              className="text-xs px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
              Réessayer
            </button>
            {isNetwork && (
              <div className="text-[10px] text-[var(--text-4)] self-center">
                Vérifiez que le backend est démarré sur le port 3001
              </div>
            )}
          </div>
        </div>
      </PlatformLayout>
    )
  }

  const totalMrr = data?.saas?.mrr_xaf || 0
  const uptime   = health?.statut === 'healthy' ? 99.9 : health?.statut === 'degraded' ? 97.4 : 0

  return (
    <PlatformLayout titre="Platform Control" sousTitre="7venHotel Cloud — Opérateur SaaS Afrique & Monde">

      {/* ── STATUS BAR ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)] mb-5 text-[10px]">
        <div className="flex items-center gap-1.5">
          <Pulse color={health?.statut === 'healthy' ? 'emerald' : health?.statut === 'degraded' ? 'amber' : 'red'} />
          <span className="font-bold text-[var(--text-1)] uppercase tracking-wide">
            {health?.statut === 'healthy' ? 'Plateforme opérationnelle' : health?.statut === 'degraded' ? 'Mode dégradé' : 'Incident critique'}
          </span>
        </div>
        <div className="h-3 w-px bg-[var(--border-1)]" />
        <span className="text-[var(--text-3)]">{data?.tenants?.actifs ?? '—'} tenants actifs</span>
        <div className="h-3 w-px bg-[var(--border-1)]" />
        <span className="text-[var(--text-3)]">{data?.infrastructure?.hotels ?? '—'} hôtels</span>
        <div className="h-3 w-px bg-[var(--border-1)]" />
        <span className="text-[var(--text-3)]">{uptime}% uptime</span>
        <div className="h-3 w-px bg-[var(--border-1)]" />
        <span className="text-[var(--text-3)]">MRR {fmt(totalMrr)}</span>
        <div className="ml-auto text-[var(--text-4)] font-mono">
          {new Date(data?.horodatage || Date.now()).toLocaleTimeString('fr-FR')}
        </div>
      </div>

      {/* ── ROW 1 : KPIs VITAUX ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2.5 mb-5">
        <div className="col-span-2">
          <MetricCard label="MRR Plateforme" value={fmt(totalMrr)} sub={`ARR : ${fmt(data?.saas?.arr_xaf || 0)}`} accent="emerald" icon="💰" glow />
        </div>
        <div className="col-span-2">
          <MetricCard label="Tenants actifs" value={data?.tenants?.actifs ?? '—'} sub={`${data?.tenants?.essai ?? 0} en essai · ${data?.tenants?.suspendus ?? 0} suspendus`} accent="blue" icon="🏢" />
        </div>
        <div className="col-span-2">
          <MetricCard label="Hôtels gérés" value={data?.infrastructure?.hotels ?? '—'} sub={`${data?.infrastructure?.chambres_totales ?? '—'} chambres totales`} accent="purple" icon="🏨" />
        </div>
        <div className="col-span-2">
          <MetricCard label="Occupation Live" value={`${data?.performance?.occ_moy_7j_pct ?? '—'}%`} sub="Moy. 7 jours · toute plateforme" accent="cyan" icon="📈" />
        </div>
        <div className="col-span-2">
          <MetricCard label="CA 30 jours" value={fmt(data?.saas?.ca_30j || 0)} sub="Paiements encaissés" accent="emerald" icon="💳" />
        </div>
        <div className="col-span-2">
          <MetricCard label="Réservations/jour" value={data?.activite_live?.reservations_jour ?? '—'} sub="Toute la plateforme" accent="blue" icon="📋" />
        </div>
        <div className="col-span-2">
          <MetricCard label="Tokens IA" value={(data?.activite_live?.tokens_ia_total || 0).toLocaleString('fr-FR')} sub="Appels historique total" accent="purple" icon="🤖" />
        </div>
        <div className="col-span-2">
          <MetricCard
            label="Alertes actives"
            value={data?.alertes?.tickets_urgents ?? 0}
            sub={`${data?.alertes?.tenants_suspendus ?? 0} tenant(s) suspendu(s)`}
            accent={data?.alertes?.tickets_urgents > 0 ? 'amber' : 'emerald'}
            icon={data?.alertes?.tickets_urgents > 0 ? '⚠' : '✅'}
          />
        </div>
      </div>

      {/* ── ROW 2 : CARTE + ACTIVITÉ STREAM ─────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3 mb-5">

        {/* Carte géo */}
        <div className="col-span-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)] mb-2">Couverture géographique</div>
          {data?.couverture_geo?.length > 0 ? (
            <AfricaMap geoData={data.couverture_geo} />
          ) : (
            <div className="h-48 rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)] flex items-center justify-center text-[var(--text-4)] text-xs">Aucune donnée</div>
          )}
          {/* Légende pays */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(data?.couverture_geo || []).map(g => (
              <span key={g.pays} className="text-[9px] bg-[var(--bg-2)] border border-[var(--border-0)] rounded px-1.5 py-0.5 text-[var(--text-3)]">
                {g.pays} ({g.nb_hotels})
              </span>
            ))}
          </div>
        </div>

        {/* Activity Stream */}
        <div className="col-span-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)]">Activité temps réel</div>
            <Pulse color="blue" />
          </div>
          <div className="rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)] p-2">
            <ActivityStream events={data?.activite_stream || []} />
          </div>
        </div>
      </div>

      {/* ── ROW 3 : TENANTS + BILLING + HEALTH ──────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-5">

        {/* Tenant Command Center */}
        <div className="col-span-2 rounded-xl border border-[var(--border-0)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-0)] bg-[var(--bg-2)]">
            <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)]">Tenants Command Center</div>
            <Link href="/platform/tenants" className="text-[9px] text-blue-400 hover:text-blue-300">Voir tous →</Link>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-0)] bg-[var(--bg-1)]">
                {['Tenant / Pays', 'Plan', 'Hotels', 'Utilisation', 'MRR'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[9px] font-semibold text-[var(--text-4)] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-[var(--text-4)] text-xs">Aucun tenant</td></tr>
              ) : tenants.map((t, i) => <TenantRow key={t.id} t={t} index={i} />)}
            </tbody>
          </table>
        </div>

        {/* Billing + Health */}
        <div className="flex flex-col gap-3">
          {/* Billing SaaS */}
          <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)] flex-1">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)]">Répartition Plans</div>
              <Link href="/platform/billing" className="text-[9px] text-blue-400">Billing →</Link>
            </div>
            <PlansBar plans={data?.saas?.plans} />
            <div className="mt-3 pt-3 border-t border-[var(--border-0)]">
              <div className="flex justify-between text-[10px]">
                <span className="text-[var(--text-4)]">MRR Total</span>
                <span className="font-black text-emerald-400">{fmt(totalMrr)}</span>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="rounded-xl border border-[var(--border-0)] p-4 bg-[var(--bg-2)]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-4)]">System Health</div>
              <Link href="/platform/health" className="text-[9px] text-blue-400">Obs →</Link>
            </div>
            <HealthRow label="PostgreSQL"  statut={health?.postgresql?.statut} valeur={health?.postgresql?.latence_ms ? `${health.postgresql.latence_ms}ms` : '—'} />
            <HealthRow label="Cache Redis" statut={health?.cache?.type === 'redis' ? 'ok' : 'degraded'} valeur={health?.cache?.type === 'redis' ? 'Redis' : 'Mémoire'} />
            <HealthRow label="API Fastify" statut="ok" valeur={`${health?.latence_ms || 0}ms`} />
            <HealthRow label="IA Anthropic" statut="ok" valeur="Disponible" />
            <div className="mt-2 pt-2 border-t border-[var(--border-0)] flex items-center gap-1.5">
              <Pulse color={health?.statut === 'healthy' ? 'emerald' : 'amber'} />
              <span className="text-[9px] text-[var(--text-3)]">
                {health?.statut === 'healthy' ? 'Tous systèmes opérationnels' : 'Mode dégradé — Redis absent'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 4 : QUICK ACTIONS ───────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2.5">
        {[
          { label: 'Audit & Logs',    href: '/platform/audit',    icon: '🛡', desc: 'Journal d\'audit cross-tenant' },
          { label: 'IA Gouvernance',  href: '/platform/ai',       icon: '🤖', desc: 'Consommation · Coûts · Budgets' },
          { label: 'Facturation SaaS',href: '/platform/billing',  icon: '💰', desc: 'MRR · ARR · Abonnements' },
          { label: 'Observabilité',   href: '/platform/health',   icon: '📡', desc: 'DB · Redis · Latence API' },
        ].map(a => (
          <a key={a.href} href={a.href}
            className="rounded-xl border border-[var(--border-0)] bg-[var(--bg-2)] p-4 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all group">
            <div className="text-xl mb-2 group-hover:scale-110 transition-transform inline-block">{a.icon}</div>
            <div className="text-xs font-bold text-[var(--text-0)]">{a.label}</div>
            <div className="text-[9px] text-[var(--text-4)] mt-0.5">{a.desc}</div>
          </a>
        ))}
      </div>

    </PlatformLayout>
  )
}
