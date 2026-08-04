/**
 * `AuditLog` is not an `identidad` entity — no domain `SPEC.md` declares it
 * as an owned entity; it has no use cases, no lifecycle, no events, and
 * `entityType` is polymorphic by design. It belongs to the "shared
 * infrastructure" category `services/core-api/SPEC.md` already defines,
 * alongside Auth, Notifications, and the payment gateway.
 */
export interface AuditLog {
  id: string;
  actorProfileId: string;
  accion: string;
  entityType: string;
  /** Polymorphic, no FK — see `audit_log.entity_id` comment on column. */
  entityId: string;
  cambios: Record<string, unknown>;
  motivo?: string;
  createdAt: string;
}
