import type { CatalogProduct } from '@repon/types';

/**
 * Read-only access to `catalog_products` — the shared reference catalog
 * (design.md D-A: "`catalog_products` no tiene columna `company_id`", so
 * this port carries no `tx?` and no visibility-filter concerns at all —
 * see that same section's table, row `buscarProductos` / "No aplica").
 *
 * Gap-fill note (Phase 3b, not explicitly named in design.md's port list):
 * design.md's "Puertos extendidos"/file-tree sections only declare
 * `CatalogRepository` (entirely `ProviderCatalogItem`-shaped, i.e.
 * `provider_catalog`) and `CatalogVisibilityProjection`. Neither can serve
 * `buscarProductos`, which reads a structurally different table
 * (`catalog_products`, no `company_id`, returns `CatalogProduct[]`).
 * `CatalogRepository` deliberately keeps that separation (see its own file
 * doc comment) — folding a `catalog_products` read into it would blur an
 * interface that's otherwise 1:1 with `provider_catalog`. This port is a
 * minimal, same-shaped completion of the existing pattern (interface +
 * token in `ports-out/`, Kysely-backed adapter in `adapters/persistence/`)
 * to close that gap; flagged explicitly in this PR's report, not silently
 * added.
 */
export interface CatalogProductRepository {
  buscar(query: string, categoria?: string): Promise<CatalogProduct[]>;
}

export const CATALOG_PRODUCT_REPOSITORY = Symbol('CATALOG_PRODUCT_REPOSITORY');
