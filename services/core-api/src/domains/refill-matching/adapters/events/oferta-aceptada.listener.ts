import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MarcarComoConfirmadaUseCase } from '../../ports-in/marcar-como-confirmada.use-case';
import type { OfertaAceptadaPayload } from './ofertas-event.payloads';

/**
 * design.md D-F/D7, tasks.md 8a.4/8a.5 — `refill-matching`'s FIRST caller of
 * `MarcarComoConfirmadaUseCase` (built with zero callers in
 * `backend-core-api-refill-matching`'s own PR7). Identical shape to its
 * sibling `OfertaEnviadaListener` (see that file's doc comment for the full
 * rationale): subscribes by channel-NAME STRING (`'ofertas.oferta_aceptada'`),
 * never by importing `ofertas`' real `OfertaAceptada` event class.
 *
 * **The `null` branch is not a defensive `if`, it is half the contract**
 * (D12, `core-api-refill-matching` scenario "A proactive OfertaAceptada does
 * not call marcarComoConfirmada"): a proactive offer has no `RefillRequest`
 * to transition — early `return`, never a `?.`, never a cast.
 *
 * `EventEmitterPublisher.publish` uses `emitAsync` — a rejecting listener
 * here would propagate BACK into `ofertas`' own `aceptarOferta`, turning an
 * ALREADY-COMMITTED acceptance into a 5xx for the user who just accepted.
 * Catches everything, NEVER re-throws (D18-5, `core-api-refill-matching`
 * scenario "Neither listener re-throws back into ofertas").
 */
@Injectable()
export class OfertaAceptadaListener {
  private readonly logger = new Logger(OfertaAceptadaListener.name);

  constructor(private readonly marcarComoConfirmadaUseCase: MarcarComoConfirmadaUseCase) {}

  @OnEvent('ofertas.oferta_aceptada')
  async onOfertaAceptada(event: { payload: OfertaAceptadaPayload }): Promise<void> {
    const { offerId, refillRequestId } = event.payload;
    if (refillRequestId === null) return;
    try {
      await this.marcarComoConfirmadaUseCase.execute(refillRequestId);
    } catch (error) {
      this.logger.error(
        { evento: 'ofertas.oferta_aceptada', offerId, refillRequestId },
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
