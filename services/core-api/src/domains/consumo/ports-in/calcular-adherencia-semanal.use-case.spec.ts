import type { UserConsumption } from '@repon/types';
import type { ConsumptionLogRepository } from '../ports-out/consumption-log-repository.port';
import type { ConsumptionRepository } from '../ports-out/consumption-repository.port';
import { CalcularAdherenciaSemanalUseCase } from './calcular-adherencia-semanal.use-case';

// usuario-mobile-consumo design.md D-1/D-2/D-4/D-5: `GET /consumo/mi-adherencia`.
// A fixed `ahora` makes the 7-day window deterministic across every test —
// no DST edge in this range (see consumo.calculos.spec.ts for that case,
// already covered there for `ventanaAdherencia` itself).
const AHORA = new Date('2026-06-15T15:00:00.000Z');
// America/Santiago, no DST active in June: fechas = 06-09 .. 06-15.

function buildConsumptionRepository(): jest.Mocked<ConsumptionRepository> {
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

function buildConsumptionLogRepository(): jest.Mocked<ConsumptionLogRepository> {
  return {
    append: jest.fn(),
    adherenciaUltimos7Dias: jest.fn(),
    contarTomasPorDia: jest.fn(),
  };
}

function buildConsumption(overrides: Partial<UserConsumption> = {}): UserConsumption {
  return {
    id: 'consumption-1',
    userId: 'user-a',
    ownerType: 'self',
    kind: 'medicamento',
    nombre: 'Losartan',
    dosisPorToma: 1,
    frecuenciaDias: 1,
    horarios: ['08:00'],
    stockActual: 10,
    autoCrearRefill: false,
    ...overrides,
  };
}

describe('CalcularAdherenciaSemanalUseCase', () => {
  it('always returns exactly 7 dias, oldest to today, matching ventanaAdherencia', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    consumptionRepository.findByUserId.mockResolvedValue([]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    const result = await useCase.execute('user-a', AHORA);

    expect(result.dias).toHaveLength(7);
    expect(result.desde).toBe('2026-06-09');
    expect(result.hasta).toBe('2026-06-15');
  });

  it('a user with no consumptions gets a full sin_datos skeleton — never [] or null', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    consumptionRepository.findByUserId.mockResolvedValue([]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    const result = await useCase.execute('user-with-nothing', AHORA);

    expect(result.items).toEqual([]);
    expect(result.porcentaje).toBe(0);
    expect(result.rachaDias).toBe(0);
    expect(result.dias.every((dia) => dia.estado === 'sin_datos')).toBe(true);
    expect(result.dias.every((dia) => dia.esperadas === 0 && dia.tomadas === 0)).toBe(true);
  });

  it('calls contarTomasPorDia exactly once, with exactly the id set findByUserId returned', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    const consumptions = [
      buildConsumption({ id: 'c-1' }),
      buildConsumption({ id: 'c-2' }),
    ];
    consumptionRepository.findByUserId.mockResolvedValue(consumptions);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    await useCase.execute('user-a', AHORA);

    expect(consumptionLogRepository.contarTomasPorDia).toHaveBeenCalledTimes(1);
    const [idsArg] = consumptionLogRepository.contarTomasPorDia.mock.calls[0]!;
    expect(idsArg).toEqual(['c-1', 'c-2']);
  });

  it('a daily item (frecuenciaDias=1, 1 horario) taken every day for the whole window is cumplido every day, 100%, and a full streak', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    const consumption = buildConsumption({ id: 'c-1', horarios: ['08:00'], frecuenciaDias: 1 });
    consumptionRepository.findByUserId.mockResolvedValue([consumption]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue(
      ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15'].map(
        (fecha) => ({ consumptionId: 'c-1', fecha, tomadas: 1 }),
      ),
    );
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    const result = await useCase.execute('user-a', AHORA);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.esperadas).toBe(7);
    expect(result.items[0]!.tomadas).toBe(7);
    expect(result.items[0]!.porcentaje).toBe(100);
    expect(result.items[0]!.dias.every((dia) => dia.estado === 'cumplido')).toBe(true);
    expect(result.porcentaje).toBe(100);
    // rachaDias excludes today (2026-06-15) — 6 prior days, all cumplido.
    expect(result.rachaDias).toBe(6);
  });

  it('a missing day for an item (no ConteoDiarioLog row) counts as 0 tomadas that day, not a crash', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    const consumption = buildConsumption({ id: 'c-1', horarios: ['08:00'], frecuenciaDias: 1 });
    consumptionRepository.findByUserId.mockResolvedValue([consumption]);
    // Only one day has a log row — every other day must default to 0, not undefined.
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([
      { consumptionId: 'c-1', fecha: '2026-06-12', tomadas: 1 },
    ]);
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    const result = await useCase.execute('user-a', AHORA);

    const diaSinLog = result.items[0]!.dias.find((d) => d.fecha === '2026-06-10')!;
    expect(diaSinLog.tomadas).toBe(0);
    expect(diaSinLog.estado).toBe('incumplido');
    const diaConLog = result.items[0]!.dias.find((d) => d.fecha === '2026-06-12')!;
    expect(diaConLog.tomadas).toBe(1);
    expect(diaConLog.estado).toBe('cumplido');
  });

  it('aggregates multiple items into the top-level dias/porcentaje — never just the first item', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    consumptionRepository.findByUserId.mockResolvedValue([
      buildConsumption({ id: 'c-1', horarios: ['08:00'], frecuenciaDias: 1 }),
      buildConsumption({ id: 'c-2', horarios: ['08:00'], frecuenciaDias: 1 }),
    ]);
    // c-1 taken every day, c-2 never taken.
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue(
      ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15'].map(
        (fecha) => ({ consumptionId: 'c-1', fecha, tomadas: 1 }),
      ),
    );
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    const result = await useCase.execute('user-a', AHORA);

    // Aggregate: esperadas = 14 (7 each), tomadas = 7 (only c-1) -> 50%.
    expect(result.porcentaje).toBe(50);
    expect(result.dias.every((dia) => dia.estado === 'parcial')).toBe(true);
  });

  it('is scoped to the given userId only — passes it through to findByUserId verbatim', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    consumptionRepository.findByUserId.mockResolvedValue([]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    await useCase.execute('user-a', AHORA);

    expect(consumptionRepository.findByUserId).toHaveBeenCalledWith('user-a');
  });

  it('defaults ahora to the real system clock when omitted — window still has exactly 7 dias', async () => {
    const consumptionRepository = buildConsumptionRepository();
    const consumptionLogRepository = buildConsumptionLogRepository();
    consumptionRepository.findByUserId.mockResolvedValue([]);
    consumptionLogRepository.contarTomasPorDia.mockResolvedValue([]);
    const useCase = new CalcularAdherenciaSemanalUseCase(
      consumptionRepository,
      consumptionLogRepository,
    );

    const result = await useCase.execute('user-a');

    expect(result.dias).toHaveLength(7);
  });
});
