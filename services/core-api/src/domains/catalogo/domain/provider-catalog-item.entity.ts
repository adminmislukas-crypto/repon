import type { NuevoProductoProveedor, ProviderCatalogItem } from '@repon/types';
import { PrecioInvalidoError } from './catalogo.errors';

export type { ProviderCatalogItem };

/**
 * `Math.round(x * 100) / 100` (design.md D-C, verbatim). The single
 * rounding rule every price passes through before the invariant below ever
 * sees it — so what gets validated is exactly what gets persisted, and
 * Postgres's `numeric(12,2)` column never has to re-round anything the
 * domain already decided.
 */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * D-C / D5: `precioMaximo >= precioBase` is enforced HERE, in the domain —
 * the `CHECK` constraint in `provider_catalog` is a safety net, never the
 * validator. Callers must round both values with `redondear` before calling
 * this so the validated values match the persisted ones.
 */
function assertPrecioValido(precioBase: number, precioMaximo: number): void {
  if (precioMaximo < precioBase) {
    throw new PrecioInvalidoError(
      `precioMaximo (${precioMaximo}) no puede ser menor que precioBase (${precioBase}).`,
    );
  }
}

export interface CrearProviderCatalogItemInput {
  id: string;
  companyId: string;
  producto: NuevoProductoProveedor;
}

/**
 * Factory (design.md Diagram 1, step 2a). Rounds `precioBase`/`precioMaximo`
 * to 2 decimals and validates the price invariant on the ROUNDED values
 * before returning — never on the raw input.
 */
export function crear(input: CrearProviderCatalogItemInput): ProviderCatalogItem {
  const precioBase = redondear(input.producto.precioBase);
  const precioMaximo = redondear(input.producto.precioMaximo);
  assertPrecioValido(precioBase, precioMaximo);

  return {
    id: input.id,
    companyId: input.companyId,
    catalogProductId: input.producto.catalogProductId,
    nombre: input.producto.nombre,
    categoria: input.producto.categoria,
    precioBase,
    precioMaximo,
    stock: input.producto.stock,
    disponible: input.producto.disponible ?? true,
    imagenUrl: input.producto.imagenUrl,
  };
}

/**
 * Used by `actualizarPrecio.use-case.ts` (Phase 4a). Returns a NEW item
 * (immutable — the original `item` is never mutated) with `precioBase`/
 * `precioMaximo` rounded to 2 decimals and the invariant re-validated on
 * those rounded values (design.md Diagram 3, step 5: "redondea a 2
 * decimales y valida precioMaximo >= precioBase EN LA ENTIDAD").
 */
export function actualizarPrecio(
  item: ProviderCatalogItem,
  precioBase: number,
  precioMaximo: number,
): ProviderCatalogItem {
  const nuevoPrecioBase = redondear(precioBase);
  const nuevoPrecioMaximo = redondear(precioMaximo);
  assertPrecioValido(nuevoPrecioBase, nuevoPrecioMaximo);

  return { ...item, precioBase: nuevoPrecioBase, precioMaximo: nuevoPrecioMaximo };
}

/**
 * Used by `ajustarPreciosPorCategoria.use-case.ts` (Phase 6). Scales BOTH
 * `precioBase` and `precioMaximo` by the same factor `(1 + porcentaje/100)`
 * (D5) and returns a NEW item — the original is never mutated.
 *
 * `porcentaje <= -100` is rejected BEFORE any scaling/rounding computation
 * runs (core-api-catalogo Scenario "porcentaje <= -100 is rejected before
 * touching the database"): a porcentaje of exactly -100 produces a factor
 * of 0, which would scale both bounds to 0 and trivially satisfy
 * `precioMaximo >= precioBase` — the invariant check alone cannot catch it,
 * so the guard is explicit and runs first.
 *
 * For any `porcentaje > -100`, the factor is strictly positive, and scaling
 * both bounds of an already-valid pair by the same positive factor
 * preserves the invariant by construction (D5: "el redondeo es monótono,
 * no puede invertir el orden") — the CHECK constraint can never fire.
 */
export function aplicarPorcentaje(
  item: ProviderCatalogItem,
  porcentaje: number,
): ProviderCatalogItem {
  if (porcentaje <= -100) {
    throw new PrecioInvalidoError(`porcentaje (${porcentaje}) no puede ser menor o igual a -100.`);
  }

  const factor = 1 + porcentaje / 100;
  const precioBase = redondear(item.precioBase * factor);
  const precioMaximo = redondear(item.precioMaximo * factor);
  assertPrecioValido(precioBase, precioMaximo);

  return { ...item, precioBase, precioMaximo };
}
