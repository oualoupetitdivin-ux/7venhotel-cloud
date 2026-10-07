'use client'
// Graphiques du tableau de bord — chargés à la demande (next/dynamic, ssr:false) pour sortir
// chart.js + react-chartjs-2 (~69 Ko gzip) du chemin critique : les indicateurs s'affichent avant.
import { Bar, Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler } from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler)

export { Bar, Line }
