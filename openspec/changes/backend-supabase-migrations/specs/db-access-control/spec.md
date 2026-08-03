# db-access-control Specification

## Purpose

Cross-cutting RLS conventions applied to all 17 tables created by this change. The `db-schema-*` specs reference this document instead of repeating policy patterns. Enforces D1: `core-api` connects with the service-role key and bypasses RLS entirely — RLS exists only to gate direct client reads (`anon`/`authenticated`) from apps, never writes.

## Requirements

### Requirement: Deny-all default

Every table MUST have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the same migration that creates it, with zero policies until an explicit SELECT policy is added per the allowlist documented in its owning `db-schema-*` spec.

#### Scenario: No policy means no access

- GIVEN a table has RLS enabled and no policies defined
- WHEN an `anon` or `authenticated` client queries that table
- THEN zero rows are returned, regardless of the query's WHERE clause

### Requirement: No client-side mutation policies

The system MUST NOT define any `INSERT`, `UPDATE`, or `DELETE` RLS policy for `anon` or `authenticated` on any of the 17 tables. All writes go through `core-api` (service-role, bypasses RLS).

#### Scenario: Direct write attempt is rejected

- GIVEN a table has RLS enabled with only SELECT policies
- WHEN an `authenticated` client attempts an INSERT/UPDATE/DELETE directly against Postgres
- THEN Postgres rejects the operation because no policy grants it

### Requirement: No physical DELETE, ever

No table MUST grant `DELETE` to `anon` or `authenticated`. Soft delete via `status` is the only supported deactivation path, per `docs/ARCHITECTURE.md` ("Principio de dar de baja"). `audit_log` and `order_items` are stricter still — see their own specs for full mutation prohibition that includes `service-role`.

#### Scenario: No DELETE grant exists

- GIVEN any of the 17 tables
- WHEN reviewing the migration's GRANT statements
- THEN no `GRANT DELETE` exists for `anon` or `authenticated`

### Requirement: Owner-less child table read policy (single convention)

For child tables with no direct owner column (`refill_items`, `offer_items`, `order_items`, `consumption_logs`), the SELECT policy MUST use an `EXISTS` subquery against the parent table's owner column, rather than adding a denormalized owner column to the child, unless a documented read-path performance case justifies denormalizing (decided case-by-case in the owning spec, never invented ad hoc during implementation).

#### Scenario: Default pattern — EXISTS against parent

- GIVEN `refill_items.refill_request_id` references `refill_requests.id`, and `refill_requests.user_id` is the owner
- WHEN the SELECT policy for `refill_items` is authored
- THEN its body is `EXISTS (SELECT 1 FROM refill_requests r WHERE r.id = refill_items.refill_request_id AND r.user_id = auth.uid())`
- AND no `user_id` column is added to `refill_items` for authorization purposes

#### Scenario: Same pattern applies uniformly across all four tables

- GIVEN `offer_items`, `order_items`, and `consumption_logs` all lack an owner column
- WHEN their SELECT policies are authored
- THEN each follows the identical `EXISTS`-against-parent shape, adjusted only for each parent's owner column, with no per-table bespoke authorization logic

### Requirement: SELECT allowlist is explicit and centralized

Each `db-schema-*` spec MUST document the exact SELECT policies for its own tables. No table gets a policy that isn't documented in its owning spec.

#### Scenario: Undocumented policy is a defect

- GIVEN a migration adds a SELECT policy not listed in the corresponding `db-schema-*` spec
- WHEN `sdd-verify` runs against this change
- THEN the undocumented policy is flagged as a spec/implementation mismatch
