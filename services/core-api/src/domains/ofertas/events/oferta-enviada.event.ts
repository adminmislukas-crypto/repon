import type { DomainEvent } from '../../../shared/event-bus/domain-event';
import type { OfertaEnviadaPayload } from './oferta-enviada.payload';

/**
 * `ofertas/SPEC.md`'s "Eventos que publica" — design.md D6/D-F, Diagrama 2
 * paso 11. `'ofertas.oferta_enviada'` es el canal de `EventEmitter2`; el
 * `OfertaEnviadaListener` que este evento dispara dentro de
 * `refill-matching` (Phase 8a, design.md D7) suscribe por este NOMBRE DE
 * CANAL STRING, nunca importando esta clase.
 */
export class OfertaEnviada implements DomainEvent {
  readonly type = 'ofertas.oferta_enviada';
  readonly occurredAt = new Date();

  constructor(readonly payload: OfertaEnviadaPayload) {}
}
