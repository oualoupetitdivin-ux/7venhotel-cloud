'use client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

function QRCodeImg({ url, size = 160 }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (!url) return
    import('qrcode').then(QRCode => {
      QRCode.toDataURL(url, { width: size, margin: 2, color: { light: '#ffffff', dark: '#1e293b' } })
        .then(setSrc)
        .catch(() => setSrc(null))
    })
  }, [url, size])

  if (!src) return (
    <div style={{ width: size, height: size }} className="bg-[var(--bg-3)] rounded-lg flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-[var(--border-1)] border-t-blue-500 rounded-full animate-spin" />
    </div>
  )
  return <img src={src} alt="QR code portail" width={size} height={size} className="rounded-lg" />
}

export default function PortailModal({ urlPortail, onClose }) {
  const copier = async () => {
    try { await navigator.clipboard.writeText(urlPortail); toast.success('Lien copié !') }
    catch { toast.error('Copie impossible') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.7)' }}>
      <div className="bg-[var(--bg-2)] border border-[var(--border-1)] rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-bold text-[var(--text-1)] text-base">Check-in effectué</div>
            <div className="text-xs text-[var(--text-3)] mt-0.5">Portail chambre disponible</div>
          </div>
          <button onClick={onClose} className="text-[var(--text-4)] hover:text-[var(--text-1)] text-xl">×</button>
        </div>
        <div className="flex justify-center">
          <QRCodeImg url={urlPortail} size={180} />
        </div>
        <div className="text-xs text-[var(--text-3)] break-all bg-[var(--bg-3)] px-3 py-2 rounded-lg font-mono">
          {urlPortail}
        </div>
        <div className="flex gap-2">
          <button onClick={copier} className="btn btn-ghost btn-sm flex-1">
            Copier le lien
          </button>
          <a href={urlPortail} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm flex-1 text-center">
            Ouvrir
          </a>
        </div>
        <div className="text-[10px] text-[var(--text-4)] text-center">
          Remettre ce QR code ou ce lien au client — valable pour toute la durée du séjour.
        </div>
      </div>
    </div>
  )
}
