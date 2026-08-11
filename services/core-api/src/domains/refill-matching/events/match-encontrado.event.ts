import type { DomainEvent } from '../../../shared/event-bus/domain-event';
import type { MatchEncontradoPayload } from './match-encontrado.payload';

/**
 * `refill-matching/SPEC.md`'s "Eventos que publica" — design.md D-C
 * (Decisión 2/3) / D15. Published by `BuscarProveedoresCompatiblesUseCase`
 * (Phase 5a) right after `CatalogQueryPort.buscarCoincidencias` resolves —
 * OUTSIDE any transaction, because there is none to be inside of: this use
 * case never injects `TRANSACTION_MANAGER` (D14/R3). Published even when
 * `companyIds` is `[]`: "buscamos y no hay nadie" is a fact this domain owns
 * and `ofertas` can act on, never suppressed (design.md's zero-match
 * scenario) — the same silent-failure family D3 and the 409-on-borrador rule
 * (D-F) both guard against.
 */
export class MatchEncontrado implements DomainEvent {
  readonly type = 'refill.match_encontrado';
  readonly occurredAt = new Date();

  constructor(readonly payload: MatchEncontradoPayload) {}
}
