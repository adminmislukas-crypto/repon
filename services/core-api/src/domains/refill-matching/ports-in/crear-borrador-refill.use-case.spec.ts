import { Logger } from '@nestjs/common';
import type { RefillRequestBorrador } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { RefillRepository } from '../ports-out/refill-repository.port';
import { CrearBorradorRefillUseCase } from './crear-borrador-refill.use-case';

// db-schema-refill-matching spec: "A second RefillAutoSolicitado for the
// same consumption while a borrador is open is skipped" (D-D.3) +
// core-api-refill-matching spec: "The listener's borrador creation
// publishes no event" (D-C Decisión 1). design.md Diagrama 3, steps 3a-3f:
// the dedup read (`findBorradorByConsumption`) and the insert (`save`)
// share the SAME `tx` — read-then-write atomicity against the TOCTOU the
// partial unique index (migration 15, D-A) also guards against.
//
// Written in tasks.md 6a.1's own literal order: the dedup/skip scenario
// FIRST ("dedup check FIRST (write this test case first...)"), THEN the
// happy path. Confirmed RED first: `Cannot find module
// './crear-borrador-refill.use-case'` before the GREEN implementation
// existed.
//
// This use case never injects EVENT_PUBLISHER (constructor: only
// REFILL_REPOSITORY + TRANSACTION_MANAGER) — "zero events published" on
// both branches is therefore a structural guarantee (no token to call
// `publish` through), not something asserted here as a mock-not-called
// check the way `CrearSolicitudUseCase.spec.ts` does for its own publisher.

const fakeTx = {} as TransactionContext;

function buildRefillRepository(): jest.Mocked<RefillRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findBorradorByConsumption: jest.fn(),
    actualizarEstado: jest.fn(),
  };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildUseCase() {
  const refillRepository = buildRefillRepository();
  const transactionManager = buildTransactionManager();
  const useCase = new CrearBorradorRefillUseCase(refillRepository, transactionManager);
  return { refillRepository, transactionManager, useCase };
}

const existingBorrador: RefillRequestBorrador = {
  id: 'existing-borrador-id',
  userId: 'user-a',
  urgencia: 'lo_antes_posible',
  consumptionId: 'consumption-a',
  estado: 'borrador',
  items: [{ id: 'item-existing', nombre: 'Alimento perro' }],
};

describe('CrearBorradorRefillUseCase', () => {
  describe("dedup: a second RefillAutoSolicitado for the same consumption while a borrador is open is skipped (D-D.3, db-schema-refill-matching 'A second RefillAutoSolicitado for the same consumption while a borrador is open is skipped')", () => {
    it('logs refill.borrador_omitido and returns — zero save() calls', async () => {
      const { refillRepository, transactionManager, useCase } = buildUseCase();
      refillRepository.findBorradorByConsumption.mockResolvedValue(existingBorrador);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await useCase.execute({
        consumptionId: 'consumption-a',
        userId: 'user-a',
        nombre: 'Alimento perro',
      });

      expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
      expect(refillRepository.findBorradorByConsumption).toHaveBeenCalledWith(
        'user-a',
        'consumption-a',
        fakeTx,
      );
      expect(refillRepository.save).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          evento: 'refill.borrador_omitido',
          userId: 'user-a',
          consumptionId: 'consumption-a',
        }),
      );

      logSpy.mockRestore();
    });
  });

  describe("happy path: no existing borrador creates exactly one, and publishes nothing (core-api-refill-matching 'The listener's borrador creation publishes no event')", () => {
    it('save() is called once, inside the same transaction as the dedup read', async () => {
      const { refillRepository, transactionManager, useCase } = buildUseCase();
      refillRepository.findBorradorByConsumption.mockResolvedValue(null);

      await useCase.execute({
        consumptionId: 'consumption-b',
        userId: 'user-b',
        nombre: 'Arena para gato',
      });

      expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
      expect(refillRepository.save).toHaveBeenCalledTimes(1);

      const [savedRequest, tx] = refillRepository.save.mock.calls[0] as [
        RefillRequestBorrador,
        TransactionContext,
      ];
      expect(tx).toBe(fakeTx);
      expect(savedRequest.estado).toBe('borrador');
      expect(savedRequest.userId).toBe('user-b');
      expect(savedRequest.consumptionId).toBe('consumption-b');
      expect(savedRequest.urgencia).toBe('lo_antes_posible');
      expect(savedRequest.items).toHaveLength(1);
      expect(savedRequest.items[0]!.nombre).toBe('Arena para gato');
    });

    it('generates a fresh id for the request and for its single item, never a DB default — and never reuses the request id for the item', async () => {
      const { refillRepository, useCase } = buildUseCase();
      refillRepository.findBorradorByConsumption.mockResolvedValue(null);

      await useCase.execute({
        consumptionId: 'consumption-c',
        userId: 'user-c',
        nombre: 'Shampoo antipulgas',
      });

      const [savedRequest] = refillRepository.save.mock.calls[0] as [RefillRequestBorrador];
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(savedRequest.id).toMatch(uuidPattern);
      expect(savedRequest.items[0]!.id).toMatch(uuidPattern);
      expect(savedRequest.items[0]!.id).not.toBe(savedRequest.id);
    });
  });
});
