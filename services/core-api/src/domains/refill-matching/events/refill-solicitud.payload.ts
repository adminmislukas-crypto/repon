import type { Urgencia } from '@repon/types';

/**
 * Shared payload shape for `RefillCreado`/`MatchEncontrado` (design.md D-C,
 * "Los payloads" — verbatim). D-C's rule, inherited from `consumo`'s D-D and
 * extended with the half that was missing: `refill-matching` publishes the
 * facts it OWNS and the outputs it itself computed, in its own vocabulary,
 * plus the correlation keys a consumer needs to act. It never re-publishes
 * another domain's vocabulary — not another domain's enum, not the SHAPE of
 * another domain's entity, even when it is holding it in hand
 * (`ProviderCatalogItem` never travels — design.md Decisión 2). `Urgencia`
 * and `RefillEstado` ARE this domain's own vocabulary (D11), so publishing
 * `urgencia` here is exactly correct — the mirror image of why `consumo`
 * refuses to publish it.
 */
export interface RefillSolicitudItemPayload {
  /** `refill_items.id`. La clave con la que `ofertas` arma
   *  `OfferItemReactiva.refillItemId` sin volver a consultar nada. */
  readonly refillItemId: string;
  readonly nombre: string;
  /** Requeridos y no opcionales: estos eventos SOLO se publican sobre una
   *  solicitud activa (Decisión 1), y `RefillRequestActiva` los garantiza. */
  readonly categoria: string;
  readonly precioReferencia: number;
  readonly catalogProductId: string | null;
}

export interface RefillSolicitudPayload {
  readonly refillRequestId: string;
  /** `ofertas` denormaliza `offers.user_id` A PROPOSITO (su SPEC.md) para no
   *  derivarlo por join contra `refill_requests`. Bajo D7 no existe camino
   *  síncrono de vuelta: si no viaja acá, no hay de dónde sacarlo. */
  readonly userId: string;
  /** Clave estructurada de zona de despacho: un proveedor la necesita para
   *  cotizar `costoDespacho`/`tiempoEntregaHoras`. */
  readonly comuna: string;
  /**
   * `direccion` NO viaja, y es una decisión de privacidad, no un olvido: es
   * texto libre con PII y NO hace falta para componer una oferta. Entra en
   * juego recién en `pedidos-pagos`, al despachar. La regla: el evento lleva
   * lo mínimo para ACTUAR, no todo lo que el emisor tiene en la mano.
   */
  readonly urgencia: Urgencia;
  readonly items: readonly RefillSolicitudItemPayload[];
}
