import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/** `identidad/SPEC.md`'s "Eventos que publica" list — published by `RegistrarEmpresaUseCase`. */
export class EmpresaRegistrada implements DomainEvent {
  readonly type = 'empresa.registrada';
  readonly occurredAt = new Date();

  constructor(readonly companyId: string) {}
}
