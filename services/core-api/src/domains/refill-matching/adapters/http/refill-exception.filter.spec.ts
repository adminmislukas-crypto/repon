import type { ArgumentsHost } from '@nestjs/common';
import { CatalogQueryUnavailableError } from '../../../catalogo/contracts/catalog-query.port';
import {
  RefillRequestNotFoundError,
  SolicitudEnBorradorError,
  SolicitudInvalidaError,
} from '../../domain/refill.errors';
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
// `SolicitudInvalidaError` was the ONLY mapping PR4b needed — it's the only
// error `CrearSolicitudUseCase` can throw (it propagates straight from
// `crearSolicitudActiva()` before any I/O). PR5b (this batch) EXTENDS this
// same `describe.each` table with the 3 mappings
// `BuscarProveedoresCompatiblesUseCase` (PR5a) can throw:
// `RefillRequestNotFoundError` (404), `SolicitudEnBorradorError` (409), and
// `CatalogQueryUnavailableError` (503 — imported from
// `catalogo/contracts/catalog-query.port.ts`, the one legitimate
// cross-domain import this domain makes, D15/C8). Phase 6b (409/400/400)
// extends this same table again — it never replaces it or creates a second
// filter file.
describe.each([
  [
    new SolicitudInvalidaError('La solicitud debe tener al menos un ítem.'),
    400,
    'SOLICITUD_INVALIDA',
  ],
  [
    new RefillRequestNotFoundError('11111111-1111-1111-1111-111111111111'),
    404,
    'REFILL_REQUEST_NOT_FOUND',
  ],
  [
    new SolicitudEnBorradorError('11111111-1111-1111-1111-111111111111'),
    409,
    'REFILL_REQUEST_EN_BORRADOR',
  ],
  [new CatalogQueryUnavailableError(), 503, 'CATALOG_UNAVAILABLE'],
] as const)('RefillExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new RefillExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
