import type { ArgumentsHost } from '@nestjs/common';
import { CatalogQueryUnavailableError } from '../../../catalogo/contracts/catalog-query.port';
import {
  OfertaInvalidaError,
  OportunidadCerradaError,
  SolicitudNoElegibleError,
} from '../../domain/oferta.errors';
import { OfertasExceptionFilter } from './ofertas-exception.filter';

function fakeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

// design.md D-E's "Errores de dominio" table, PR5b's 4 new rows — this is
// `ofertas-exception.filter.ts`'s FIRST dedicated spec file. PR4b's own
// route (`listarSolicitudesElegibles`) throws none of `oferta.errors.ts`'s
// 8 classes, so `ERROR_STATUS_MAP` had zero entries to test until
// `enviarOferta` (this PR) gives it its first 4 (tasks.md 5b.4/5b.5).
// Mirrors `catalogo-exception.filter.spec.ts`'s own `describe.each` shape
// (constructor-keyed map, one test per mapped class, independent of any
// particular controller route — `test/ofertas-enviar-oferta.e2e-spec.ts`
// proves at least the 404/409/400/503 set through the real HTTP pipeline).
// Later PRs (6b/7b) EXTEND this same `describe.each` table, never replace
// it.
describe.each([
  [
    new SolicitudNoElegibleError('11111111-1111-4111-8111-111111111111'),
    404,
    'SOLICITUD_NO_ELEGIBLE',
  ],
  [
    new OportunidadCerradaError('11111111-1111-4111-8111-111111111111'),
    409,
    'OFERTA_OPORTUNIDAD_CERRADA',
  ],
  [new OfertaInvalidaError('El item x no pertenece a la solicitud y.'), 400, 'OFERTA_INVALIDA'],
  [new CatalogQueryUnavailableError(), 503, 'CATALOG_UNAVAILABLE'],
] as const)('OfertasExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new OfertasExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
