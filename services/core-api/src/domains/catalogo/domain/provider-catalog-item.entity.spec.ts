import type { NuevoProductoProveedor, ProviderCatalogItem } from '@repon/types';
import { PrecioInvalidoError, ProductoInvalidoError } from './catalogo.errors';
import { actualizarPrecio, aplicarPorcentaje, crear } from './provider-catalog-item.entity';

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '22222222-2222-2222-2222-222222222222';

function nuevoProducto(overrides: Partial<NuevoProductoProveedor> = {}): NuevoProductoProveedor {
  return {
    nombre: 'Alimento Premium 3Kg',
    categoria: 'alimentos',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
    ...overrides,
  };
}

function item(overrides: Partial<ProviderCatalogItem> = {}): ProviderCatalogItem {
  return {
    id: ITEM_ID,
    companyId: COMPANY_ID,
    nombre: 'Alimento Premium 3Kg',
    categoria: 'alimentos',
    precioBase: 1000,
    precioMaximo: 1500,
    stock: 10,
    disponible: true,
    ...overrides,
  };
}

// core-api-catalogo spec, D-C: the price invariant (precioMaximo >=
// precioBase) is enforced BY THE ENTITY, never left to the DB CHECK.
describe('crear', () => {
  it('rejects precioMaximo < precioBase', () => {
    expect(() =>
      crear({
        id: ITEM_ID,
        companyId: COMPANY_ID,
        producto: nuevoProducto({ precioBase: 1500, precioMaximo: 1000 }),
      }),
    ).toThrow(PrecioInvalidoError);
  });

  // D-C: rounding to 2 decimals happens in the entity BEFORE validating the
  // invariant — Postgres never re-rounds what the domain already decided.
  it('rounds precioBase and precioMaximo to 2 decimals', () => {
    const producto = crear({
      id: ITEM_ID,
      companyId: COMPANY_ID,
      producto: nuevoProducto({ precioBase: 1000.567, precioMaximo: 1500.993 }),
    });

    expect(producto.precioBase).toBe(1000.57);
    expect(producto.precioMaximo).toBe(1500.99);
  });

  it('builds a ProviderCatalogItem carrying the given id and companyId, unchanged fields from the input', () => {
    const producto = crear({
      id: ITEM_ID,
      companyId: COMPANY_ID,
      producto: nuevoProducto({ catalogProductId: 'cp-1', stock: 7 }),
    });

    expect(producto).toMatchObject({
      id: ITEM_ID,
      companyId: COMPANY_ID,
      catalogProductId: 'cp-1',
      nombre: 'Alimento Premium 3Kg',
      categoria: 'alimentos',
      stock: 7,
      disponible: true,
    });
  });

  // design.md Diagram 1, step 2a (`cargarCatalogoMasivo`'s per-row
  // validation): "nombre/categoria no vacíos; precios finitos y >= 0; ...
  // stock entero >= 0". PR 3a deliberately narrowed `crear()` to only the
  // price invariant (see this file's own git history / PR 3a apply-progress
  // notes); PR 5b closes that gap HERE, in the entity, matching the
  // diagram's literal attribution rather than re-implementing the same
  // checks a second time inside `cargarCatalogoMasivoUseCase`. A malformed
  // row (e.g. `NaN` from `carga-masiva.parser.ts`'s deliberately permissive
  // `Number()` cast) must become a `ProductoInvalidoError`, not silently
  // produce a `NaN`-carrying `ProviderCatalogItem` — `NaN < x` is always
  // `false`, so without this guard `assertPrecioValido` alone would never
  // catch it.
  it('rejects an empty nombre', () => {
    expect(() =>
      crear({ id: ITEM_ID, companyId: COMPANY_ID, producto: nuevoProducto({ nombre: '' }) }),
    ).toThrow(ProductoInvalidoError);
  });

  it('rejects a whitespace-only categoria', () => {
    expect(() =>
      crear({ id: ITEM_ID, companyId: COMPANY_ID, producto: nuevoProducto({ categoria: '   ' }) }),
    ).toThrow(ProductoInvalidoError);
  });

  it('rejects a non-finite precioBase (NaN, e.g. from a malformed CSV cell)', () => {
    expect(() =>
      crear({ id: ITEM_ID, companyId: COMPANY_ID, producto: nuevoProducto({ precioBase: NaN }) }),
    ).toThrow(ProductoInvalidoError);
  });

  it('rejects a non-finite precioMaximo (Infinity)', () => {
    expect(() =>
      crear({
        id: ITEM_ID,
        companyId: COMPANY_ID,
        producto: nuevoProducto({ precioMaximo: Infinity }),
      }),
    ).toThrow(ProductoInvalidoError);
  });

  it('rejects a negative precioBase', () => {
    expect(() =>
      crear({ id: ITEM_ID, companyId: COMPANY_ID, producto: nuevoProducto({ precioBase: -1 }) }),
    ).toThrow(ProductoInvalidoError);
  });

  it('rejects a non-integer stock', () => {
    expect(() =>
      crear({ id: ITEM_ID, companyId: COMPANY_ID, producto: nuevoProducto({ stock: 1.5 }) }),
    ).toThrow(ProductoInvalidoError);
  });

  it('rejects a negative stock', () => {
    expect(() =>
      crear({ id: ITEM_ID, companyId: COMPANY_ID, producto: nuevoProducto({ stock: -1 }) }),
    ).toThrow(ProductoInvalidoError);
  });
});

describe('actualizarPrecio', () => {
  it('rejects a new precioMaximo < precioBase, leaving the original item untouched', () => {
    const original = item({ precioBase: 1000, precioMaximo: 1500 });

    expect(() => actualizarPrecio(original, 1500, 1000)).toThrow(PrecioInvalidoError);
    expect(original).toEqual(item({ precioBase: 1000, precioMaximo: 1500 }));
  });

  it('rounds the new prices to 2 decimals and validates the invariant on the rounded values', () => {
    const original = item({ precioBase: 1000, precioMaximo: 1500 });

    const actualizado = actualizarPrecio(original, 800.567, 900.993);

    expect(actualizado.precioBase).toBe(800.57);
    expect(actualizado.precioMaximo).toBe(900.99);
    // every other field is preserved
    expect(actualizado).toMatchObject({ id: ITEM_ID, companyId: COMPANY_ID, stock: 10 });
  });
});

describe('aplicarPorcentaje', () => {
  // core-api-catalogo spec, Scenario "Both bounds scale proportionally"
  it('scales both precioBase and precioMaximo by the same factor', () => {
    const original = item({ precioBase: 1000, precioMaximo: 1500 });

    const ajustado = aplicarPorcentaje(original, 10);

    expect(ajustado.precioBase).toBe(1100);
    expect(ajustado.precioMaximo).toBe(1650);
  });

  // core-api-catalogo spec, Scenario "porcentaje <= -100 is rejected before
  // touching the database". A porcentaje of exactly -100 yields a scaling
  // factor of 0, which would make precioBase = precioMaximo = 0 — a value
  // pair that would still trivially satisfy `precioMaximo >= precioBase`.
  // The explicit guard below is what proves porcentaje is checked BEFORE
  // any scaling/rounding computation, not "by accident" via the invariant.
  it('rejects porcentaje <= -100 as a validation error before any other computation', () => {
    const original = item({ precioBase: 1000, precioMaximo: 1500 });

    expect(() => aplicarPorcentaje(original, -100)).toThrow(PrecioInvalidoError);
    expect(() => aplicarPorcentaje(original, -150)).toThrow(PrecioInvalidoError);
  });

  // core-api-catalogo spec, Scenario "The CHECK constraint is never at risk"
  it('preserves the invariant by construction for any porcentaje > -100', () => {
    const original = item({ precioBase: 1000, precioMaximo: 1000 });

    const ajustado = aplicarPorcentaje(original, 25);

    expect(ajustado.precioMaximo).toBeGreaterThanOrEqual(ajustado.precioBase);
    expect(ajustado.precioBase).toBe(1250);
    expect(ajustado.precioMaximo).toBe(1250);
  });
});
