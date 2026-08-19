import type { ConsumptionLog } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `consumo/SPEC.md`, "Puertos de salida" — thin placeholder (exploration.md
 * D2). `NotificationPort`/`EventPublisher`, also listed in `SPEC.md`'s
 * ports-out block, are NOT redeclared here: design.md's DI-wiring
 * convention (§"Convenciones de DI y wiring de módulos") already classifies
 * both as shared-kernel infrastructure (`NOTIFICATION_PORT`/
 * `EVENT_PUBLISHER`, `shared/notifications`/`shared/event-bus`), not a
 * per-domain port.
 */
/**
 * usuario-mobile-consumo design.md D-3: one row per (consumption, calendar
 * day) with a non-zero dose count, for the trailing-window query
 * `contarTomasPorDia` runs. `fecha` is already bucketed by the caller's
 * `zonaHoraria` — the adapter does this grouping in SQL (`at time zone` in
 * `SELECT`/`GROUP BY` only, never in `WHERE`, or the
 * `consumption_logs_consumption_id_tomado_at_idx` index gets disabled).
 */
export interface ConteoDiarioLog {
  readonly consumptionId: string;
  readonly fecha: string; // 'YYYY-MM-DD', in the caller's zonaHoraria
  readonly tomadas: number;
}

export interface ConsumptionLogRepository {
  append(log: ConsumptionLog, tx?: TransactionContext): Promise<void>;
  /**
   * Superseded by `contarTomasPorDia` (usuario-mobile-consumo design.md
   * D-3) — this method returns a single scalar for one known id and cannot
   * back a per-day/per-item adherence view. Left in place, untouched: it
   * still has no caller in this codebase, and deleting it is an unrelated
   * cleanup this change does not do.
   */
  adherenciaUltimos7Dias(consumptionId: string, tx?: TransactionContext): Promise<number>;

  /**
   * usuario-mobile-consumo design.md D-3/D-4: ONE grouped query over every
   * id in `consumptionIds`, never one call per item (the same N+1 D7
   * already rejects for `diasRestantes`). `consumptionIds` MUST already be
   * scoped to the actor by the caller (`ConsumptionRepository.findByUserId`
   * first, D-4) — this method takes ids as given, it does not itself
   * enforce ownership. `desde`/`hasta` are plain UTC instants
   * (`[desde, hasta)`, inclusive/exclusive) so the `WHERE` clause stays
   * index-friendly; only the `SELECT`/`GROUP BY` bucketing is timezone-aware.
   * An empty `consumptionIds` array MUST short-circuit to `[]` without
   * issuing a query (never `IN ()`, which is invalid/always-false SQL).
   */
  contarTomasPorDia(
    consumptionIds: readonly string[],
    desde: Date,
    hasta: Date,
    zonaHoraria: string,
    tx?: TransactionContext,
  ): Promise<ConteoDiarioLog[]>;
}

export const CONSUMPTION_LOG_REPOSITORY = Symbol('CONSUMPTION_LOG_REPOSITORY');
