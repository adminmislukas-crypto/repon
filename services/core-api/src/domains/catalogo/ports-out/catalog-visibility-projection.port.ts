import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `design.md` D-A (Q1) — write side of the `catalog_hidden_companies`
 * deny-list projection. Interface + DI token only; the real implementation
 * (`KyselyCatalogVisibilityProjection`, backed by an upsert/update against
 * `catalog_hidden_companies`) lands in Phase 8a's PR, together with the
 * `adapters/events/` listener that calls these methods in response to
 * `empresa.suspendida`/`empresa.reactivada`/`empresa.aprobada`.
 *
 * `ocultarEmpresa`/`mostrarEmpresa` are both idempotent by construction: no
 * `DELETE` exists anywhere in this schema, so "restore" is
 * `UPDATE ... SET oculto = false`, and a 0-rows-affected update (already
 * visible) is success, not an error.
 */
export interface CatalogVisibilityProjection {
  ocultarEmpresa(companyId: string, motivo: string | null, tx?: TransactionContext): Promise<void>;
  mostrarEmpresa(companyId: string, tx?: TransactionContext): Promise<void>;
}

export const CATALOG_VISIBILITY_PROJECTION = Symbol('CATALOG_VISIBILITY_PROJECTION');
