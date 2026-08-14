import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { CatalogQueryUnavailableError } from '../../../catalogo/contracts/catalog-query.port';
import {
  DestinatarioNoElegibleError,
  ItemsNoDisponiblesError,
  OfertaInvalidaError,
  OfertaYaAceptadaError,
  OfferNotFoundError,
  OportunidadCerradaError,
  SolicitudNoElegibleError,
  TransicionInvalidaError,
} from '../../domain/oferta.errors';

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

interface StatusAndCode {
  statusCode: number;
  code: string;
}

type ErrorConstructor = new (...args: never[]) => Error;

// `domain/oferta.errors.ts`'s per-class doc comments + design.md D-E's
// "Errores de dominio" table pin the exact status/code every one of these
// plain-`Error` subclasses maps to at this domain's HTTP boundary. A lookup
// keyed by constructor, not an instanceof-chain, so a new mapping is a
// one-line append — mirrors `RefillExceptionFilter`/`ConsumoExceptionFilter`/
// `CatalogoExceptionFilter` exactly.
//
// `ERROR_STATUS_MAP` started EMPTY in PR4b (tasks.md 4b.5):
// `ListarSolicitudesElegiblesUseCase` — the only use case wired to a route
// at the time — threw none of these 8 classes (it is a single read, no
// eligibility/ownership check of its own). This PR (5b, tasks.md 5b.4/5b.5)
// adds the FIRST 4 entries, for `enviarOferta`'s own errors — 6b/7b each
// add their own entries incrementally (`enviarOfertaProactiva`'s 2 new
// ones, `aceptarOferta`'s 3) — this file is never replaced, only appended
// to, same discipline as every sibling filter.
//
// `CatalogQueryUnavailableError` (imported from `catalogo/contracts/`, the
// one legitimate cross-domain import this domain makes anywhere, D15) is
// NOT one of `oferta.errors.ts`'s own 8 classes — it is added to BOTH
// `@Catch()` and `ERROR_STATUS_MAP` in THIS PR (5b), the first PR where a
// route (`enviarOferta`) can actually call `CatalogQueryPort` and propagate
// this error uncaught (C8, `EnviarOfertaUseCase`'s own step 7 doc comment).
//
// ## Why `@Catch()` lists all 8 classes NOW, even though none has a map
// entry yet — a deliberate, documented divergence from the sibling filters'
// own convention of keeping `@Catch()`'s class list byte-identical to
// `ERROR_STATUS_MAP`'s keys at every point in time:
//
// `@Catch()` called with ZERO arguments is NestJS's own catch-ALL
// mechanism (`@nestjs/common`'s `Catch` decorator sets
// `FILTER_CATCH_EXCEPTIONS` to `[]`; `selectExceptionFilterMetadata`
// matches ANY exception when that array is empty — verified by reading
// both directly, not assumed). A controller-scoped `@UseFilters()` filter
// is checked BEFORE the app's global filter for every route on that
// controller (`RouterExceptionFilters.create()` reverses
// `[...global, ...class, ...method]` into `[...method, ...class,
// ...global]` before the first-match lookup). An empty `@Catch()` on
// `OfertasController` — this domain's first HTTP surface, task 4b.4 — would
// therefore intercept EVERY exception on every route this controller ever
// declares, including `AuthGuard`'s `UnauthorizedException` (401) and
// `RolesGuard`'s `ForbiddenException` (403), converting them into this
// filter's defensive-fallback 500 `INTERNAL_SERVER_ERROR` instead of
// letting them fall through to `main.ts`'s `GlobalExceptionFilter` — which
// would break this very PR's own 401/403 e2e requirements (task 4b.7).
//
// Since `oferta.errors.ts`'s all 8 classes were already fully declared
// (PR1) and their target status/code were already fixed by design.md's
// table, PR4b listed them all in `@Catch()` up front — both SAFE (none of
// them is `UnauthorizedException`/`ForbiddenException`/any Nest built-in,
// so guard rejections still fall through correctly — re-verified by this
// PR's own 401/403 e2e tests) and reduces future churn: 5b (this PR)/6b/7b
// each only ever need to APPEND an entry to the map below — the exact same
// extension discipline `RefillExceptionFilter`/`ConsumoExceptionFilter`/
// `CatalogoExceptionFilter` already established for their own maps. This
// PR adds `SolicitudNoElegibleError`→404, `OportunidadCerradaError`→409,
// `OfertaInvalidaError`→400, `CatalogQueryUnavailableError`→503 (plus that
// 4th class to `@Catch()`, since it is not one of `oferta.errors.ts`'s own
// 8); 6b adds `DestinatarioNoElegibleError`→404,
// `ItemsNoDisponiblesError`→400; 7b adds `OfferNotFoundError`→404,
// `TransicionInvalidaError`→409, `OfertaYaAceptadaError`→409 (design.md
// D-E's "Errores de dominio" table).
const ERROR_STATUS_MAP = new Map<ErrorConstructor, StatusAndCode>([
  [SolicitudNoElegibleError, { statusCode: HttpStatus.NOT_FOUND, code: 'SOLICITUD_NO_ELEGIBLE' }],
  [
    OportunidadCerradaError,
    { statusCode: HttpStatus.CONFLICT, code: 'OFERTA_OPORTUNIDAD_CERRADA' },
  ],
  [OfertaInvalidaError, { statusCode: HttpStatus.BAD_REQUEST, code: 'OFERTA_INVALIDA' }],
  [
    CatalogQueryUnavailableError,
    { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'CATALOG_UNAVAILABLE' },
  ],
]);

@Catch(
  SolicitudNoElegibleError,
  OportunidadCerradaError,
  DestinatarioNoElegibleError,
  OfferNotFoundError,
  OfertaYaAceptadaError,
  TransicionInvalidaError,
  ItemsNoDisponiblesError,
  OfertaInvalidaError,
  CatalogQueryUnavailableError,
)
export class OfertasExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OfertasExceptionFilter.name);

  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    // Every class named in @Catch() above WILL eventually get a map entry
    // (added incrementally, PR by PR — 4 of 9 now have one, this PR) —
    // until a remaining class does, an instance reaching this filter (6b's
    // `DestinatarioNoElegibleError`/`ItemsNoDisponiblesError`, 7b's
    // `OfferNotFoundError`/`TransicionInvalidaError`/`OfertaYaAceptadaError`
    // — none reachable from any route wired as of this PR) falls into the
    // same defensive 500 fallback every sibling filter already uses for a
    // genuinely unexpected error.
    const { statusCode, code } = ERROR_STATUS_MAP.get(
      exception.constructor as ErrorConstructor,
    ) ?? {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
    };
    if (statusCode >= 500) this.logger.error(exception.stack);
    response.status(statusCode).json({ statusCode, code, message: exception.message });
  }
}
