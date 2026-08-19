import type { UserConsumption } from '@repon/types';
import { consumoDiario, diasRestantes } from '../domain/consumo.calculos';
import type { ConsumptionRepository } from '../ports-out/consumption-repository.port';
import { ListarConsumosUseCase } from './listar-consumos.use-case';

// usuario-mobile-consumo design.md D-1/D-5/D7: `GET /consumo/mis-consumos`
// attaches `diasRestantes` per row IN PROCESS, reusing the exact same pure
// functions the point-read (`CalcularDiasRestantesUseCase`) already uses —
// never a per-item repository call (D7's N+1 guarantee).

function buildRepository(): jest.Mocked<ConsumptionRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findDueForCheck: jest.fn(),
    intentarMarcarStockBajo: jest.fn(),
    limpiarMarcaStockBajo: jest.fn(),
    descontarStock: jest.fn(),
    findByUserId: jest.fn(),
  };
}

function buildConsumption(overrides: Partial<UserConsumption> = {}): UserConsumption {
  return {
    id: 'consumption-1',
    userId: 'user-a',
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 2,
    frecuenciaDias: 1,
    horarios: ['08:00', '20:00'],
    stockActual: 10,
    autoCrearRefill: false,
    ...overrides,
  };
}

describe('ListarConsumosUseCase', () => {
  it('attaches diasRestantes to every row, matching consumoDiario+diasRestantes on the same input', async () => {
    const repository = buildRepository();
    const consumption = buildConsumption();
    repository.findByUserId.mockResolvedValue([consumption]);
    const useCase = new ListarConsumosUseCase(repository);

    const [result] = await useCase.execute('user-a');

    const esperado = diasRestantes(
      consumption.stockActual,
      consumoDiario({
        dosisPorToma: consumption.dosisPorToma,
        horarios: consumption.horarios,
        frecuenciaDias: consumption.frecuenciaDias,
      }),
    );
    expect(result!.diasRestantes).toBe(esperado);
    expect(result).toEqual({ ...consumption, diasRestantes: esperado });
  });

  it('calls findByUserId exactly once, regardless of how many rows come back — zero extra repository calls per item (D7)', async () => {
    const repository = buildRepository();
    repository.findByUserId.mockResolvedValue([
      buildConsumption(),
      buildConsumption({ id: 'consumption-2' }),
      buildConsumption({ id: 'consumption-3' }),
    ]);
    const useCase = new ListarConsumosUseCase(repository);

    const result = await useCase.execute('user-a');

    expect(result).toHaveLength(3);
    expect(repository.findByUserId).toHaveBeenCalledTimes(1);
  });

  it('a degenerate row (empty horarios) produces a non-finite raw diasRestantes — sanitized at the DTO boundary, not here', async () => {
    const repository = buildRepository();
    repository.findByUserId.mockResolvedValue([buildConsumption({ horarios: [] as never })]);
    const useCase = new ListarConsumosUseCase(repository);

    const [result] = await useCase.execute('user-a');

    // consumoDiario = 0 when horarios is empty; stockActual(10) / 0 = Infinity.
    // This use case does NOT guard it — that's `consumo.mapper.ts`'s job.
    expect(Number.isFinite(result!.diasRestantes)).toBe(false);
  });

  it('returns an empty array for a user with no consumptions — never throws', async () => {
    const repository = buildRepository();
    repository.findByUserId.mockResolvedValue([]);
    const useCase = new ListarConsumosUseCase(repository);

    await expect(useCase.execute('user-with-nothing')).resolves.toEqual([]);
  });
});
