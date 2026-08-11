import type {
  NuevoRefillItem,
  RefillItemBorrador,
  RefillRequestActiva,
  RefillRequestBorrador,
} from '@repon/types';
import {
  RefillItemDesconocidoError,
  SolicitudIncompletaError,
  SolicitudInvalidaError,
  TransicionInvalidaError,
} from './refill.errors';
import {
  type CompletarInput,
  type CrearBorradorInput,
  completar,
  crearBorrador,
  crearSolicitudActiva,
  marcarConfirmada,
  marcarOfertada,
} from './refill-request.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USER_ID = '11111111-1111-1111-1111-111111111111';
const CONSUMPTION_ID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_1_ID = '44444444-4444-4444-4444-444444444444';
const ITEM_2_ID = '55555555-5555-5555-5555-555555555555';

function nuevoItem(overrides: Partial<NuevoRefillItem> = {}): NuevoRefillItem {
  return {
    nombre: 'Alimento Premium 3Kg',
    categoria: 'alimentos',
    precioReferencia: 12990,
    ...overrides,
  };
}

function itemBorrador(overrides: Partial<RefillItemBorrador> = {}): RefillItemBorrador {
  return {
    id: ITEM_1_ID,
    nombre: 'Alimento Premium 3Kg',
    ...overrides,
  };
}

function borrador(overrides: Partial<RefillRequestBorrador> = {}): RefillRequestBorrador {
  return {
    id: REQUEST_ID,
    userId: USER_ID,
    urgencia: 'lo_antes_posible',
    consumptionId: CONSUMPTION_ID,
    estado: 'borrador',
    items: [
      itemBorrador({ id: ITEM_1_ID }),
      itemBorrador({ id: ITEM_2_ID, nombre: 'Arena Sanitaria' }),
    ],
    ...overrides,
  };
}

function activa(overrides: Partial<RefillRequestActiva> = {}): RefillRequestActiva {
  return {
    id: REQUEST_ID,
    userId: USER_ID,
    urgencia: 'hoy',
    estado: 'abierta',
    direccion: 'Av. Siempre Viva 742',
    comuna: 'Providencia',
    items: [
      {
        id: ITEM_1_ID,
        nombre: 'Alimento Premium 3Kg',
        categoria: 'alimentos',
        precioReferencia: 12990,
      },
    ],
    ...overrides,
  };
}

// core-api-refill-matching spec / tasks.md 2.1/2.2: crearSolicitudActiva()
// rejects an invalid manual (HTTP) input with SolicitudInvalidaError, and
// produces a RefillRequestActiva with estado 'abierta' by construction.
describe('crearSolicitudActiva', () => {
  it('rejects an empty items array', () => {
    expect(() =>
      crearSolicitudActiva(USER_ID, [], 'Av. Siempre Viva 742', 'Providencia', 'hoy'),
    ).toThrow(SolicitudInvalidaError);
  });

  it('rejects an empty direccion', () => {
    expect(() => crearSolicitudActiva(USER_ID, [nuevoItem()], '', 'Providencia', 'hoy')).toThrow(
      SolicitudInvalidaError,
    );
  });

  it('rejects a whitespace-only direccion', () => {
    expect(() => crearSolicitudActiva(USER_ID, [nuevoItem()], '   ', 'Providencia', 'hoy')).toThrow(
      SolicitudInvalidaError,
    );
  });

  it('rejects an empty comuna', () => {
    expect(() =>
      crearSolicitudActiva(USER_ID, [nuevoItem()], 'Av. Siempre Viva 742', '', 'hoy'),
    ).toThrow(SolicitudInvalidaError);
  });

  // refill.errors.ts's own SolicitudInvalidaError doc-comment names this
  // explicitly ("un nombre/categoria/direccion/comuna vacíos, o un
  // precioReferencia negativo") — validated in the entity, defense-in-depth
  // ahead of the DTO's own class-validator checks (Phase 4b), same pattern
  // as provider-catalog-item.entity.ts's assertProductoValido.
  it('rejects an item with an empty nombre', () => {
    expect(() =>
      crearSolicitudActiva(
        USER_ID,
        [nuevoItem({ nombre: '' })],
        'Av. Siempre Viva 742',
        'Providencia',
        'hoy',
      ),
    ).toThrow(SolicitudInvalidaError);
  });

  it('rejects an item with an empty categoria', () => {
    expect(() =>
      crearSolicitudActiva(
        USER_ID,
        [nuevoItem({ categoria: '  ' })],
        'Av. Siempre Viva 742',
        'Providencia',
        'hoy',
      ),
    ).toThrow(SolicitudInvalidaError);
  });

  it('rejects an item with a negative precioReferencia', () => {
    expect(() =>
      crearSolicitudActiva(
        USER_ID,
        [nuevoItem({ precioReferencia: -1 })],
        'Av. Siempre Viva 742',
        'Providencia',
        'hoy',
      ),
    ).toThrow(SolicitudInvalidaError);
  });

  it('builds a RefillRequestActiva with estado abierta, carrying userId/direccion/comuna/urgencia and every item field', () => {
    const request = crearSolicitudActiva(
      USER_ID,
      [nuevoItem({ catalogProductId: 'cp-1' })],
      'Av. Siempre Viva 742',
      'Providencia',
      'hoy',
    );

    expect(request.estado).toBe('abierta');
    expect(request.userId).toBe(USER_ID);
    expect(request.direccion).toBe('Av. Siempre Viva 742');
    expect(request.comuna).toBe('Providencia');
    expect(request.urgencia).toBe('hoy');
    expect(request.items).toHaveLength(1);
    expect(request.items[0]).toMatchObject({
      nombre: 'Alimento Premium 3Kg',
      categoria: 'alimentos',
      precioReferencia: 12990,
      catalogProductId: 'cp-1',
    });
  });

  // tasks.md 2.1: ids via randomUUID() for the request AND every item —
  // never a DB default. Same assertion shape as consumo's
  // registrar-mascota.use-case.spec.ts precedent.
  it('generates a fresh randomUUID() id for the request and for every item — never a DB default', () => {
    const request = crearSolicitudActiva(
      USER_ID,
      [nuevoItem(), nuevoItem({ nombre: 'Arena Sanitaria', categoria: 'higiene' })],
      'Av. Siempre Viva 742',
      'Providencia',
      'hoy',
    );

    expect(request.id).toMatch(UUID_RE);
    expect(request.items[0].id).toMatch(UUID_RE);
    expect(request.items[1].id).toMatch(UUID_RE);
    expect(request.items[0].id).not.toBe(request.items[1].id);
    expect(request.items[0].id).not.toBe(request.id);

    const second = crearSolicitudActiva(
      USER_ID,
      [nuevoItem()],
      'Av. Siempre Viva 742',
      'Providencia',
      'hoy',
    );
    expect(second.id).not.toBe(request.id);
  });
});

// core-api-refill-matching spec / tasks.md 2.3/2.4: crearBorrador() has no
// direccion/comuna/categoria/precioReferencia parameter at all — the
// listener has none of those available (D3) — and produces a
// RefillRequestBorrador with estado 'borrador' by construction.
describe('crearBorrador', () => {
  function input(overrides: Partial<CrearBorradorInput> = {}): CrearBorradorInput {
    return {
      id: REQUEST_ID,
      userId: USER_ID,
      consumptionId: CONSUMPTION_ID,
      urgencia: 'lo_antes_posible',
      items: [itemBorrador({ id: ITEM_1_ID })],
      ...overrides,
    };
  }

  it('builds a RefillRequestBorrador with estado borrador, carrying the given id/userId/consumptionId/urgencia/items untouched', () => {
    const request = crearBorrador(input());

    expect(request).toEqual({
      id: REQUEST_ID,
      userId: USER_ID,
      urgencia: 'lo_antes_posible',
      consumptionId: CONSUMPTION_ID,
      estado: 'borrador',
      items: [itemBorrador({ id: ITEM_1_ID })],
    });
  });

  it('omits consumptionId when not provided (manual borradores are not required to correlate to a consumption)', () => {
    const request = crearBorrador(input({ consumptionId: undefined }));

    expect(request.consumptionId).toBeUndefined();
  });

  it('carries items that only have id/nombre — no categoria/precioReferencia required (D3)', () => {
    const request = crearBorrador(input({ items: [itemBorrador({ id: ITEM_1_ID })] }));

    expect(request.items[0].categoria).toBeUndefined();
    expect(request.items[0].precioReferencia).toBeUndefined();
  });
});

// core-api-refill-matching spec / tasks.md 2.5/2.6: completar() enforces
// direccion + comuna + every item's categoria/precioReferencia before
// transitioning 'borrador' -> 'abierta'. Negative scenarios FIRST, per
// strict TDD convention.
describe('completar', () => {
  function input(overrides: Partial<CompletarInput> = {}): CompletarInput {
    return {
      direccion: 'Av. Siempre Viva 742',
      comuna: 'Providencia',
      items: [
        { refillItemId: ITEM_1_ID, categoria: 'alimentos', precioReferencia: 12990 },
        { refillItemId: ITEM_2_ID, categoria: 'higiene', precioReferencia: 4990 },
      ],
      ...overrides,
    };
  }

  // core-api-refill-matching Scenario "A borrador missing direccion or comuna is rejected"
  it('rejects a missing direccion, leaving the borrador untouched', () => {
    const original = borrador();
    const snapshot = structuredClone(original);

    expect(() => completar(original, input({ direccion: '' }))).toThrow(SolicitudIncompletaError);
    expect(original).toEqual(snapshot);
  });

  it('rejects a whitespace-only direccion', () => {
    expect(() => completar(borrador(), input({ direccion: '   ' }))).toThrow(
      SolicitudIncompletaError,
    );
  });

  it('rejects a missing comuna, leaving the borrador untouched', () => {
    const original = borrador();
    const snapshot = structuredClone(original);

    expect(() => completar(original, input({ comuna: '' }))).toThrow(SolicitudIncompletaError);
    expect(original).toEqual(snapshot);
  });

  // core-api-refill-matching Scenario "A borrador with any item missing
  // categoria or precioReferencia is rejected". CompletarRefillItemInput's
  // categoria/precioReferencia are REQUIRED fields (design.md D-E) — the
  // only way an item ends up "missing" them is for its entry to be absent
  // from input.items entirely, and for the borrador's own item to not
  // already carry them either (it doesn't, by default here).
  it('rejects when one item is left out of the input and the borrador item has no categoria/precioReferencia of its own', () => {
    const original = borrador();
    const snapshot = structuredClone(original);

    expect(() =>
      completar(
        original,
        input({
          items: [{ refillItemId: ITEM_1_ID, categoria: 'alimentos', precioReferencia: 12990 }],
        }),
      ),
    ).toThrow(SolicitudIncompletaError);
    expect(original).toEqual(snapshot);
  });

  it('accepts an item left out of the input WHEN the borrador item already carries its own categoria/precioReferencia', () => {
    const conCategoriaPropia = borrador({
      items: [
        itemBorrador({ id: ITEM_1_ID, categoria: 'alimentos', precioReferencia: 12990 }),
        itemBorrador({ id: ITEM_2_ID, nombre: 'Arena Sanitaria' }),
      ],
    });

    const result = completar(
      conCategoriaPropia,
      input({ items: [{ refillItemId: ITEM_2_ID, categoria: 'higiene', precioReferencia: 4990 }] }),
    );

    expect(result.items.find((item) => item.id === ITEM_1_ID)).toMatchObject({
      categoria: 'alimentos',
      precioReferencia: 12990,
    });
  });

  // core-api-refill-matching / design.md D-E: the input must reference only
  // ids that belong to the borrador being completed.
  it('rejects an unknown refillItemId with RefillItemDesconocidoError', () => {
    const original = borrador();
    const snapshot = structuredClone(original);

    expect(() =>
      completar(
        original,
        input({
          items: [
            ...input().items,
            { refillItemId: 'no-pertenece-a-este-borrador', categoria: 'x', precioReferencia: 1 },
          ],
        }),
      ),
    ).toThrow(RefillItemDesconocidoError);
    expect(original).toEqual(snapshot);
  });

  // core-api-refill-matching Scenario "A fully completed borrador transitions to abierta"
  it('transitions to RefillRequestActiva, updating items in place — same length/ids/order as the borrador, never replaced', () => {
    const original = borrador();

    const result = completar(original, input());

    expect(result.estado).toBe('abierta');
    expect(result.direccion).toBe('Av. Siempre Viva 742');
    expect(result.comuna).toBe('Providencia');
    expect(result.items).toHaveLength(original.items.length);
    expect(result.items.map((item) => item.id)).toEqual(original.items.map((item) => item.id));
    expect(result.items[0]).toEqual({
      id: ITEM_1_ID,
      nombre: 'Alimento Premium 3Kg',
      categoria: 'alimentos',
      precioReferencia: 12990,
      catalogProductId: undefined,
    });
  });

  it('preserves consumptionId from the borrador onto the resulting RefillRequestActiva', () => {
    const result = completar(borrador({ consumptionId: CONSUMPTION_ID }), input());

    expect(result.consumptionId).toBe(CONSUMPTION_ID);
  });

  it('keeps the borrador urgencia when the input omits it', () => {
    const result = completar(borrador({ urgencia: 'en_2_3_dias' }), input({ urgencia: undefined }));

    expect(result.urgencia).toBe('en_2_3_dias');
  });

  it('overrides urgencia when the input provides it', () => {
    const result = completar(
      borrador({ urgencia: 'lo_antes_posible' }),
      input({ urgencia: 'hoy' }),
    );

    expect(result.urgencia).toBe('hoy');
  });
});

// tasks.md 2.7/2.8: the 4-state machine's 2 forward transitions, each
// rejecting an out-of-order call with TransicionInvalidaError.
describe('marcarOfertada', () => {
  it('transitions abierta -> ofertada, returning a new object (original untouched)', () => {
    const original = activa({ estado: 'abierta' });
    const snapshot = structuredClone(original);

    const result = marcarOfertada(original);

    expect(result.estado).toBe('ofertada');
    expect(result).not.toBe(original);
    expect(original).toEqual(snapshot);
  });

  it('rejects a request that is not abierta with TransicionInvalidaError', () => {
    expect(() => marcarOfertada(activa({ estado: 'ofertada' }))).toThrow(TransicionInvalidaError);
    expect(() => marcarOfertada(activa({ estado: 'confirmada' }))).toThrow(TransicionInvalidaError);
  });
});

describe('marcarConfirmada', () => {
  it('transitions ofertada -> confirmada, returning a new object (original untouched)', () => {
    const original = activa({ estado: 'ofertada' });
    const snapshot = structuredClone(original);

    const result = marcarConfirmada(original);

    expect(result.estado).toBe('confirmada');
    expect(result).not.toBe(original);
    expect(original).toEqual(snapshot);
  });

  it('rejects an out-of-order call (e.g. confirming an abierta request) with TransicionInvalidaError', () => {
    expect(() => marcarConfirmada(activa({ estado: 'abierta' }))).toThrow(TransicionInvalidaError);
  });
});
