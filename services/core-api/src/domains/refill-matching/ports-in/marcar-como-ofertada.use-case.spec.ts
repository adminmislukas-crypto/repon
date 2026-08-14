import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';
import { RefillController } from '../adapters/http/refill.controller';
import { MarcarComoOfertadaUseCase } from './marcar-como-ofertada.use-case';

// core-api-refill-matching spec / design.md D6: `marcarComoOfertada` is a
// trivial `actualizarEstado` wrapper with ZERO HTTP surface and ZERO caller
// in this change — the state machine exists (Phase 2's `marcarOfertada()`)
// and the port exists (`actualizarEstado`, D-G.2, PR1), but nothing wires
// them together until this task. Mirrors `consumo`'s
// `adherenciaUltimos7Dias()` precedent: a real, tested, orphan public
// surface, doc-commented as such, not built speculatively — the interface
// completeness (`RefillRepository`) already demanded `actualizarEstado`
// exist; this use case is simply its first (and, in this change, only)
// caller.
//
// NestJS metadata keys, hardcoded rather than importing `@nestjs/common`'s
// internal `constants` subpath — same technique 5a.6
// (`buscar-proveedores-compatibles.use-case.spec.ts`) and 6a.4
// (`refill-auto-solicitado.listener.spec.ts`) already established in this
// domain, verified against the installed package source
// (`@nestjs/common/constants.js`): `SELF_DECLARED_DEPS_METADATA` for
// `@Inject(TOKEN)` constructor params, `PARAMTYPES_METADATA` for the raw
// `design:paramtypes` TS-emitted metadata (every constructor param, tokens
// AND concrete classes alike), `PATH_METADATA` for `@Post()`/`@Get()`'s own
// route path (`request-mapping.decorator.js`: `Reflect.defineMetadata(PATH_METADATA,
// path, descriptor.value)`).
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';
const PARAMTYPES_METADATA = 'design:paramtypes';
const PATH_METADATA = 'path';

function buildRefillRepository(): jest.Mocked<RefillRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findBorradorByConsumption: jest.fn(),
    actualizarEstado: jest.fn(),
  };
}

/** Recursively lists every `.ts` file under `dir` — used by the module-graph
 *  check below. Domain-local, not a shared test helper: the "no caller
 *  exists" claim (D6) only needs to hold within this one domain's own
 *  source tree, never across `test/`'s e2e specs. */
function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('MarcarComoOfertadaUseCase', () => {
  // tasks.md 7.1 — happy path.
  it("execute(refillRequestId) calls actualizarEstado(refillRequestId, 'ofertada') exactly once", async () => {
    const refillRepository = buildRefillRepository();
    const useCase = new MarcarComoOfertadaUseCase(refillRepository);

    await useCase.execute('refill-1');

    expect(refillRepository.actualizarEstado).toHaveBeenCalledTimes(1);
    expect(refillRepository.actualizarEstado).toHaveBeenCalledWith('refill-1', 'ofertada');
  });

  // tasks.md 7.1 — constructor-inspection test.
  it('constructor injects ONLY REFILL_REPOSITORY — no EVENT_PUBLISHER, no AuditLogPort (D16)', () => {
    const injectedTokens: Array<{ index: number; param: unknown }> =
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, MarcarComoOfertadaUseCase) ?? [];

    expect(injectedTokens).toHaveLength(1);
    expect(injectedTokens[0]?.param).toBe(REFILL_REPOSITORY);
  });

  // tasks.md 7.1 (originally) / tasks.md 8a.6 (updated) — the 2 structural
  // checks below are properties of the WHOLE domain, not of
  // `MarcarComoOfertadaUseCase` alone. They live HERE, once, rather than
  // being duplicated verbatim in `marcar-como-confirmada.use-case.spec.ts`
  // — that file cross-references this describe block by name instead of
  // re-asserting the same 2 facts a second time.
  //
  // **The 2nd check's own claim changed under `backend-core-api-ofertas`
  // PR8a, on purpose — not a regression, the whole POINT of that PR
  // (design.md D7, tasks.md 8a.6, `core-api-refill-matching` spec "Neither
  // method is HTTP-reachable"/"A reactive OfertaEnviada calls
  // marcarComoOfertada exactly once").** `backend-core-api-refill-matching`
  // (the change that introduced this file) asserted "no caller anywhere in
  // this domain" — true AT THAT TIME (D6: "No caller exists in this
  // change"). `backend-core-api-ofertas` PR8a gives both use cases their
  // FIRST real callers — `OfertaEnviadaListener`/`OfertaAceptadaListener`
  // (`adapters/events/oferta-enviada.listener.ts`/
  // `oferta-aceptada.listener.ts`) — by design, not by drift. Re-running
  // this suite unmodified after PR8a landed the listeners is exactly what
  // caught the stale assertion (`offendingFiles` grew from `[]` to the 5
  // new/touched files below) — the same "run it, don't assume green"
  // discipline every prior batch in this chain has documented. The fix is
  // widening `allowedReferrers`, never touching
  // `marcar-como-ofertada.use-case.ts`/`marcar-como-confirmada.use-case.ts`
  // themselves (tasks.md 8a.6 forbids exactly that) — this spec file is the
  // one place in `refill-matching`, besides `refill-matching.module.ts`,
  // that PR8a is allowed to touch.
  describe(
    'Neither marcarComoOfertada nor marcarComoConfirmada is HTTP-reachable directly, and ' +
      'their only callers anywhere in this domain are the 2 listeners backend-core-api-ofertas ' +
      'PR8a added (D6/D7, core-api-refill-matching "Neither method is HTTP-reachable" / ' +
      'tasks.md 8a.6)',
    () => {
      it("RefillController's own routes are unchanged: exactly 3 handlers, none of them named/pathed after ofertada or confirmada", () => {
        const controllerParamTypes: unknown[] =
          Reflect.getMetadata(PARAMTYPES_METADATA, RefillController) ?? [];
        // If either use case were ever injected into the controller's
        // constructor, this length would grow past 3 (crearSolicitud,
        // buscarProveedoresCompatibles, completarBorrador — PR4b/5b/6b).
        expect(controllerParamTypes).toHaveLength(3);
        expect(controllerParamTypes).not.toContain(MarcarComoOfertadaUseCase);

        const routeMethodNames = Object.getOwnPropertyNames(RefillController.prototype).filter(
          (name) => name !== 'constructor',
        );
        const controllerPrototype = RefillController.prototype as unknown as Record<
          string,
          (...args: unknown[]) => unknown
        >;
        const routePaths = routeMethodNames
          .map((name) => Reflect.getMetadata(PATH_METADATA, controllerPrototype[name]!))
          .filter((path): path is string => typeof path === 'string');

        expect(routePaths).toHaveLength(3);
        expect(routePaths.join('|')).not.toMatch(/ofertada|confirmada/i);
      });

      it("no file in this domain references MarcarComoOfertadaUseCase or MarcarComoConfirmadaUseCase by name, except their own impl/spec files, refill-matching.module.ts, and PR8a's 2 listeners + local payloads", () => {
        const domainRoot = resolve(__dirname, '..');
        const allowedReferrers = new Set([
          'marcar-como-ofertada.use-case.ts',
          'marcar-como-ofertada.use-case.spec.ts',
          'marcar-como-confirmada.use-case.ts',
          'marcar-como-confirmada.use-case.spec.ts',
          'refill-matching.module.ts',
          // backend-core-api-ofertas PR8a (tasks.md 8a.6, design.md D7) —
          // the 2 use cases' first legitimate callers, plus the local
          // payload file whose own doc comment names both use cases by way
          // of explaining why their 2 fields are required.
          'oferta-enviada.listener.ts',
          'oferta-enviada.listener.spec.ts',
          'oferta-aceptada.listener.ts',
          'oferta-aceptada.listener.spec.ts',
          'ofertas-event.payloads.ts',
        ]);

        const offendingFiles = listTsFiles(domainRoot)
          .filter((filePath) => !allowedReferrers.has(basename(filePath)))
          .filter((filePath) => {
            const content = readFileSync(filePath, 'utf-8');
            return (
              content.includes('MarcarComoOfertadaUseCase') ||
              content.includes('MarcarComoConfirmadaUseCase')
            );
          });

        expect(offendingFiles).toEqual([]);
      });
    },
  );
});
