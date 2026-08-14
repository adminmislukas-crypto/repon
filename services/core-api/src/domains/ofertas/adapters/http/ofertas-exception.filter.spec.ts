import type { ArgumentsHost } from '@nestjs/common';
import { CatalogQueryUnavailableError } from '../../../catalogo/contracts/catalog-query.port';
import {
  DestinatarioNoElegibleError,
  ItemsNoDisponiblesError,
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
// This PR (6b, tasks.md 6b.7/6b.8) EXTENDS this same table with the 2 new
// `enviarOfertaProactiva` rows — `DestinatarioNoElegibleError`/
// `ItemsNoDisponiblesError` — never replacing the 4 rows above. 7b will do
// the same for `aceptarOferta`'s 3 remaining classes.
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
  [
    new DestinatarioNoElegibleError('11111111-1111-4111-8111-111111111111'),
    404,
    'DESTINATARIO_NO_ELEGIBLE',
  ],
  [
    new ItemsNoDisponiblesError('1 de 2 item(s) no estan disponibles en el catalogo.'),
    400,
    'OFERTA_ITEMS_NO_DISPONIBLES',
  ],
] as const)('OfertasExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new OfertasExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
