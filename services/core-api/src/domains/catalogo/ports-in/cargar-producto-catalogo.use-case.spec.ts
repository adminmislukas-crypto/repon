import type { NuevoProductoProveedor } from '@repon/types';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import { EmpresaNoActivaError } from '../domain/catalogo.errors';
import type { CatalogRepository } from '../ports-out/catalog-repository.port';
import { CargarProductoCatalogoUseCase } from './cargar-producto-catalogo.use-case';

// core-api-catalogo spec: "cargarProductoCatalogo scopes the new item to
// the actor's company" (Scenarios "Provider loads their own product" / "A
// client-supplied companyId cannot influence the write") + "The 4 mutating
// use cases require an active company" (Scenario "A suspended company
// cannot write to its own catalog"). `companyId`/`companyStatus` arrive as
// explicit scalar params (D8/D-E) — this use case never re-derives them
// from `producto`, which has no `companyId` field to trust in the first
// place.

function buildDeps() {
  const catalogRepository: jest.Mocked<CatalogRepository> = {
    save: jest.fn().mockResolvedValue(undefined),
    saveMany: jest.fn(),
    findById: jest.fn(),
    findByCompany: jest.fn(),
    findByCompanyAndCategoria: jest.fn(),
    findMatching: jest.fn(),
  };
  const eventPublisher: jest.Mocked<EventPublisher> = {
    publish: jest.fn().mockResolvedValue(undefined),
  };
  const useCase = new CargarProductoCatalogoUseCase(catalogRepository, eventPublisher);
  return { catalogRepository, eventPublisher, useCase };
}

const producto: NuevoProductoProveedor = {
  nombre: 'Agua Purificada',
  categoria: 'Bebidas',
  precioBase: 1000,
  precioMaximo: 1500,
  stock: 10,
  disponible: true,
};

describe('CargarProductoCatalogoUseCase', () => {
  it('creates a ProviderCatalogItem scoped to companyId=A, persists it, and publishes exactly one ProductoAgregado', async () => {
    const { catalogRepository, eventPublisher, useCase } = buildDeps();

    const result = await useCase.execute('company-a', 'activo', producto);

    expect(result).toMatchObject({
      companyId: 'company-a',
      nombre: 'Agua Purificada',
      precioBase: 1000,
      precioMaximo: 1500,
    });
    expect(catalogRepository.save).toHaveBeenCalledTimes(1);
    expect(catalogRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-a' }),
    );
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'producto.agregado', companyId: 'company-a' }),
    );
  });

  it('derives companyId exclusively from the explicit companyId param, never from producto (D8)', async () => {
    const { catalogRepository, useCase } = buildDeps();

    await useCase.execute('company-b', 'activo', producto);

    expect(catalogRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-b' }),
    );
  });

  it('rejects with EmpresaNoActivaError before any repository call when companyStatus is suspendido', async () => {
    const { catalogRepository, eventPublisher, useCase } = buildDeps();

    await expect(useCase.execute('company-a', 'suspendido', producto)).rejects.toThrow(
      EmpresaNoActivaError,
    );

    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('rejects with EmpresaNoActivaError before any repository call when companyStatus is pendiente', async () => {
    const { catalogRepository, eventPublisher, useCase } = buildDeps();

    await expect(useCase.execute('company-a', 'pendiente', producto)).rejects.toThrow(
      EmpresaNoActivaError,
    );

    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });
});
