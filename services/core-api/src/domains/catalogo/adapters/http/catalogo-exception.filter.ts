import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  ArchivoCargaInvalidoError,
  CatalogItemNotFoundError,
  EmpresaNoActivaError,
  PorcentajeInvalidoError,
  PrecioInvalidoError,
  ProductoInvalidoError,
} from '../../domain/catalogo.errors';

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

interface StatusAndCode {
  statusCode: number;
  code: string;
}

// `domain/catalogo.errors.ts`'s per-class doc comments + design.md's
// "Errores de dominio" table pin the exact status/code every one of these
// plain-`Error` subclasses maps to at this domain's HTTP boundary. A lookup
// keyed by constructor, not an instanceof-chain, so a new error class
// (`CatalogQueryUnavailableError`, cross-domain only) is a one-line append
// — mirrors `IdentidadExceptionFilter` exactly. `ArchivoCargaInvalidoError`
// (Phase 5a) and `ProductoInvalidoError` (Phase 5b) were added in Phase 5b;
// `PorcentajeInvalidoError` (Phase 6) is added in this batch — the first
// controller route that can throw it now exists (`POST
// /catalogo/mi-catalogo/ajustes-de-precio`).
type ErrorConstructor = new (...args: never[]) => Error;

const ERROR_STATUS_MAP = new Map<ErrorConstructor, StatusAndCode>([
  [CatalogItemNotFoundError, { statusCode: HttpStatus.NOT_FOUND, code: 'CATALOG_ITEM_NOT_FOUND' }],
  [EmpresaNoActivaError, { statusCode: HttpStatus.FORBIDDEN, code: 'EMPRESA_NO_ACTIVA' }],
  [PrecioInvalidoError, { statusCode: HttpStatus.BAD_REQUEST, code: 'PRECIO_INVALIDO' }],
  [PorcentajeInvalidoError, { statusCode: HttpStatus.BAD_REQUEST, code: 'PORCENTAJE_INVALIDO' }],
  [
    ArchivoCargaInvalidoError,
    { statusCode: HttpStatus.BAD_REQUEST, code: 'ARCHIVO_CARGA_INVALIDO' },
  ],
  [ProductoInvalidoError, { statusCode: HttpStatus.BAD_REQUEST, code: 'PRODUCTO_INVALIDO' }],
]);

/**
 * `core-api-hexagonal-layout` spec forbids `domain/`/`ports-in/` from
 * importing HTTP-framework types, so `catalogo`'s domain errors
 * (`domain/catalogo.errors.ts`) cannot extend `HttpException` themselves.
 * This controller-scoped filter (`@UseFilters` on `CatalogoController`) is
 * the boundary that converts them, reusing `GlobalExceptionFilter`'s own
 * `{statusCode, code, message}` envelope so a client sees one consistent
 * shape regardless of which filter handled it — same pattern as
 * `identidad/adapters/http/identidad-exception.filter.ts`.
 *
 * `@Catch()` deliberately lists only these 6 classes (this domain's scope
 * so far): anything else (a guard rejection, an unexpected infra error)
 * does not match, so Nest falls through to `main.ts`'s
 * `GlobalExceptionFilter` instead of this filter inventing a second,
 * competing catch-all.
 */
@Catch(
  CatalogItemNotFoundError,
  EmpresaNoActivaError,
  PrecioInvalidoError,
  PorcentajeInvalidoError,
  ArchivoCargaInvalidoError,
  ProductoInvalidoError,
)
export class CatalogoExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CatalogoExceptionFilter.name);

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
