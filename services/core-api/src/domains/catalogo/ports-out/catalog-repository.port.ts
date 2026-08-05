import type { ProviderCatalogItem } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `catalogo/SPEC.md`, "Puertos de salida" — thin placeholder (exploration.md
 * D2: `identidad` is fully scaffolded, the other 5 domains ship as empty
 * module shells with just their port contracts). Interface + DI token only;
 * `adapters/persistence/` (a real `KyselyCatalogRepository`) is out of
 * scope until `catalogo` gets its own SDD change. `tx?` trailing param
 * matches the repo-wide convention design.md D-A fixed once for every
 * domain's repositories, not only `identidad`'s.
 */
export interface CatalogRepository {
  save(item: ProviderCatalogItem, tx?: TransactionContext): Promise<void>;
  findByCompany(companyId: string, tx?: TransactionContext): Promise<ProviderCatalogItem[]>;
  findMatching(
    categoria: string,
    nombre: string,
    tx?: TransactionContext,
  ): Promise<ProviderCatalogItem[]>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
