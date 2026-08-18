import type { ArgumentsHost } from '@nestjs/common';
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
import { IdentidadExceptionFilter } from './identidad-exception.filter';

function fakeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

// `domain/identidad.errors.ts`'s per-class doc comments pin this exact
// status/code pairing (Phase 4b) — this test is the single source of truth
// proving `IdentidadExceptionFilter` honors it, independent of any
// particular controller route (`test/identidad.e2e-spec.ts` proves at
// least one of these through the real HTTP pipeline).
describe.each([
  [new InvalidProfileError('bad'), 400, 'INVALID_PROFILE'],
  [new EmailYaRegistradoError('a@b.cl'), 409, 'EMAIL_YA_REGISTRADO'],
  [new AuthProviderError(), 502, 'AUTH_PROVIDER_ERROR'],
  [new RegistroFallidoError(), 503, 'REGISTRO_FALLIDO'],
  [new CompanyNotFoundError('c1'), 404, 'COMPANY_NOT_FOUND'],
  [new ProfileNotFoundError('p1'), 404, 'PROFILE_NOT_FOUND'],
  [new CompanyNotSuspendedError('c1'), 409, 'COMPANY_NOT_SUSPENDED'],
  [new CredencialesInvalidasError(), 401, 'CREDENCIALES_INVALIDAS'],
  [new SesionExpiradaError(), 401, 'SESION_EXPIRADA'],
  [new AuthProviderNoDisponibleError(), 503, 'AUTH_PROVIDER_NO_DISPONIBLE'],
  [new PerfilSuspendidoError(), 403, 'PROFILE_SUSPENDED'],
  [new EmpresaSuspendidaError(), 403, 'COMPANY_SUSPENDED'],
  [new RolNoPermitidoError(), 403, 'ROL_NO_PERMITIDO'],
] as const)('IdentidadExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new IdentidadExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
