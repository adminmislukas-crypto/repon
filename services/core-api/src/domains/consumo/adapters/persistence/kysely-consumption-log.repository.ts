import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ConsumptionLog } from '@repon/types';
import { DATABASE } from '../../../../shared/database/database.module';
import type { DB } from '../../../../shared/database/schema';
import {
  toKyselyTransaction,
  type TransactionContext,
} from '../../../../shared/database/transaction';
import type { ConsumptionLogRepository } from '../../ports-out/consumption-log-repository.port';

/**
 * `ConsumptionLogRepository`'s Kysely-backed implementation (design.md
 * D-H.2, first implementer — this PR). `cantidad` is `numeric` -> `string`
 * on the wire, same gotcha `kysely-consumption.repository.ts`/
 * `kysely-pet.repository.ts` already document for
 * `dosis_por_toma`/`stock_actual`/`peso_kg`.
 */
@Injectable()
export class KyselyConsumptionLogRepository implements ConsumptionLogRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  private executor(tx?: TransactionContext) {
    return tx ? toKyselyTransaction(tx) : this.db;
  }

  /**
   * `MarcarDosisTomadaUseCase`'s only write path to this table (D-H.2): a
   * pure insert, never an upsert — a dose log is append-only ("el log es el
   * registro de salud y debe reflejar la realidad"), so there is no
   * conflict target to resolve. `id` is always caller-supplied
   * (`randomUUID()`, D-H.1's repo-wide precedent), never the DB's
   * `gen_random_uuid()` default.
   */
  async append(log: ConsumptionLog, tx?: TransactionContext): Promise<void> {
    await this.executor(tx)
      .insertInto('consumption_logs')
      .values({
        id: log.id,
        consumption_id: log.consumptionId,
        tomado_at: log.tomadoAt,
        cantidad: log.cantidad !== undefined ? log.cantidad.toFixed(2) : null,
      })
      .execute();
  }

  /**
   * Implemented minimally to satisfy `ConsumptionLogRepository`'s interface
   * shape — no caller exists anywhere in this change's scope (design.md's
   * own PR sequence never wires an adherence calculation into any use case;
   * it is declared in `consumo/SPEC.md`'s ports-out block but never invoked
   * by `sdd-tasks`' 10-PR chain). Correct-but-unused, not a throwing stub: a
   * throwing stub would be indistinguishable from a genuinely missing
   * method to a future caller, and this repository's own convention (see
   * this file's sibling `kysely-consumption.repository.ts`) reserves
   * throwing stubs for methods whose PR hasn't landed at all — this one
   * has, just with no consumer yet. Uses the
   * `consumption_logs_consumption_id_tomado_at_idx` index (design.md
   * "Migración y row types" — the index db-schema-consumo already
   * documents as existing FOR this exact query shape). Deliberately has NO
   * dedicated unit test (tasks.md 4.3/4.4 name only `append()`'s RED/GREEN
   * cycle) — revisit with a real test the day a use case actually calls it.
   */
  async adherenciaUltimos7Dias(consumptionId: string, tx?: TransactionContext): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const row = await this.executor(tx)
      .selectFrom('consumption_logs')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('consumption_id', '=', consumptionId)
      .where('tomado_at', '>=', sevenDaysAgo)
      .executeTakeFirst();
    return row ? Number(row.total) : 0;
  }
}
