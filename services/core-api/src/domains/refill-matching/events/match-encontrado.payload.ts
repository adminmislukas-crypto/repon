import type { RefillSolicitudPayload } from './refill-solicitud.payload';

/**
 * design.md D-C, Decisión 2/3 — `MatchEncontrado`'s payload. Extends
 * `RefillSolicitudPayload` rather than duplicating it (Decisión 3: the two
 * events are self-sufficient and share the same base ON PURPOSE, so `ofertas`
 * never has to hold state from `RefillCreado` to be able to process this
 * one) and adds exactly the two outputs `buscarProveedoresCompatibles`
 * itself computes.
 *
 * NO `ProviderCatalogItem` snapshot travels here — no `precioBase`,
 * `precioMaximo`, `stock`, `disponible`, nothing from `catalogo`'s own
 * vocabulary (design.md D-C, three independent reasons, any one of which is
 * enough: (1) it's another domain's vocabulary — embedding it couples
 * `refill-matching`'s event to a `catalogo` change; (2) prices go stale
 * between the match and the eventual offer, with no way for `ofertas` to
 * know; (3) it would freeze past C4's visibility filter — a company hidden
 * moments later would still look live inside an already-published event).
 * `ofertas` re-queries `CatalogQueryPort.buscarCoincidencias` per
 * `companyId` instead, for genuinely fresh prices and current visibility.
 */
export interface MatchEncontradoPayload extends RefillSolicitudPayload {
  /**
   * Empresas con al menos una coincidencia. Deduplicado, orden ESTABLE
   * (primera aparición) — nunca ordenado alfabéticamente, nunca arbitrario.
   * Esta es la lista de a quién notificar. Se publica también como `[]`
   * cuando no hubo coincidencias (ver la propia spec: "A zero-match search
   * still publishes MatchEncontrado") — un hecho accionable que este dominio
   * posee, nunca un evento suprimido.
   */
  readonly companyIds: readonly string[];
  /**
   * Ids de `provider_catalog` que matchearon — el conjunto COMPLETO que
   * devolvió el puerto, sin dedup adicional (a diferencia de `companyIds`,
   * que sí se deduplica). Registro preciso de qué matcheó en este instante;
   * re-derivarlo llamando de nuevo a `buscarCoincidencias` daría un
   * resultado distinto si el catálogo cambió mientras tanto.
   */
  readonly providerCatalogItemIds: readonly string[];
}
