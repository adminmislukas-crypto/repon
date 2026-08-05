# shared-audit-log Specification

## Purpose

`AuditLogPort`: a write-only, shared-kernel port over the append-only `audit_log` table (D-C), consumed by any domain's admin-mutating use cases — not owned by `identidad`, even though `identidad` is its first and only caller in this change.

## Requirements

### Requirement: AuditLogPort lives in the shared kernel, not in any domain's ports-out

`AuditLogPort` and its token `AUDIT_LOG_PORT` MUST live in `src/shared/audit/`. No domain's `ports-out/` MUST declare a competing audit interface over the same table — `AuditLog` is not an entity any domain `SPEC.md` owns, has no lifecycle, and `entity_type` is polymorphic by design.

```ts
interface AuditEntry {
  actorProfileId: string // always an authenticated admin
  accion: string // snake_case, matches the use-case name: 'aprobar_empresa'
  entityType: string // singular snake_case: 'company' | 'profile' | 'admin_role'
  entityId: string
  cambios: Record<string, { antes: unknown; despues: unknown }>
  motivo?: string
}
interface AuditLogPort {
  record(entry: AuditEntry, tx?: TransactionContext): Promise<void>
}
export const AUDIT_LOG_PORT = Symbol('AUDIT_LOG_PORT')
```

#### Scenario: A second domain reuses the same port

- GIVEN `pedidos-pagos` later needs to audit a refund
- WHEN it injects `AUDIT_LOG_PORT`
- THEN it uses this shared interface — it does not import `identidad`'s ports-out and does not declare a second audit interface

### Requirement: Write-only surface

`AuditLogPort` MUST expose only `record`. No read/query method MUST exist on this port in this change — admin-web's audit read surface is out of scope, and the underlying table already rejects `UPDATE`/`DELETE` even for `service_role`.

#### Scenario: No list/find method exists

- GIVEN the `AuditLogPort` interface
- WHEN it is inspected
- THEN it has exactly one method, `record`

### Requirement: cambios shape is fixed

Every `AuditEntry.cambios` value MUST use `{ campo: { antes: unknown; despues: unknown } }` per changed field. No caller MUST write a differently-shaped `jsonb` payload — this shape is pinned once because six domains will copy it.

#### Scenario: A status change records exactly its field

- GIVEN `suspenderEmpresa` changes only `status`
- WHEN the audit entry is built
- THEN `cambios` is `{ status: { antes: 'activo', despues: 'suspendido' } }` — no other keys

### Requirement: record() participates in the caller's transaction

`record` MUST accept the same `tx?: TransactionContext` the caller used for its own mutation, so the audit insert commits or rolls back atomically with it.

#### Scenario: Rollback removes both the mutation and its audit entry

- GIVEN a caller passes the same `tx` to its repository update and to `record`
- WHEN the surrounding transaction rolls back
- THEN neither the mutation nor the audit row persists
