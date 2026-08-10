import type { ArgumentsHost } from '@nestjs/common';
import {
  ConsumoInvalidoError,
  ConsumptionNotFoundError,
  MascotaInvalidaError,
  PetNotFoundError,
} from '../../domain/consumo.errors';
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
// map, one test per mapped class). ConsumptionNotFoundError landed in PR2b
// (CalcularDiasRestantesUseCase); PetNotFoundError/ConsumoInvalidoError/
// MascotaInvalidaError land in this PR (3) — RegistrarMascotaUseCase/
// ConfigurarConsumoUseCase's real callers now exist. DosisInvalidaError
// lands as its own use case does (PR4), extending @Catch()/ERROR_STATUS_MAP
// in this same file.
describe.each([
  [new ConsumptionNotFoundError('consumption-1'), 404, 'CONSUMPTION_NOT_FOUND'],
  [new PetNotFoundError('pet-1'), 404, 'PET_NOT_FOUND'],
  [new MascotaInvalidaError('nombre no puede estar vacío.'), 400, 'MASCOTA_INVALIDA'],
  [new ConsumoInvalidoError('dosisPorToma (0) debe ser mayor que 0.'), 400, 'CONSUMO_INVALIDO'],
] as const)('ConsumoExceptionFilter — %#', (exception, statusCode, code) => {
  it(`maps ${exception.constructor.name} to ${statusCode} ${code}`, () => {
    const filter = new ConsumoExceptionFilter();
    const { host, status, json } = fakeHost();

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith({ statusCode, code, message: exception.message });
  });
});
