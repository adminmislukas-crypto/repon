import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { DB } from '../database/schema';
import { toKyselyTransaction, type TransactionContext } from '../database/transaction';
import type { AuditEntry, AuditLogPort } from './audit-log.port';

/**
 * Kysely-backed `AuditLogPort`. `record()`'s atomicity rule (shared-audit-log
 * spec, "record() participates in the caller's transaction"): when a caller
 * passes `tx`, this insert runs on that same Kysely `Transaction<DB>` — not
 * on the shared pool-backed `db` — so it commits or rolls back with
 * whatever mutation the caller made in the same `tx`.
 */
@Injectable()
export class KyselyAuditLogAdapter implements AuditLogPort {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async record(entry: AuditEntry, tx?: TransactionContext): Promise<void> {
    const executor = tx ? toKyselyTransaction(tx) : this.db;

    await executor
      .insertInto('audit_log')
      .values({
        actor_profile_id: entry.actorProfileId,
        accion: entry.accion,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        // node-postgres serializes a plain JS object param to JSON
        // automatically for a `jsonb` column (`pg`'s own `prepareValue`) —
        // no manual `JSON.stringify` needed, verified against the local
        // stack (`test/database.integration-spec.ts`).
        cambios: entry.cambios,
        motivo: entry.motivo ?? null,
      })
      .execute();
  }
}
