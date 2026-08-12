import { Inject, Injectable } from '@nestjs/common';
import { REFILL_REPOSITORY, type RefillRepository } from '../ports-out/refill-repository.port';

/**
 * `refill-matching/SPEC.md`'s `marcarComoOfertada(refillRequestId)` — design.md
 * D6/D-G.2. A 1-line-body wrapper around `RefillRepository.actualizarEstado`
 * (PR1's port declaration, PR3's `KyselyRefillRepository` implementation):
 * this task is that method's FIRST caller in this change.
 *
 * The domain-level transition (`marcarOfertada()`, `'abierta' -> 'ofertada'`,
 * `domain/refill-request.entity.ts`, PR2) is intentionally NOT called here —
 * unlike `completarBorrador` (which reads the full entity, calls
 * `completar()`, then `save()`s the whole thing back), this use case has no
 * reason to round-trip the entity through memory: `actualizarEstado` is
 * `RefillRepository`'s own narrow, single-column `UPDATE` (D-G.2, "nunca
 * reescribe ítems"), and the state transition it performs is exactly
 * `marcarOfertada`'s. The pure function stays as living documentation of the
 * invariant (no out-of-order transitions); this adapter-facing wrapper is
 * what a future caller (D6: `ofertas`, out of scope here) will actually
 * invoke.
 *
 * **No HTTP route, no caller in this change (D6)** — same class of orphan
 * public surface as `consumo`'s `adherenciaUltimos7Dias()`: a real, tested
 * method with zero current consumers, built because the interface/state
 * machine already demand it exist, not built speculatively for a use case
 * this change doesn't otherwise need. Constructor injects ONLY
 * `REFILL_REPOSITORY` — no `EVENT_PUBLISHER`, no `AuditLogPort` (D16): this
 * transition publishes nothing and carries no audit trail of its own in this
 * change's scope.
 */
@Injectable()
export class MarcarComoOfertadaUseCase {
  constructor(@Inject(REFILL_REPOSITORY) private readonly refillRepository: RefillRepository) {}

  async execute(refillRequestId: string): Promise<void> {
    await this.refillRepository.actualizarEstado(refillRequestId, 'ofertada');
  }
}
