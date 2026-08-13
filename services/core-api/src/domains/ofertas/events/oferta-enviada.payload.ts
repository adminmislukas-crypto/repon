import type { OfferKind } from '@repon/types';

/**
 * `ofertas/SPEC.md`'s "Eventos que publica" — design.md D6 (verbatim),
 * Diagrama 2 paso 11. Published by `EnviarOfertaUseCase` (Phase 5a, this
 * event's only publisher today) and, later, `EnviarOfertaProactivaUseCase`
 * (Phase 6b) — both strictly AFTER `runInTransaction` commits, never
 * before/inside its callback (same discipline as
 * `RefillCreado`/`DosisRegistrada`: a consumer must never react to a write
 * that got rolled back).
 *
 * Fields anidados bajo `payload`, no aplanados sobre la instancia del
 * evento (design.md D-F: "es la forma de `consumo` y de `refill-matching`",
 * y la que el gotcha de `emitAsync` obliga a respetar del lado del
 * consumidor).
 */
export interface OfertaEnviadaPayload {
  readonly offerId: string;
  readonly kind: OfferKind;
  readonly companyId: string;
  readonly userId: string;
  /**
   * `null` para una oferta proactiva (Phase 6b) — el negativo obligatorio
   * de D18-3 sobre el que rama el `OfertaEnviadaListener` de
   * `refill-matching` (Phase 8a): "una oferta proactiva no tiene solicitud
   * que transicionar". `EnviarOfertaUseCase` (esta fase) SIEMPRE la publica
   * no-nula — viene directo del `refillRequestId` que el proveedor invocó.
   */
  readonly refillRequestId: string | null;
  readonly total: number;
  readonly tiempoEntregaHoras: number;
}
