import type { CatalogProduct } from '@repon/types';
import type { CatalogProductRepository } from '../ports-out/catalog-product-repository.port';
import { BuscarProductosUseCase } from './buscar-productos.use-case';

// core-api-catalogo spec, "buscarProductos reads the shared reference
// catalog, with no company dimension" — Scenario "Happy path search":
// a pure passthrough to CatalogProductRepository.buscar, no company filter
// applied anywhere in this use case (its own `execute` signature carries no
// companyId parameter at all, matching D-E: "buscarProductos no lo recibe").

function buildRepository(): jest.Mocked<CatalogProductRepository> {
  return { buscar: jest.fn() };
}

describe('BuscarProductosUseCase', () => {
  it('delegates to CatalogProductRepository.buscar with the query and optional categoria', async () => {
    const repository = buildRepository();
    const products: CatalogProduct[] = [
      { id: 'p1', nombre: 'Detergente Ropa', categoria: 'Limpieza', status: 'activo' },
    ];
    repository.buscar.mockResolvedValueOnce(products);
    const useCase = new BuscarProductosUseCase(repository);

    const result = await useCase.execute('detergente', 'Limpieza');

    expect(repository.buscar).toHaveBeenCalledWith('detergente', 'Limpieza');
    expect(result).toBe(products);
  });

  it('works with no categoria filter', async () => {
    const repository = buildRepository();
    repository.buscar.mockResolvedValueOnce([]);
    const useCase = new BuscarProductosUseCase(repository);

    await useCase.execute('detergente');

    expect(repository.buscar).toHaveBeenCalledWith('detergente', undefined);
  });
});
