'use strict'
/**
 * LOT-OHADA-01 — Seed du référentiel comptable produit
 *
 * Exécuter : node scripts/seed-plan-comptable.js
 *            node scripts/seed-plan-comptable.js --hotel <hotel_id> [--annee 2026]
 *              → initialise en plus le dossier comptable de cet hôtel
 *                (plan de comptes, journaux, mapping, exercice + périodes)
 *
 * NATURE DU RÉFÉRENTIEL
 *   Ce fichier charge la CONFIGURATION INITIALE DU PRODUIT 7venHotel :
 *   un extrait du plan de comptes SYSCOHADA révisé (AUDCIF 2017) retenu pour
 *   l'exploitation hôtelière, plus quelques subdivisions propres au produit
 *   (source '7venHotel — subdivision produit'). Ce n'est PAS le texte officiel
 *   intégral de l'Acte uniforme ; chaque hôtel peut compléter son plan
 *   (comptes_syscohada.referentiel_numero NULL = compte créé par l'hôtel).
 *   Le libellé et la numérotation doivent être validés par l'expert-comptable
 *   de l'hôtel avant usage en production.
 *
 * Idempotent : ON CONFLICT DO UPDATE (référentiel) — ne touche aucun hôtel
 * sans --hotel. Refuse le tenant/hôtel DEMO.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') })
const knex = require('knex')

const VERSION     = 'R1-2026.09'
const SRC_SYSCO   = 'SYSCOHADA revise 2017 (extrait produit)'
const SRC_PRODUIT = '7venHotel - subdivision produit'

const TENANT_DEMO = '11111111-1111-1111-1111-111111111111'
const HOTEL_DEMO  = '22222222-2222-2222-2222-222222222222'

// [numero, libelle, nature, sens_normal, collectif, source?]
const COMPTES = [
  // ── Classe 1 — Ressources durables
  ['101',  'Capital social',                                             'passif',     'C'],
  ['104',  'Compte de l\'exploitant',                                    'passif',     'C'],
  ['111',  'Reserve legale',                                             'passif',     'C'],
  ['118',  'Autres reserves',                                            'passif',     'C'],
  ['121',  'Report a nouveau crediteur',                                 'passif',     'C'],
  ['129',  'Report a nouveau debiteur',                                  'passif',     'D'],
  ['131',  'Resultat net : benefice',                                    'passif',     'C'],
  ['139',  'Resultat net : perte',                                       'passif',     'D'],
  ['141',  'Subventions d\'equipement',                                  'passif',     'C'],
  ['151',  'Amortissements derogatoires',                                'passif',     'C'],
  ['162',  'Emprunts et dettes aupres des etablissements de credit',     'passif',     'C'],
  ['165',  'Depots et cautionnements recus',                             'passif',     'C'],
  ['191',  'Provisions pour litiges',                                    'passif',     'C'],
  // ── Classe 2 — Actif immobilisé
  ['211',  'Frais de developpement',                                     'actif',      'D'],
  ['213',  'Logiciels et sites internet',                                'actif',      'D'],
  ['215',  'Fonds commercial',                                           'actif',      'D'],
  ['221',  'Terrains',                                                   'actif',      'D'],
  ['231',  'Batiments sur sol propre',                                   'actif',      'D'],
  ['234',  'Amenagements, agencements et installations',                 'actif',      'D'],
  ['241',  'Materiel et outillage',                                      'actif',      'D'],
  ['244',  'Materiel et mobilier',                                       'actif',      'D'],
  ['245',  'Materiel de transport',                                      'actif',      'D'],
  ['275',  'Depots et cautionnements verses',                            'actif',      'D'],
  ['2813', 'Amortissements des logiciels et sites internet',             'actif',      'C'],
  ['2831', 'Amortissements des batiments',                               'actif',      'C'],
  ['2834', 'Amortissements des amenagements et installations',           'actif',      'C'],
  ['2841', 'Amortissements du materiel et outillage',                    'actif',      'C'],
  ['2844', 'Amortissements du materiel et mobilier',                     'actif',      'C'],
  ['2845', 'Amortissements du materiel de transport',                    'actif',      'C'],
  // ── Classe 3 — Stocks
  ['311',  'Marchandises',                                               'actif',      'D'],
  ['321',  'Matieres premieres',                                         'actif',      'D'],
  ['331',  'Matieres consommables',                                      'actif',      'D'],
  ['391',  'Depreciations des stocks de marchandises',                   'actif',      'C'],
  // ── Classe 4 — Tiers
  ['401',  'Fournisseurs, dettes en compte',                             'tiers',      'C', true],
  ['408',  'Fournisseurs, factures non parvenues',                       'tiers',      'C'],
  ['409',  'Fournisseurs debiteurs, avances et acomptes verses',         'tiers',      'D'],
  ['411',  'Clients',                                                    'tiers',      'D', true],
  ['418',  'Clients, produits a recevoir',                               'tiers',      'D'],
  ['419',  'Clients crediteurs, avances et acomptes recus',              'tiers',      'C', true],
  ['421',  'Personnel, avances et acomptes',                             'tiers',      'D', true],
  ['422',  'Personnel, remunerations dues',                              'tiers',      'C', true],
  ['431',  'Securite sociale',                                           'tiers',      'C'],
  ['441',  'Etat, impot sur les benefices',                              'tiers',      'C'],
  ['4431', 'Etat, TVA facturee sur ventes',                              'tiers',      'C'],
  ['4432', 'Etat, TVA facturee sur prestations de services',             'tiers',      'C'],
  ['4452', 'Etat, TVA recuperable sur achats',                           'tiers',      'D'],
  ['4454', 'Etat, TVA recuperable sur services exterieurs',              'tiers',      'D'],
  ['447',  'Etat, impots retenus a la source',                           'tiers',      'C'],
  ['462',  'Associes, comptes courants',                                 'tiers',      'C', true],
  ['471',  'Debiteurs et crediteurs divers',                             'tiers',      'D'],
  ['476',  'Charges constatees d\'avance',                               'tiers',      'D'],
  ['477',  'Produits constates d\'avance',                               'tiers',      'C'],
  // ── Classe 5 — Trésorerie
  ['521',  'Banques locales',                                            'tresorerie', 'D'],
  ['552',  'Monnaie electronique - telephone portable (Mobile Money)',   'tresorerie', 'D'],
  ['571',  'Caisse',                                                     'tresorerie', 'D'],
  ['585',  'Virements de fonds',                                         'tresorerie', 'D'],
  // ── Classe 6 — Charges des activités ordinaires
  ['601',  'Achats de marchandises',                                     'charge',     'D'],
  ['6031', 'Variations des stocks de marchandises',                      'charge',     'D'],
  ['602',  'Achats de matieres premieres et fournitures liees',          'charge',     'D'],
  ['604',  'Achats stockes de matieres et fournitures consommables',     'charge',     'D'],
  ['605',  'Autres achats',                                              'charge',     'D'],
  ['6051', 'Fournitures non stockables - eau',                           'charge',     'D'],
  ['6052', 'Fournitures non stockables - electricite',                   'charge',     'D'],
  ['6053', 'Fournitures non stockables - autres energies',               'charge',     'D'],
  ['6055', 'Fournitures de bureau non stockables',                       'charge',     'D'],
  ['608',  'Achats d\'emballages',                                       'charge',     'D'],
  ['618',  'Autres frais de transport',                                  'charge',     'D'],
  ['622',  'Locations et charges locatives',                             'charge',     'D'],
  ['624',  'Entretien, reparations et maintenance',                      'charge',     'D'],
  ['625',  'Primes d\'assurance',                                        'charge',     'D'],
  ['627',  'Publicite, publications, relations publiques',               'charge',     'D'],
  ['628',  'Frais de telecommunications',                                'charge',     'D'],
  ['631',  'Frais bancaires',                                            'charge',     'D'],
  ['632',  'Remunerations d\'intermediaires et de conseils',             'charge',     'D'],
  ['633',  'Frais de formation du personnel',                            'charge',     'D'],
  ['638',  'Autres charges externes',                                    'charge',     'D'],
  ['641',  'Impots et taxes directs',                                    'charge',     'D'],
  ['646',  'Droits d\'enregistrement',                                   'charge',     'D'],
  ['648',  'Autres impots et taxes',                                     'charge',     'D'],
  ['651',  'Pertes sur creances clients et autres debiteurs',            'charge',     'D'],
  ['658',  'Charges diverses',                                           'charge',     'D'],
  ['661',  'Remunerations directes versees au personnel national',       'charge',     'D'],
  ['663',  'Indemnites forfaitaires versees au personnel',               'charge',     'D'],
  ['664',  'Charges sociales',                                           'charge',     'D'],
  ['671',  'Interets des emprunts',                                      'charge',     'D'],
  ['676',  'Pertes de change',                                           'charge',     'D'],
  ['681',  'Dotations aux amortissements d\'exploitation',               'charge',     'D'],
  ['691',  'Dotations aux provisions d\'exploitation',                   'charge',     'D'],
  // ── Classe 7 — Produits des activités ordinaires
  ['701',  'Ventes de marchandises',                                     'produit',    'C'],
  ['705',  'Travaux factures',                                           'produit',    'C'],
  ['706',  'Services vendus',                                            'produit',    'C'],
  ['70611','Services vendus - hebergement',                              'produit',    'C', false, SRC_PRODUIT],
  ['70612','Services vendus - restauration',                             'produit',    'C', false, SRC_PRODUIT],
  ['70613','Services vendus - room service',                             'produit',    'C', false, SRC_PRODUIT],
  ['707',  'Produits accessoires',                                       'produit',    'C'],
  ['758',  'Produits divers',                                            'produit',    'C'],
  ['771',  'Interets de prets',                                          'produit',    'C'],
  ['776',  'Gains de change',                                            'produit',    'C'],
  ['781',  'Transferts de charges d\'exploitation',                      'produit',    'C'],
  ['791',  'Reprises de provisions d\'exploitation',                     'produit',    'C'],
  // ── Classe 8 — Autres charges et produits (HAO)
  ['811',  'Valeurs comptables des cessions d\'immobilisations',         'charge',     'D'],
  ['821',  'Produits des cessions d\'immobilisations',                   'produit',    'C'],
  ['831',  'Charges HAO constatees',                                     'charge',     'D'],
  ['841',  'Produits HAO constates',                                     'produit',    'C'],
  ['891',  'Impots sur les benefices de l\'exercice',                    'charge',     'D'],
]

// [etat, code, libelle, prefixes, ordre]
const RUBRIQUES = [
  ['bilan_actif',  'AD', 'Immobilisations incorporelles',               ['21', '281', '291'], 10],
  ['bilan_actif',  'AI', 'Immobilisations corporelles',                 ['22', '23', '24', '282', '283', '284', '292', '293', '294'], 20],
  ['bilan_actif',  'AQ', 'Immobilisations financieres',                 ['26', '27', '296', '297'], 30],
  ['bilan_actif',  'BB', 'Stocks et encours',                           ['3'], 40],
  ['bilan_actif',  'BH', 'Fournisseurs, avances versees',               ['40', '409'], 50],
  ['bilan_actif',  'BI', 'Clients',                                     ['41'], 60],
  ['bilan_actif',  'BJ', 'Autres creances',                             ['42', '43', '44', '45', '46', '47', '48'], 70],
  ['bilan_actif',  'BS', 'Tresorerie - Actif',                          ['5'], 80],
  ['bilan_passif', 'CA', 'Capital',                                     ['10'], 10],
  ['bilan_passif', 'CD', 'Reserves',                                    ['11'], 20],
  ['bilan_passif', 'CH', 'Report a nouveau',                            ['12'], 30],
  ['bilan_passif', 'CJ', 'Resultat net de l\'exercice',                 ['13'], 40],
  ['bilan_passif', 'CL', 'Subventions d\'investissement',               ['14'], 50],
  ['bilan_passif', 'CM', 'Provisions reglementees',                     ['15'], 60],
  ['bilan_passif', 'DA', 'Emprunts et dettes financieres',              ['16', '17', '18'], 70],
  ['bilan_passif', 'DD', 'Provisions pour risques et charges',          ['19'], 80],
  ['bilan_passif', 'DH', 'Clients, avances recues',                     ['41', '419'], 90],
  ['bilan_passif', 'DJ', 'Fournisseurs d\'exploitation',                ['40'], 100],
  ['bilan_passif', 'DK', 'Dettes fiscales et sociales',                 ['42', '43', '44'], 110],
  ['bilan_passif', 'DM', 'Autres dettes',                               ['45', '46', '47', '48'], 120],
  ['bilan_passif', 'DT', 'Tresorerie - Passif',                         ['5'], 130],
  ['resultat_produits', 'TA', 'Ventes de marchandises',                 ['701'], 10],
  ['resultat_produits', 'TB', 'Ventes de produits fabriques',           ['702', '703', '704'], 20],
  ['resultat_produits', 'TC', 'Travaux, services vendus',               ['705', '706'], 30],
  ['resultat_produits', 'TD', 'Produits accessoires',                   ['707'], 40],
  ['resultat_produits', 'TE', 'Autres produits',                        ['71', '72', '73', '75'], 50],
  ['resultat_produits', 'TK', 'Revenus financiers',                     ['77'], 60],
  ['resultat_produits', 'TL', 'Reprises et transferts de charges',      ['78', '79'], 70],
  ['resultat_produits', 'TN', 'Produits HAO',                           ['82', '84', '86', '88'], 80],
  ['resultat_charges',  'RA', 'Achats de marchandises',                 ['601'], 10],
  ['resultat_charges',  'RB', 'Variation de stocks de marchandises',    ['6031'], 20],
  ['resultat_charges',  'RC', 'Achats de matieres et fournitures',      ['602', '604', '605', '608'], 30],
  ['resultat_charges',  'RD', 'Variation de stocks de matieres',        ['6032', '6033'], 40],
  ['resultat_charges',  'RE', 'Transports',                             ['61'], 50],
  ['resultat_charges',  'RF', 'Services exterieurs',                    ['62', '63'], 60],
  ['resultat_charges',  'RG', 'Impots et taxes',                        ['64'], 70],
  ['resultat_charges',  'RH', 'Autres charges',                         ['65'], 80],
  ['resultat_charges',  'RI', 'Charges de personnel',                   ['66'], 90],
  ['resultat_charges',  'RK', 'Frais financiers',                       ['67'], 100],
  ['resultat_charges',  'RL', 'Dotations aux amortissements et provisions', ['68', '69'], 110],
  ['resultat_charges',  'RM', 'Charges HAO',                            ['81', '83', '85'], 120],
  ['resultat_charges',  'RQ', 'Participation des travailleurs',         ['87'], 130],
  ['resultat_charges',  'RS', 'Impots sur le resultat',                 ['89'], 140],
]

async function chargerReferentiel(db) {
  const comptes = COMPTES.map(([numero, libelle, nature, sens_normal, collectif = false, source = SRC_SYSCO]) => ({
    numero, libelle, nature, sens_normal, collectif, source, version: VERSION,
    classe: parseInt(numero[0], 10),
  }))
  await db('plan_comptable_referentiel').insert(comptes)
    .onConflict('numero').merge(['libelle', 'nature', 'sens_normal', 'collectif', 'source', 'version'])

  const rubriques = RUBRIQUES.map(([etat, code, libelle, prefixes, ordre]) => ({
    etat, code, libelle, prefixes, ordre, source: SRC_SYSCO, version: VERSION,
  }))
  await db('rubriques_etats').insert(rubriques)
    .onConflict(['etat', 'code']).merge(['libelle', 'prefixes', 'ordre', 'source', 'version'])

  return { comptes: comptes.length, rubriques: rubriques.length, version: VERSION }
}

module.exports = { chargerReferentiel, COMPTES, RUBRIQUES, VERSION }

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const db = knex({
    client: 'pg',
    connection: {
      host:     process.env.PGHOST     || process.env.DB_HOST || 'localhost',
      port:     parseInt(process.env.PGPORT || process.env.DB_PORT) || 5432,
      user:     process.env.PGUSER     || process.env.DB_USER || 'postgres',
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
      database: process.env.PGDATABASE || process.env.DB_NAME || 'ocs7venhotel',
    },
  })
  const args  = process.argv.slice(2)
  const arg   = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
  const hotel = arg('--hotel')
  const annee = parseInt(arg('--annee') || new Date().getFullYear(), 10)

  ;(async () => {
    const r = await chargerReferentiel(db)
    console.log(`✅ Référentiel ${r.version} : ${r.comptes} comptes, ${r.rubriques} rubriques`)
    if (hotel) {
      if (hotel === HOTEL_DEMO) throw new Error('Hôtel DEMO interdit')
      const h = await db('hotels').where({ id: hotel }).first()
      if (!h) throw new Error('Hôtel introuvable')
      if (h.tenant_id === TENANT_DEMO) throw new Error('Tenant DEMO interdit')
      const { initialiserDossier } = require('../src/engines/accounting.engine')
      const res = await initialiserDossier(db, { tenantId: h.tenant_id, hotelId: h.id, annee })
      console.log('✅ Dossier comptable initialisé :', res)
    }
  })()
    .catch(err => { console.error('❌', err.message); process.exitCode = 1 })
    .finally(() => db.destroy())
}
