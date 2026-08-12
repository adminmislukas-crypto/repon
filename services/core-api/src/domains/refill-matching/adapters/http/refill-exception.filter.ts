import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { CatalogQueryUnavailableError } from '../../../catalogo/contracts/catalog-query.port';
import {
  RefillItemDesconocidoError,
  RefillRequestNotFoundError,
  SolicitudEnBorradorError,
  SolicitudIncompletaError,
  SolicitudInvalidaError,
  TransicionInvalidaError,
} from '../../domain/refill.errors';

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

interface StatusAndCode {
  statusCode: number;
  code: string;
}

// `domain/refill.errors.ts`'s per-class doc comments + design.md D-E's
// "Errores de dominio" table pin the exact status/code every one of these
// plain-`Error` subclasses maps to at this domain's HTTP boundary. A lookup
// keyed by constructor, not an instanceof-chain, so a new error class is a
// one-line append — mirrors `ConsumoExceptionFilter`/`CatalogoExceptionFilter`
// exactly. `SolicitudInvalidaError` landed in PR4b — it's the only error
// `CrearSolicitudUseCase` can throw. PR5b (this batch) adds the 3 mappings
// `BuscarProveedoresCompatiblesUseCase` (PR5a) can throw:
// `RefillRequestNotFoundError` (404), `SolicitudEnBorradorError` (409), and
// `CatalogQueryUnavailableError` (503 — imported from
// `catalogo/contracts/catalog-query.port.ts`, the ONE legitimate
// cross-domain import this domain makes anywhere, D15/C8: it is `catalogo`'s
// own error class, never redeclared/copied here). PR6b (this batch) adds
// `TransicionInvalidaError` (409 — `CompletarBorradorUseCase` rejects
// completing a non-borrador), `SolicitudIncompletaError` (400 — delegated
// from Phase 2's `completar()`), and `RefillItemDesconocidoError` (400 —
// also delegated from `completar()`) — it EXTENDS this same map and this
// same `@Catch()` list too, it never creates a second filter.
type ErrorConstructor = new (...args: never[]) => Error;

const ERROR_STATUS_MAP = new Map<ErrorConstructor, StatusAndCode>([
  [SolicitudInvalidaError, { statusCode: HttpStatus.BAD_REQUEST, code: 'SOLICITUD_INVALIDA' }],
  [
    RefillRequestNotFoundError,
    { statusCode: HttpStatus.NOT_FOUND, code: 'REFILL_REQUEST_NOT_FOUND' },
  ],
  [
    SolicitudEnBorradorError,
    { statusCode: HttpStatus.CONFLICT, code: 'REFILL_REQUEST_EN_BORRADOR' },
  ],
  [
    CatalogQueryUnavailableError,
    { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'CATALOG_UNAVAILABLE' },
  ],
  [TransicionInvalidaError, { statusCode: HttpStatus.CONFLICT, code: 'TRANSICION_INVALIDA' }],
  [
    SolicitudIncompletaError,
    { statusCode: HttpStatus.BAD_REQUEST, code: 'REFILL_REQUEST_INCOMPLETA' },
  ],
  [
    RefillItemDesconocidoError,
    { statusCode: HttpStatus.BAD_REQUEST, code: 'REFILL_ITEM_DESCONOCIDO' },
  ],
]);

/**
 * `core-api-hexagonal-layout` spec forbids `domain/`/`ports-in/` from
 * importing HTTP-framework types, so `refill-matching`'s domain errors
 * (`domain/refill.errors.ts`) cannot extend `HttpException` themselves.
 * This controller-scoped filter (`@UseFilters` on `RefillController`) is
 * the boundary that converts them, reusing `GlobalExceptionFilter`'s own
 * `{statusCode, code, message}` envelope — same pattern as
 * `consumo/adapters/http/consumo-exception.filter.ts` and
 * `catalogo/adapters/http/catalogo-exception.filter.ts`.
 *
 * `@Catch()` deliberately lists only this domain's mapped classes: anything
 * else (a guard rejection, an unexpected infra error) does not match, so
 * Nest falls through to `main.ts`'s `GlobalExceptionFilter` instead of this
 * filter inventing a second, competing catch-all.
 */
@Catch(
  SolicitudInvalidaError,
  RefillRequestNotFoundError,
  SolicitudEnBorradorError,
  CatalogQueryUnavailableError,
  TransicionInvalidaError,
  SolicitudIncompletaError,
  RefillItemDesconocidoError,
)
export class RefillExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RefillExceptionFilter.name);

  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    // Defensive fallback only — every class named in @Catch() above has a
    // map entry; this can't actually miss in practice.
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
