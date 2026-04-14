import '../styles/globals.css'
import { Inter } from 'next/font/google'
import { Toaster } from 'react-hot-toast'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${inter.variable} font-sans antialiased bg-[var(--bg-0)] text-[var(--text-0)]`}>
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
              fontFamily: 'Inter, system-ui, sans-serif',
            },
            success: { iconTheme: { primary: '#10B981', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  )
}
