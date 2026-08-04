/**
 * Base shape every domain event extends. `type` is the event name used as
 * the `EventEmitter2` channel (e.g. `'usuario.registrado'`); a subscriber
 * pattern-matches on it via `@OnEvent(type)`. Kept intentionally minimal —
 * no domain payload here, each domain's own event (e.g.
 * `UsuarioRegistrado`, Phase 4c) extends this with its own fields.
 */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}
