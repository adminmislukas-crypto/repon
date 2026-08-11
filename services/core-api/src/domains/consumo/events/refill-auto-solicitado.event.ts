import type { DomainEvent } from '../../../shared/event-bus/domain-event';
import type { StockBajoPayload } from './stock-bajo.payload';

/**
 * `consumo/SPEC.md`'s "Eventos que publica" — design.md D-D. Published by
 * the future `ProcesarConsumosVencidosUseCase` (PR 6b) alongside
 * `StockBajoDetectado`, and ONLY when `consumption.autoCrearRefill` is
 * true. Same field set as `StockBajoDetectado`, on purpose — both fire from
 * the same underlying signal (D-D, "Por qué dos eventos con el mismo
 * payload"):
 *
 * - Fusing them into one event with an `autoCrearRefill` flag would turn
 *   "did the user consent?" into a payload field instead of a channel — the
 *   wrong place for an authorization fact, and it would force every
 *   consumer to re-check the flag itself.
 * - Making this event depend on `StockBajoDetectado` having already been
 *   processed (e.g. `{ consumptionId, userId }` only) would create an
 *   ordering dependency between two events over an in-process emitter that
 *   makes no cross-event ordering guarantee.
 *
 * `StockBajoDetectado` is "a fact was observed"; this one is "the user
 * pre-authorized us to act" — it carries CONSENT, not just a fact.
 */
export class RefillAutoSolicitado implements DomainEvent {
  readonly type = 'consumo.refill_auto_solicitado';
  readonly occurredAt = new Date();

  constructor(readonly payload: StockBajoPayload) {}
}
