import type { ProviderCatalogItem } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `catalogo/SPEC.md`, "Puertos de salida". Interface + DI token only;
 * `adapters/persistence/` (a real `KyselyCatalogRepository`) lands in the
 * Phase 3b/4a/6 PRs of this same change. `tx?` trailing param on every
 * method matches the repo-wide convention design.md D-A fixed once for every
 * domain's repositories — in deliberate contrast with `contracts/`'s
 * `CatalogQueryPort`, which has no `tx?` at all (C1).
 *
 * `findById` (D7): powers `actualizarPrecio`'s cross-tenant ownership check
 * — a lookup by item id, company membership verified by the caller.
 * `saveMany` (D4): `ajustarPreciosPorCategoria`'s batch write, born
 * batch-shaped so migrating its adapter loop to a single
 * `UPDATE ... FROM (VALUES ...)` later never touches the use case or its
 * tests. `findByCompanyAndCategoria`: lets `ajustarPreciosPorCategoria`
 * fetch only the affected category instead of the provider's whole catalog.
 */
export interface CatalogRepository {
  save(item: ProviderCatalogItem, tx?: TransactionContext): Promise<void>;
  saveMany(items: ProviderCatalogItem[], tx?: TransactionContext): Promise<void>;
  findById(itemId: string, tx?: TransactionContext): Promise<ProviderCatalogItem | null>;
  findByCompany(companyId: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>;
  findByCompanyAndCategoria(
    companyId: string,
    categoria: string,
    tx?: TransactionContext,
  ): Promise<ProviderCatalogItem[]>;
  findMatching(
    categoria: string,
    nombre: string,
    tx?: TransactionContext,
  ): Promise<ProviderCatalogItem[]>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
