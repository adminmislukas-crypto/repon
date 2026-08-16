import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { Order, OrderItem } from '@repon/types';
import { OfertaAceptada } from '../src/domains/ofertas/events/oferta-aceptada.event';
import type { OfertaAceptadaPayload } from '../src/domains/ofertas/events/oferta-aceptada.payload';
import { OfertaAceptadaListener } from '../src/domains/pedidos-pagos/adapters/events/oferta-aceptada.listener';
import { CrearPedidoDesdeOfertaUseCase } from '../src/domains/pedidos-pagos/ports-in/crear-pedido-desde-oferta.use-case';
import {
  ORDER_REPOSITORY,
  type OrderRepository,
} from '../src/domains/pedidos-pagos/ports-out/order-repository.port';
import {
  TRANSACTION_MANAGER,
  type TransactionContext,
  type TransactionManager,
} from '../src/shared/database/transaction';
import { EventEmitterPublisher } from '../src/shared/event-bus/event-emitter.publisher';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

/**
 * design.md Diagrama 1 / D3 / D-F, tasks.md 5.8 — el test de contrato
 * obligatorio para el único listener de `pedidos-pagos`
 * (`OfertaAceptadaListener`, PR5), probando que está genuinamente cableado
 * al canal REAL `ofertas.oferta_aceptada` de `ofertas`, no solo a un
 * payload tipeado a mano que un test unitario construye. Mismo patrón
 * exacto que `ofertas-contrato-match-encontrado.e2e-spec.ts` (el propio
 * precedente de este repo para esta fila de la tabla de testing) y
 * `ofertas-contrato-oferta-eventos.e2e-spec.ts`.
 *
 * **`await moduleRef.init()`, nunca solo `.compile()`**: `@nestjs/event-
 * emitter`'s `OnEvent` se registra en `onApplicationBootstrap`, que
 * `.compile()` solo no dispara — sin `.init()` el listener nunca se
 * registra y "exactamente una fila" pasaría sobre un store VACÍO por la
 * razón equivocada (nada corrió), no la correcta (el listener escribió).
 *
 * Publica una instancia REAL de `OfertaAceptada` de `ofertas` (import
 * directo, legítimo acá porque este archivo vive en `test/`, fuera de
 * `domains/`, así que la regla zona `import-x/no-restricted-paths` no
 * aplica — misma excepción que el precedente de `match-encontrado` usa).
 * Si `ofertas` alguna vez cambia `OfertaAceptada.type` o el nombre del
 * canal, `@OnEvent('ofertas.oferta_aceptada')` deja de matchear y las
 * aserciones de abajo fallan ruidosamente, no en silencio.
 */
describe('OfertaAceptada — cross-domain event contract with ofertas (e2e)', () => {
  let eventPublisher: EventPublisher;
  let ordersStore: Array<{ order: Order; items: readonly OrderItem[] }>;

  function buildOfertaAceptadaPayload(
    overrides: Partial<OfertaAceptadaPayload>,
  ): OfertaAceptadaPayload {
    return {
      offerId: 'offer-default',
      companyId: 'company-default',
      userId: 'user-default',
      refillRequestId: 'refill-request-default',
      total: 14990,
      desplazadas: [],
      costoDespacho: 2000,
      lineas: [
        {
          offerItemId: 'offer-item-default',
          nombre: 'Agua 20L',
          precio: 12990,
          isAlt: false,
        },
      ],
      ...overrides,
    };
  }

  beforeEach(async () => {
    ordersStore = [];

    const orderRepository: OrderRepository = {
      crear: async (order, items) => {
        ordersStore.push({ order, items });
      },
      findById: async () => null,
      findByOfferId: async (offerId) =>
        ordersStore.find((entry) => entry.order.offerId === offerId)?.order ?? null,
      transicionar: async () => false,
    };

    const fakeTx = {} as TransactionContext;
    const transactionManager: TransactionManager = {
      runInTransaction: async (work) => work(fakeTx),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        { provide: EVENT_PUBLISHER, useClass: EventEmitterPublisher },
        { provide: ORDER_REPOSITORY, useValue: orderRepository },
        { provide: TRANSACTION_MANAGER, useValue: transactionManager },
        CrearPedidoDesdeOfertaUseCase,
        OfertaAceptadaListener,
      ],
    }).compile();

    // Ver el doc comment de arriba: sin `.init()`, `onApplicationBootstrap`
    // nunca dispara y `@OnEvent` nunca se registra.
    await moduleRef.init();
    eventPublisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);
  });

  it('a real OfertaAceptada creates exactly one order with its items', async () => {
    await eventPublisher.publish(
      new OfertaAceptada(
        buildOfertaAceptadaPayload({
          offerId: 'offer-1',
          companyId: 'company-1',
          userId: 'user-1',
          total: 14990,
          costoDespacho: 2000,
          lineas: [
            { offerItemId: 'offer-item-1', nombre: 'Agua 20L', precio: 12990, isAlt: false },
          ],
        }),
      ),
    );

    expect(ordersStore).toHaveLength(1);
    expect(ordersStore[0]!.order.offerId).toBe('offer-1');
    expect(ordersStore[0]!.order.status).toBe('pendiente_pago');
    expect(ordersStore[0]!.items).toHaveLength(1);
    expect(ordersStore[0]!.items[0]!.nombre).toBe('Agua 20L');
  });

  it('a second OfertaAceptada for the same offer creates zero new orders (R5, read-and-skip)', async () => {
    const payload = buildOfertaAceptadaPayload({ offerId: 'offer-2' });

    await eventPublisher.publish(new OfertaAceptada(payload));
    await eventPublisher.publish(new OfertaAceptada(payload));

    expect(ordersStore).toHaveLength(1);
  });

  it('the listener never re-throws — a failing use case still resolves the handler (D3/R8)', async () => {
    // Un total incoherente hace que `crearPedidoPendiente` lance
    // `PedidoInvalidoError` DENTRO del caso de uso — el listener debe
    // capturarlo igual, sin que `publish` (emitAsync) rechace.
    await expect(
      eventPublisher.publish(
        new OfertaAceptada(buildOfertaAceptadaPayload({ offerId: 'offer-3', total: 999999 })),
      ),
    ).resolves.toBeUndefined();

    expect(ordersStore).toHaveLength(0);
  });
});
