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

/**
 * Maps to 404 `CATALOG_ITEM_NOT_FOUND` in `adapters/http/` (design.md's
 * error table, Phase 4b). Thrown by `ActualizarPrecioUseCase` when
 * `findById(itemId)` returns `null` OR returns an item whose `companyId`
 * does not match the caller's `companyId` (D7) — BOTH branches throw this
 * exact same error, constructed the exact same way (design.md Diagram 3:
 * "Byte a byte idéntico a la rama 'el ítem no existe'"). A 403 in the
 * cross-tenant branch would confirm the item exists and belongs to someone
 * else, letting an actor enumerate `itemId` to map another company's
 * catalog by observing 403-vs-404 — 404 in both branches closes that
 * channel (R1, the risk this exact PR closes).
 */
export class CatalogItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Ítem de catálogo ${itemId} no encontrado.`);
    this.name = 'CatalogItemNotFoundError';
  }
}

/**
 * Maps to 403 `EMPRESA_NO_ACTIVA` in `adapters/http/` (design.md's error
 * table). Thrown by all 4 mutating use cases (`cargarProductoCatalogo`,
 * `cargarCatalogoMasivo`, `actualizarPrecio`, `ajustarPreciosPorCategoria`)
 * when `companyStatus !== 'activo'` — checked FIRST, before any repository
 * read or write (core-api-catalogo spec, "The 4 mutating use cases require
 * an active company"; design.md D-E: one rule, four applications, the same
 * shape D8 already established for `companyId`). `buscarProductos` never
 * throws this — reading the reference catalog does not require an active
 * company.
 */
export class EmpresaNoActivaError extends Error {
  constructor(companyId: string) {
    super(`La empresa ${companyId} no está activa.`);
    this.name = 'EmpresaNoActivaError';
  }
}

/**
 * Maps to 400 `ARCHIVO_CARGA_INVALIDO` in `adapters/http/` (design.md's
 * error table, Phase 5a). Thrown by `adapters/http/carga-masiva.parser.ts`
 * when the multipart upload's ENVELOPE is invalid — wrong mimetype, a file
 * over the size limit, a data-row count outside `[1, 500]`, or a header
 * missing a required column (design.md Diagram 1, step P1). Never thrown
 * for a row-VALUE problem (a negative price, an empty `nombre`, etc.) —
 * that is per-row failure reporting inside `ResultadoCargaMasiva.fallos`
 * (`cargarCatalogoMasivo`, Phase 5b), not an envelope rejection: a single
 * malformed row must never invalidate the whole file (D2). When the
 * envelope itself is rejected, nothing is written and nothing is emitted —
 * the request fails before `cargarCatalogoMasivo` ever runs. `cause`
 * preserves the original `csv-parse` error, if any, mirroring
 * `CatalogQueryUnavailableError`'s `cause`-preserving shape (`contracts/
 * catalog-query.port.ts`, D-B) for the same reason: never let a
 * lower-layer error silently vanish.
 */
export class ArchivoCargaInvalidoError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArchivoCargaInvalidoError';
  }
}
