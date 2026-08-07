import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `catalogo/SPEC.md`'s "Eventos que publica" list — a DECLARED DELTA (D6,
 * core-api-catalogo spec: "PreciosCategoriaAjustados is not listed under
 * its 'Eventos que publica'"). Published EXACTLY ONCE per
 * `ajustarPreciosPorCategoria` invocation, regardless of match count —
 * never one event per item (D3/D6, same "one summary event" shape as
 * `CatalogoCargaMasivaCompletada`), and published only AFTER the wrapping
 * `runInTransaction` commits.
 *
 * Deliberately a RICHER shape than `ProductoAgregado`/`PrecioActualizado`/
 * `CatalogoCargaMasivaCompletada`'s minimal payloads — those 3 were minimal
 * by their OWN choice (each documented as an additive, non-breaking
 * extension point), not a repo-wide convention. `tasks.md` (task 6.6) pins
 * this event's exact field list: `{ companyId, categoria, porcentaje,
 * totalActualizados }`.
 */
export class PreciosCategoriaAjustados implements DomainEvent {
  readonly type = 'catalogo.precios_categoria_ajustados';
  readonly occurredAt = new Date();

  constructor(
    readonly companyId: string,
    readonly categoria: string,
    readonly porcentaje: number,
    readonly totalActualizados: number,
  ) {}
}
