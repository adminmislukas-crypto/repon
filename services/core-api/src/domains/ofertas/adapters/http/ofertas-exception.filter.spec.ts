import type { ArgumentsHost } from '@nestjs/common';
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
// PR7b (tasks.md 7b.2/7b.3) EXTENDS this same table with the 3 remaining
// `aceptarOferta`/`obtenerBandeja` rows — `OfferNotFoundError`/
// `TransicionInvalidaError`/`OfertaYaAceptadaError` — never replacing the 6
// rows above. This closes out all 9 of `oferta.errors.ts`'s classes plus
// `CatalogQueryUnavailableError` — every class named in `@Catch()` now has a
// map entry, no more classes falling through to the 500 defensive fallback.
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
  [new OfferNotFoundError('11111111-1111-4111-8111-111111111111'), 404, 'OFFER_NOT_FOUND'],
  [
    new TransicionInvalidaError('La oferta ya fue procesada y no puede aceptarse de nuevo.'),
    409,
    'TRANSICION_INVALIDA',
  ],
  [new OfertaYaAceptadaError('11111111-1111-4111-8111-111111111111'), 409, 'OFERTA_YA_ACEPTADA'],
] as const)('OfertasExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new OfertasExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
