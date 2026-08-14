import type { DomainEvent } from '../../../shared/event-bus/domain-event';
import type { OfertaAceptadaPayload } from './oferta-aceptada.payload';

/**
 * `ofertas/SPEC.md`'s "Eventos que publica" — design.md D6/D-F, D-D paso 4.
 * `'ofertas.oferta_aceptada'` es el canal de `EventEmitter2`; el
 * `OfertaAceptadaListener` que este evento dispara dentro de
 * `refill-matching` (Phase 8a, design.md D7) suscribe por este NOMBRE DE
 * CANAL STRING, nunca importando esta clase.
 */
export class OfertaAceptada implements DomainEvent {
  readonly type = 'ofertas.oferta_aceptada';
  readonly occurredAt = new Date();

  constructor(readonly payload: OfertaAceptadaPayload) {}
}
