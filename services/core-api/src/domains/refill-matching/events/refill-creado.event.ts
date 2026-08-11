import type { DomainEvent } from '../../../shared/event-bus/domain-event';
import type { RefillSolicitudPayload } from './refill-solicitud.payload';

/**
 * `refill-matching/SPEC.md`'s "Eventos que publica" — design.md D-C,
 * Decisión 1: marks the entry into `'abierta'`, never the insert of the row.
 * Published by `CrearSolicitudUseCase` (Phase 4a, manual path, always
 * `'abierta'` by construction) and by the future `CompletarBorradorUseCase`
 * (Phase 6b, `'borrador' -> 'abierta'`) — in BOTH cases only AFTER the
 * transaction that persisted the request commits (D14). The listener that
 * creates a `'borrador'` (`RefillAutoSolicitadoListener`, Phase 6a) publishes
 * ZERO events: a borrador has no `direccion`/`comuna`/complete items, and
 * notifying `ofertas` about one would reproduce the exact silent-failure gap
 * D3 exists to close.
 */
export class RefillCreado implements DomainEvent {
  readonly type = 'refill.creado';
  readonly occurredAt = new Date();

  constructor(readonly payload: RefillSolicitudPayload) {}
}
