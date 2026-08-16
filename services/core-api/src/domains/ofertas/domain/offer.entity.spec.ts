import type {
  DatosEntrega,
  NuevoOfferItemProactiva,
  NuevoOfferItemReactiva,
  Offer,
} from '@repon/types';
import { OfertaInvalidaError, TransicionInvalidaError } from './oferta.errors';
import {
  aceptar,
  crearOfertaProactiva,
  crearOfertaReactiva,
  precioPorUnidad,
  total,
} from './offer.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const REFILL_REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const REFILL_ITEM_1_ID = '44444444-4444-4444-4444-444444444444';
const REFILL_ITEM_2_ID = '55555555-5555-5555-5555-555555555555';

// `nombre` (backend-core-api-pedidos-pagos design.md D-B.2/D-B.4, PR4): las
// factories ahora reciben `NuevoOfferItem* & { nombre: string }` — ya
// resuelto por el caso de uso en producción, acá simplemente lo fija el
// fixture, mismo criterio que `itemReactiva`/`itemProactiva` ya usaban para
// el resto de los campos.
function itemReactiva(
  overrides: Partial<NuevoOfferItemReactiva & { nombre: string }> = {},
): NuevoOfferItemReactiva & { nombre: string } {
  return {
    refillItemId: REFILL_ITEM_1_ID,
    nombre: 'Agua 20L',
    isAlt: false,
    precio: 12990,
    ...overrides,
  } as NuevoOfferItemReactiva & { nombre: string };
}

const PROVIDER_CATALOG_ITEM_1_ID = '66666666-6666-6666-6666-666666666666';
const PROVIDER_CATALOG_ITEM_2_ID = '77777777-7777-7777-7777-777777777777';

function itemProactiva(
  overrides: Partial<NuevoOfferItemProactiva & { nombre: string }> = {},
): NuevoOfferItemProactiva & { nombre: string } {
  return {
    providerCatalogItemId: PROVIDER_CATALOG_ITEM_1_ID,
    nombre: 'Bidón 10L',
    isAlt: false,
    precio: 8990,
    ...overrides,
  } as NuevoOfferItemProactiva & { nombre: string };
}

function entrega(overrides: Partial<DatosEntrega> = {}): DatosEntrega {
  return {
    tiempoEntregaHoras: 24,
    costoDespacho: 2000,
    ...overrides,
  };
}

// core-api-ofertas spec / tasks.md 2.1/2.2: crearOfertaReactiva() rejects
// isAlt: true without altNote, and — on the happy path — returns an Offer
// with status 'pendiente' by construction, id via randomUUID().
describe('crearOfertaReactiva', () => {
  // The compile-time union (OfferItemAlt) already requires altNote when
  // isAlt: true — this test simulates data that bypassed that guarantee
  // (e.g. an HTTP DTO before class-validator runs, Phase 4b), same
  // discipline as refill-request.entity.ts's assertItemValido: the domain
  // never trusts a caller's TS type-checking alone.
  it('rejects isAlt: true with altNote omitted entirely', () => {
    // itemReactiva()'s own `as NuevoOfferItemReactiva` cast is what lets
    // this compile with isAlt: true and no altNote key at all — the
    // discriminated union's compile-time guarantee is deliberately
    // bypassed here to simulate untrusted runtime data.
    const itemSinAltNote = itemReactiva({ isAlt: true });

    expect(() =>
      crearOfertaReactiva(COMPANY_ID, REFILL_REQUEST_ID, [itemSinAltNote], entrega(), USER_ID),
    ).toThrow(OfertaInvalidaError);
  });

  it('rejects isAlt: true with a whitespace-only altNote', () => {
    expect(() =>
      crearOfertaReactiva(
        COMPANY_ID,
        REFILL_REQUEST_ID,
        [itemReactiva({ isAlt: true, altNote: '   ' })],
        entrega(),
        USER_ID,
      ),
    ).toThrow(OfertaInvalidaError);
  });

  it('accepts isAlt: true when altNote is a non-empty string', () => {
    const offer = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [itemReactiva({ isAlt: true, altNote: 'Solo tenemos sacos de 25kg.' })],
      entrega(),
      USER_ID,
    );

    expect(offer.items[0].isAlt).toBe(true);
  });

  it('builds an Offer with status pendiente by construction, kind reactiva, and every field from its inputs', () => {
    const offer = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [itemReactiva()],
      entrega({ tiempoEntregaHoras: 48, costoDespacho: 3500 }),
      USER_ID,
      'Llega mañana temprano',
    ) as Extract<Offer, { kind: 'reactiva' }>;

    expect(offer.status).toBe('pendiente');
    expect(offer.kind).toBe('reactiva');
    expect(offer.companyId).toBe(COMPANY_ID);
    expect(offer.refillRequestId).toBe(REFILL_REQUEST_ID);
    expect(offer.userId).toBe(USER_ID);
    expect(offer.tiempoEntregaHoras).toBe(48);
    expect(offer.costoDespacho).toBe(3500);
    expect(offer.mensaje).toBe('Llega mañana temprano');
    expect(offer.items).toHaveLength(1);
    expect(offer.items[0]).toMatchObject({ refillItemId: REFILL_ITEM_1_ID, precio: 12990 });
  });

  it('generates a fresh randomUUID() id for the offer — never a DB default', () => {
    const first = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [itemReactiva()],
      entrega(),
      USER_ID,
    );
    const second = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [itemReactiva()],
      entrega(),
      USER_ID,
    );

    expect(first.id).toMatch(UUID_RE);
    expect(first.id).not.toBe(second.id);
  });

  // backend-core-api-pedidos-pagos design.md D-B.4 (PR4): cada item gana
  // `id`/`nombre`. `id` lo genera esta factory; `nombre` llega ya resuelto
  // por el caso de uso — acá el fixture lo fija, mismo criterio que el
  // resto de sus campos.
  it("generates a fresh randomUUID() id per item, distinct from the offer's own id", () => {
    const offer = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [itemReactiva(), itemReactiva({ refillItemId: REFILL_ITEM_2_ID })],
      entrega(),
      USER_ID,
    );

    expect(offer.items[0].id).toMatch(UUID_RE);
    expect(offer.items[1].id).toMatch(UUID_RE);
    expect(offer.items[0].id).not.toBe(offer.items[1].id);
    expect(offer.items[0].id).not.toBe(offer.id);
  });

  it('copies nombre from the input item by value, never inventing or dropping it', () => {
    const offer = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [itemReactiva({ nombre: 'Bidón 20L retornable' })],
      entrega(),
      USER_ID,
    );

    expect(offer.items[0].nombre).toBe('Bidón 20L retornable');
  });

  it('rejects an empty items array with OfertaInvalidaError', () => {
    expect(() =>
      crearOfertaReactiva(COMPANY_ID, REFILL_REQUEST_ID, [], entrega(), USER_ID),
    ).toThrow(OfertaInvalidaError);
  });

  it('rejects a negative precio with OfertaInvalidaError', () => {
    expect(() =>
      crearOfertaReactiva(
        COMPANY_ID,
        REFILL_REQUEST_ID,
        [itemReactiva({ precio: -1 })],
        entrega(),
        USER_ID,
      ),
    ).toThrow(OfertaInvalidaError);
  });

  it('computes total as the sum of every item precio plus costoDespacho', () => {
    const offer = crearOfertaReactiva(
      COMPANY_ID,
      REFILL_REQUEST_ID,
      [
        itemReactiva({ refillItemId: REFILL_ITEM_1_ID, precio: 10000 }),
        itemReactiva({ refillItemId: REFILL_ITEM_2_ID, precio: 5000 }),
      ],
      entrega({ costoDespacho: 2500 }),
      USER_ID,
    );

    expect(offer.total).toBe(17500);
  });

  it('rejects a negative costoDespacho with OfertaInvalidaError — code-review finding on PR5a', () => {
    expect(() =>
      crearOfertaReactiva(
        COMPANY_ID,
        REFILL_REQUEST_ID,
        [itemReactiva()],
        entrega({ costoDespacho: -50000 }),
        USER_ID,
      ),
    ).toThrow(OfertaInvalidaError);
  });
});

// core-api-ofertas spec / tasks.md 2.3/2.4: crearOfertaProactiva() has no
// refillRequestId parameter at all — proactiva offers have no originating
// solicitud (design.md D-G.1's OportunidadElegible has no analogue here).
// Same isAlt ⇒ altNote rule as crearOfertaReactiva; providerCatalogItemId
// required per item is enforced structurally by NuevoOfferItemProactiva.
describe('crearOfertaProactiva', () => {
  it('rejects isAlt: true with a whitespace-only altNote', () => {
    expect(() =>
      crearOfertaProactiva(
        COMPANY_ID,
        USER_ID,
        [itemProactiva({ isAlt: true, altNote: '  ' })],
        entrega(),
      ),
    ).toThrow(OfertaInvalidaError);
  });

  it('accepts isAlt: true when altNote is a non-empty string', () => {
    const offer = crearOfertaProactiva(
      COMPANY_ID,
      USER_ID,
      [itemProactiva({ isAlt: true, altNote: 'Presentación distinta a la solicitada.' })],
      entrega(),
    );

    expect(offer.items[0].isAlt).toBe(true);
  });

  it('builds an Offer with status pendiente by construction, kind proactiva, and refillRequestId absent', () => {
    const offer = crearOfertaProactiva(
      COMPANY_ID,
      USER_ID,
      [itemProactiva()],
      entrega({ tiempoEntregaHoras: 12, costoDespacho: 1500 }),
      'Tenemos stock disponible',
    ) as Extract<Offer, { kind: 'proactiva' }>;

    expect(offer.status).toBe('pendiente');
    expect(offer.kind).toBe('proactiva');
    expect(offer.companyId).toBe(COMPANY_ID);
    expect(offer.userId).toBe(USER_ID);
    expect(offer.refillRequestId).toBeUndefined();
    expect(offer.tiempoEntregaHoras).toBe(12);
    expect(offer.costoDespacho).toBe(1500);
    expect(offer.mensaje).toBe('Tenemos stock disponible');
    expect(offer.items).toHaveLength(1);
    expect(offer.items[0]).toMatchObject({
      providerCatalogItemId: PROVIDER_CATALOG_ITEM_1_ID,
      precio: 8990,
    });
  });

  it('generates a fresh randomUUID() id for the offer — never a DB default', () => {
    const first = crearOfertaProactiva(COMPANY_ID, USER_ID, [itemProactiva()], entrega());
    const second = crearOfertaProactiva(COMPANY_ID, USER_ID, [itemProactiva()], entrega());

    expect(first.id).toMatch(UUID_RE);
    expect(first.id).not.toBe(second.id);
  });

  it("generates a fresh randomUUID() id per item, distinct from the offer's own id", () => {
    const offer = crearOfertaProactiva(
      COMPANY_ID,
      USER_ID,
      [itemProactiva(), itemProactiva({ providerCatalogItemId: PROVIDER_CATALOG_ITEM_2_ID })],
      entrega(),
    );

    expect(offer.items[0].id).toMatch(UUID_RE);
    expect(offer.items[1].id).toMatch(UUID_RE);
    expect(offer.items[0].id).not.toBe(offer.items[1].id);
    expect(offer.items[0].id).not.toBe(offer.id);
  });

  it('copies nombre from the input item by value, never inventing or dropping it', () => {
    const offer = crearOfertaProactiva(
      COMPANY_ID,
      USER_ID,
      [itemProactiva({ nombre: 'Saco 25kg' })],
      entrega(),
    );

    expect(offer.items[0].nombre).toBe('Saco 25kg');
  });

  it('rejects an empty items array with OfertaInvalidaError', () => {
    expect(() => crearOfertaProactiva(COMPANY_ID, USER_ID, [], entrega())).toThrow(
      OfertaInvalidaError,
    );
  });

  it('computes total as the sum of every item precio plus costoDespacho', () => {
    const offer = crearOfertaProactiva(
      COMPANY_ID,
      USER_ID,
      [
        itemProactiva({ providerCatalogItemId: PROVIDER_CATALOG_ITEM_1_ID, precio: 8990 }),
        itemProactiva({ providerCatalogItemId: PROVIDER_CATALOG_ITEM_2_ID, precio: 4000 }),
      ],
      entrega({ costoDespacho: 1000 }),
    );

    expect(offer.total).toBe(13990);
  });

  it('rejects a negative costoDespacho with OfertaInvalidaError — code-review finding on PR5a', () => {
    expect(() =>
      crearOfertaProactiva(COMPANY_ID, USER_ID, [itemProactiva()], entrega({ costoDespacho: -1 })),
    ).toThrow(OfertaInvalidaError);
  });
});

// core-api-ofertas spec / tasks.md 2.5/2.6, design.md D-G.2 paso 9:
// total(items, costoDespacho) = Σ(item.precio) + costoDespacho, pura.
// NOTE on TDD ordering: total()'s implementation already existed before
// this dedicated describe block — task 2.2's GREEN (crearOfertaReactiva)
// structurally required a working total() to populate OfferCommon.total,
// so it was implemented one task pair early. The factory-level "computes
// total..." tests above WERE genuinely RED-then-GREEN against total()
// transitively. This block adds the dedicated, direct unit coverage
// tasks.md 2.5 asks for, run here for the first time as its own
// import — flagged explicitly rather than silently claimed as a from-zero
// RED cycle.
describe('total', () => {
  it('sums a single item precio plus costoDespacho', () => {
    expect(total([{ precio: 12990 }], 2000)).toBe(14990);
  });

  it('sums multiple item precios plus costoDespacho', () => {
    expect(total([{ precio: 10000 }, { precio: 5000 }, { precio: 2500 }], 1500)).toBe(19000);
  });

  it('returns exactly costoDespacho when items is empty', () => {
    expect(total([], 3000)).toBe(3000);
  });

  it('returns 0 when items is empty and costoDespacho is 0', () => {
    expect(total([], 0)).toBe(0);
  });
});

// core-api-ofertas spec / ofertas/SPEC.md ("el cálculo del precio por
// unidad/kilo para comparar contra la referencia también es una función
// de dominio pura") / tasks.md 2.7/2.8 / design.md D-G.2. Formula verified
// against the existing product mockup
// (apps/proveedor-mobile/mockups/proveedor.html's updateAltNote):
// unitAlt = totalAlt / (altSize * altQty), where totalAlt is the LINE's
// already-multiplied total price — exactly what this domain's item.precio
// is (total() above sums item.precio directly, with no separate
// per-unit-times-qty step elsewhere).
describe('precioPorUnidad', () => {
  it('divides precio by altSize * altQty when both are declared', () => {
    // 40000 / (25 * 2) = 800/kg — 2 sacos de 25kg por 40000 en total.
    expect(precioPorUnidad({ precio: 40000, altSize: 25, altQty: 2 })).toBe(800);
  });

  it('divides precio by altSize alone when altQty is absent (defaults to 1)', () => {
    // 5000 / (10 * 1) = 500/kg — 1 saco de 10kg por 5000.
    expect(precioPorUnidad({ precio: 5000, altSize: 10 })).toBe(500);
  });

  it('returns precio unchanged when neither altSize nor altQty is declared — nothing to normalize by', () => {
    expect(precioPorUnidad({ precio: 12990 })).toBe(12990);
  });

  it('falls back to precio when altSize is 0 (never divides by zero)', () => {
    expect(precioPorUnidad({ precio: 12990, altSize: 0, altQty: 2 })).toBe(12990);
  });

  // Residual risk (design.md D-G.2, named in its own risks list): this
  // function only COMPUTES a comparable value — it enforces no ceiling.
  // The precio_maximo cap applies exclusively to non-isAlt items and is
  // enforced by EnviarOfertaUseCase (Phase 5a), never here. An isAlt item
  // has no server-side price ceiling at all today.
  it('does not enforce any ceiling — a price above any reference still returns its computed unit price', () => {
    expect(precioPorUnidad({ precio: 999999, altSize: 1, altQty: 1 })).toBe(999999);
  });
});

// core-api-ofertas spec / tasks.md 2.9/2.10 / design.md D-G.3: OfferStatus
// only admits 'pendiente' -> 'aceptada'. Any other origin — including the
// SAME offer already 'aceptada' — throws TransicionInvalidaError (409),
// never a silent no-op (a double-accept does not violate the partial
// unique index, since it's the same row).
describe('aceptar', () => {
  function offerPendiente(overrides: Partial<Offer> = {}): Offer {
    return {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      userId: USER_ID,
      companyId: COMPANY_ID,
      status: 'pendiente',
      tiempoEntregaHoras: 24,
      costoDespacho: 2000,
      total: 14990,
      kind: 'reactiva',
      refillRequestId: REFILL_REQUEST_ID,
      items: [{ refillItemId: REFILL_ITEM_1_ID, isAlt: false, precio: 12990 }],
      ...overrides,
    } as Offer;
  }

  it('transitions pendiente -> aceptada, returning a new object (original untouched)', () => {
    const original = offerPendiente({ status: 'pendiente' });
    const snapshot = structuredClone(original);

    const result = aceptar(original);

    expect(result.status).toBe('aceptada');
    expect(result).not.toBe(original);
    expect(original).toEqual(snapshot);
  });

  it('rejects an offer that is already aceptada with TransicionInvalidaError — a double-accept is not a silent no-op', () => {
    expect(() => aceptar(offerPendiente({ status: 'aceptada' }))).toThrow(TransicionInvalidaError);
  });

  it('rejects an offer in rechazada with TransicionInvalidaError', () => {
    expect(() => aceptar(offerPendiente({ status: 'rechazada' }))).toThrow(TransicionInvalidaError);
  });

  it('rejects an offer in expirada with TransicionInvalidaError', () => {
    expect(() => aceptar(offerPendiente({ status: 'expirada' }))).toThrow(TransicionInvalidaError);
  });

  it('preserves every other field of the offer, changing only status', () => {
    const original = offerPendiente();

    const result = aceptar(original);

    expect(result).toMatchObject({
      id: original.id,
      userId: original.userId,
      companyId: original.companyId,
      total: original.total,
      items: original.items,
    });
  });
});
