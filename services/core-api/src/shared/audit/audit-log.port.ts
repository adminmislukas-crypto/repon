import type { TransactionContext } from '../database/transaction';

// shared-audit-log spec — pinned shape, six domains will copy this. Do not
// widen `cambios` to a looser `Record<string, unknown>`: the whole point of
// fixing `{ campo: { antes, despues } }` now is that a mixed-shape jsonb
// column is unqueryable later and there is no cheap migration for it.
export interface AuditEntry {
  actorProfileId: string; // always an authenticated admin
  accion: string; // snake_case, matches the use-case name: 'aprobar_empresa'
  entityType: string; // singular snake_case: 'company' | 'profile' | 'admin_role'
  entityId: string;
  cambios: Record<string, { antes: unknown; despues: unknown }>;
  motivo?: string;
}

/**
 * Shared-kernel port over the append-only `audit_log` table (D-C) — not a
 * domain's `ports-out`, even though `identidad` is its first caller. Any
 * domain's admin-mutating use case injects `AUDIT_LOG_PORT` directly; none
 * declares a competing audit interface over the same table.
 *
 * Write-only by design: no read/query method exists on this port in this
 * change (admin-web's audit read surface is out of scope), and the
 * underlying table rejects UPDATE/DELETE even for `service_role` — see
 * `test/database.integration-spec.ts`.
 */
export interface AuditLogPort {
  record(entry: AuditEntry, tx?: TransactionContext): Promise<void>;
}

export const AUDIT_LOG_PORT = Symbol('AUDIT_LOG_PORT');
