/**
 * design.md's DI token table: lives in the shared kernel even though
 * `consumo`/`ofertas`/`pedidos-pagos`'s own `SPEC.md` list it among their
 * ports-out — push notifications are shared infra, not domain logic
 * (`core-api/SPEC.md`, "Infraestructura compartida"). This is the
 * authoritative shape; reconciling each domain's `SPEC.md` is Phase 5's job.
 *
 * Interface + token only (task 3.9) — no `useValue: {}`, no adapter. The
 * real Expo Push adapter is a future domain's job; a token with no
 * provider and nothing injecting it yet is inert by construction.
 */
export interface NotificationPort {
  sendPush(recipientProfileId: string, mensaje: string): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
