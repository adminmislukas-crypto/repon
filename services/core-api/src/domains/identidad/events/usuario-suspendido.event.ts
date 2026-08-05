import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `identidad/SPEC.md`'s "Eventos que publica" list. Published by
 * `SuspenderUsuarioUseCase` only after its mutation+audit transaction
 * commits.
 */
export class UsuarioSuspendido implements DomainEvent {
  readonly type = 'usuario.suspendido';
  readonly occurredAt = new Date();

  constructor(
    readonly profileId: string,
    readonly motivo: string,
  ) {}
}
