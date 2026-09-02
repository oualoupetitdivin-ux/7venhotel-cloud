'use client'

export default function BookingResultatsObsolete() {
  return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
      <div className="text-center text-white max-w-sm">
        <div className="text-5xl mb-5">🔗</div>
        <h1 className="text-xl font-black mb-2">URL obsolète</h1>
        <p className="text-gray-400 text-sm mb-4">
          Ce lien n&apos;est plus valide. Utilisez l&apos;URL complète avec le nom de l&apos;hôtel.
        </p>
        <a href="/booking" className="text-blue-400 text-sm">← Informations sur l&apos;URL correcte</a>
      </div>
    </div>
  )
}
