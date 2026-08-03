# db-schema-auditoria Specification

## Purpose

Append-only record of administrative actions: who did what, to which entity, when, and why. Mandatory from day one per `docs/DATA_MODEL.md`.

## Schema

### audit_log (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| actor_profile_id | uuid | NOT NULL REFERENCES profiles(id) |
| accion | text | NOT NULL |
| entity_type | text | NOT NULL |
| entity_id | uuid | NOT NULL (polymorphic, intentionally no FK) |
| cambios | jsonb | NOT NULL |
| motivo | text | NULL |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |

## Requirements

### Requirement: entity_id is intentionally not a foreign key

`entity_id` MUST remain a plain `uuid` with no FK constraint, because `audit_log` is polymorphic across every domain's tables (`companies`, `profiles`, `offers`, etc.) and a single FK cannot target multiple tables.

#### Scenario: Logging an action on any entity type succeeds

- GIVEN an admin approves a company (id = X)
- WHEN the system inserts `audit_log(entity_type='company', entity_id=X, accion='aprobar_empresa', ...)`
- THEN the insert succeeds even though no FK validates X against `companies`

### Requirement: audit_log rejects UPDATE and DELETE from every role, including service-role

The system MUST revoke `UPDATE` and `DELETE` privileges on `audit_log` from `anon`, `authenticated`, and `service-role`. Only `INSERT` and `SELECT` are granted to `service-role` (core-api writes; admin-web reads through core-api). This is stricter than the general "no client mutation" rule (`db-access-control`) — it applies to service-role too, because a mutable audit trail is not a trail.

#### Scenario: service-role cannot alter a log entry

- GIVEN an existing `audit_log` row inserted by core-api using service-role
- WHEN core-api (service-role) attempts `UPDATE audit_log SET cambios = '{}' WHERE id = ...`
- THEN Postgres rejects it — no UPDATE grant exists for service-role

#### Scenario: service-role cannot delete a log entry

- GIVEN the same row
- WHEN service-role attempts `DELETE FROM audit_log WHERE id = ...`
- THEN Postgres rejects it — no DELETE grant exists for any role

### Requirement: No direct client access

`anon` and `authenticated` MUST have zero policies on `audit_log` — admin-web reads it exclusively through core-api's service-role connection, matching `supabase/SPEC.md`'s existing rule.

#### Scenario: Direct client read is denied

- GIVEN an authenticated admin session (not service-role)
- WHEN it queries `audit_log` directly via the Supabase client
- THEN zero rows are returned
