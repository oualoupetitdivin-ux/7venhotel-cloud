import '../styles/globals.css'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'

// Polices auto-hébergées par next/font (plus d'@import Google bloquant ni de doublon Inter).
// JetBrains Mono n'est pas préchargée : elle ne sert qu'aux montants / codes, pas au premier rendu.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono  = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap', preload: false })

// Origine de l'API dérivée de NEXT_PUBLIC_API_URL (local / staging / production) :
// la connexion DNS + TCP + TLS est ouverte pendant le téléchargement du JS, pas au premier appel.
const API_ORIGIN = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').origin } catch { return null }
})()

export const metadata = {
  title: {
    default:  '7venHotel Cloud',
    template: '%s — 7venHotel Cloud'
  },
  description: 'Plateforme SaaS hôtelière multi-tenant — Gestion complète de votre établissement',
  keywords:    ['hôtel', 'PMS', 'réservations', 'housekeeping', 'restaurant', 'Cameroun', 'Afrique'],
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0B0F1A',
}

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" />
        {API_ORIGIN && <link rel="preconnect" href={API_ORIGIN} crossOrigin="anonymous" />}
        {API_ORIGIN && <link rel="dns-prefetch" href={API_ORIGIN} />}
      </head>
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased bg-[var(--bg-0)] text-[var(--text-0)]`}>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: 'var(--bg-2)',
              color: 'var(--text-0)',
              border: '1px solid var(--border-2)',
              borderRadius: '12px',
              fontSize: '12.5px',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
            },
            success: { iconTheme: { primary: '#10B981', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  )
}
