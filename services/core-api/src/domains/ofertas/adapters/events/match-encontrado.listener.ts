import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RegistrarOportunidadUseCase } from '../../ports-in/registrar-oportunidad.use-case';
import type { MatchEncontradoPayload } from './refill-matching-event.payloads';

/**
 * design.md Diagrama 1 (D2 + D5 + R5), tasks.md 4a.5/4a.6 — `ofertas`' FIRST
 * event consumer. Subscribes by channel-NAME STRING
 * (`'refill.match_encontrado'`), never by importing `refill-matching`'s real
 * `MatchEncontrado` event class — see `refill-matching-event.payloads.ts`'s
 * doc comment for the full rationale.
 *
 * Deliberately has **NO** `@OnEvent('refill.creado')` handler anywhere in
 * `ofertas/adapters/events/` (design.md D2, `core-api-ofertas` spec
 * "RefillCreado alone creates no opportunity"). This is not saved work, it
 * is AUTHORIZATION: `RefillCreado` does not carry `companyIds` — there is no
 * eligibility fact to project yet. Subscribing to it would create an
 * `offer_opportunities` row with zero eligible companies for EVERY solicitud
 * created, before any matching ever ran. `match-encontrado.listener.spec.ts`'s
 * own structural inspection test proves this (D18-5's sibling negative), not
 * just "we didn't write one".
 *
 * **Payload shape gotcha, same one `refill-auto-solicitado.listener.ts`
 * documents**: `EventEmitterPublisher.publish(event)` does
 * `emitter.emitAsync(event.type, event)` — the WHOLE event instance is what
 * an `@OnEvent` handler receives, never `event.payload` pre-unwrapped for
 * it. `refill-matching`'s `MatchEncontrado`, like `consumo`'s
 * `RefillAutoSolicitado`, NESTS its fields under a `payload:
 * MatchEncontradoPayload` property — this handler's parameter type reflects
 * that real shape (`{ payload: MatchEncontradoPayload }`) and destructures
 * nothing eagerly, passing `event.payload` straight through to the use case.
 *
 * `EventEmitterPublisher.publish` uses `emitAsync` — a rejecting listener
 * here would propagate BACK into `refill-matching`'s own
 * `buscarProveedoresCompatibles` publish call, turning a SUCCESSFUL match
 * search into a 5xx there. Catches everything, NEVER re-throws (R5) — one of
 * this change's 5 mandatory D18 negatives (tasks.md 4a.5, `core-api-ofertas`
 * spec "A projection write failure does not propagate to the emitter").
 */
@Injectable()
export class MatchEncontradoListener {
  private readonly logger = new Logger(MatchEncontradoListener.name);

  constructor(private readonly registrarOportunidadUseCase: RegistrarOportunidadUseCase) {}

  @OnEvent('refill.match_encontrado')
  async onMatchEncontrado(event: { payload: MatchEncontradoPayload }): Promise<void> {
    try {
      await this.registrarOportunidadUseCase.execute(event.payload);
    } catch (error) {
      this.logger.error(
        { evento: 'refill.match_encontrado', ...event.payload },
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
