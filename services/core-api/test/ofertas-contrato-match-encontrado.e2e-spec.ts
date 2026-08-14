import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { MatchEncontrado } from '../src/domains/refill-matching/events/match-encontrado.event';
import type { MatchEncontradoPayload } from '../src/domains/refill-matching/events/match-encontrado.payload';
import { MatchEncontradoListener } from '../src/domains/ofertas/adapters/events/match-encontrado.listener';
import { RegistrarOportunidadUseCase } from '../src/domains/ofertas/ports-in/registrar-oportunidad.use-case';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
  type OportunidadElegible,
  type OportunidadSnapshot,
} from '../src/domains/ofertas/ports-out/offer-opportunity-repository.port';
import {
  TRANSACTION_MANAGER,
  type TransactionContext,
  type TransactionManager,
} from '../src/shared/database/transaction';
import { EventEmitterPublisher } from '../src/shared/event-bus/event-emitter.publisher';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

/**
 * design.md Diagrama 1 / D2 / D5 / D-F, tasks.md 8a.7 — the mandatory
 * contract test for `ofertas`' own listener (`MatchEncontradoListener`,
 * PR4a) proving it is genuinely wired to `refill-matching`'s REAL
 * `refill.match_encontrado` channel, not just to a hand-typed payload a unit
 * test happens to construct.
 *
 * **Named `.e2e-spec.ts`, deliberately, not `.contract-spec.ts`**: same
 * `test/jest-e2e.json` `testRegex` incident this domain's own
 * `refill-auto-solicitado.e2e-spec.ts` (PR6a of `backend-core-api-
 * refill-matching`) and `catalogo-visibility.e2e-spec.ts` (`catalogo` PR8b)
 * already document — a `.contract-spec.ts` file matches none of this repo's
 * 3 configured `pnpm test*` patterns and would silently never run in CI.
 *
 * **`await moduleRef.init()`, never only `.compile()`**: `@nestjs/event-
 * emitter`'s `OnEvent` decorator is wired by an internal
 * `EventEmitterReadinessWatcher` that registers listeners on the
 * `onApplicationBootstrap` lifecycle hook — `.compile()` alone does NOT fire
 * lifecycle hooks. Without `.init()`, the listener never registers and the
 * "exactly one row" assertion below would pass on an EMPTY store for the
 * wrong reason (nothing ran) instead of the right one (the listener wrote
 * it) — the exact `catalogo` PR8b bug this task's own text names.
 *
 * **Orchestrator-prompt correction, verified against design.md/tasks.md
 * before writing a single line of this file — flagged here, not silently
 * fixed**: the batch instructions for this task assumed 8a.7/8a.8 need a
 * REAL Postgres and would be blocked by this environment's paused Docker
 * Desktop. That assumption does not hold. design.md's own "Estrategia de
 * testing" table lists this exact row ("E2E contrato... Con `await
 * moduleRef.init()`...") with `¿CI? Sí` — distinct from the row directly
 * above it ("Integración (opt-in)... `supabase start`... ¿CI? No"), which
 * IS the one requiring a live Postgres (that is task 3b.13, already
 * deferred as opt-in/non-CI, unrelated to this task). `refill-auto-
 * solicitado.e2e-spec.ts` and `catalogo-visibility.e2e-spec.ts` are this
 * repo's own established precedent for exactly this row: "override the
 * port, keep the wiring real" — a LIGHT `Test.createTestingModule`, a real
 * `EventEmitterModule.forRoot()`, a real `EVENT_PUBLISHER`/
 * `EventEmitterPublisher`, the real listener, and the real use case, but
 * `OFFER_OPPORTUNITY_REPOSITORY`/`TRANSACTION_MANAGER` as a minimal
 * in-memory fake asserted against directly — never requiring a live
 * database in default CI. This file follows that same convention, so this
 * task is FULLY VERIFIED this batch, not written-but-unverified.
 *
 * Publishes a REAL `refill-matching` `MatchEncontrado` instance (imported
 * from `refill-matching/events/` — legitimate here because this file lives
 * in `test/`, outside `domains/`, so the zone-boundary ESLint rule
 * (`import-x/no-restricted-paths`) does not apply, the same exception
 * `refill-auto-solicitado.e2e-spec.ts`/`catalogo-visibility.e2e-spec.ts`
 * already use). If `refill-matching` ever drifts `MatchEncontrado.type`
 * away from `'refill.match_encontrado'`, `@OnEvent('refill.match_encontrado')`
 * stops matching and the assertions below fail loudly instead of silently.
 */
describe('MatchEncontrado — cross-domain event contract with refill-matching (e2e)', () => {
  let eventPublisher: EventPublisher;
  let store: OportunidadSnapshot[];

  function buildMatchEncontradoPayload(
    overrides: Partial<MatchEncontradoPayload>,
  ): MatchEncontradoPayload {
    return {
      refillRequestId: 'refill-request-default',
      userId: 'user-default',
      comuna: 'Providencia',
      urgencia: 'hoy',
      items: [
        {
          refillItemId: 'refill-item-default',
          nombre: 'Alimento perro',
          categoria: 'alimento',
          precioReferencia: 12990,
          catalogProductId: null,
        },
      ],
      companyIds: ['company-default'],
      providerCatalogItemIds: ['provider-catalog-item-default'],
      ...overrides,
    };
  }

  beforeEach(async () => {
    store = [];

    const opportunityRepository: OfferOpportunityRepository = {
      reemplazar: async (snapshot: OportunidadSnapshot) => {
        store.push(snapshot);
      },
      findElegible: async (): Promise<OportunidadElegible | null> => null,
      listarPorCompany: async () => [],
      existeRelacion: async () => false,
      cerrar: async () => undefined,
    };

    const fakeTx = {} as TransactionContext;
    const transactionManager: TransactionManager = {
      runInTransaction: async (work) => work(fakeTx),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        { provide: EVENT_PUBLISHER, useClass: EventEmitterPublisher },
        { provide: OFFER_OPPORTUNITY_REPOSITORY, useValue: opportunityRepository },
        { provide: TRANSACTION_MANAGER, useValue: transactionManager },
        RegistrarOportunidadUseCase,
        MatchEncontradoListener,
      ],
    }).compile();

    // See doc comment above: without `.init()`, `onApplicationBootstrap`
    // never fires and `@OnEvent` never registers — the test would pass
    // without testing anything (the `catalogo` PR8b incident).
    await moduleRef.init();
    eventPublisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);
  });

  it('a real MatchEncontrado creates exactly one offer_opportunities row with the right eligible set', async () => {
    await eventPublisher.publish(
      new MatchEncontrado(
        buildMatchEncontradoPayload({
          refillRequestId: 'refill-request-1',
          userId: 'user-1',
          comuna: 'Ñuñoa',
          urgencia: 'lo_antes_posible',
          companyIds: ['company-a', 'company-b'],
          items: [
            {
              refillItemId: 'refill-item-1',
              nombre: 'Arena para gato',
              categoria: 'higiene',
              precioReferencia: 8990,
              catalogProductId: 'catalog-product-1',
            },
          ],
        }),
      ),
    );

    expect(store).toHaveLength(1);
    expect(store[0]!.refillRequestId).toBe('refill-request-1');
    expect(store[0]!.userId).toBe('user-1');
    expect(store[0]!.comuna).toBe('Ñuñoa');
    expect(store[0]!.urgencia).toBe('lo_antes_posible');
    expect(store[0]!.companyIds).toEqual(['company-a', 'company-b']);
    expect(store[0]!.items).toHaveLength(1);
    expect(store[0]!.items[0]!.refillItemId).toBe('refill-item-1');
  });

  it('a real MatchEncontrado with companyIds: [] still writes the header row (D2/D5, never suppressed)', async () => {
    await eventPublisher.publish(
      new MatchEncontrado(
        buildMatchEncontradoPayload({
          refillRequestId: 'refill-request-2',
          userId: 'user-2',
          companyIds: [],
        }),
      ),
    );

    expect(store).toHaveLength(1);
    expect(store[0]!.refillRequestId).toBe('refill-request-2');
    expect(store[0]!.companyIds).toEqual([]);
  });
});
