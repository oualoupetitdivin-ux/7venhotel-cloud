'use strict'

// =============================================================================
// TESTS UNITAIRES R1 — Création automatique du folio à la réservation
//
// Scénarios :
//   A. Réservation réussie → folio créé avec champs corrects
//   B. Rollback réservation (creer échoue) → creerFolio jamais appelé
//   C. Rollback folio (creerFolio échoue) → transaction rejetée, réservation non persistée
//   D. numero_folio = 'FOL-' + reservation.numero_reservation
//   E. folio.hotel_id = hotel de la réservation
//   F. folio.client_id = client de la réservation
// =============================================================================

// ── Mocks modules ─────────────────────────────────────────────────────────────

// Espions instanciés avant les mocks pour pouvoir les reconfigurer par test
let mockCreer
let mockCreerFolio
let mockCreerSessionChambre
let mockInsererLogAudit
let mockClientAppartientHotel
let mockTrouverParametres
let mockTrouverTaxesHebergement

jest.mock('../repositories/reservations.repository', () => {
  return {
    STATUTS_CHECKIN_VALIDES:  ['confirmee'],
    STATUTS_CHECKOUT_VALIDES: ['arrivee', 'depart_aujourd_hui'],
    createReservationsRepository: jest.fn(() => ({
      get clientAppartientHotel()      { return mockClientAppartientHotel },
      get trouverParametres()          { return mockTrouverParametres },
      get trouverTaxesHebergement()    { return mockTrouverTaxesHebergement },
      get creer()                      { return mockCreer },
      get creerSessionChambre()        { return mockCreerSessionChambre },
      get insererLogAudit()            { return mockInsererLogAudit },
    })),
  }
})

jest.mock('../repositories/facturation.repository', () => {
  return {
    createFacturationRepository: jest.fn(() => ({
      get creerFolio() { return mockCreerFolio },
    })),
  }
})

// ── Import service (après les mocks) ─────────────────────────────────────────

const { createReservationsService } = require('../services/reservations.service')

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOTEL_ID  = 'hotel-uuid-001'
const TENANT_ID = 'tenant-uuid-001'
const CLIENT_ID = 'client-uuid-001'
const ACTEUR_ID = 'staff-uuid-001'

const DONNEES_RESERVATION = {
  client_id:    CLIENT_ID,
  chambre_id:   null,        // pas de chambre — simplifie les vérifs disponibilité
  date_arrivee: '2026-07-01',
  date_depart:  '2026-07-03',
  nombre_adultes: 2,
  source:       'reception',
  devise:       'XAF',
}

const RESERVATION_CREEE = {
  id:                  'res-uuid-001',
  numero_reservation:  'RES26000042',
  hotel_id:            HOTEL_ID,
  client_id:           CLIENT_ID,
  statut:              'confirmee',
  devise:              'XAF',
}

const FOLIO_CREE = {
  id:             'folio-uuid-001',
  reservation_id: RESERVATION_CREEE.id,
  hotel_id:       HOTEL_ID,
  client_id:      CLIENT_ID,
  numero_folio:   'FOL-RES26000042',
  statut:         'ouvert',
  devise:         'XAF',
}

// ── Fabrique de mock DB ────────────────────────────────────────────────────────

function makeMockDb({ failTransaction } = {}) {
  const mockTrx = {
    fn:  { now: () => new Date().toISOString() },
    raw: jest.fn().mockResolvedValue({ rows: [] }),
  }

  const db = Object.assign(
    jest.fn(() => ({ where: jest.fn().mockReturnThis(), first: jest.fn() })),
    {
      transaction: jest.fn(async (fn) => {
        if (failTransaction) throw failTransaction
        return fn(mockTrx)
      }),
      fn:  { now: () => new Date().toISOString() },
      raw: jest.fn().mockResolvedValue({ rows: [] }),
    }
  )

  return { db, trx: mockTrx }
}

function makeService(db) {
  return createReservationsService({ db, cache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), delPattern: jest.fn() } })
}

// ── Reset mocks avant chaque test ─────────────────────────────────────────────

beforeEach(() => {
  mockClientAppartientHotel = jest.fn().mockResolvedValue(true)
  mockTrouverParametres     = jest.fn().mockResolvedValue({ devise: 'XAF', parametres_supplementaires: {} })
  mockTrouverTaxesHebergement = jest.fn().mockResolvedValue([])
  mockCreer                 = jest.fn().mockResolvedValue(RESERVATION_CREEE)
  mockCreerFolio            = jest.fn().mockResolvedValue(FOLIO_CREE)
  mockCreerSessionChambre   = jest.fn().mockResolvedValue({ id: 'sess-id', token: 'tok' })
  mockInsererLogAudit       = jest.fn().mockResolvedValue(undefined)
})

// =============================================================================
// SCÉNARIO A — Réservation réussie → folio créé
// =============================================================================

describe('R1 — Scénario A : Réservation réussie → folio créé', () => {
  test('creerFolio() est appelé après creer() dans la même transaction', async () => {
    const { db, trx } = makeMockDb()
    const service = makeService(db)

    await service.creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    expect(mockCreer).toHaveBeenCalledTimes(1)
    expect(mockCreerFolio).toHaveBeenCalledTimes(1)
  })

  test('creerFolio est appelé avec la transaction (trx) active', async () => {
    const { db, trx } = makeMockDb()
    const service = makeService(db)

    await service.creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    // Le 2ème argument de creerFolio est la trx
    const [, trxArg] = mockCreerFolio.mock.calls[0]
    expect(trxArg).toBe(trx)
  })

  test('creerFolio est appelé APRÈS creer (ordre garantit l\'id réservation)', async () => {
    const callOrder = []
    mockCreer      = jest.fn(async () => { callOrder.push('creer'); return RESERVATION_CREEE })
    mockCreerFolio = jest.fn(async () => { callOrder.push('creerFolio'); return FOLIO_CREE })

    const { db } = makeMockDb()
    await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    expect(callOrder).toEqual(['creer', 'creerFolio'])
  })
})

// =============================================================================
// SCÉNARIO B — rollback réservation → creerFolio jamais appelé
// =============================================================================

describe('R1 — Scénario B : creer() échoue → creerFolio jamais appelé', () => {
  test('si creer() lève une exception, creerFolio n\'est pas appelé', async () => {
    mockCreer = jest.fn().mockRejectedValue(new Error('DB error reservation'))

    const { db } = makeMockDb()
    const service = makeService(db)

    await expect(
      service.creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)
    ).rejects.toThrow('DB error reservation')

    expect(mockCreerFolio).not.toHaveBeenCalled()
  })

  test('si clientAppartientHotel retourne false, creerFolio n\'est pas appelé', async () => {
    mockClientAppartientHotel = jest.fn().mockResolvedValue(false)

    const { db } = makeMockDb()
    const service = makeService(db)

    await expect(
      service.creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)
    ).rejects.toThrow()

    expect(mockCreer).not.toHaveBeenCalled()
    expect(mockCreerFolio).not.toHaveBeenCalled()
  })
})

// =============================================================================
// SCÉNARIO C — rollback folio → transaction rejetée
// =============================================================================

describe('R1 — Scénario C : creerFolio() échoue → transaction rejetée', () => {
  test('si creerFolio() lève une exception, service.creerReservation rejette', async () => {
    mockCreerFolio = jest.fn().mockRejectedValue(new Error('folio insert failed'))

    const { db } = makeMockDb()
    const service = makeService(db)

    await expect(
      service.creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)
    ).rejects.toThrow('folio insert failed')
  })

  test('contrainte UNIQUE sur numero_folio (code 23505) → ConflictError NUMERO_COLLISION', async () => {
    const pgUniqueError = Object.assign(new Error('duplicate key value'), { code: '23505' })
    mockCreerFolio = jest.fn().mockRejectedValue(pgUniqueError)

    const { db } = makeMockDb()
    const service = makeService(db)

    // La catch 23505 du service englobe toute la transaction (réservation ET folio).
    // Un doublon de numero_folio est donc retourné comme NUMERO_COLLISION — comportement documenté.
    await expect(
      service.creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)
    ).rejects.toMatchObject({ code: 'NUMERO_COLLISION' })
  })
})

// =============================================================================
// SCÉNARIO D — Numérotation folio
// =============================================================================

describe('R1 — Scénario D : numero_folio = FOL- + numero_reservation', () => {
  test('numero_folio est construit depuis numero_reservation', async () => {
    mockCreer = jest.fn().mockResolvedValue({
      ...RESERVATION_CREEE,
      numero_reservation: 'RES26001234',
    })

    const { db } = makeMockDb()
    await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    const [champsPassés] = mockCreerFolio.mock.calls[0]
    expect(champsPassés.numero_folio).toBe('FOL-RES26001234')
  })

  test('numero_folio varie correctement avec différents numero_reservation', async () => {
    for (const numero of ['RES26000001', 'RES26099999', 'RES27000001']) {
      mockCreer      = jest.fn().mockResolvedValue({ ...RESERVATION_CREEE, numero_reservation: numero })
      mockCreerFolio = jest.fn().mockResolvedValue(FOLIO_CREE)

      const { db } = makeMockDb()
      await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

      const [champs] = mockCreerFolio.mock.calls[0]
      expect(champs.numero_folio).toBe('FOL-' + numero)
    }
  })
})

// =============================================================================
// SCÉNARIO E — Conservation hotel_id
// =============================================================================

describe('R1 — Scénario E : hotel_id propagé au folio', () => {
  test('folio.hotel_id = hotel_id passé à creerReservation', async () => {
    const { db } = makeMockDb()
    await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    const [champs] = mockCreerFolio.mock.calls[0]
    expect(champs.hotel_id).toBe(HOTEL_ID)
  })

  test('hotel_id différent entre deux réservations → folio scopé correctement', async () => {
    const HOTEL_B = 'hotel-uuid-002'

    const { db: db1 } = makeMockDb()
    await makeService(db1).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    mockCreer      = jest.fn().mockResolvedValue({ ...RESERVATION_CREEE, hotel_id: HOTEL_B })
    mockCreerFolio = jest.fn().mockResolvedValue({ ...FOLIO_CREE, hotel_id: HOTEL_B })

    const { db: db2 } = makeMockDb()
    await makeService(db2).creerReservation(HOTEL_B, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    expect(mockCreerFolio.mock.calls[0][0].hotel_id).toBe(HOTEL_B)
  })
})

// =============================================================================
// SCÉNARIO F — Conservation client_id
// =============================================================================

describe('R1 — Scénario F : client_id propagé au folio', () => {
  test('folio.client_id = donnees.client_id', async () => {
    const { db } = makeMockDb()
    await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    const [champs] = mockCreerFolio.mock.calls[0]
    expect(champs.client_id).toBe(CLIENT_ID)
  })

  test('folio.reservation_id = reservation.id retourné par creer()', async () => {
    const { db } = makeMockDb()
    await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', DONNEES_RESERVATION)

    const [champs] = mockCreerFolio.mock.calls[0]
    expect(champs.reservation_id).toBe(RESERVATION_CREEE.id)
  })

  test('folio.devise héritée des paramètres réservation', async () => {
    const donnees = { ...DONNEES_RESERVATION, devise: 'EUR' }
    mockTrouverParametres = jest.fn().mockResolvedValue({ devise: 'EUR', parametres_supplementaires: {} })

    const { db } = makeMockDb()
    await makeService(db).creerReservation(HOTEL_ID, TENANT_ID, ACTEUR_ID, 'staff', donnees)

    const [champs] = mockCreerFolio.mock.calls[0]
    expect(champs.devise).toBe('EUR')
  })
})
