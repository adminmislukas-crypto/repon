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
 * 5a, `ProductoInvalidoError` in Phase 5b) — this file is never edited
 * destructively, only appended to.
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

/**
 * Maps to 400 `PRODUCTO_INVALIDO` in `adapters/http/` (design.md's error
 * table, Phase 5b). Thrown by `provider-catalog-item.entity.ts`'s `crear()`
 * when `nombre`/`categoria` is empty, `precioBase`/`precioMaximo` is not a
 * finite number >= 0 (BEFORE rounding — a `NaN`/`Infinity` value can reach
 * `crear()` from `carga-masiva.parser.ts`'s deliberately permissive
 * `Number()` cast, per D2's "cero validación de valores" during parsing), or
 * `stock` is not a non-negative integer (design.md Diagram 1, step 2a: "
 * nombre/categoria no vacíos; precios finitos y >= 0; ... stock entero >=
 * 0"). Distinct from `PrecioInvalidoError`, which is only the cross-field
 * `precioMaximo >= precioBase` invariant on already-well-formed numbers —
 * `ProductoInvalidoError` is field-level malformation, checked first.
 *
 * `cargarCatalogoMasivoUseCase` (Phase 5b) is this error's primary
 * consumer: it catches this per row and reports it in
 * `ResultadoCargaMasiva.fallos`, never letting it escape as an HTTP
 * response — a single malformed row must never invalidate the whole file
 * (D2). The `adapters/http/` mapping below exists as defense-in-depth for
 * `cargarProductoCatalogo`'s single-item path (Phase 4a/4b), whose
 * `NuevoProductoDto` already rejects the same malformed shapes via
 * `class-validator` before `crear()` ever runs — this error class is not
 * expected to surface there in practice, only if that DTO-level defense is
 * ever bypassed.
 */
export class ProductoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductoInvalidoError';
  }
}

/**
 * Maps to 400 `PORCENTAJE_INVALIDO` in `adapters/http/` (design.md's error
 * table, Phase 6 — a DISTINCT row from `PRECIO_INVALIDO`, with its own HTTP
 * `code`). Thrown by `AjustarPreciosPorCategoriaUseCase` itself, as an
 * up-front gate on the raw `porcentaje` argument, BEFORE `runInTransaction`
 * is even entered — i.e. before `findByCompanyAndCategoria` (a repository
 * READ) or `saveMany` (the write) ever run.
 *
 * Why this can't just reuse `provider-catalog-item.entity.ts`'s existing
 * `aplicarPorcentaje()` guard (which already throws `PrecioInvalidoError`
 * for the identical `porcentaje <= -100` condition — a PR 3a choice made
 * before this class existed): `aplicarPorcentaje()` only runs PER ITEM,
 * inside the loop that happens AFTER `findByCompanyAndCategoria` has
 * already executed. core-api-catalogo spec's own scenario text requires
 * rejection "before touching the database" / "no repository call is made"
 * — not just "before any write". Relying solely on the entity's guard would
 * violate that in two ways: (1) the SELECT already ran by the time any
 * item's `aplicarPorcentaje()` call could throw, and (2) if zero items
 * match the `categoria`, the per-item loop never runs at all, so an invalid
 * `porcentaje` would be silently accepted end-to-end (the SELECT still ran,
 * `saveMany([])` is a no-op, and a "successful" empty adjustment gets
 * reported). This class closes both gaps with one synchronous check, run
 * before the transaction is even opened.
 *
 * `aplicarPorcentaje()`'s own `PrecioInvalidoError` guard is left
 * unchanged — still correct, still tested (PR 3a), and now effectively
 * unreachable via THIS use case's call path (this gate always fires
 * first) — but it remains the right defense-in-depth for any other/future
 * direct caller of the entity function.
 */
export class PorcentajeInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PorcentajeInvalidoError';
  }
}
