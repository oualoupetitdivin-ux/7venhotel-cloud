'use client'

export default function BookingIndex() {
  return (
    <div className="min-h-screen bg-[#060810] flex items-center justify-center p-6">
      <div className="text-center text-white max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-black text-2xl mx-auto mb-6">7</div>
        <h1 className="text-2xl font-black mb-2">Réservation en ligne</h1>
        <p className="text-gray-400 text-sm mb-6">
          Pour accéder au portail de réservation, utilisez l&apos;URL fournie par votre hôtel&nbsp;:
        </p>
        <div className="bg-[#111827] border border-white/10 rounded-xl px-5 py-3 text-left mb-6 font-mono text-xs text-blue-400">
          /booking/<span className="text-gray-400">nom-de-votre-hotel</span>
        </div>
        <p className="text-[10px] text-gray-600">
          Aucun hôtel sélectionné. L&apos;URL doit inclure le slug de l&apos;hôtel.
        </p>
      </div>
    </div>
  )
}
