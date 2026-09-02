'use client'
import { motion } from 'framer-motion'

export default function AnimatedKpiCard({ label, valeur, sous, couleur, icone, index = 0 }) {
  return (
    <motion.div
      className={`kpi-card border-b-2 ${couleur}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3, transition: { type: 'spring', stiffness: 400, damping: 20 } }}
      whileTap={{ scale: 0.985 }}
    >
      <div className="absolute right-3 top-3 text-xl opacity-10">{icone}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{valeur}</div>
      <div className="text-[10px] text-[var(--text-3)] mt-1">{sous}</div>
    </motion.div>
  )
}
