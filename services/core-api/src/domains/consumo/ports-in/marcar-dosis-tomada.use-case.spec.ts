import type { UserConsumption } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import { ConsumptionNotFoundError, DosisInvalidaError } from '../domain/consumo.errors';
import type { ConsumptionLogRepository } from '../ports-out/consumption-log-repository.port';
import type { ConsumptionRepository } from '../ports-out/consumption-repository.port';
import { MarcarDosisTomadaUseCase } from './marcar-dosis-tomada.use-case';

// core-api-consumo spec: "marcarDosisTomada is scoped to the caller's own
// consumption; cross-tenant access is a 404, never 403, and does not
// mutate" (R1-shaped, written FIRST per D16) + "marcarDosisTomada writes the
// log and decrements stock in one transaction; DosisRegistrada publishes
// only after commit" (D6) + "marcarDosisTomada decrements by the configured
// dose and never drives stock negative" (D-H.2).
//
// design.md Diagram 2 + "Mapa de transacciones" ("1 select + 1 insert + 1
// update", ALL inside the transaction): the ownership read (`findById`)
// runs INSIDE `runInTransaction`, on the SAME `tx` as both writes — a
// rejection throws inside the transaction, rolling back with zero writes.
// This deliberately does NOT mirror `ajustarPreciosPorCategoria`'s "checked
// BEFORE runInTransaction" gate: that gate validates actor-supplied SCALARS
// (no repository read needed to know them). This use case needs a
// repository READ to know the owner, and design.md pins that read inside
// the transaction, explicitly, in two places (the diagram's own "Se lanza
// DENTRO de la transaccion: rollback sin escrituras" note, and the
// transactions table's statement count).

const fakeTx = {} as TransactionContext;

function buildConsumptionRepository(): jest.Mocked<ConsumptionRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findDueForCheck: jest.fn(),
    intentarMarcarStockBajo: jest.fn(),
    limpiarMarcaStockBajo: jest.fn(),
    descontarStock: jest.fn(),
  };
}

function buildConsumptionLogRepository(): jest.Mocked<ConsumptionLogRepository> {
  return { append: jest.fn().mockResolvedValue(undefined), adherenciaUltimos7Dias: jest.fn() };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildUseCase() {
  const consumptionRepository = buildConsumptionRepository();
  const consumptionLogRepository = buildConsumptionLogRepository();
  const eventPublisher = buildEventPublisher();
  const transactionManager = buildTransactionManager();
  const useCase = new MarcarDosisTomadaUseCase(
    consumptionRepository,
    consumptionLogRepository,
    eventPublisher,
    transactionManager,
  );
  return {
    consumptionRepository,
    consumptionLogRepository,
    eventPublisher,
    transactionManager,
    useCase,
  };
}

const consumoDeUsuarioB: UserConsumption = {
  id: 'consumption-1',
  userId: 'user-b',
  ownerType: 'self',
  kind: 'medicamento',
  nombre: 'Losartan',
  dosisPorToma: 2,
  frecuenciaDias: 1,
  horarios: ['08:00'],
  stockActual: 10,
  autoCrearRefill: false,
};

describe('MarcarDosisTomadaUseCase', () => {
  describe('cross-tenant / not-found — byte-identical rejection, zero mutation (R1, D7)', () => {
    it('a cross-tenant consumption throws ConsumptionNotFoundError and calls neither append, descontarStock, nor publish', async () => {
      const { consumptionRepository, consumptionLogRepository, eventPublisher, useCase } =
        buildUseCase();
      consumptionRepository.findById.mockResolvedValue(consumoDeUsuarioB);

      await expect(useCase.execute('user-a', 'consumption-1')).rejects.toThrow(
        ConsumptionNotFoundError,
      );

      expect(consumptionLogRepository.append).not.toHaveBeenCalled();
      expect(consumptionRepository.descontarStock).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('a genuinely missing consumption throws the SAME ConsumptionNotFoundError', async () => {
      const { consumptionRepository, useCase } = buildUseCase();
      consumptionRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute('user-a', 'missing-consumption')).rejects.toThrow(
        ConsumptionNotFoundError,
      );
    });

    it('both branches produce byte-identical errors — no distinguishing information leaks cross-tenant existence (D7)', async () => {
      const notFoundRepo = buildConsumptionRepository();
      notFoundRepo.findById.mockResolvedValue(null);
      const crossTenantRepo = buildConsumptionRepository();
      crossTenantRepo.findById.mockResolvedValue(consumoDeUsuarioB);
      const buildFor = (repo: ConsumptionRepository) =>
        new MarcarDosisTomadaUseCase(
          repo,
          buildConsumptionLogRepository(),
          buildEventPublisher(),
          buildTransactionManager(),
        );

      const captureError = async (useCase: MarcarDosisTomadaUseCase): Promise<Error> => {
        try {
          await useCase.execute('user-a', 'consumption-1');
          throw new Error('expected execute() to reject, but it resolved');
        } catch (error) {
          return error as Error;
        }
      };
      const notFoundError = await captureError(buildFor(notFoundRepo));
      const crossTenantError = await captureError(buildFor(crossTenantRepo));

      expect(notFoundError).toBeInstanceOf(ConsumptionNotFoundError);
      expect(crossTenantError).toBeInstanceOf(ConsumptionNotFoundError);
      expect(notFoundError.constructor).toBe(crossTenantError.constructor);
      expect(notFoundError.message).toBe(crossTenantError.message);
    });
  });

  describe('transactional wiring — runInTransaction wraps the ownership read AND both writes on the SAME tx (D6, design.md Diagram 2)', () => {
    it('findById, append, and descontarStock all receive the identical tx object', async () => {
      const { consumptionRepository, consumptionLogRepository, transactionManager, useCase } =
        buildUseCase();
      const ownConsumption: UserConsumption = { ...consumoDeUsuarioB, userId: 'user-a' };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(8);

      await useCase.execute('user-a', 'consumption-1');

      expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
      expect(consumptionRepository.findById).toHaveBeenCalledWith('consumption-1', fakeTx);
      expect(consumptionLogRepository.append).toHaveBeenCalledWith(expect.anything(), fakeTx);
      expect(consumptionRepository.descontarStock).toHaveBeenCalledWith('consumption-1', 2, fakeTx);
    });

    it('a failure in the second write (descontarStock rejects) still shows append was called with the same tx — atomicity is the transaction rollback, not call-ordering', async () => {
      const { consumptionRepository, consumptionLogRepository, eventPublisher, useCase } =
        buildUseCase();
      const ownConsumption: UserConsumption = { ...consumoDeUsuarioB, userId: 'user-a' };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockRejectedValue(new Error('boom'));

      await expect(useCase.execute('user-a', 'consumption-1')).rejects.toThrow('boom');

      expect(consumptionLogRepository.append).toHaveBeenCalledTimes(1);
      expect(consumptionLogRepository.append).toHaveBeenCalledWith(expect.anything(), fakeTx);
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('DosisRegistrada publishes only after the transaction commits (D6)', () => {
    it('publish happens after runInTransaction resolves, never from inside the callback', async () => {
      const { consumptionRepository, transactionManager, eventPublisher, useCase } = buildUseCase();
      const ownConsumption: UserConsumption = { ...consumoDeUsuarioB, userId: 'user-a' };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(8);
      const callOrder: string[] = [];
      transactionManager.runInTransaction.mockImplementation(async (work) => {
        const result = await work(fakeTx);
        callOrder.push('transaction-committed');
        return result;
      });
      eventPublisher.publish.mockImplementation(async () => {
        callOrder.push('published');
      });

      await useCase.execute('user-a', 'consumption-1');

      expect(callOrder).toEqual(['transaction-committed', 'published']);
    });

    it('publishes DosisRegistrada with the exact D-D payload shape', async () => {
      const { consumptionRepository, eventPublisher, useCase } = buildUseCase();
      const ownConsumption: UserConsumption = {
        ...consumoDeUsuarioB,
        userId: 'user-a',
        dosisPorToma: 2,
      };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(8);

      await useCase.execute('user-a', 'consumption-1');

      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'consumo.dosis_registrada',
          consumptionId: 'consumption-1',
          userId: 'user-a',
          cantidad: 2,
          stockRestante: 8,
        }),
      );
    });
  });

  describe('cantidad is always consumption.dosisPorToma — never a client-supplied value (D-H.2, no such DTO field exists)', () => {
    it('append and descontarStock both use the CONFIGURED dose', async () => {
      const { consumptionRepository, consumptionLogRepository, useCase } = buildUseCase();
      const ownConsumption: UserConsumption = {
        ...consumoDeUsuarioB,
        userId: 'user-a',
        dosisPorToma: 3.5,
      };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(1);

      await useCase.execute('user-a', 'consumption-1');

      expect(consumptionLogRepository.append).toHaveBeenCalledWith(
        expect.objectContaining({ cantidad: 3.5 }),
        fakeTx,
      );
      expect(consumptionRepository.descontarStock).toHaveBeenCalledWith(
        'consumption-1',
        3.5,
        fakeTx,
      );
    });
  });

  describe('clamp-at-zero flows through from descontarStock (SQL-level guarantee, design.md D-H.2)', () => {
    it('a resolved stock of 0 (descontarStock clamped) publishes stockRestante: 0, never negative — the dose is still recorded', async () => {
      const { consumptionRepository, consumptionLogRepository, eventPublisher, useCase } =
        buildUseCase();
      const ownConsumption: UserConsumption = {
        ...consumoDeUsuarioB,
        userId: 'user-a',
        stockActual: 1,
        dosisPorToma: 5,
      };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(0);

      await useCase.execute('user-a', 'consumption-1');

      expect(consumptionLogRepository.append).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ stockRestante: 0 }),
      );
    });
  });

  describe('tomadoAt resolution (domain/consumo.errors.ts DosisInvalidaError doc comment names this use case as the thrower)', () => {
    it('an absent tomadoAt defaults to now(), never rejected', async () => {
      const { consumptionRepository, consumptionLogRepository, useCase } = buildUseCase();
      const ownConsumption: UserConsumption = { ...consumoDeUsuarioB, userId: 'user-a' };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(8);
      const before = Date.now();

      await useCase.execute('user-a', 'consumption-1', undefined);

      const after = Date.now();
      const [logArg] = consumptionLogRepository.append.mock.calls[0]!;
      const tomadoAtMs = new Date((logArg as { tomadoAt: string }).tomadoAt).getTime();
      expect(tomadoAtMs).toBeGreaterThanOrEqual(before);
      expect(tomadoAtMs).toBeLessThanOrEqual(after);
    });

    it('a future tomadoAt beyond the clock-skew tolerance throws DosisInvalidaError before the transaction ever opens', async () => {
      const { consumptionRepository, consumptionLogRepository, transactionManager, useCase } =
        buildUseCase();
      const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h

      await expect(useCase.execute('user-a', 'consumption-1', farFuture)).rejects.toThrow(
        DosisInvalidaError,
      );

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(consumptionRepository.findById).not.toHaveBeenCalled();
      expect(consumptionLogRepository.append).not.toHaveBeenCalled();
    });

    it('a past tomadoAt is accepted and passed through verbatim', async () => {
      const { consumptionRepository, consumptionLogRepository, useCase } = buildUseCase();
      const ownConsumption: UserConsumption = { ...consumoDeUsuarioB, userId: 'user-a' };
      consumptionRepository.findById.mockResolvedValue(ownConsumption);
      consumptionRepository.descontarStock.mockResolvedValue(8);
      const past = '2026-01-01T00:00:00.000Z';

      await useCase.execute('user-a', 'consumption-1', past);

      expect(consumptionLogRepository.append).toHaveBeenCalledWith(
        expect.objectContaining({ tomadoAt: past }),
        fakeTx,
      );
    });
  });
});
