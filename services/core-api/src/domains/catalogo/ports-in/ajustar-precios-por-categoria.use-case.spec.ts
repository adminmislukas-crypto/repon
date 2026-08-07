import type { ProviderCatalogItem } from '@repon/types';
import type { TransactionContext, TransactionManager } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import { EmpresaNoActivaError, PorcentajeInvalidoError } from '../domain/catalogo.errors';
import type { CatalogRepository } from '../ports-out/catalog-repository.port';
import { AjustarPreciosPorCategoriaUseCase } from './ajustar-precios-por-categoria.use-case';

// core-api-catalogo spec, "ajustarPreciosPorCategoria scales both price
// bounds and preserves the price invariant" + "ajustarPreciosPorCategoria
// emits exactly one summary event". design.md "Mapa de transacciones": this
// is the FIRST use case in this domain that DOES wrap `runInTransaction` —
// `tx` must propagate to BOTH `findByCompanyAndCategoria` (the read) AND
// `saveMany` (the write), and `porcentaje <= -100` must be rejected before
// EITHER of those repository calls happens (not just before the write).

const fakeTx = {} as TransactionContext;

function buildRepository(): jest.Mocked<CatalogRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    saveMany: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findByCompany: jest.fn(),
    findByCompanyAndCategoria: jest.fn().mockResolvedValue([]),
    findMatching: jest.fn(),
  };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function buildTransactionManager(): jest.Mocked<TransactionManager> {
  return { runInTransaction: jest.fn().mockImplementation((work) => work(fakeTx)) };
}

function item(overrides: Partial<ProviderCatalogItem> = {}): ProviderCatalogItem {
  return {
    id: 'item-1',
    companyId: 'company-a',
    nombre: 'Agua Purificada',
    categoria: 'Limpieza',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

function buildUseCase() {
  const catalogRepository = buildRepository();
  const eventPublisher = buildEventPublisher();
  const transactionManager = buildTransactionManager();
  const useCase = new AjustarPreciosPorCategoriaUseCase(
    catalogRepository,
    eventPublisher,
    transactionManager,
  );
  return { catalogRepository, eventPublisher, transactionManager, useCase };
}

describe('AjustarPreciosPorCategoriaUseCase', () => {
  describe('EmpresaNoActivaError gate (D-E, checked first)', () => {
    it('rejects before the transaction, the repository, or the publisher are ever touched', async () => {
      const { catalogRepository, eventPublisher, transactionManager, useCase } = buildUseCase();

      await expect(useCase.execute('company-a', 'suspendido', 'Limpieza', 10)).rejects.toThrow(
        EmpresaNoActivaError,
      );

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalled();
      expect(catalogRepository.saveMany).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('porcentaje <= -100 gate — rejected before touching the database', () => {
    it('rejects porcentaje === -100 without ever opening the transaction or calling the repository (no read, no write)', async () => {
      const { catalogRepository, eventPublisher, transactionManager, useCase } = buildUseCase();

      await expect(useCase.execute('company-a', 'activo', 'Limpieza', -100)).rejects.toThrow(
        PorcentajeInvalidoError,
      );

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalled();
      expect(catalogRepository.saveMany).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('rejects a more negative porcentaje (-150) the same way', async () => {
      const { catalogRepository, transactionManager, useCase } = buildUseCase();

      await expect(useCase.execute('company-a', 'activo', 'Limpieza', -150)).rejects.toThrow(
        PorcentajeInvalidoError,
      );

      expect(transactionManager.runInTransaction).not.toHaveBeenCalled();
      expect(catalogRepository.findByCompanyAndCategoria).not.toHaveBeenCalled();
    });
  });

  describe('happy path — both bounds scale proportionally (exact spec.md numbers)', () => {
    it('1000/1500 @ 10% becomes 1100/1650, preserving the invariant by construction', async () => {
      const { catalogRepository, eventPublisher, useCase } = buildUseCase();
      catalogRepository.findByCompanyAndCategoria.mockResolvedValue([
        item({ precioBase: 1000, precioMaximo: 1500 }),
      ]);

      await useCase.execute('company-a', 'activo', 'Limpieza', 10);

      expect(catalogRepository.saveMany).toHaveBeenCalledWith(
        [expect.objectContaining({ precioBase: 1100, precioMaximo: 1650 })],
        fakeTx,
      );
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'catalogo.precios_categoria_ajustados',
          companyId: 'company-a',
          categoria: 'Limpieza',
          porcentaje: 10,
          totalActualizados: 1,
        }),
      );
    });
  });

  describe('transactional wiring — runInTransaction wraps BOTH the read and the write', () => {
    it('propagates the SAME tx to findByCompanyAndCategoria and to saveMany', async () => {
      const { catalogRepository, transactionManager, useCase } = buildUseCase();
      catalogRepository.findByCompanyAndCategoria.mockResolvedValue([item()]);

      await useCase.execute('company-a', 'activo', 'Limpieza', 10);

      expect(transactionManager.runInTransaction).toHaveBeenCalledTimes(1);
      expect(catalogRepository.findByCompanyAndCategoria).toHaveBeenCalledWith(
        'company-a',
        'Limpieza',
        fakeTx,
      );
      expect(catalogRepository.saveMany).toHaveBeenCalledWith(expect.any(Array), fakeTx);
    });

    it('derives companyId from the explicit param (never from an item) and scopes the read to it + the given categoria', async () => {
      const { catalogRepository, useCase } = buildUseCase();
      catalogRepository.findByCompanyAndCategoria.mockResolvedValue([]);

      await useCase.execute('company-a', 'activo', 'Limpieza', 10);

      expect(catalogRepository.findByCompanyAndCategoria).toHaveBeenCalledWith(
        'company-a',
        'Limpieza',
        fakeTx,
      );
    });
  });

  describe('exactly one PreciosCategoriaAjustados, regardless of match count', () => {
    it('publishes with totalActualizados: 0 when zero items match — never zero events, never an error', async () => {
      const { catalogRepository, eventPublisher, useCase } = buildUseCase();
      catalogRepository.findByCompanyAndCategoria.mockResolvedValue([]);

      await useCase.execute('company-a', 'activo', 'Limpieza', 10);

      expect(catalogRepository.saveMany).toHaveBeenCalledWith([], fakeTx);
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ totalActualizados: 0 }),
      );
    });

    it('publishes exactly once for 40 matching items, with totalActualizados: 40', async () => {
      const { catalogRepository, eventPublisher, useCase } = buildUseCase();
      const items = Array.from({ length: 40 }, (_, i) => item({ id: `item-${i}` }));
      catalogRepository.findByCompanyAndCategoria.mockResolvedValue(items);

      await useCase.execute('company-a', 'activo', 'Limpieza', 10);

      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ totalActualizados: 40 }),
      );
    });
  });
});
