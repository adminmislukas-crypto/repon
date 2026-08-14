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
}
