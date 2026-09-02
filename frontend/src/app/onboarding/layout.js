// Layout onboarding — shell minimal, sans Sidebar ni Topbar
// Base extensible pour les 4 étapes du wizard :
//   Étape 1 (Hôtel) → Étape 2 (Fiscalité) → Étape 3 (Utilisateurs) → Étape 4 (Config PMS)
//
// Ce layout ne fait aucun guard d'accès — chaque page enfant est responsable
// de ses propres vérifications (token, role, hotel_id=null).

export const metadata = {
  title:       '7venHotel Cloud — Configuration',
  description: 'Configuration initiale de votre espace hôtelier',
}

export default function OnboardingLayout({ children }) {
  return (
    <div className="min-h-screen bg-[var(--bg-0)]">
      {children}
    </div>
  )
}
