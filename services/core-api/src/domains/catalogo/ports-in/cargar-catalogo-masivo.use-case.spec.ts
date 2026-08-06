import type { ArchivoCarga, FilaCarga, NuevoProductoProveedor } from '@repon/types';
import { TRANSACTION_MANAGER } from '../../../shared/database/transaction';
import type { EventPublisher } from '../../../shared/event-bus/event-publisher.port';
import { EmpresaNoActivaError } from '../domain/catalogo.errors';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports-out/catalog-repository.port';
import { EVENT_PUBLISHER } from '../../../shared/event-bus/event-publisher.port';
import { CargarCatalogoMasivoUseCase } from './cargar-catalogo-masivo.use-case';

// core-api-catalogo spec: "cargarCatalogoMasivo processes rows independently
// and reports partial failure" + "cargarCatalogoMasivo emits exactly one
// summary event" + "The 4 mutating use cases require an active company".
// design.md Diagram 1 (D2): NO wrapping transaction — this use case must
// never even be GIVEN a `TransactionManager` to inject, a structural
// guarantee proven below, not just "nobody happens to call
// runInTransaction at runtime".

// NestJS stores every `@Inject(TOKEN)`-decorated constructor parameter's
// token under this Reflect metadata key (`SELF_DECLARED_DEPS_METADATA` in
// `@nestjs/common/constants.ts`). Hardcoded here — matching the string
// literal exactly — rather than importing the package's internal subpath,
// to keep this test decoupled from an undocumented Nest internal import
// path while still proving the real DI wiring structurally.
const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

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
  const useCase = new CargarCatalogoMasivoUseCase(catalogRepository, eventPublisher);
  return { catalogRepository, eventPublisher, useCase };
}

function producto(overrides: Partial<NuevoProductoProveedor> = {}): NuevoProductoProveedor {
  return {
    nombre: 'Agua Purificada',
    categoria: 'Bebidas',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

function fila(numero: number, overrides: Partial<NuevoProductoProveedor> = {}): FilaCarga {
  return { numero, producto: producto({ nombre: `Producto ${numero}`, ...overrides }) };
}

function archivo(filas: FilaCarga[]): ArchivoCarga {
  return { filas };
}

describe('CargarCatalogoMasivoUseCase', () => {
  it('constructor never injects TRANSACTION_MANAGER (D2: no wrapping transaction — a structural guarantee)', () => {
    const injectedTokens: Array<{ index: number; param: unknown }> =
      Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, CargarCatalogoMasivoUseCase) ?? [];

    expect(injectedTokens).toHaveLength(2);
    const tokens = injectedTokens.map((dep) => dep.param);
    expect(tokens).not.toContain(TRANSACTION_MANAGER);
    expect(tokens).toEqual(expect.arrayContaining([CATALOG_REPOSITORY, EVENT_PUBLISHER]));
  });

  it('rejects with EmpresaNoActivaError before touching any row when companyStatus is suspendido', async () => {
    const { catalogRepository, eventPublisher, useCase } = buildDeps();

    await expect(useCase.execute('company-a', 'suspendido', archivo([fila(1)]))).rejects.toThrow(
      EmpresaNoActivaError,
    );

    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('rejects with EmpresaNoActivaError before touching any row when companyStatus is pendiente', async () => {
    const { catalogRepository, eventPublisher, useCase } = buildDeps();

    await expect(useCase.execute('company-a', 'pendiente', archivo([fila(1)]))).rejects.toThrow(
      EmpresaNoActivaError,
    );

    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).not.toHaveBeenCalled();
  });

  it('persists every valid row scoped to companyId=A, regardless of any reference inside the file', async () => {
    const { catalogRepository, useCase } = buildDeps();

    await useCase.execute('company-a', 'activo', archivo([fila(1), fila(2)]));

    expect(catalogRepository.save).toHaveBeenCalledTimes(2);
    expect(catalogRepository.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ companyId: 'company-a' }),
    );
    expect(catalogRepository.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ companyId: 'company-a' }),
    );
  });

  it('reports N-M successes and M individually identifiable failures for a mix of valid/invalid rows, without aborting the batch', async () => {
    const { catalogRepository, useCase } = buildDeps();
    const archivoConFilas = archivo([
      fila(1),
      fila(2, { nombre: '' }), // invalid: empty nombre -> ProductoInvalidoError
      fila(3),
      fila(4, { precioBase: NaN }), // invalid: non-finite price (parser's Number() cast output)
      fila(5),
    ]);

    const resultado = await useCase.execute('company-a', 'activo', archivoConFilas);

    expect(resultado.totalFilas).toBe(5);
    expect(resultado.totalCargados).toBe(3);
    expect(resultado.totalFallidos).toBe(2);
    expect(resultado.fallos).toEqual([
      { numero: 2, motivo: expect.any(String) },
      { numero: 4, motivo: expect.any(String) },
    ]);
    expect(catalogRepository.save).toHaveBeenCalledTimes(3);
  });

  it('reports a save() rejection as a fallos entry, without aborting remaining rows', async () => {
    const { catalogRepository, useCase } = buildDeps();
    catalogRepository.save
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValue(undefined);

    const resultado = await useCase.execute('company-a', 'activo', archivo([fila(1), fila(2)]));

    expect(resultado.totalCargados).toBe(1);
    expect(resultado.totalFallidos).toBe(1);
    expect(resultado.fallos).toEqual([{ numero: 1, motivo: 'constraint violation' }]);
  });

  it('rejects the 2nd row sharing the same catalogProductId within the file as a duplicate, not a merge/update', async () => {
    const { catalogRepository, useCase } = buildDeps();
    const archivoConFilas = archivo([
      fila(1, { catalogProductId: 'cp-1' }),
      fila(2, { catalogProductId: 'cp-1', nombre: 'Descripción distinta' }),
    ]);

    const resultado = await useCase.execute('company-a', 'activo', archivoConFilas);

    expect(resultado.totalCargados).toBe(1);
    expect(resultado.totalFallidos).toBe(1);
    expect(resultado.fallos).toEqual([{ numero: 2, motivo: expect.any(String) }]);
    expect(catalogRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects the 2nd row sharing the same nombre+categoria (case/whitespace-insensitive) when catalogProductId is absent', async () => {
    const { catalogRepository, useCase } = buildDeps();
    const archivoConFilas = archivo([
      fila(1, { nombre: 'Agua Purificada', categoria: 'Bebidas' }),
      fila(2, { nombre: '  agua purificada  ', categoria: 'BEBIDAS' }),
    ]);

    const resultado = await useCase.execute('company-a', 'activo', archivoConFilas);

    expect(resultado.totalCargados).toBe(1);
    expect(resultado.totalFallidos).toBe(1);
    expect(resultado.fallos).toEqual([{ numero: 2, motivo: expect.any(String) }]);
    expect(catalogRepository.save).toHaveBeenCalledTimes(1);
  });

  it('does NOT treat two rows as duplicates when only nombre matches but categoria differs (or vice versa)', async () => {
    const { catalogRepository, useCase } = buildDeps();
    const archivoConFilas = archivo([
      fila(1, { nombre: 'Agua Purificada', categoria: 'Bebidas' }),
      fila(2, { nombre: 'Agua Purificada', categoria: 'Limpieza' }),
    ]);

    const resultado = await useCase.execute('company-a', 'activo', archivoConFilas);

    expect(resultado.totalCargados).toBe(2);
    expect(resultado.totalFallidos).toBe(0);
    expect(catalogRepository.save).toHaveBeenCalledTimes(2);
  });

  it('publishes exactly one CatalogoCargaMasivaCompletada with the correct totals, for a mixed outcome', async () => {
    const { eventPublisher, useCase } = buildDeps();
    const archivoConFilas = archivo([fila(1), fila(2, { nombre: '' }), fila(3)]);

    await useCase.execute('company-a', 'activo', archivoConFilas);

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'catalogo.carga_masiva_completada',
        companyId: 'company-a',
        totalCargados: 2,
        totalFallidos: 1,
      }),
    );
  });

  it('publishes exactly one CatalogoCargaMasivaCompletada even when every row fails (totalCargados = 0)', async () => {
    const { catalogRepository, eventPublisher, useCase } = buildDeps();
    const archivoConFilas = archivo([fila(1, { nombre: '' }), fila(2, { stock: -1 })]);

    const resultado = await useCase.execute('company-a', 'activo', archivoConFilas);

    expect(resultado.totalCargados).toBe(0);
    expect(resultado.totalFallidos).toBe(2);
    expect(catalogRepository.save).not.toHaveBeenCalled();
    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ totalCargados: 0, totalFallidos: 2 }),
    );
  });

  it('never publishes a per-item ProductoAgregado — only the single summary event (D3)', async () => {
    const { eventPublisher, useCase } = buildDeps();

    await useCase.execute('company-a', 'activo', archivo([fila(1), fila(2), fila(3)]));

    expect(eventPublisher.publish).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'producto.agregado' }),
    );
  });
});
