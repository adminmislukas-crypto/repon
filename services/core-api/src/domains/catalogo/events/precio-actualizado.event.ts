import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `catalogo/SPEC.md`'s "Eventos que publica" list. Published only by
 * `ActualizarPrecioUseCase`, after `save()` commits — never by
 * `cargarCatalogoMasivo`/`ajustarPreciosPorCategoria` (D3/D6, core-api-catalogo
 * spec "Per-item events never fire during batch operations").
 *
 * Deliberately minimal shape (`companyId`, `itemId`), mirroring
 * `ProductoAgregado`'s precedent: no scenario in `spec.md`/`design.md` pins a
 * richer payload for this event yet. A future consumer that needs the new
 * price values (e.g. `refill-matching` maintaining its own denormalized
 * cache, per `catalogo/SPEC.md`'s "Al extraer como microservicio" note) can
 * re-derive them via `CatalogQueryPort`/`findById` — growing this event with
 * `precioBase`/`precioMaximo` later is an additive, non-breaking change.
 */
export class PrecioActualizado implements DomainEvent {
  readonly type = 'catalogo.precio_actualizado';
  readonly occurredAt = new Date();

  constructor(
    readonly companyId: string,
    readonly itemId: string,
  ) {}
}
