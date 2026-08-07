import type { CatalogVisibilityProjection } from '../ports-out/catalog-visibility-projection.port';
import { OcultarCatalogoEmpresaUseCase } from './ocultar-catalogo-empresa.use-case';

// design.md D-A: `OcultarCatalogoEmpresaUseCase` is an internal maintenance
// operation — no HTTP route, no controller, ever. Its ONLY caller is
// `CompanyVisibilityListener` (Phase 8a), reacting to `empresa.suspendida`.
// A thin pass-through to `CatalogVisibilityProjection.ocultarEmpresa`,
// mocked here — the real Kysely-backed implementation is
// `KyselyCatalogVisibilityProjection`'s own spec, not this one's.

function buildProjection(): jest.Mocked<CatalogVisibilityProjection> {
  return { ocultarEmpresa: jest.fn(), mostrarEmpresa: jest.fn() };
}

describe('OcultarCatalogoEmpresaUseCase', () => {
  it('delegates to CatalogVisibilityProjection.ocultarEmpresa with companyId and motivo', async () => {
    const projection = buildProjection();
    const useCase = new OcultarCatalogoEmpresaUseCase(projection);

    await useCase.execute('company-a', 'Pago vencido');

    expect(projection.ocultarEmpresa).toHaveBeenCalledWith('company-a', 'Pago vencido');
    expect(projection.mostrarEmpresa).not.toHaveBeenCalled();
  });

  it('forwards a null motivo unchanged (the listener already normalizes an absent motivo to null)', async () => {
    const projection = buildProjection();
    const useCase = new OcultarCatalogoEmpresaUseCase(projection);

    await useCase.execute('company-a', null);

    expect(projection.ocultarEmpresa).toHaveBeenCalledWith('company-a', null);
  });
});
