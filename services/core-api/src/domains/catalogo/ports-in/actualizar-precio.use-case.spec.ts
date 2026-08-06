import type { ProviderCatalogItem } from '@repon/types';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import {
  CatalogItemNotFoundError,
  EmpresaNoActivaError,
  PrecioInvalidoError,
} from '../domain/catalogo.errors';
import type { CatalogRepository } from '../ports-out/catalog-repository.port';
import { ActualizarPrecioUseCase } from './actualizar-precio.use-case';

// core-api-catalogo spec: "actualizarPrecio is scoped to the caller's own
// company; cross-tenant access is a 404" — THE scenario this PR closes
// (R1, design.md Diagram 3). A cross-tenant item and a genuinely missing
// item MUST throw the exact same error, constructed the exact same way —
// no 403-shaped distinction, no mutation in either branch.
//
// PR4b gap-close (flagged explicitly in PR4a's own apply-progress notes):
// this use case did NOT publish `PrecioActualizado` before this batch.
// Every test below now also asserts the publish behavior — exactly once on
// success, never on any rejection path (D3, "Per-item events never fire
// during batch operations" generalizes to "never fire on a rejected call").

function buildRepository(): jest.Mocked<CatalogRepository> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    saveMany: jest.fn(),
    findById: jest.fn(),
    findByCompany: jest.fn(),
    findByCompanyAndCategoria: jest.fn(),
    findMatching: jest.fn(),
  };
}

function buildEventPublisher(): jest.Mocked<EventPublisher> {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

const itemDeCompanyB: ProviderCatalogItem = {
  id: 'item-1',
  companyId: 'company-b',
  nombre: 'Agua Purificada',
  categoria: 'Bebidas',
  precioBase: 1000,
  precioMaximo: 1500,
  stock: 10,
  disponible: true,
};

describe('ActualizarPrecioUseCase', () => {
  describe('cross-tenant / not-found — byte-identical rejection (R1)', () => {
    it('a cross-tenant item (belongs to company B, requested by company A) throws CatalogItemNotFoundError, never a 403-shaped error, and never mutates or publishes', async () => {
      const catalogRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      catalogRepository.findById.mockResolvedValue(itemDeCompanyB);
      const useCase = new ActualizarPrecioUseCase(catalogRepository, eventPublisher);

      await expect(useCase.execute('company-a', 'activo', 'item-1', 100, 150)).rejects.toThrow(
        CatalogItemNotFoundError,
      );

      expect(catalogRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('a genuinely missing item throws the SAME CatalogItemNotFoundError and never mutates or publishes', async () => {
      const catalogRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      catalogRepository.findById.mockResolvedValue(null);
      const useCase = new ActualizarPrecioUseCase(catalogRepository, eventPublisher);

      await expect(
        useCase.execute('company-a', 'activo', 'missing-item', 100, 150),
      ).rejects.toThrow(CatalogItemNotFoundError);

      expect(catalogRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });

    it('both branches produce byte-identical errors — no distinguishing information leaks cross-tenant existence (D7)', async () => {
      const notFoundRepo = buildRepository();
      notFoundRepo.findById.mockResolvedValue(null);
      const crossTenantRepo = buildRepository();
      crossTenantRepo.findById.mockResolvedValue(itemDeCompanyB);

      const captureError = async (useCase: ActualizarPrecioUseCase): Promise<Error> => {
        try {
          await useCase.execute('company-a', 'activo', 'item-1', 100, 150);
          throw new Error('expected execute() to reject, but it resolved');
        } catch (error) {
          return error as Error;
        }
      };
      const notFoundError = await captureError(
        new ActualizarPrecioUseCase(notFoundRepo, buildEventPublisher()),
      );
      const crossTenantError = await captureError(
        new ActualizarPrecioUseCase(crossTenantRepo, buildEventPublisher()),
      );

      expect(notFoundError).toBeInstanceOf(CatalogItemNotFoundError);
      expect(crossTenantError).toBeInstanceOf(CatalogItemNotFoundError);
      expect(notFoundError.constructor).toBe(crossTenantError.constructor);
      expect(notFoundError.message).toBe(crossTenantError.message);
    });
  });

  describe('EmpresaNoActivaError gate', () => {
    it('rejects before any repository call when companyStatus is not activo, and never publishes', async () => {
      const catalogRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const useCase = new ActualizarPrecioUseCase(catalogRepository, eventPublisher);

      await expect(useCase.execute('company-a', 'suspendido', 'item-1', 100, 150)).rejects.toThrow(
        EmpresaNoActivaError,
      );

      expect(catalogRepository.findById).not.toHaveBeenCalled();
      expect(catalogRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('happy path — owner updates their own item', () => {
    it("updates the item's price, persists via save, and publishes exactly one PrecioActualizado when the actor owns it", async () => {
      const catalogRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const ownItem: ProviderCatalogItem = { ...itemDeCompanyB, companyId: 'company-a' };
      catalogRepository.findById.mockResolvedValue(ownItem);
      const useCase = new ActualizarPrecioUseCase(catalogRepository, eventPublisher);

      const result = await useCase.execute('company-a', 'activo', 'item-1', 200, 300);

      expect(result).toMatchObject({ precioBase: 200, precioMaximo: 300 });
      expect(catalogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'item-1', precioBase: 200, precioMaximo: 300 }),
      );
      expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'catalogo.precio_actualizado',
          companyId: 'company-a',
          itemId: 'item-1',
        }),
      );
    });

    it('delegates the price invariant to the entity — an invalid pair rejects with PrecioInvalidoError, never calls save, and never publishes', async () => {
      const catalogRepository = buildRepository();
      const eventPublisher = buildEventPublisher();
      const ownItem: ProviderCatalogItem = { ...itemDeCompanyB, companyId: 'company-a' };
      catalogRepository.findById.mockResolvedValue(ownItem);
      const useCase = new ActualizarPrecioUseCase(catalogRepository, eventPublisher);

      await expect(useCase.execute('company-a', 'activo', 'item-1', 300, 200)).rejects.toThrow(
        PrecioInvalidoError,
      );

      expect(catalogRepository.save).not.toHaveBeenCalled();
      expect(eventPublisher.publish).not.toHaveBeenCalled();
    });
  });
});
