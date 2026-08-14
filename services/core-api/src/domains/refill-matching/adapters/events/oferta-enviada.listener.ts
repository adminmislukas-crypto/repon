import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MarcarComoOfertadaUseCase } from '../../ports-in/marcar-como-ofertada.use-case';
import type { OfertaEnviadaPayload } from './ofertas-event.payloads';

/**
 * design.md D-F/D7, tasks.md 8a.2/8a.3 — `refill-matching`'s FIRST caller of
 * `MarcarComoOfertadaUseCase` (built with zero callers in
 * `backend-core-api-refill-matching`'s own PR7). Subscribes by channel-NAME
 * STRING (`'ofertas.oferta_enviada'`), never by importing `ofertas`' real
 * `OfertaEnviada` event class — see `ofertas-event.payloads.ts`'s doc comment
 * for the full rationale.
 *
 * **The `null` branch is not a defensive `if`, it is half the contract**
 * (D6, `core-api-refill-matching` scenario "A proactive OfertaEnviada does
 * not call marcarComoOfertada"): a proactive offer has no `RefillRequest` to
 * transition, so an early `return` skips the use case entirely — never a
 * `?.`, never a cast, never a silently-wrong call with a fabricated id.
 *
 * **Payload shape gotcha, same one `match-encontrado.listener.ts`/
 * `refill-auto-solicitado.listener.ts` document**: `EventEmitterPublisher.
 * publish(event)` does `emitter.emitAsync(event.type, event)` — the WHOLE
 * event instance is what an `@OnEvent` handler receives, never `event.
 * payload` pre-unwrapped for it. `ofertas`' `OfertaEnviada`, like every other
 * domain event in this repo, NESTS its fields under a `payload:
 * OfertaEnviadaPayload` property — this handler's parameter type reflects
 * that real shape.
 *
 * `EventEmitterPublisher.publish` uses `emitAsync` — a rejecting listener
 * here would propagate BACK into `ofertas`' own `enviarOferta`/
 * `enviarOfertaProactiva`, turning an ALREADY-COMMITTED, successful offer
 * into a 5xx for the provider who just sent it. Catches everything, NEVER
 * re-throws (D18-5, `core-api-refill-matching` scenario "Neither listener
 * re-throws back into ofertas") — the most expensive of this change's 5
 * mandatory D18 negatives to skip.
 */
@Injectable()
export class OfertaEnviadaListener {
  private readonly logger = new Logger(OfertaEnviadaListener.name);

  constructor(private readonly marcarComoOfertadaUseCase: MarcarComoOfertadaUseCase) {}

  @OnEvent('ofertas.oferta_enviada')
  async onOfertaEnviada(event: { payload: OfertaEnviadaPayload }): Promise<void> {
    const { offerId, refillRequestId } = event.payload;
    if (refillRequestId === null) return;
    try {
      await this.marcarComoOfertadaUseCase.execute(refillRequestId);
    } catch (error) {
      this.logger.error(
        { evento: 'ofertas.oferta_enviada', offerId, refillRequestId },
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
