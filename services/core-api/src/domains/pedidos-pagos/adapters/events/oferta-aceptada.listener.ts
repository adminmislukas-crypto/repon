import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrearPedidoDesdeOfertaUseCase } from '../../ports-in/crear-pedido-desde-oferta.use-case';
import type { OfertaAceptadaPayload } from './ofertas-event.payloads';

/**
 * design.md D3/D-F Diagrama 1 — el único listener de `pedidos-pagos`,
 * FIRST caller de `CrearPedidoDesdeOfertaUseCase`. Suscribe por NOMBRE DE
 * CANAL STRING (`'ofertas.oferta_aceptada'`), nunca importando la clase
 * real del evento de `ofertas` — el payload se tipa con la interfaz LOCAL
 * de `ofertas-event.payloads.ts`. `emitAsync` entrega la instancia
 * COMPLETA: el handler tipa `{ payload: ... }` y desestructura (gotcha
 * heredado, ya documentado en `refill-matching`'s propios listeners de
 * este mismo evento).
 *
 * Captura y loguea, **NUNCA re-lanza** (D3/R8 — negativo obligatorio de
 * D6): `EventEmitterPublisher.publish` usa `emitAsync`, así que un
 * rechazo acá propagaría DE VUELTA a `AceptarOfertaUseCase` DESPUÉS de su
 * propio commit, convirtiendo una aceptación ya exitosa en un 5xx para el
 * usuario que la disparó.
 */
@Injectable()
export class OfertaAceptadaListener {
  private readonly logger = new Logger(OfertaAceptadaListener.name);

  constructor(private readonly crearPedidoDesdeOfertaUseCase: CrearPedidoDesdeOfertaUseCase) {}

  @OnEvent('ofertas.oferta_aceptada')
  async onOfertaAceptada(event: { payload: OfertaAceptadaPayload }): Promise<void> {
    const { offerId, companyId, userId, total, costoDespacho, lineas } = event.payload;
    try {
      await this.crearPedidoDesdeOfertaUseCase.execute({
        offerId,
        userId,
        companyId,
        total,
        costoDespacho,
        lineas,
      });
    } catch (error) {
      this.logger.error(
        { evento: 'ofertas.oferta_aceptada', offerId },
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
