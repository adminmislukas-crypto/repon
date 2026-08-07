import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CompanyVisibilityListener } from '../src/domains/catalogo/adapters/events/company-visibility.listener';
import { OcultarCatalogoEmpresaUseCase } from '../src/domains/catalogo/ports-in/ocultar-catalogo-empresa.use-case';
import { RestaurarCatalogoEmpresaUseCase } from '../src/domains/catalogo/ports-in/restaurar-catalogo-empresa.use-case';
import {
  CATALOG_VISIBILITY_PROJECTION,
  type CatalogVisibilityProjection,
} from '../src/domains/catalogo/ports-out/catalog-visibility-projection.port';
import { EmpresaAprobada } from '../src/domains/identidad/events/empresa-aprobada.event';
import { EmpresaReactivada } from '../src/domains/identidad/events/empresa-reactivada.event';
import { EmpresaSuspendida } from '../src/domains/identidad/events/empresa-suspendida.event';
import { EventEmitterPublisher } from '../src/shared/event-bus/event-emitter.publisher';
import { EVENT_PUBLISHER, type EventPublisher } from '../src/shared/event-bus/event-publisher.port';

/**
 * design.md D-A: the mandatory mitigation for `catalogo`'s string-keyed
 * event coupling to `identidad`. `CompanyVisibilityListener`
 * (`catalogo/adapters/events/`) subscribes to `identidad`'s events by
 * channel-NAME STRING and types its payload with a locally-declared
 * interface (`EmpresaOcultablePayload`) — it never imports `identidad`'s
 * event classes, so there is NO compile-time link between the two domains.
 * If `identidad` ever renamed one of these events' `type` field, nothing
 * would break at build time — only silently, at runtime, in production.
 *
 * This file is the one place in the whole `catalogo` change that DOES
 * import `identidad`'s real event classes (`EmpresaSuspendida`/
 * `EmpresaReactivada`/`EmpresaAprobada`) — legitimately, because it lives
 * in `test/`, outside `domains/`, so the zone-boundary ESLint rule
 * (`import-x/no-restricted-paths`, `core-api-hexagonal-layout`) does not
 * apply here. It publishes REAL instances of those 3 classes through the
 * REAL `EventEmitterPublisher`/`EventEmitter2` (`emitAsync`, not a stub),
 * and asserts a REAL `CompanyVisibilityListener` reacted correctly. If
 * `identidad` ever drifts `EmpresaSuspendida.type` away from
 * `'empresa.suspendida'`, `@OnEvent('empresa.suspendida')` stops matching,
 * the listener never fires, and the assertions below fail — that's the
 * whole point: a silent runtime break becomes a loud CI failure.
 *
 * **Chosen shape** (documented per this batch's own decision point):
 * option (b) from `apply-progress.md`'s "What PR8b Needs to Know" —
 * real event bus + real listener + real `Ocultar`/`RestaurarCatalogoEmpresaUseCase`,
 * but a MOCKED `CATALOG_VISIBILITY_PROJECTION`, asserted via
 * `toHaveBeenCalledWith`. This fully covers the actual risk named above
 * (a renamed event `type` string) without requiring a live Postgres in
 * default CI — same "override the port, keep the wiring real" convention
 * every other e2e spec in this domain already uses. Named
 * `*.e2e-spec.ts`, not `*.contract-spec.ts` as `tasks.md`/`design.md`'s
 * prose names it: verified against `package.json`'s `jest` config
 * (`rootDir: "src"`, so nothing under `test/` is even scanned there) and
 * `test/jest-e2e.json`'s `testRegex: ".e2e-spec\\.ts$"` — a
 * `.contract-spec.ts` file would match NONE of this repo's 3 configured
 * test patterns (unit/e2e/integration) and would silently never run under
 * any `pnpm test*` script. Filename corrected so this test actually
 * executes in CI, which is the one property a "mandatory mitigation" test
 * cannot fail to have.
 */
describe('Catalogo visibility — cross-domain event contract with identidad (e2e)', () => {
  let eventPublisher: EventPublisher;
  let catalogVisibilityProjection: jest.Mocked<CatalogVisibilityProjection>;

  beforeEach(async () => {
    catalogVisibilityProjection = {
      ocultarEmpresa: jest.fn().mockResolvedValue(undefined),
      mostrarEmpresa: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        { provide: EVENT_PUBLISHER, useClass: EventEmitterPublisher },
        { provide: CATALOG_VISIBILITY_PROJECTION, useValue: catalogVisibilityProjection },
        CompanyVisibilityListener,
        OcultarCatalogoEmpresaUseCase,
        RestaurarCatalogoEmpresaUseCase,
      ],
    }).compile();

    // `@nestjs/event-emitter`'s `OnEvent` decorator is wired up by an
    // internal `EventEmitterReadinessWatcher` that registers listeners on
    // the `onApplicationBootstrap` lifecycle hook — `.compile()` alone
    // does NOT fire lifecycle hooks, only `.init()` does. Without this,
    // every test below fails with "0 calls" even though the listener class
    // is correctly instantiated — caught by actually running this test,
    // not assumed (first draft used `moduleRef.get(...)` only and failed
    // all 3 routing assertions for exactly this reason).
    await moduleRef.init();
    eventPublisher = moduleRef.get<EventPublisher>(EVENT_PUBLISHER);
  });

  it('routes a real EmpresaSuspendida through the real event bus to ocultarEmpresa', async () => {
    const companyId = 'company-a';
    const motivo = 'Reporte de fraude';

    await eventPublisher.publish(new EmpresaSuspendida(companyId, motivo));

    expect(catalogVisibilityProjection.ocultarEmpresa).toHaveBeenCalledWith(companyId, motivo);
    expect(catalogVisibilityProjection.mostrarEmpresa).not.toHaveBeenCalled();
  });

  it('routes a real EmpresaReactivada through the real event bus to mostrarEmpresa', async () => {
    const companyId = 'company-b';

    await eventPublisher.publish(new EmpresaReactivada(companyId, 'Disputa resuelta'));

    expect(catalogVisibilityProjection.mostrarEmpresa).toHaveBeenCalledWith(companyId);
    expect(catalogVisibilityProjection.ocultarEmpresa).not.toHaveBeenCalled();
  });

  it('routes a real EmpresaAprobada through the SAME handler as EmpresaReactivada (design.md Diagram 2)', async () => {
    const companyId = 'company-c';

    // EmpresaAprobada's constructor takes ONLY companyId — no `motivo` at
    // all (verified against services/core-api/src/domains/identidad/
    // events/empresa-aprobada.event.ts). Consuming it is NOT redundant:
    // AprobarEmpresaUseCase has no state precondition, so an admin
    // approving an already-suspended company also publishes this event —
    // without this subscription that company would stay activo-but-hidden
    // forever (fail-CLOSED, invisible, see design.md D-A).
    await eventPublisher.publish(new EmpresaAprobada(companyId));

    expect(catalogVisibilityProjection.mostrarEmpresa).toHaveBeenCalledWith(companyId);
    expect(catalogVisibilityProjection.ocultarEmpresa).not.toHaveBeenCalled();
  });

  it('does not propagate a listener failure back into the publisher (fail-open, R4)', async () => {
    catalogVisibilityProjection.ocultarEmpresa.mockRejectedValueOnce(new Error('DB down'));

    // EventEmitterPublisher.publish awaits emitAsync — if the listener
    // did not catch its own errors, this would reject and the promise
    // below would throw. It must resolve cleanly instead (design.md D-A:
    // "el listener captura todo... y no relanza").
    await expect(
      eventPublisher.publish(new EmpresaSuspendida('company-d', 'motivo')),
    ).resolves.toBeUndefined();
  });
});
