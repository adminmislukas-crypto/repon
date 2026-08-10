import type { UserConsumption } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `consumo/SPEC.md`, "Puertos de salida", finalized shape (design.md D-A/
 * D-C/D-H.2 — backend-core-api-consumo PR 1). Interface + DI token only:
 * every method below lands incrementally, in the PR that first needs it
 * (`findById` in PR 2, `save` extended in PR 3, `descontarStock` in PR 4,
 * `findDueForCheck`/`intentarMarcarStockBajo`/`limpiarMarcaStockBajo` in PR
 * 6a) — this PR has zero implementers, by design (mirrors `catalogo`
 * PR 1's `CatalogRepository`).
 */
export interface ConsumptionRepository {
  /**
   * `configurarConsumo`'s only write path today (D-H.2): an insert for a
   * new item, or a full-row upsert. NEVER called by the cron — the cron's
   * two writes below are narrower on purpose, so a concurrent
   * `descontarStock` can never be clobbered by a stale in-memory snapshot.
   */
  save(item: UserConsumption, tx?: TransactionContext): Promise<void>;

  /**
   * Powers the D7 cross-tenant ownership check on `marcarDosisTomada`/
   * `calcularDiasRestantes`: look up by id, compare `entity.userId` against
   * `actor.profileId` in the use case, `null` and "found but foreign" both
   * resolve to the same `ConsumptionNotFoundError` (byte-identical 404).
   */
  findById(consumptionId: string, tx?: TransactionContext): Promise<UserConsumption | null>;

  /**
   * Design.md D-C: returns CANDIDATES, not "items under threshold" — the
   * SQL predicate is a strict superset (union of "may need to fire" OR "may
   * need to clear"), multiplicative (never division, to avoid an
   * abort-the-whole-query division-by-zero on a degenerate row). The
   * authoritative decision is `domain/consumo.calculos.ts`, run by the
   * caller over each returned entity — this method never decides on its
   * own. `umbralDias` is `UMBRAL_STOCK_BAJO_DIAS` (D-B), passed in rather
   * than hard-coded so the domain constant stays the single source.
   */
  findDueForCheck(umbralDias: number, tx?: TransactionContext): Promise<UserConsumption[]>;

  /**
   * The compare-and-set that makes the debounce marker (D-A) safe under
   * concurrency AND across cron runs, in one statement:
   * `UPDATE ... SET stock_bajo_notificado_at = $2 WHERE id = $1 AND
   * stock_bajo_notificado_at IS NULL RETURNING id`. `true` (1 row) = this
   * caller won the claim and MUST emit. `false` (0 rows) = already claimed
   * — by yesterday's run (D5), another replica, or an overlapping run
   * (D-E) — and the caller MUST NOT emit. Never a read-then-write: the
   * row-lock Postgres already takes on the `UPDATE` is the entire
   * mechanism, no advisory lock needed.
   */
  intentarMarcarStockBajo(
    consumptionId: string,
    notificadoAt: Date,
    tx?: TransactionContext,
  ): Promise<boolean>;

  /**
   * Idempotent on purpose: 0 rows affected (already clear) is success, not
   * an error — called both by the cron (stock replenished above threshold)
   * and by `configurarConsumo` (a full reconfiguration is a new alert
   * context). Never called by `marcarDosisTomada`, which can only lower
   * stock and can never resolve the alert condition.
   */
  limpiarMarcaStockBajo(consumptionId: string, tx?: TransactionContext): Promise<void>;

  /**
   * `marcarDosisTomada`'s atomic decrement (D-H.2):
   * `UPDATE ... SET stock_actual = greatest(stock_actual - $2, 0) ...
   * RETURNING stock_actual`. Immune to lost-update under concurrent doses
   * (double-tap, two devices) — a naive read-modify-write-via-`save()`
   * would not be. Clamps at 0 in the adapter, never rejects: the dose LOG
   * is the health record and must reflect reality regardless of a stale
   * stock estimate. Returns the new stock so `DosisRegistrada` gets its
   * `stockRestante` without a second read.
   */
  descontarStock(consumptionId: string, cantidad: number, tx?: TransactionContext): Promise<number>;
}

export const CONSUMPTION_REPOSITORY = Symbol('CONSUMPTION_REPOSITORY');
