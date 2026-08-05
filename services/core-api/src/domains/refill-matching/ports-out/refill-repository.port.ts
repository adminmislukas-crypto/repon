import type { RefillRequest } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `refill-matching/SPEC.md`, "Puertos de salida" — thin placeholder
 * (exploration.md D2). Interface + DI token only. `SPEC.md` also notes this
 * domain "usa `CatalogQueryPort` (expuesto por `catalogo`)... no tiene su
 * propio repositorio de catálogo" — no second port declared here for that;
 * the real cross-domain wiring lands when both domains get their own SDD
 * change (see `catalogo/ports-out/catalog-query.port.ts`'s placement note).
 */
export interface RefillRepository {
  save(request: RefillRequest, tx?: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<RefillRequest | null>;
}

export const REFILL_REPOSITORY = Symbol('REFILL_REPOSITORY');
