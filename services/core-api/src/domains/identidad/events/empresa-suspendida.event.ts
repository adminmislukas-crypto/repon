import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `identidad/SPEC.md`'s "Eventos que publica" list — "obliga a `catalogo` a
 * ocultar su catálogo y a `refill-matching` a excluirla del matching".
 * Published by `SuspenderEmpresaUseCase` only after commit.
 */
export class EmpresaSuspendida implements DomainEvent {
  readonly type = 'empresa.suspendida';
  readonly occurredAt = new Date();

  constructor(
    readonly companyId: string,
    readonly motivo: string,
  ) {}
}
