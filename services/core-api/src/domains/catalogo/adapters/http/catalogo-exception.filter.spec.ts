import type { ArgumentsHost } from '@nestjs/common';
import {
  CatalogItemNotFoundError,
  EmpresaNoActivaError,
  PrecioInvalidoError,
} from '../../domain/catalogo.errors';
import { CatalogoExceptionFilter } from './catalogo-exception.filter';

function fakeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

// design.md's "Errores de dominio" table (Phase 4b) pins this exact
// status/code pairing — mirrors `IdentidadExceptionFilter`'s own spec
// (constructor-keyed map, one test per mapped class, independent of any
// particular controller route; `test/catalogo-mi-catalogo.e2e-spec.ts`
// proves at least the 404/403 pair through the real HTTP pipeline).
describe.each([
  [new CatalogItemNotFoundError('item-1'), 404, 'CATALOG_ITEM_NOT_FOUND'],
  [new EmpresaNoActivaError('company-a'), 403, 'EMPRESA_NO_ACTIVA'],
  [
    new PrecioInvalidoError('precioMaximo debe ser mayor o igual a precioBase.'),
    400,
    'PRECIO_INVALIDO',
  ],
] as const)('CatalogoExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new CatalogoExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
