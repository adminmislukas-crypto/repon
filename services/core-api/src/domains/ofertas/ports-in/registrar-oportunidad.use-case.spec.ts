import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type {
  OfferOpportunityRepository,
  OportunidadSnapshot,
} from '../ports-out/offer-opportunity-repository.port';
import {
  RegistrarOportunidadUseCase,
  type RegistrarOportunidadInput,
} from './registrar-oportunidad.use-case';

// design.md Diagrama 1 (D2 + D5 + R5), tasks.md 4a.3/4a.4 — the internal use
// case `MatchEncontradoListener` calls, never reachable via HTTP (no route
// anywhere names it, design.md D-E). `runInTransaction` (D5/D13) wraps
// EXACTLY ONE `reemplazar(snapshot, tx)` call: the writer's 5-statement
// order-is-not-commutative mechanic already lives entirely inside
// `KyselyOfferOpportunityRepository.reemplazar` (PR3b) — this use case's
// only job is to translate the listener's input into a snapshot and hand it
// to the repository inside a transaction, never to reimplement any part of
// the 5-statement mechanic itself.
//
// `companyIds: []` still calls `reemplazar` (core-api-ofertas spec "A
// MatchEncontrado with companyIds: [] still writes the header", D2/D5) — the
// use case must never short-circuit on an empty array. Suppressing the call
// would mean "buscamos y no hay nadie" (a fact `refill-matching` owns) never
// reaches the projection at all.

const fakeTx = {} as TransactionContext;

function buildOpportunityRepository(): jest.Mocked<OfferOpportunityRepository> {
  return {
    reemplazar: jest.fn().mockResolvedValue(undefined),
    findElegible: jest.fn(),
    listarPorCompany: jest.fn(),
    existeRelacion: jest.fn(),
    cerrar: jest.fn(),
  };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function buildUseCase() {
  const opportunityRepository = buildOpportunityRepository();
  const transactionManager = buildTransactionManager();
  const useCase = new RegistrarOportunidadUseCase(opportunityRepository, transactionManager);
  return { opportunityRepository, transactionManager, useCase };
}

const baseInput: RegistrarOportunidadInput = {
  refillRequestId: 'refill-request-a',
  userId: 'user-a',
  comuna: 'Providencia',
  urgencia: 'hoy',
  companyIds: ['company-a', 'company-b'],
  items: [
    {
      refillItemId: 'refill-item-a',
      nombre: 'Alimento perro',
      categoria: 'alimento',
      precioReferencia: 12990,
      catalogProductId: 'catalog-product-a',
    },
    {
      refillItemId: 'refill-item-b',
      nombre: 'Arena para gato',
      categoria: 'higiene',
      precioReferencia: 5990,
      catalogProductId: null,
    },
  ],
};

describe('RegistrarOportunidadUseCase', () => {
  describe('runInTransaction wraps exactly 1 reemplazar(snapshot, tx) call, snapshot built 1:1 from the input (design.md D5/D13, tasks.md 4a.3)', () => {
    it('calls transactionManager.runInTransaction exactly once', async () => {
      const { transactionManager, useCase } = buildUseCase();

      await useCase.execute(baseInput);

      expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
    });

    it('calls opportunityRepository.reemplazar exactly once, with the tx handed by runInTransaction', async () => {
      const { opportunityRepository, useCase } = buildUseCase();

      await useCase.execute(baseInput);

      expect(opportunityRepository.reemplazar).toHaveBeenCalledTimes(1);
      const [, tx] = opportunityRepository.reemplazar.mock.calls[0] as [
        OportunidadSnapshot,
        TransactionContext,
      ];
      expect(tx).toBe(fakeTx);
    });

    it('builds the snapshot 1:1 from the input — same refillRequestId/userId/comuna/urgencia/companyIds/items, no adaptation', async () => {
      const { opportunityRepository, useCase } = buildUseCase();

      await useCase.execute(baseInput);

      const [snapshot] = opportunityRepository.reemplazar.mock.calls[0] as [
        OportunidadSnapshot,
        TransactionContext,
      ];
      expect(snapshot).toEqual({
        refillRequestId: baseInput.refillRequestId,
        userId: baseInput.userId,
        comuna: baseInput.comuna,
        urgencia: baseInput.urgencia,
        companyIds: baseInput.companyIds,
        items: baseInput.items,
      });
    });
  });

  describe("companyIds: [] still calls reemplazar — never suppressed (core-api-ofertas 'A MatchEncontrado with companyIds: [] still writes the header', D2/D5)", () => {
    it('calls reemplazar with an empty companyIds array, exactly once', async () => {
      const { opportunityRepository, useCase } = buildUseCase();
      const zeroMatchInput: RegistrarOportunidadInput = { ...baseInput, companyIds: [] };

      await useCase.execute(zeroMatchInput);

      expect(opportunityRepository.reemplazar).toHaveBeenCalledTimes(1);
      const [snapshot] = opportunityRepository.reemplazar.mock.calls[0] as [
        OportunidadSnapshot,
        TransactionContext,
      ];
      expect(snapshot.companyIds).toEqual([]);
    });
  });

  describe('constructor injects TRANSACTION_MANAGER (design.md D13 — one of the 4 write use cases)', () => {
    it('accepts an OfferOpportunityRepository and a TransactionManager as its only 2 constructor dependencies', () => {
      const { opportunityRepository, transactionManager } = buildUseCase();

      expect(
        () => new RegistrarOportunidadUseCase(opportunityRepository, transactionManager),
      ).not.toThrow();
    });
  });
});
