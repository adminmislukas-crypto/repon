import type { Kysely, Transaction } from 'kysely';
import type { DB } from './schema';

// design.md D-A — exact shape. A ports-out repository (or `AuditLogPort`)
// receives this opaque handle, never a Kysely `Transaction<DB>` directly:
// the domain must be able to express "run this atomically" without knowing
// Kysely exists. Chosen over an `AsyncLocalStorage`-based ambient
// transaction on purpose (design.md): "forgot to open the transaction"
// must be a compile error via an explicit `tx?` parameter, never an
// invisible autocommit — and an explicit `tx` lets a mocked-ports-out unit
// test assert the repository actually received it (task 3.5 / 4b's
// "rollback-removes-audit-entry" tests depend on this).
declare const txBrand: unique symbol;
export interface TransactionContext {
  readonly [txBrand]: true;
}

export interface TransactionManager {
  runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export const TRANSACTION_MANAGER = Symbol('TRANSACTION_MANAGER');

/**
 * The cast between the opaque `TransactionContext` and Kysely's real
 * `Transaction<DB>` lives ONLY here and in `adapters/persistence/`
 * (design.md D-A's edge rule) — never in a domain's `ports-out`/`ports-in`.
 * A Kysely-backed adapter (e.g. this PR's `KyselyAuditLogAdapter`, or a
 * future `adapters/persistence/kysely-*.repository.ts`) calls this to
 * unwrap a `tx` it was handed before running a query on it.
 */
export function toKyselyTransaction(tx: TransactionContext): Transaction<DB> {
  return tx as unknown as Transaction<DB>;
}

export class KyselyTransactionManager implements TransactionManager {
  constructor(private readonly db: Kysely<DB>) {}

  async runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(trx as unknown as TransactionContext));
  }
}
