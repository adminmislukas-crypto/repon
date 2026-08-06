import type { ProviderCatalogItem } from '@repon/types';
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
    it('a cross-tenant item (belongs to company B, requested by company A) throws CatalogItemNotFoundError, never a 403-shaped error, and never mutates', async () => {
      const catalogRepository = buildRepository();
      catalogRepository.findById.mockResolvedValue(itemDeCompanyB);
      const useCase = new ActualizarPrecioUseCase(catalogRepository);

      await expect(useCase.execute('company-a', 'activo', 'item-1', 100, 150)).rejects.toThrow(
        CatalogItemNotFoundError,
      );

      expect(catalogRepository.save).not.toHaveBeenCalled();
    });

    it('a genuinely missing item throws the SAME CatalogItemNotFoundError and never mutates', async () => {
      const catalogRepository = buildRepository();
      catalogRepository.findById.mockResolvedValue(null);
      const useCase = new ActualizarPrecioUseCase(catalogRepository);

      await expect(
        useCase.execute('company-a', 'activo', 'missing-item', 100, 150),
      ).rejects.toThrow(CatalogItemNotFoundError);

      expect(catalogRepository.save).not.toHaveBeenCalled();
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
      const notFoundError = await captureError(new ActualizarPrecioUseCase(notFoundRepo));
      const crossTenantError = await captureError(new ActualizarPrecioUseCase(crossTenantRepo));

      expect(notFoundError).toBeInstanceOf(CatalogItemNotFoundError);
      expect(crossTenantError).toBeInstanceOf(CatalogItemNotFoundError);
      expect(notFoundError.constructor).toBe(crossTenantError.constructor);
      expect(notFoundError.message).toBe(crossTenantError.message);
    });
  });

  describe('EmpresaNoActivaError gate', () => {
    it('rejects before any repository call when companyStatus is not activo', async () => {
      const catalogRepository = buildRepository();
      const useCase = new ActualizarPrecioUseCase(catalogRepository);

      await expect(useCase.execute('company-a', 'suspendido', 'item-1', 100, 150)).rejects.toThrow(
        EmpresaNoActivaError,
      );

      expect(catalogRepository.findById).not.toHaveBeenCalled();
      expect(catalogRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('happy path — owner updates their own item', () => {
    it("updates the item's price and persists via save when the actor owns it", async () => {
      const catalogRepository = buildRepository();
      const ownItem: ProviderCatalogItem = { ...itemDeCompanyB, companyId: 'company-a' };
      catalogRepository.findById.mockResolvedValue(ownItem);
      const useCase = new ActualizarPrecioUseCase(catalogRepository);

      const result = await useCase.execute('company-a', 'activo', 'item-1', 200, 300);

      expect(result).toMatchObject({ precioBase: 200, precioMaximo: 300 });
      expect(catalogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'item-1', precioBase: 200, precioMaximo: 300 }),
      );
    });

    it('delegates the price invariant to the entity — an invalid pair rejects with PrecioInvalidoError and never calls save', async () => {
      const catalogRepository = buildRepository();
      const ownItem: ProviderCatalogItem = { ...itemDeCompanyB, companyId: 'company-a' };
      catalogRepository.findById.mockResolvedValue(ownItem);
      const useCase = new ActualizarPrecioUseCase(catalogRepository);

      await expect(useCase.execute('company-a', 'activo', 'item-1', 300, 200)).rejects.toThrow(
        PrecioInvalidoError,
      );

      expect(catalogRepository.save).not.toHaveBeenCalled();
    });
  });
});
