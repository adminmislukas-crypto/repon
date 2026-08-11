import type { DomainEvent } from '../../../shared/event-bus/domain-event';
import type { StockBajoPayload } from './stock-bajo.payload';

/**
 * `consumo/SPEC.md`'s "Eventos que publica" — design.md D-D. Published by
 * the future `ProcesarConsumosVencidosUseCase` (PR 6b) for EVERY
 * `UserConsumption` newly crossing the threshold in a cron run — one event
 * per item, never a daily summary (D3, the opposite conclusion from
 * `catalogo`'s D3/D6 summary-event pattern, deliberately: `refill-matching`
 * needs the concrete identity of each item).
 *
 * "Se observó un hecho": general-audience signal (analytics, notifications,
 * a future dashboard) — contrast with `RefillAutoSolicitado` below, which
 * carries consent, not just observation (D-D, "Por qué dos eventos con el
 * mismo payload").
 */
export class StockBajoDetectado implements DomainEvent {
  readonly type = 'consumo.stock_bajo_detectado';
  readonly occurredAt = new Date();

  constructor(readonly payload: StockBajoPayload) {}
}
