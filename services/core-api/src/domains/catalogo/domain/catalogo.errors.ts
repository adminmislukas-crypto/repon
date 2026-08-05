/**
 * Domain-invariant violations for `catalogo` (core-api-catalogo spec, D-C).
 * Plain `Error` subclasses, zero framework imports
 * (core-api-hexagonal-layout: `domain/`/`ports-in/` MUST NOT import
 * HTTP-framework types) — a ports-in caller never throws these directly as
 * an HTTP response; `adapters/http/catalogo-exception.filter.ts` (Phase 4b)
 * maps each class to a status code (design.md's "Errores de dominio"
 * table). More classes are appended here as later phases need them
 * (`CatalogItemNotFoundError`/`EmpresaNoActivaError` in Phase 4a,
 * `PorcentajeInvalidoError` in Phase 6, `ArchivoCargaInvalidoError` in Phase
 * 5a) — this file is never edited destructively, only appended to.
 */

/**
 * Maps to 400 `PRECIO_INVALIDO` in `adapters/http/` (design.md's error
 * table). Thrown by `provider-catalog-item.entity.ts` when, after rounding
 * to 2 decimals, `precioMaximo < precioBase` (D-C: rounding happens BEFORE
 * validating the invariant, never trusting Postgres to re-round) — or when
 * an `aplicarPorcentaje` call would use a `porcentaje <= -100` (core-api-
 * catalogo Scenario "porcentaje <= -100 is rejected before touching the
 * database"): that guard is a validation error, checked before any scaling
 * or rounding computation runs, not a consequence of the price invariant
 * check (a porcentaje of exactly -100 scales both bounds to 0, which would
 * otherwise trivially satisfy `precioMaximo >= precioBase`).
 */
export class PrecioInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrecioInvalidoError';
  }
}
