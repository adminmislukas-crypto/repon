import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `identidad/SPEC.md`'s "Eventos que publica" list — "habilita a `catalogo`
 * y `refill-matching` a considerar esta empresa". Published by
 * `AprobarEmpresaUseCase` only AFTER the mutation+audit transaction commits
 * (`core-api-identidad` spec, "Admin mutations audit inside the same
 * transaction").
 */
export class EmpresaAprobada implements DomainEvent {
  readonly type = 'empresa.aprobada';
  readonly occurredAt = new Date();

  constructor(readonly companyId: string) {}
}
