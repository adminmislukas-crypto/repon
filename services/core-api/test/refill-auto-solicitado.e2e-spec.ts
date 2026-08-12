import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { RefillRequest, RefillRequestBorrador } from '@repon/types';
import { RefillAutoSolicitado } from '../src/domains/consumo/events/refill-auto-solicitado.event';
import { StockBajoDetectado } from '../src/domains/consumo/events/stock-bajo-detectado.event';
import type { StockBajoPayload } from '../src/domains/consumo/events/stock-bajo.payload';
import { RefillAutoSolicitadoListener } from '../src/domains/refill-matching/adapters/events/refill-auto-solicitado.listener';
import { CrearBorradorRefillUseCase } from '../src/domains/refill-matching/ports-in/crear-borrador-refill.use-case';
import {
  REFILL_REPOSITORY,
  type RefillRepository,
} from '../src/domains/refill-matching/ports-out/refill-repository.port';
import {
  TRANSACTION_MANAGER,
  type TransactionContext,
  type TransactionManager,
} from '../src/shared/database/transaction';
import { EventEmitterPublisher } from '../src/shared/event-bus/event-emitter.publisher';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

/**
 * design.md Diagrama 3 / D2 / D-D.3 — the mandatory contract test for
 * `refill-matching`'s FIRST event consumer (tasks.md 6a.7).
 *
 * **Named `.e2e-spec.ts`, deliberately, not `.contract-spec.ts`**: `catalogo`'s
 * own PR8b discovered `test/jest-e2e.json`'s `testRegex` only matches
 * `.e2e-spec\.ts$` — a `.contract-spec.ts` file matches none of this repo's
 * 3 configured `pnpm test*` patterns and would silently never run in CI. See
 * `test/catalogo-visibility.e2e-spec.ts`'s own doc comment for the full
 * incident — not rediscovered here, cited so it isn't rediscovered again.
 *
 * **`await moduleRef.init()`, never only `.compile()`**: `@nestjs/event-
 * emitter`'s `OnEvent` decorator is wired by an internal
 * `EventEmitterReadinessWatcher` that registers listeners on the
 * `onApplicationBootstrap` lifecycle hook — `.compile()` alone does NOT fire
 * lifecycle hooks. Without `.init()`, the listener never registers, so the
 * two "a request gets created" assertions below FAIL LOUDLY (`store` stays
 * empty) — the exact bug `catalogo`'s PR8b caught, verified here by actually
 * running this suite with only `.compile()` first: 2 of 3 tests failed for
 * exactly that reason. (The 3rd — "StockBajoDetectado creates zero" — would
 * have passed either way, since it already expects an empty store; it is
 * not, by itself, proof `.init()` is load-bearing — the other two are.)
 *
 * Follows `catalogo-visibility.e2e-spec.ts`'s "override the port, keep the
 * wiring real" shape: a LIGHT `Test.createTestingModule` (not the full
 * `AppModule`), a real `EventEmitterModule.forRoot()`, a real
 * `EVENT_PUBLISHER`/`EventEmitterPublisher`, the real listener, and the real
 * `CrearBorradorRefillUseCase` — but `REFILL_REPOSITORY`/`TRANSACTION_MANAGER`
 * are a minimal in-memory fake, asserted against directly (the "verify via
 * direct repository read" option tasks.md 6a.7 itself names), same as
 * `catalogo-visibility.e2e-spec.ts`'s own choice to avoid requiring a live
 * Postgres in default CI.
 *
 * Publishes REAL `consumo` `RefillAutoSolicitado`/`StockBajoDetectado`
 * instances (imported from `consumo/events/` — legitimate here because this
 * file lives in `test/`, outside `domains/`, so the zone-boundary ESLint
 * rule does not apply, the same exception `catalogo-visibility.e2e-spec.ts`
 * already uses for `identidad`'s events). If `consumo` ever drifts either
 * event's `type` string, `@OnEvent` stops matching and the assertions below
 * fail loudly instead of silently — the whole point of a contract test.
 */
describe('RefillAutoSolicitado — cross-domain event contract with consumo (e2e)', () => {
  let eventPublisher: EventPublisher;
  let store: RefillRequest[];

  function buildStockBajoPayload(overrides: Partial<StockBajoPayload>): StockBajoPayload {
    return {
      consumptionId: 'consumption-default',
      userId: 'user-default',
      ownerType: 'pet',
      petId: 'pet-a',
      kind: 'alimento',
      nombre: 'Alimento perro',
      unidad: 'kg',
      stockActual: 1,
      consumoDiario: 0.5,
      diasRestantes: 2,
      umbralDias: 3,
      ...overrides,
    };
  }

  beforeEach(async () => {
    store = [];

    const fakeTx = {} as TransactionContext;
    const transactionManager: TransactionManager = {
      runInTransaction: async (work) => work(fakeTx),
    };

    const refillRepository: RefillRepository = {
      save: async (request) => {
        store.push(request);
      },
      findById: async (id) => store.find((r) => r.id === id) ?? null,
      findBorradorByConsumption: async (userId, consumptionId) =>
        (store.find(
          (r) =>
            r.estado === 'borrador' && r.userId === userId && r.consumptionId === consumptionId,
        ) as RefillRequestBorrador | undefined) ?? null,
      actualizarEstado: async () => undefined,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        { provide: EVENT_PUBLISHER, useClass: EventEmitterPublisher },
        { provide: REFILL_REPOSITORY, useValue: refillRepository },
        { provide: TRANSACTION_MANAGER, useValue: transactionManager },
        CrearBorradorRefillUseCase,
        RefillAutoSolicitadoListener,
      ],
    }).compile();

    // See doc comment above: without `.init()`, `onApplicationBootstrap`
    // never fires and `@OnEvent` never registers — the test would pass
    // without testing anything (catalogo's PR8b incident).
    await moduleRef.init();
    eventPublisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);
  });

  it('a real RefillAutoSolicitado creates exactly one borrador RefillRequest', async () => {
    await eventPublisher.publish(
      new RefillAutoSolicitado(
        buildStockBajoPayload({
          consumptionId: 'consumption-1',
          userId: 'user-1',
          nombre: 'Alimento perro',
        }),
      ),
    );

    expect(store).toHaveLength(1);
    expect(store[0]!.estado).toBe('borrador');
    expect(store[0]!.userId).toBe('user-1');
    expect(store[0]!.consumptionId).toBe('consumption-1');
    expect(store[0]!.items).toHaveLength(1);
    expect(store[0]!.items[0]!.nombre).toBe('Alimento perro');
  });

  it('a second RefillAutoSolicitado for the same consumption creates only one request total (dedup, D-D.3)', async () => {
    const payload = buildStockBajoPayload({
      consumptionId: 'consumption-2',
      userId: 'user-2',
      nombre: 'Arena para gato',
    });

    await eventPublisher.publish(new RefillAutoSolicitado(payload));
    await eventPublisher.publish(new RefillAutoSolicitado(payload));

    expect(store).toHaveLength(1);
  });

  it('StockBajoDetectado alone creates zero requests — this listener only reacts to consumo.refill_auto_solicitado', async () => {
    await eventPublisher.publish(
      new StockBajoDetectado(
        buildStockBajoPayload({
          consumptionId: 'consumption-3',
          userId: 'user-3',
          nombre: 'Shampoo antipulgas',
        }),
      ),
    );

    expect(store).toHaveLength(0);
  });
});
