import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `core-api-identidad` spec, "reactivarEmpresa reverses a suspension" —
 * the reverse edge of `EmpresaSuspendida` (D16/D-D,
 * `backend-core-api-catalogo`). `catalogo`'s `CompanyVisibilityListener`
 * (Phase 8a) routes this to the SAME handler as `EmpresaAprobada`, since
 * `aprobarEmpresa` has no state precondition and can also move a company
 * out of `'suspendido'`. Published by `ReactivarEmpresaUseCase` only after
 * commit.
 */
export class EmpresaReactivada implements DomainEvent {
  readonly type = 'empresa.reactivada';
  readonly occurredAt = new Date();

  constructor(
    readonly companyId: string,
    readonly motivo: string,
  ) {}
}
