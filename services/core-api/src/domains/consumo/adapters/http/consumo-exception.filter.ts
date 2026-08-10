import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConsumptionNotFoundError } from '../../domain/consumo.errors';

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

interface StatusAndCode {
  statusCode: number;
  code: string;
}

// `domain/consumo.errors.ts`'s per-class doc comments + design.md's
// "Errores de dominio" table pin the exact status/code every one of these
// plain-`Error` subclasses maps to at this domain's HTTP boundary. A lookup
// keyed by constructor, not an instanceof-chain, so a new error class is a
// one-line append — mirrors `CatalogoExceptionFilter` exactly.
// `ConsumptionNotFoundError` is the only mapped class in this PR (2b) — the
// first HTTP-reachable route/error pair (`GET .../dias-restantes`).
// `PetNotFoundError`/`ConsumoInvalidoError`/`MascotaInvalidaError`/
// `DosisInvalidaError` are appended here as PR3/PR4's use cases/routes
// start throwing them.
type ErrorConstructor = new (...args: never[]) => Error;

const ERROR_STATUS_MAP = new Map<ErrorConstructor, StatusAndCode>([
  [ConsumptionNotFoundError, { statusCode: HttpStatus.NOT_FOUND, code: 'CONSUMPTION_NOT_FOUND' }],
]);

/**
 * `core-api-hexagonal-layout` spec forbids `domain/`/`ports-in/` from
 * importing HTTP-framework types, so `consumo`'s domain errors
 * (`domain/consumo.errors.ts`) cannot extend `HttpException` themselves.
 * This controller-scoped filter (`@UseFilters` on `ConsumoController`) is
 * the boundary that converts them, reusing `GlobalExceptionFilter`'s own
 * `{statusCode, code, message}` envelope — same pattern as
 * `catalogo/adapters/http/catalogo-exception.filter.ts`.
 *
 * `@Catch()` deliberately lists only this domain's mapped classes: anything
 * else (a guard rejection, an unexpected infra error) does not match, so
 * Nest falls through to `main.ts`'s `GlobalExceptionFilter` instead of this
 * filter inventing a second, competing catch-all.
 */
@Catch(ConsumptionNotFoundError)
export class ConsumoExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ConsumoExceptionFilter.name);

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
