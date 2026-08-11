import type { ArgumentsHost } from '@nestjs/common';
import { SolicitudInvalidaError } from '../../domain/refill.errors';
import { RefillExceptionFilter } from './refill-exception.filter';

function fakeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

// design.md D-E's "Errores de dominio" table pins this exact status/code
// pairing — mirrors `ConsumoExceptionFilter`'s/`CatalogoExceptionFilter`'s
// own spec (constructor-keyed map, one test per mapped class).
// `SolicitudInvalidaError` is the ONLY mapping this PR (4b) needs — it's
// the only error `CrearSolicitudUseCase` can throw (it propagates straight
// from `crearSolicitudActiva()` before any I/O). Phase 5b (404/409/503) and
// Phase 6b (409/400/400) EXTEND this same `describe.each` table as their
// own use cases land, they never replace it or create a second filter file.
describe.each([
  [
    new SolicitudInvalidaError('La solicitud debe tener al menos un ítem.'),
    400,
    'SOLICITUD_INVALIDA',
  ],
] as const)('RefillExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new RefillExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
