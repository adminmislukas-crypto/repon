import type { OrderStatus } from '@repon/types';
import { PedidoInvalidoError, TransicionInvalidaError } from './pedido.errors';
import {
  CANTIDAD_LINEA,
  crearPedidoPendiente,
  esTransicionValida,
  transicionar,
  type NuevaLineaPedido,
} from './order.entity';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OFFER_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const COMPANY_ID = '33333333-3333-3333-3333-333333333333';
const OFFER_ITEM_1_ID = '44444444-4444-4444-4444-444444444444';
const OFFER_ITEM_2_ID = '55555555-5555-5555-5555-555555555555';

function linea(overrides: Partial<NuevaLineaPedido> = {}): NuevaLineaPedido {
  return {
    offerItemId: OFFER_ITEM_1_ID,
    nombre: 'Agua 20L',
    precio: 12990,
    isAlt: false,
    ...overrides,
  };
}

function input(
  overrides: {
    lineas?: readonly NuevaLineaPedido[];
    costoDespacho?: number;
    total?: number;
  } = {},
) {
  const lineas = overrides.lineas ?? [linea()];
  const costoDespacho = overrides.costoDespacho ?? 2000;
  const total = overrides.total ?? lineas.reduce((suma, l) => suma + l.precio, 0) + costoDespacho;
  return {
    offerId: OFFER_ID,
    userId: USER_ID,
    companyId: COMPANY_ID,
    total,
    costoDespacho,
    lineas,
  };
}

// tasks.md 2.1: crearPedidoPendiente toma el payload extendido de
// OfertaAceptada (líneas + costoDespacho) y produce un Order/OrderItem[] en
// memoria con status 'pendiente_pago' EXPLÍCITO — design.md D-A.2/D-A.4.
describe('crearPedidoPendiente', () => {
  it('builds an Order with status pendiente_pago by construction and every field from its input', () => {
    const { order } = crearPedidoPendiente(input());

    expect(order.status).toBe<OrderStatus>('pendiente_pago');
    expect(order.offerId).toBe(OFFER_ID);
    expect(order.userId).toBe(USER_ID);
    expect(order.companyId).toBe(COMPANY_ID);
    expect(order.id).toMatch(UUID_RE);
  });

  it('builds order_items with cantidad always 1 and precio_unitario === subtotal === linea.precio (design.md D-B.3)', () => {
    const { items } = crearPedidoPendiente(
      input({
        lineas: [linea({ precio: 5000 }), linea({ offerItemId: OFFER_ITEM_2_ID, precio: 3000 })],
      }),
    );

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.cantidad).toBe(CANTIDAD_LINEA);
      expect(item.cantidad).toBe(1);
      expect(item.precioUnitario).toBe(item.subtotal);
    }
    expect(items[0].precioUnitario).toBe(5000);
    expect(items[1].precioUnitario).toBe(3000);
  });

  it('assigns each item a domain-generated id, never left to the column default', () => {
    const { items } = crearPedidoPendiente(input());

    expect(items[0].id).toMatch(UUID_RE);
  });

  it('copies offerItemId, nombre, and the alt-presentation fields by value from each línea', () => {
    const { items } = crearPedidoPendiente(
      input({
        lineas: [
          linea({
            isAlt: true,
            altSize: 2,
            altQty: 3,
            altNote: 'presentación familiar',
          }),
        ],
      }),
    );

    expect(items[0]).toMatchObject({
      offerItemId: OFFER_ITEM_1_ID,
      nombre: 'Agua 20L',
      isAlt: true,
      altSize: 2,
      altQty: 3,
      altNote: 'presentación familiar',
    });
  });

  it('copies costoDespacho onto the order by value', () => {
    const { order } = crearPedidoPendiente(input({ costoDespacho: 1500 }));

    expect(order.costoDespacho).toBe(1500);
  });

  // tasks.md 2.2 / design.md's "El total invariant validated before any
  // insert" — the check that keeps a corrupted or tampered event payload
  // from ever reaching order_items, which admits no UPDATE/DELETE (R6).
  describe('total invariant: total === Σ(subtotal) + costoDespacho', () => {
    it('accepts a payload whose total matches the sum of its lines plus shipping', () => {
      expect(() =>
        crearPedidoPendiente(
          input({
            lineas: [linea({ precio: 1000 }), linea({ precio: 2000 })],
            costoDespacho: 500,
            total: 3500,
          }),
        ),
      ).not.toThrow();
    });

    it('rejects a payload whose declared total is higher than the sum of its lines plus shipping', () => {
      expect(() =>
        crearPedidoPendiente(
          input({ lineas: [linea({ precio: 1000 })], costoDespacho: 500, total: 9999 }),
        ),
      ).toThrow(PedidoInvalidoError);
    });

    it('rejects a payload whose declared total is lower than the sum of its lines plus shipping', () => {
      expect(() =>
        crearPedidoPendiente(
          input({ lineas: [linea({ precio: 1000 })], costoDespacho: 500, total: 1 }),
        ),
      ).toThrow(PedidoInvalidoError);
    });

    it('validates before producing any order or items — the invariant check runs first', () => {
      expect(() =>
        crearPedidoPendiente(
          input({ lineas: [linea({ precio: 1000 })], costoDespacho: 0, total: 0 }),
        ),
      ).toThrow(PedidoInvalidoError);
    });
  });
});

// tasks.md 2.3 / design.md D-A.2: la máquina de estados completa. Función
// PURA — nunca I/O, nunca sabe qué la llama (actualizarEstadoPedido vs. el
// camino de confirmación de pago); la restricción "el proveedor no puede
// alcanzar 'confirmado'" es responsabilidad del DTO (design.md D-E, Fase
// 6), no de esta función.
describe('esTransicionValida / transicionar — máquina de OrderStatus', () => {
  const legales: ReadonlyArray<[OrderStatus, OrderStatus]> = [
    ['pendiente_pago', 'confirmado'],
    ['pendiente_pago', 'expirado'],
    ['confirmado', 'preparando'],
    ['preparando', 'en_camino'],
    ['en_camino', 'entregado'],
  ];

  it.each(legales)('allows %s -> %s', (desde, hacia) => {
    expect(esTransicionValida(desde, hacia)).toBe(true);
    expect(transicionar(desde, hacia)).toBe(hacia);
  });

  it('rejects a skipped step: confirmado -> en_camino', () => {
    expect(esTransicionValida('confirmado', 'en_camino')).toBe(false);
    expect(() => transicionar('confirmado', 'en_camino')).toThrow(TransicionInvalidaError);
  });

  it('rejects a reversal: en_camino -> preparando', () => {
    expect(esTransicionValida('en_camino', 'preparando')).toBe(false);
    expect(() => transicionar('en_camino', 'preparando')).toThrow(TransicionInvalidaError);
  });

  it.each<OrderStatus>(['preparando', 'en_camino', 'entregado'])(
    'rejects pendiente_pago -> %s — the provider cannot push an unpaid order forward',
    (hacia) => {
      expect(esTransicionValida('pendiente_pago', hacia)).toBe(false);
    },
  );

  it.each<[OrderStatus, OrderStatus]>([
    ['entregado', 'preparando'],
    ['entregado', 'confirmado'],
    ['expirado', 'pendiente_pago'],
    ['expirado', 'confirmado'],
  ])('rejects any transition out of a terminal state: %s -> %s', (desde, hacia) => {
    expect(esTransicionValida(desde, hacia)).toBe(false);
    expect(() => transicionar(desde, hacia)).toThrow(TransicionInvalidaError);
  });

  it('rejects confirmado -> pendiente_pago — confirmado is never reachable backward', () => {
    expect(esTransicionValida('confirmado', 'pendiente_pago')).toBe(false);
  });
});
