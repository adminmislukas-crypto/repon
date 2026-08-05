import type { UserConsumption } from '@repon/types';
import type { TransactionContext } from '../../../shared/database/transaction';

/**
 * `consumo/SPEC.md`, "Puertos de salida" — thin placeholder (exploration.md
 * D2). Interface + DI token only; `adapters/persistence/` is out of scope
 * until `consumo` gets its own SDD change. `findDueForCheck` backs the
 * domain's own cron job (`SPEC.md` "Job programado"), not built here.
 */
export interface ConsumptionRepository {
  save(item: UserConsumption, tx?: TransactionContext): Promise<void>;
  findDueForCheck(tx?: TransactionContext): Promise<UserConsumption[]>;
}

export const CONSUMPTION_REPOSITORY = Symbol('CONSUMPTION_REPOSITORY');
