import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CrearBorradorRefillUseCase } from '../../ports-in/crear-borrador-refill.use-case';
import type { RefillAutoSolicitadoPayload } from './consumo-event.payloads';

/**
 * design.md Diagrama 3 (D2 + D3 + D8 + D-D + R5) — `refill-matching`'s
 * FIRST event consumer, and its ONLY one in this change. Subscribes by
 * channel-NAME STRING, never by importing `consumo`'s event class — see
 * `consumo-event.payloads.ts`'s doc comment for the full rationale.
 *
 * Subscribes ONLY to `consumo.refill_auto_solicitado` — deliberately NOT
 * `consumo.stock_bajo_detectado` (D2). This is not saved work, it is
 * AUTHORIZATION: both events carry the same underlying `StockBajoPayload`
 * shape, but `RefillAutoSolicitado` only fires when
 * `consumption.autoCrearRefill` is `true` — it carries CONSENT, not just an
 * observed fact (`consumo/events/refill-auto-solicitado.event.ts`'s own doc
 * comment). Subscribing to both would create a `RefillRequest` for a user
 * who never asked for one. Tasks.md 6a.4's D17 negative proves this
 * structurally, not just by omission — see this file's `.spec.ts`.
 *
 * **Payload shape gotcha, worth naming explicitly**: `EventEmitterPublisher.
 * publish(event)` does `emitter.emitAsync(event.type, event)` — the WHOLE
 * event instance is what an `@OnEvent` handler receives, never `event.
 * payload` pre-unwrapped for it. `identidad`'s events (`EmpresaSuspendida`/
 * etc., what `CompanyVisibilityListener` consumes) happen to flatten their
 * fields directly onto the instance, so `payload: EmpresaOcultablePayload`
 * "just works" there. `consumo`'s `RefillAutoSolicitado`, like this domain's
 * own `RefillCreado`/`MatchEncontrado`, instead NESTS its fields under a
 * `payload: StockBajoPayload` property. This handler's parameter type
 * reflects that real shape (`{ payload: RefillAutoSolicitadoPayload }`) and
 * destructures `.payload` explicitly — typing the parameter as a flattened
 * `RefillAutoSolicitadoPayload` directly would silently read every field as
 * `undefined` at runtime (TypeScript cannot catch this: `@OnEvent` handler
 * parameters are untyped from the framework's side). tasks.md 6a.7's e2e
 * contract test, which publishes a REAL `RefillAutoSolicitado` instance
 * through the REAL event bus, is what would have caught this the hard way.
 *
 * `EventEmitterPublisher.publish` uses `emitAsync` — a rejecting listener
 * here would propagate BACK into `consumo`'s `procesarConsumosVencidos`,
 * aborting the rest of that cron run's items. Catches everything, never
 * re-throws (R5) — same pattern `CompanyVisibilityListener` already
 * established, one of this change's 4 mandatory D17 negatives (tasks.md
 * 6a.4, `core-api-refill-matching` spec "the listener captures and logs,
 * never re-throws").
 */
@Injectable()
export class RefillAutoSolicitadoListener {
  private readonly logger = new Logger(RefillAutoSolicitadoListener.name);

  constructor(private readonly crearBorradorRefillUseCase: CrearBorradorRefillUseCase) {}

  @OnEvent('consumo.refill_auto_solicitado')
  async onRefillAutoSolicitado(event: { payload: RefillAutoSolicitadoPayload }): Promise<void> {
    try {
      await this.crearBorradorRefillUseCase.execute(event.payload);
    } catch (error) {
      this.logger.error(
        { evento: 'consumo.refill_auto_solicitado', ...event.payload },
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
