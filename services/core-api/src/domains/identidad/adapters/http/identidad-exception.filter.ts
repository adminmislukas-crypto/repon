import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  AuthProviderError,
  AuthProviderNoDisponibleError,
  CompanyNotFoundError,
  CompanyNotSuspendedError,
  CredencialesInvalidasError,
  EmailYaRegistradoError,
  EmpresaSuspendidaError,
  InvalidProfileError,
  PerfilSuspendidoError,
  ProfileNotFoundError,
  RegistroFallidoError,
  RolNoPermitidoError,
  SesionExpiradaError,
} from '../../domain/identidad.errors';

interface ResponseLike {
  status(code: number): { json(body: unknown): void };
}

interface StatusAndCode {
  statusCode: number;
  code: string;
}

// `domain/identidad.errors.ts`'s per-class doc comments (Phase 4b) pin the
// exact status/code every one of these plain-`Error` subclasses maps to at
// this domain's HTTP boundary. A lookup keyed by constructor, not an
// instanceof-chain, so a 7th error class is a one-line append.
type ErrorConstructor = new (...args: never[]) => Error;

const ERROR_STATUS_MAP = new Map<ErrorConstructor, StatusAndCode>([
  [InvalidProfileError, { statusCode: HttpStatus.BAD_REQUEST, code: 'INVALID_PROFILE' }],
  [EmailYaRegistradoError, { statusCode: HttpStatus.CONFLICT, code: 'EMAIL_YA_REGISTRADO' }],
  [AuthProviderError, { statusCode: HttpStatus.BAD_GATEWAY, code: 'AUTH_PROVIDER_ERROR' }],
  [RegistroFallidoError, { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'REGISTRO_FALLIDO' }],
  [CompanyNotFoundError, { statusCode: HttpStatus.NOT_FOUND, code: 'COMPANY_NOT_FOUND' }],
  [ProfileNotFoundError, { statusCode: HttpStatus.NOT_FOUND, code: 'PROFILE_NOT_FOUND' }],
  [CompanyNotSuspendedError, { statusCode: HttpStatus.CONFLICT, code: 'COMPANY_NOT_SUSPENDED' }],
  // mobile-auth-login design.md D-4/D-4a/D-5 (Phase 9) — the 6 new errors
  // this change's session routes throw.
  [CredencialesInvalidasError, { statusCode: HttpStatus.UNAUTHORIZED, code: 'CREDENCIALES_INVALIDAS' }],
  [SesionExpiradaError, { statusCode: HttpStatus.UNAUTHORIZED, code: 'SESION_EXPIRADA' }],
  [
    AuthProviderNoDisponibleError,
    { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'AUTH_PROVIDER_NO_DISPONIBLE' },
  ],
  [PerfilSuspendidoError, { statusCode: HttpStatus.FORBIDDEN, code: 'PROFILE_SUSPENDED' }],
  [EmpresaSuspendidaError, { statusCode: HttpStatus.FORBIDDEN, code: 'COMPANY_SUSPENDED' }],
  [RolNoPermitidoError, { statusCode: HttpStatus.FORBIDDEN, code: 'ROL_NO_PERMITIDO' }],
]);

/**
 * `core-api-hexagonal-layout` spec forbids `domain/`/`ports-in/` from
 * importing HTTP-framework types, so identidad's domain errors
 * (`domain/identidad.errors.ts`) cannot extend `HttpException` themselves.
 * This controller-scoped filter (`@UseFilters` on `IdentidadController`) is
 * the boundary that converts them, reusing `GlobalExceptionFilter`'s own
 * `{statusCode, code, message}` envelope (`core-api-auth-guard` spec) so a
 * client sees one consistent shape regardless of which filter handled it.
 *
 * `@Catch()` deliberately lists only these classes: anything else (a
 * guard rejection, an unexpected infra error) does not match, so Nest
 * falls through to `main.ts`'s `GlobalExceptionFilter` instead of this
 * filter inventing a second, competing catch-all.
 */
@Catch(
  InvalidProfileError,
  EmailYaRegistradoError,
  AuthProviderError,
  RegistroFallidoError,
  CompanyNotFoundError,
  ProfileNotFoundError,
  CompanyNotSuspendedError,
  CredencialesInvalidasError,
  SesionExpiradaError,
  AuthProviderNoDisponibleError,
  PerfilSuspendidoError,
  EmpresaSuspendidaError,
  RolNoPermitidoError,
)
export class IdentidadExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(IdentidadExceptionFilter.name);

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
