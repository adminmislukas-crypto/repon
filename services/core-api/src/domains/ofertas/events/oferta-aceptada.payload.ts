/**
 * Una línea del payload extendido de `OfertaAceptada`
 * (`backend-core-api-pedidos-pagos` design.md D-B.4/D1). Vocabulario PROPIO
 * de `ofertas` viajando por el bus — nunca el tipo `OfferItem` exportado de
 * `@repon/types` — para que un cambio de forma en `OfferItem` no rompa a
 * `pedidos-pagos` en silencio; `pedidos-pagos` redeclara su propia forma de
 * consumo local (mismo patrón "payloads locales" que este mismo evento ya
 * usa con `refill-matching`, D3).
 */
export interface OfertaAceptadaLineaPayload {
  readonly offerItemId: string;
  readonly nombre: string;
  /** `-> precio_unitario Y subtotal` en `pedidos-pagos` (`cantidad` es
   *  siempre 1 ahí, design.md D-B.3 de ese cambio). */
  readonly precio: number;
  readonly isAlt: boolean;
  readonly altSize?: number;
  readonly altQty?: number;
  readonly altNote?: string;
}

/**
 * `ofertas/SPEC.md`'s "Eventos que publica" — design.md D6 (verbatim), D-D's
 * Diagrama, paso 4. Published by `AceptarOfertaUseCase` (Phase 7a, this
 * event's only publisher) strictly AFTER `runInTransaction` commits, never
 * before/inside its callback — same discipline as `OfertaEnviada`: a
 * consumer must never react to a write that got rolled back.
 *
 * Fields anidados bajo `payload`, no aplanados sobre la instancia del
 * evento (design.md D-F: "es la forma de `consumo` y de `refill-matching`").
 */
export interface OfertaAceptadaPayload {
  readonly offerId: string;
  readonly companyId: string;
  readonly userId: string;
  /**
   * `null` para una oferta proactiva (D12) — el mismo negativo obligatorio
   * D18-3 que `OfertaEnviadaPayload.refillRequestId` sobre el que rama el
   * `OfertaAceptadaListener` de `refill-matching` (Phase 8a): "una oferta
   * proactiva no tiene solicitud que transicionar (a `'confirmada'`)".
   */
  readonly refillRequestId: string | null;
  readonly total: number;
  /**
   * Los ids de las ofertas hermanas (mismo `refillRequestId`, `status`
   * `'pendiente'`) que esta aceptación desplazó a `'rechazada'` —
   * EXACTAMENTE lo que `OfferRepository.desplazarHermanas`'s propio
   * `UPDATE ... RETURNING id` devolvió (design.md D-D), nunca una lista
   * calculada por separado en el caso de uso. `[]` para una oferta
   * proactiva (D12) o para una reactiva sin hermanas `'pendiente'` al
   * momento de aceptar.
   */
  readonly desplazadas: readonly string[];
  /**
   * Aditivo (`backend-core-api-pedidos-pagos` D1/D-B.4) — copiado de
   * `offers.costoDespacho` sin recalcular. `refill-matching`'s
   * `OfertaAceptadaListener` redeclara su propio payload local con solo 2
   * campos, así que este campo nuevo le es invisible (R8): esa es
   * exactamente la propiedad que compra el patrón de payloads locales.
   */
  readonly costoDespacho: number;
  /** Aditivo, mismo motivo — ver `OfertaAceptadaLineaPayload`. */
  readonly lineas: readonly OfertaAceptadaLineaPayload[];
}
