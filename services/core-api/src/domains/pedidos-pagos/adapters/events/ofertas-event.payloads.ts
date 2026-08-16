import type { NuevaLineaPedido } from '../../domain/order.entity';

/**
 * Forma local del payload real de `OfertaAceptada` de `ofertas`
 * (`domains/ofertas/events/oferta-aceptada.payload.ts`, que lleva 8 campos)
 * — solo los que este dominio consume (design.md D3/D-F). Deliberadamente
 * NO importa el tipo real ni la clase del evento: `oferta-aceptada.listener.ts`
 * suscribe por NOMBRE DE CANAL STRING (`'ofertas.oferta_aceptada'`), mismo
 * patrón que `refill-matching/adapters/events/ofertas-event.payloads.ts` ya
 * estableció para el mismo evento. `refillRequestId`/`desplazadas` del
 * payload real NO viajan acá — este dominio no los necesita, y declararlos
 * sería acoplarse a campos que nunca lee.
 */
export interface OfertaAceptadaPayload {
  readonly offerId: string;
  readonly companyId: string;
  readonly userId: string;
  readonly total: number;
  readonly costoDespacho: number;
  readonly lineas: readonly NuevaLineaPedido[];
}
