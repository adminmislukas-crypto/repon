import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `catalogo/SPEC.md`'s "Eventos que publica" list. Published EXACTLY ONCE
 * per `cargarCatalogoMasivo` invocation, regardless of row count — never
 * one event per row (D3, core-api-catalogo spec "cargarCatalogoMasivo
 * emits exactly one summary event" + "Per-item events never fire during
 * batch operations"; design.md Diagram 1, step (3): "EXACTAMENTE UNO,
 * siempre — incluso con 0 cargados"). `totalCargados + totalFallidos`
 * always equals the file's row count.
 */
export class CatalogoCargaMasivaCompletada implements DomainEvent {
  readonly type = 'catalogo.carga_masiva_completada';
  readonly occurredAt = new Date();

  constructor(
    readonly companyId: string,
    readonly totalCargados: number,
    readonly totalFallidos: number,
  ) {}
}
