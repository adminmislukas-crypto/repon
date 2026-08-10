import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { ConsumptionNotFoundError, DosisInvalidaError } from '../domain/consumo.errors';
import { DosisRegistrada } from '../events/dosis-registrada.event';
import {
  CONSUMPTION_LOG_REPOSITORY,
  type ConsumptionLogRepository,
} from '../ports-out/consumption-log-repository.port';
import {
  CONSUMPTION_REPOSITORY,
  type ConsumptionRepository,
} from '../ports-out/consumption-repository.port';

/**
 * design.md's "Superficie HTTP": a small clock-skew tolerance is allowed
 * before a `tomadoAt` in the future is rejected — the exact bound is not
 * pinned by any Given/When/Then scenario in core-api-consumo spec (the same
 * kind of underspecified gap PR2a flagged for `mensajeStockBajo`'s
 * wording), so 1 minute is a reasonable, documented default, not a measured
 * product decision.
 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * Resolves the DTO's optional `tomadoAt` (ISO-8601 string) into a concrete
 * `Date`: absent -> the server's `now()` (never rejected); present and
 * beyond the future-tolerance -> `DosisInvalidaError`.
 * `domain/consumo.errors.ts`'s own `DosisInvalidaError` doc comment (landed
 * in PR1) names THIS use case as the thrower, not the controller/DTO layer
 * — so the resolution lives here, and `Date.now()` is read at EXECUTION
 * time (request time), never at DTO construction time.
 */
function resolveTomadoAt(tomadoAtRaw: string | undefined): Date {
  if (tomadoAtRaw === undefined) return new Date();
  const tomadoAt = new Date(tomadoAtRaw);
  if (tomadoAt.getTime() > Date.now() + CLOCK_SKEW_TOLERANCE_MS) {
    throw new DosisInvalidaError(`tomadoAt (${tomadoAtRaw}) no puede ser un instante futuro.`);
  }
  return tomadoAt;
}

/**
 * core-api-consumo spec: "marcarDosisTomada is scoped to the caller's own
 * consumption; cross-tenant access is a 404, never 403, and does not
 * mutate" + "marcarDosisTomada writes the log and decrements stock in one
 * transaction; DosisRegistrada publishes only after commit" (D6) +
 * "marcarDosisTomada decrements by the configured dose and never drives
 * stock negative" (D-H.2).
 *
 * design.md Diagram 2 + "Mapa de transacciones" ("1 select + 1 insert + 1
 * update", all three inside `runInTransaction`): the D7 ownership read
 * (`findById`) runs INSIDE the transaction, on the SAME `tx` as both
 * writes — a rejection throws inside the callback, so the transaction rolls
 * back with zero writes; there is no separate pre-transaction read. This
 * deliberately does NOT mirror `ajustarPreciosPorCategoria`'s "checked
 * BEFORE runInTransaction" gate: that gate validates actor-supplied SCALARS
 * (`companyStatus`/`porcentaje`, no repository read needed). This use case
 * needs a repository READ to know the owner in the first place, and
 * design.md pins that read inside the transaction explicitly, in two
 * places — the diagram's "Se lanza DENTRO de la transaccion: rollback sin
 * escrituras" note, and the transactions table's own statement count.
 *
 * `cantidad` is ALWAYS `consumption.dosisPorToma` — the DTO has no
 * `cantidad` field to trust in the first place (D-H.2).
 */
@Injectable()
export class MarcarDosisTomadaUseCase {
  constructor(
    @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
    @Inject(CONSUMPTION_LOG_REPOSITORY)
    private readonly consumptionLogRepository: ConsumptionLogRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(userId: string, consumptionId: string, tomadoAtRaw?: string): Promise<void> {
    const tomadoAt = resolveTomadoAt(tomadoAtRaw);

    const { cantidad, stockRestante } = await this.transactionManager.runInTransaction(
      async (tx) => {
        const consumption = await this.consumptionRepository.findById(consumptionId, tx);
        if (!consumption || consumption.userId !== userId) {
          throw new ConsumptionNotFoundError(consumptionId);
        }

        await this.consumptionLogRepository.append(
          {
            id: randomUUID(),
            consumptionId,
            tomadoAt: tomadoAt.toISOString(),
            cantidad: consumption.dosisPorToma,
          },
          tx,
        );
        const stockRestante = await this.consumptionRepository.descontarStock(
          consumptionId,
          consumption.dosisPorToma,
          tx,
        );
        return { cantidad: consumption.dosisPorToma, stockRestante };
      },
    );

    // D6: published only AFTER commit — a consumer can never react to a
    // dose that got rolled back (design.md Diagram 2, step 5).
    await this.eventPublisher.publish(
      new DosisRegistrada(consumptionId, userId, tomadoAt, cantidad, stockRestante),
    );
  }
}
