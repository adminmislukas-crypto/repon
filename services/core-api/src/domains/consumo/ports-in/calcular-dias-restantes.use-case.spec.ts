import type { UserConsumption } from '@repon/types';
import { ConsumptionNotFoundError } from '../domain/consumo.errors';
import type { ConsumptionRepository } from '../ports-out/consumption-repository.port';
import { CalcularDiasRestantesUseCase } from './calcular-dias-restantes.use-case';

// core-api-consumo spec: "calcularDiasRestantes is scoped to the caller's
// own consumption; cross-tenant access is a 404, never 403" — THE scenario
// this PR closes (R1, design.md Diagram 3). Written FIRST, mirroring
// catalogo's ActualizarPrecioUseCase spec convention: a cross-tenant
// consumption and a genuinely missing one MUST throw the exact same error,
// constructed the exact same way — no 403-shaped distinction.

function buildRepository(): jest.Mocked<ConsumptionRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findDueForCheck: jest.fn(),
    intentarMarcarStockBajo: jest.fn(),
    limpiarMarcaStockBajo: jest.fn(),
    descontarStock: jest.fn(),
  };
}

const consumoDeUsuarioB: UserConsumption = {
  id: 'consumption-1',
  userId: 'user-b',
  ownerType: 'self',
  kind: 'medicamento',
  nombre: 'Losartan',
  dosisPorToma: 1,
  frecuenciaDias: 1,
  horarios: ['08:00'],
  stockActual: 10,
  autoCrearRefill: false,
};

describe('CalcularDiasRestantesUseCase', () => {
  describe('cross-tenant / not-found — byte-identical rejection (R1)', () => {
    it('a cross-tenant consumption (belongs to user B, requested by user A) throws ConsumptionNotFoundError, never a 403-shaped error', async () => {
      const consumptionRepository = buildRepository();
      consumptionRepository.findById.mockResolvedValue(consumoDeUsuarioB);
      const useCase = new CalcularDiasRestantesUseCase(consumptionRepository);

      await expect(useCase.execute('user-a', 'consumption-1')).rejects.toThrow(
        ConsumptionNotFoundError,
      );
    });

    it('a genuinely missing consumption throws the SAME ConsumptionNotFoundError', async () => {
      const consumptionRepository = buildRepository();
      consumptionRepository.findById.mockResolvedValue(null);
      const useCase = new CalcularDiasRestantesUseCase(consumptionRepository);

      await expect(useCase.execute('user-a', 'missing-consumption')).rejects.toThrow(
        ConsumptionNotFoundError,
      );
    });

    it('both branches produce byte-identical errors — no distinguishing information leaks cross-tenant existence (D7)', async () => {
      const notFoundRepo = buildRepository();
      notFoundRepo.findById.mockResolvedValue(null);
      const crossTenantRepo = buildRepository();
      crossTenantRepo.findById.mockResolvedValue(consumoDeUsuarioB);

      const captureError = async (useCase: CalcularDiasRestantesUseCase): Promise<Error> => {
        try {
          await useCase.execute('user-a', 'consumption-1');
          throw new Error('expected execute() to reject, but it resolved');
        } catch (error) {
          return error as Error;
        }
      };
      const notFoundError = await captureError(new CalcularDiasRestantesUseCase(notFoundRepo));
      const crossTenantError = await captureError(
        new CalcularDiasRestantesUseCase(crossTenantRepo),
      );

      expect(notFoundError).toBeInstanceOf(ConsumptionNotFoundError);
      expect(crossTenantError).toBeInstanceOf(ConsumptionNotFoundError);
      expect(notFoundError.constructor).toBe(crossTenantError.constructor);
      expect(notFoundError.message).toBe(crossTenantError.message);
    });
  });

  describe('happy path — owner queries their own remaining days', () => {
    it('returns diasRestantes computed from the pure calculos (design.md Diagram 1, step 2a) when the actor owns the consumption', async () => {
      const consumptionRepository = buildRepository();
      const ownConsumption: UserConsumption = { ...consumoDeUsuarioB, userId: 'user-a' };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      const useCase = new CalcularDiasRestantesUseCase(consumptionRepository);

      // consumoDiario = 1 * 1 / 1 = 1; diasRestantes = floor(10 / 1) = 10
      const result = await useCase.execute('user-a', 'consumption-1');

      expect(result).toBe(10);
    });

    it('floors a partial day (design.md: Math.floor, never round/ceil)', async () => {
      const consumptionRepository = buildRepository();
      const ownConsumption: UserConsumption = {
        ...consumoDeUsuarioB,
        userId: 'user-a',
        stockActual: 10,
        dosisPorToma: 3,
        horarios: ['08:00'],
        frecuenciaDias: 1,
      };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      const useCase = new CalcularDiasRestantesUseCase(consumptionRepository);

      // consumoDiario = 3; diasRestantes = floor(10 / 3) = 3
      const result = await useCase.execute('user-a', 'consumption-1');

      expect(result).toBe(3);
    });
  });

  describe('structural CQS guarantee (D2/R4)', () => {
    it('the constructor injects ONLY CONSUMPTION_REPOSITORY — length 1, no EVENT_PUBLISHER/NOTIFICATION_PORT parameter', () => {
      // core-api-consumo spec: "The pure-query use case cannot reach events
      // or notifications" — an inspectable structural property. The
      // constructor accepting exactly one parameter, with no optional
      // 2nd/3rd parameter for a publisher or notification port, is what
      // makes this verifiable by reading the class instead of trusting a
      // convention.
      expect(CalcularDiasRestantesUseCase.length).toBe(1);
    });
  });
});
