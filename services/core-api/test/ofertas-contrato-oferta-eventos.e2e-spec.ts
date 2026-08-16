import { EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { RefillEstadoActivo, RefillRequestBorrador } from '@repon/types';
import { OfertaAceptada } from '../src/domains/ofertas/events/oferta-aceptada.event';
import type { OfertaAceptadaPayload } from '../src/domains/ofertas/events/oferta-aceptada.payload';
import { OfertaEnviada } from '../src/domains/ofertas/events/oferta-enviada.event';
import type { OfertaEnviadaPayload } from '../src/domains/ofertas/events/oferta-enviada.payload';
import { OfertaAceptadaListener } from '../src/domains/refill-matching/adapters/events/oferta-aceptada.listener';
import { OfertaEnviadaListener } from '../src/domains/refill-matching/adapters/events/oferta-enviada.listener';
import { MarcarComoConfirmadaUseCase } from '../src/domains/refill-matching/ports-in/marcar-como-confirmada.use-case';
import { MarcarComoOfertadaUseCase } from '../src/domains/refill-matching/ports-in/marcar-como-ofertada.use-case';
import {
  REFILL_REPOSITORY,
  type RefillRepository,
} from '../src/domains/refill-matching/ports-out/refill-repository.port';
import { EventEmitterPublisher } from '../src/shared/event-bus/event-emitter.publisher';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

/**
 * design.md D-F/D7, tasks.md 8a.8 — the mandatory contract test for
 * `refill-matching`'s 2 NEW event consumers (`OfertaEnviadaListener`/
 * `OfertaAceptadaListener`, this batch's own PR8a), proving they are
 * genuinely wired to `ofertas`' REAL `ofertas.oferta_enviada`/
 * `ofertas.oferta_aceptada` channels, not just to a hand-typed local payload
 * a unit test happens to construct.
 *
 * **Named `.e2e-spec.ts`, deliberately, not `.contract-spec.ts`**, same
 * `test/jest-e2e.json` `testRegex` incident `refill-auto-solicitado.e2e-spec.ts`/
 * `catalogo-visibility.e2e-spec.ts`/this batch's own
 * `ofertas-contrato-match-encontrado.e2e-spec.ts` already document.
 *
 * **`await moduleRef.init()`, never only `.compile()`** — same
 * `EventEmitterReadinessWatcher`/`onApplicationBootstrap` reasoning as this
 * batch's sibling contract test; see that file's doc comment for the full
 * mechanism.
 *
 * **Same orchestrator-prompt correction as this batch's sibling contract
 * test**: this task does NOT require a live Postgres. design.md's own
 * "Estrategia de testing" table marks this exact row `¿CI? Sí`, distinct
 * from the opt-in/non-CI Postgres-integration row above it (task 3b.13).
 * Follows the same "override the port, keep the wiring real" convention
 * `refill-auto-solicitado.e2e-spec.ts` established: a LIGHT
 * `Test.createTestingModule`, a real `EventEmitterModule.forRoot()`, a real
 * `EVENT_PUBLISHER`/`EventEmitterPublisher`, the 2 real new listeners, and
 * the 2 real (pre-existing, unedited) use cases — but `REFILL_REPOSITORY` is
 * a minimal in-memory fake, `refill_requests.estado` asserted directly
 * against its own in-memory store. FULLY VERIFIED this batch, not
 * written-but-unverified.
 *
 * Publishes REAL `ofertas` `OfertaEnviada`/`OfertaAceptada` instances
 * (imported from `ofertas/events/` — legitimate here because this file
 * lives in `test/`, outside `domains/`, so the zone-boundary ESLint rule
 * does not apply, the same exception every sibling contract test in this
 * repo already uses). If `ofertas` ever drifts either event's `type` string,
 * `@OnEvent` stops matching and the assertions below fail loudly instead of
 * silently — the whole point of a contract test.
 */
describe('OfertaEnviada/OfertaAceptada — cross-domain event contract with ofertas (e2e)', () => {
  let eventPublisher: EventPublisher;
  let estados: Map<string, RefillEstadoActivo>;

  function buildOfertaEnviadaPayload(
    overrides: Partial<OfertaEnviadaPayload>,
  ): OfertaEnviadaPayload {
    return {
      offerId: 'offer-default',
      kind: 'reactiva',
      companyId: 'company-default',
      userId: 'user-default',
      refillRequestId: 'refill-request-default',
      total: 15990,
      tiempoEntregaHoras: 24,
      ...overrides,
    };
  }

  function buildOfertaAceptadaPayload(
    overrides: Partial<OfertaAceptadaPayload>,
  ): OfertaAceptadaPayload {
    return {
      offerId: 'offer-default',
      companyId: 'company-default',
      userId: 'user-default',
      refillRequestId: 'refill-request-default',
      total: 15990,
      desplazadas: [],
      costoDespacho: 2000,
      lineas: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    estados = new Map([
      ['refill-request-a', 'abierta'],
      ['refill-request-b', 'abierta'],
      ['refill-request-c', 'abierta'],
    ]);

    const refillRepository: RefillRepository = {
      save: async () => undefined,
      findById: async () => null,
      findBorradorByConsumption: async (): Promise<RefillRequestBorrador | null> => null,
      actualizarEstado: async (id: string, estado: RefillEstadoActivo) => {
        estados.set(id, estado);
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        { provide: EVENT_PUBLISHER, useClass: EventEmitterPublisher },
        { provide: REFILL_REPOSITORY, useValue: refillRepository },
        MarcarComoOfertadaUseCase,
        MarcarComoConfirmadaUseCase,
        OfertaEnviadaListener,
        OfertaAceptadaListener,
      ],
    }).compile();

    // See doc comment above: without `.init()`, `onApplicationBootstrap`
    // never fires and `@OnEvent` never registers — the test would pass
    // without testing anything (the `catalogo` PR8b incident).
    await moduleRef.init();
    eventPublisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);
  });

  it("a real reactive OfertaEnviada drives refill_requests.estado to 'ofertada'", async () => {
    await eventPublisher.publish(
      new OfertaEnviada(
        buildOfertaEnviadaPayload({ offerId: 'offer-a', refillRequestId: 'refill-request-a' }),
      ),
    );

    expect(estados.get('refill-request-a')).toBe('ofertada');
  });

  it("a real reactive OfertaAceptada drives refill_requests.estado to 'confirmada'", async () => {
    await eventPublisher.publish(
      new OfertaAceptada(
        buildOfertaAceptadaPayload({ offerId: 'offer-b', refillRequestId: 'refill-request-b' }),
      ),
    );

    expect(estados.get('refill-request-b')).toBe('confirmada');
  });

  it('a real proactive OfertaEnviada (refillRequestId: null) leaves every refill_requests.estado untouched', async () => {
    await eventPublisher.publish(
      new OfertaEnviada(buildOfertaEnviadaPayload({ offerId: 'offer-c', refillRequestId: null })),
    );

    expect(estados.get('refill-request-c')).toBe('abierta');
  });
});
