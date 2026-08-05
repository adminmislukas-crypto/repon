import type { Profile } from '@repon/types';
import type { DomainEvent } from '../../../shared/event-bus/domain-event';

/**
 * `identidad/SPEC.md`'s "Eventos que publica" list — published by
 * `RegistrarUsuarioUseCase` after `insertIfAbsent` succeeds (design.md D-B
 * step 3), never on a compensated/failed registration. Channel name
 * (`type`) mirrors `EventEmitterPublisher`'s dot-case convention.
 */
export class UsuarioRegistrado implements DomainEvent {
  readonly type = 'usuario.registrado';
  readonly occurredAt = new Date();

  constructor(readonly profile: Profile) {}
}
