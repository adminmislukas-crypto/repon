import type { ArgumentsHost } from '@nestjs/common';
import { ConsumptionNotFoundError } from '../../domain/consumo.errors';
import { ConsumoExceptionFilter } from './consumo-exception.filter';

function fakeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

// design.md's "Errores de dominio" table pins this exact status/code
// pairing — mirrors CatalogoExceptionFilter's own spec (constructor-keyed
// map, one test per mapped class). Only ConsumptionNotFoundError has a
// caller in this PR (CalcularDiasRestantesUseCase); PetNotFoundError/
// ConsumoInvalidoError/MascotaInvalidaError/DosisInvalidaError land as
// their own use cases do (PR3/PR4), extending @Catch()/ERROR_STATUS_MAP in
// this same file.
describe.each([
  [new ConsumptionNotFoundError('consumption-1'), 404, 'CONSUMPTION_NOT_FOUND'],
] as const)('ConsumoExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new ConsumoExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
