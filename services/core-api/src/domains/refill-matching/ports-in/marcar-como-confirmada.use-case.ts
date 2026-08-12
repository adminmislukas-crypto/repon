import { Inject, Injectable } from '@nestjs/common';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';

/**
 * `refill-matching/SPEC.md`'s `marcarComoConfirmada(refillRequestId)` —
 * design.md D6/D-G.2. Same shape as its sibling `MarcarComoOfertadaUseCase`
 * (see that file's doc comment for the full rationale): a 1-line-body
 * wrapper around `RefillRepository.actualizarEstado`, this use case's job is
 * only to persist the `'ofertada' -> 'confirmada'` transition
 * (`marcarConfirmada()`, `domain/refill-request.entity.ts`, PR2) via the
 * narrow single-column `UPDATE` `actualizarEstado` already provides —
 * `save()` is never called, `refill_items` is never touched.
 *
 * **No HTTP route, no caller in this change (D6)** — same orphan-surface
 * class as `consumo`'s `adherenciaUltimos7Dias()`. Constructor injects ONLY
 * `REFILL_REPOSITORY` — no `EVENT_PUBLISHER`, no `AuditLogPort` (D16).
 */
@Injectable()
export class MarcarComoConfirmadaUseCase {
  constructor(@Inject(REFILL_REPOSITORY) private readonly refillRepository: RefillRepository) {}

  async execute(refillRequestId: string): Promise<void> {
    await this.refillRepository.actualizarEstado(refillRequestId, 'confirmada');
  }
}
