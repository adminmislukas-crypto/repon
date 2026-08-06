import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `catalogo/SPEC.md`'s "Eventos que publica" list. Published only by
 * `CargarProductoCatalogoUseCase`, after `save()` commits (core-api-catalogo
 * spec, "cargarProductoCatalogo scopes the new item to the actor's
 * company", Scenario "Provider loads their own product"). Never published
 * by `cargarCatalogoMasivo` — batch operations publish only their own
 * summary event (D3, core-api-catalogo "Per-item events never fire during
 * batch operations").
 *
 * Created in this PR (4a) rather than 4b: `CargarProductoCatalogoUseCase`
 * needs a concrete class to import and publish, and design.md's file tree
 * lists this as its own file under `events/` regardless of which PR creates
 * it — a natural dependency of the use case, not scope creep. The sibling
 * events `PrecioActualizado`/`CatalogoCargaMasivaCompletada`/
 * `PreciosCategoriaAjustados` land in their own later PRs (4b/5b/6),
 * alongside the use case that actually publishes each one.
 */
export class ProductoAgregado implements DomainEvent {
  readonly type = 'producto.agregado';
  readonly occurredAt = new Date();

  constructor(
    readonly companyId: string,
    readonly itemId: string,
  ) {}
}
