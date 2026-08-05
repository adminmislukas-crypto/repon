import type { ProviderCatalogItem, RefillItem } from '@repon/types';

/**
 * `catalogo/SPEC.md`, "Consulta que expone a otros dominios (síncrona, solo
 * lectura)" — consumed by `refill-matching` and `ofertas`. design.md's own
 * DI-token table (§"Convenciones de DI y wiring de módulos") lists
 * `CATALOG_QUERY_PORT` alongside `CATALOG_REPOSITORY` under "Ports-out por
 * dominio", so it is declared here for this thin-placeholder PR.
 *
 * Known placement gap (flagged, not silently resolved): `core-api-hexagonal-
 * layout`'s "Only contracts/ is importable across a domain boundary"
 * requirement means a cross-domain sync query port structurally belongs in
 * `domains/catalogo/contracts/`, mirroring `ActorPort`'s
 * declared-by-kernel/implemented-by-`identidad` pattern. This placeholder
 * PR does not create a `contracts/` folder for any of the 5 thin domains
 * (D2 scope), so this interface stays in `ports-out/` for now — nothing
 * imports it cross-domain yet (`refill-matching`/`ofertas` are placeholders
 * too, in this same PR). Move it to `contracts/` when `catalogo` gets its
 * own SDD change and a real implementation exists to export.
 */
export interface CatalogQueryPort {
  buscarCoincidencias(
    itemsSolicitados: RefillItem[],
    companyId?: string,
  ): Promise<ProviderCatalogItem[]>;
}

export const CATALOG_QUERY_PORT = Symbol('CATALOG_QUERY_PORT');
