import type { CatalogVisibilityProjection } from '../ports-out/catalog-visibility-projection.port';
import { RestaurarCatalogoEmpresaUseCase } from './restaurar-catalogo-empresa.use-case';

// design.md D-A: `RestaurarCatalogoEmpresaUseCase` is the shared handler
// for BOTH `empresa.reactivada` and `empresa.aprobada` (Diagram 2's
// "MISMO handler" note) — an internal maintenance operation, no HTTP route,
// no controller. A thin pass-through to
// `CatalogVisibilityProjection.mostrarEmpresa`, mocked here. The
// 0-rows-affected case (a company that was never hidden) is the
// projection adapter's own concern (`kysely-catalog-visibility.projection
// .spec.ts`) — from this use case's perspective it is just "success",
// nothing to assert differently here.

function buildProjection(): jest.Mocked<CatalogVisibilityProjection> {
  return { ocultarEmpresa: jest.fn(), mostrarEmpresa: jest.fn() };
}

describe('RestaurarCatalogoEmpresaUseCase', () => {
  it('delegates to CatalogVisibilityProjection.mostrarEmpresa with companyId', async () => {
    const projection = buildProjection();
    const useCase = new RestaurarCatalogoEmpresaUseCase(projection);

    await useCase.execute('company-a');

    expect(projection.mostrarEmpresa).toHaveBeenCalledWith('company-a');
    expect(projection.ocultarEmpresa).not.toHaveBeenCalled();
  });
});
