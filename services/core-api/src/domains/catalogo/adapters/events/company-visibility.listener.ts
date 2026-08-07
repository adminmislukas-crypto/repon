import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OcultarCatalogoEmpresaUseCase } from '../../ports-in/ocultar-catalogo-empresa.use-case';
import { RestaurarCatalogoEmpresaUseCase } from '../../ports-in/restaurar-catalogo-empresa.use-case';
import type { EmpresaOcultablePayload } from './identidad-event.payloads';

/**
 * design.md D-A: `catalogo`'s ONLY event consumer — the first domain in
 * this repo to actually populate `adapters/events/` (core-api-hexagonal-
 * layout, "catalogo has adapters/events because it consumes events").
 * Subscribes by channel-NAME STRING, never by importing `identidad`'s
 * event classes — see `identidad-event.payloads.ts`'s doc comment for the
 * full rationale.
 *
 * Routes THREE channels to TWO use cases: `empresa.suspendida` hides,
 * `empresa.reactivada` AND `empresa.aprobada` BOTH restore, through the
 * SAME `RestaurarCatalogoEmpresaUseCase` (Diagram 2's "MISMO handler"
 * note). Consuming `EmpresaAprobada` is NOT redundant even though a
 * `pendiente` company was never in the deny-list: `AprobarEmpresaUseCase`
 * has no state precondition, so an admin approving an already-suspended
 * company also transitions it to `activo` while publishing
 * `EmpresaAprobada` — without this subscription, that company would stay
 * `activo` with its catalog hidden forever (fail-CLOSED, invisible).
 * Named, out-of-scope follow-up: giving `aprobarEmpresa` its own
 * precondition — fixing it here would violate R9 (`identidad` touched
 * only additively, PR 7).
 *
 * `EventEmitterPublisher.publish` uses `emitAsync` — a rejecting listener
 * here would propagate BACK into the producer's `publish()` call, turning
 * `suspenderEmpresa`'s successful, already-committed 204 into a 5xx for an
 * operation the admin would then retry unnecessarily. Every handler below
 * therefore catches everything and never re-throws — a deliberate
 * fail-open (R4, accepted and scoped: `provider_catalog` rows are already
 * public marketplace data via `disponible = true`, so a missed hide leaks
 * nothing new). `logger.error({ evento, companyId })` is the input for the
 * reconciliation follow-up the proposal already left out of scope.
 */
@Injectable()
export class CompanyVisibilityListener {
  private readonly logger = new Logger(CompanyVisibilityListener.name);

  constructor(
    private readonly ocultarCatalogoEmpresaUseCase: OcultarCatalogoEmpresaUseCase,
    private readonly restaurarCatalogoEmpresaUseCase: RestaurarCatalogoEmpresaUseCase,
  ) {}

  @OnEvent('empresa.suspendida')
  async onEmpresaSuspendida(payload: EmpresaOcultablePayload): Promise<void> {
    try {
      await this.ocultarCatalogoEmpresaUseCase.execute(payload.companyId, payload.motivo ?? null);
    } catch (error) {
      this.logError('empresa.suspendida', payload.companyId, error);
    }
  }

  @OnEvent('empresa.reactivada')
  async onEmpresaReactivada(payload: EmpresaOcultablePayload): Promise<void> {
    await this.restaurar('empresa.reactivada', payload);
  }

  @OnEvent('empresa.aprobada')
  async onEmpresaAprobada(payload: EmpresaOcultablePayload): Promise<void> {
    await this.restaurar('empresa.aprobada', payload);
  }

  private async restaurar(evento: string, payload: EmpresaOcultablePayload): Promise<void> {
    try {
      await this.restaurarCatalogoEmpresaUseCase.execute(payload.companyId);
    } catch (error) {
      this.logError(evento, payload.companyId, error);
    }
  }

  private logError(evento: string, companyId: string, error: unknown): void {
    this.logger.error({ evento, companyId }, error instanceof Error ? error.stack : String(error));
  }
}
