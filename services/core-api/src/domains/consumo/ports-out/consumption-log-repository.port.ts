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
export interface ConsumptionLogRepository {
  append(log: ConsumptionLog, tx?: TransactionContext): Promise<void>;
  adherenciaUltimos7Dias(consumptionId: string, tx?: TransactionContext): Promise<number>;
}

export const CONSUMPTION_LOG_REPOSITORY = Symbol('CONSUMPTION_LOG_REPOSITORY');
