export type CatalogProductStatus = 'activo' | 'inactivo';

/**
 * `status` is not filtered out of this type: `'inactivo'` remains a valid,
 * visible value. This is not a soft-delete hidden from an authenticated
 * client (Q6, `db-schema-catalogo`).
 */
export interface CatalogProduct {
  id: string;
  nombre: string;
  categoria: string;
  marca?: string;
  presentacion?: string;
  imagenUrl?: string;
  status: CatalogProductStatus;
}

export interface ProviderCatalogItem {
  id: string;
  companyId: string;
  /**
   * Optional by design (Q4, `db-schema-catalogo`): a provider can load a
   * product that doesn't match anything in `catalog_products`, using
   * `nombre`/`categoria` for matching instead — never forced to `NOT NULL`.
   */
  catalogProductId?: string;
  nombre: string;
  categoria: string;
  precioBase: number;
  precioMaximo: number;
  stock: number;
  disponible: boolean;
  imagenUrl?: string;
}

/**
 * Input shape for a single product upload (D12). Shared by
 * `cargarProductoCatalogo(producto: NuevoProductoProveedor)` (one item) and,
 * per-row, by `ArchivoCarga` (bulk upload — design.md Diagram 1). No
 * `companyId` field: D8 forces it to come only from `actor.companyId`, never
 * from a client-supplied body. Field-level validation (non-negative prices,
 * non-empty `nombre`/`categoria`, etc.) is enforced at the type/DTO layer in
 * `core-api`'s `adapters/http/`, never here (shared-types-package delta) —
 * this interface intentionally carries no validation decorators.
 */
export interface NuevoProductoProveedor {
  catalogProductId?: string;
  nombre: string;
  categoria: string;
  precioBase: number;
  precioMaximo: number;
  stock: number;
  disponible?: boolean;
  imagenUrl?: string;
}

/**
 * One row of an `ArchivoCarga`, already parsed and framework-free (D11: the
 * CSV/XLSX parser lives in `adapters/http/`, never in `ports-in`/`domain`).
 * `numero` is 1-based, excluding the header row (design.md Diagram 1) — the
 * identifier `ResultadoCargaMasiva.fallos` reports back per row. `producto`
 * carries only column-to-key mapping at this stage: values may be malformed
 * (e.g. `NaN` from a bad `Number()` cast) because row-level value validation
 * happens later, in the type/DTO layer per row, not during parsing — a single
 * bad row must never invalidate the whole file (D2).
 */
export interface FilaCarga {
  numero: number;
  producto: NuevoProductoProveedor;
}

/**
 * An already-parsed, framework-free representation of an uploaded catalog
 * file (D12). Never an `Express.Multer.File` or any framework buffer type —
 * that boundary is D11's entire point: `ports-in`/`domain` never sees a
 * framework type.
 */
export interface ArchivoCarga {
  filas: FilaCarga[];
}

/**
 * Per-row success/failure report returned by `cargarCatalogoMasivo` (D2,
 * D12). `totalCargados + totalFallidos` MUST equal `totalFilas` regardless of
 * row count — exactly one event is published per invocation, never one per
 * row (D3, design.md Diagram 1). `fallos[].numero` matches `FilaCarga.numero`
 * so a provider can locate the offending row in their original file.
 */
export interface ResultadoCargaMasiva {
  totalFilas: number;
  totalCargados: number;
  totalFallidos: number;
  fallos: Array<{ numero: number; motivo: string }>;
}
