// Skeleton global — affiché pendant la compilation du bundle de la page
export default function Loading() {
  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-0, #080C18)' }}>
      {/* Sidebar skeleton */}
      <div style={{ width: 220, background: 'var(--sidebar-bg, #0B0F1A)', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <div className="skeleton" style={{ height: 48, borderRadius: 10, marginBottom: 8 }} />
        {[...Array(9)].map((_,i) => (
          <div key={i} className="skeleton" style={{ height: 34, borderRadius: 8 }} />
        ))}
      </div>
      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div className="skeleton" style={{ height: 52, margin: '0 0 0 0', borderRadius: 0 }} />
        {/* Content */}
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }}>
            {[...Array(6)].map((_,i) => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
            <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
          </div>
          <div className="skeleton" style={{ height: 260, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  )
}
