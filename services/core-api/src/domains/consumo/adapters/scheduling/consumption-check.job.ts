import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProcesarConsumosVencidosUseCase } from '../../ports-in/procesar-consumos-vencidos.use-case';

/**
 * design.md D1 — first scheduled adapter in the repo. **One call, zero
 * logic**: no try/catch (the use case already catches per item, D4), no
 * re-entrancy guard (D-F: the CAS in `ConsumptionRepository` already makes
 * an overlap safe, and the item count needed to matter at this scale is
 * unreachable), no logging (the use case logs its own run summary). This
 * class is verifiable by inspection — by design it needs no dedicated unit
 * test (tasks.md 6c.6): there is nothing to assert beyond "does it call the
 * use case exactly once", which a mock-heavy test would only restate.
 *
 * design.md D-F: `0 9 * * *` runs after the typical morning-dose window (so
 * `stockActual` reflects today's consumption, not yesterday's) and 09:00
 * never falls in Chile's DST transition window (which always happens at
 * midnight local time) — a midnight cron would risk a skipped or duplicated
 * run twice a year; 09:00 risks neither.
 *
 * design.md D-E: `disabled` reads `process.env.CONSUMO_CRON_ENABLED`
 * directly (not via `ConfigService`) because `@Cron()` is evaluated at class
 * decoration time — i.e. at module load, before Nest's DI container exists.
 * `env.schema.ts` still validates the variable so an out-of-union value is a
 * fail-fast boot error; this decorator just can't consume the validated,
 * injected value. Toggling the flag requires a process restart, which is the
 * expected operational model (it doubles as the multi-instance kill-switch,
 * D-E) — this is evaluated ONCE, deliberately, never re-checked per tick.
 */
@Injectable()
export class ConsumptionCheckJob {
  constructor(private readonly procesarConsumosVencidos: ProcesarConsumosVencidosUseCase) {}

  @Cron('0 9 * * *', {
    name: 'consumo.chequeo-stock-diario',
    timeZone: 'America/Santiago',
    disabled: process.env.CONSUMO_CRON_ENABLED === 'false',
  })
  async ejecutar(): Promise<void> {
    await this.procesarConsumosVencidos.execute();
  }
}
