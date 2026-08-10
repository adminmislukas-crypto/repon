import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `consumo/SPEC.md`'s "Eventos que publica" — design.md D-D's exact payload
 * (Diagrama 2, step 5). Published by `MarcarDosisTomadaUseCase` ONLY after
 * `TRANSACTION_MANAGER.runInTransaction` commits — never from inside the
 * transaction callback: a consumer must never react to a dose that got
 * rolled back (design.md, "Por qué transacción acá y no en el cron").
 *
 * D-D's rule ("consumo publica hechos que posee, en su propio vocabulario,
 * ... nunca la interpretación de otro dominio") applies here too, even
 * though this event has no cross-domain enum to leak: `cantidad` is always
 * `consumption.dosisPorToma` (the CONFIGURED dose, never a client-supplied
 * value — there is no `cantidad` field anywhere in the inbound DTO), and
 * `stockRestante` is `descontarStock`'s own RETURNING value (the post-clamp
 * fact, D-H.2) — never recomputed here from `stockActual - cantidad`, which
 * would silently drift from the real clamped value under concurrency.
 */
export class DosisRegistrada implements DomainEvent {
  readonly type = 'consumo.dosis_registrada';
  readonly occurredAt = new Date();

  constructor(
    readonly consumptionId: string,
    /** Present because, under D14, no consumer can query it back. */
    readonly userId: string,
    readonly tomadoAt: Date,
    readonly cantidad: number,
    /** Post-decrement: the consumer sees the effect, not just the fact. */
    readonly stockRestante: number,
  ) {}
}
