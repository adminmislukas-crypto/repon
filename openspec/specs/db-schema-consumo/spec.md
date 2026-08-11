# db-schema-consumo Specification

## Purpose

Pets, dose/consumption configuration, and the log of doses taken, owned entirely by the `consumo` domain — no other domain writes here.

## Schema

### pets / user_consumption

Columns fixed by `packages/types/SPEC.md` (`Pet`, `UserConsumption`). Physical-only additions: `pets.user_id` REFERENCES `profiles(id)` NOT NULL (owner); `user_consumption.user_id` REFERENCES `profiles(id)` NOT NULL (owner, present regardless of `owner_type`, since even `pet`-scoped consumption belongs to a user); `created_at`/`updated_at` on both.

### consumption_logs (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| consumption_id | uuid | NOT NULL REFERENCES user_consumption(id) |
| tomado_at | timestamptz | NOT NULL |
| cantidad | numeric | NULL |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX (consumption_id, tomado_at DESC) |

No owner column by design (Q8) — see `db-access-control`'s Owner-less Child Table Read Policy.

## Requirements

### Requirement: SELECT allowlist for pets and user_consumption

The system MUST allow `authenticated` SELECT on `pets` and `user_consumption` WHERE the row's `user_id = auth.uid()`, and MUST NOT allow any other authenticated user — including providers — to read them.

#### Scenario: Owner reads own pets only

- GIVEN pets P1 (user A) and P2 (user B)
- WHEN user A queries `pets`
- THEN only P1 is returned

### Requirement: consumption_logs SELECT via EXISTS on parent (Q8 pattern)

Per `db-access-control`'s Owner-less Child Table Read Policy, `consumption_logs` MUST use `EXISTS (SELECT 1 FROM user_consumption uc WHERE uc.id = consumption_logs.consumption_id AND uc.user_id = auth.uid())` as its sole SELECT policy — no `user_id` column is added to `consumption_logs`.

#### Scenario: Owner reads their own dose history

- GIVEN `user_consumption` UC belongs to user A, with logs L1, L2
- WHEN user A queries `consumption_logs`
- THEN L1 and L2 are returned

#### Scenario: Other users cannot read another user's dose history

- GIVEN UC belongs to user A
- WHEN user B queries `consumption_logs`
- THEN no rows referencing UC are returned to B

### Requirement: Adherence index supports the daily cron without full scans

The index `(consumption_id, tomado_at DESC)` MUST exist to support `adherenciaUltimos7Dias` and `calcularDiasRestantes`, since the daily cron (`ConsumptionRepository.findDueForCheck`) runs against every active `user_consumption` row.

#### Scenario: Query plan uses the index

- GIVEN `consumption_logs` has thousands of rows across many `consumption_id` values
- WHEN the cron computes 7-day adherence for a single `consumption_id`
- THEN the query plan uses the `(consumption_id, tomado_at DESC)` index, not a full table scan

### Requirement: user_consumption tracks debounce state to prevent repeat stock-alert notifications across cron runs

`user_consumption` MUST gain a debounce marker (D5) that lets `procesarConsumosVencidos` distinguish "already notified for this unresolved condition" from "eligible to notify again." While the marker is active for a given row, the cron MUST NOT re-emit `StockBajoDetectado`/`RefillAutoSolicitado` for it. The marker MUST clear when the condition resolves (stock replenished above threshold) or is explicitly reset. The exact column shape and clearing trigger are a `sdd-design` decision (Q1) — this requirement describes only the observable, cross-cron behavior. The marker MUST land via a new fix-forward migration; an already-applied migration file MUST NOT be edited (repo convention, e.g. `20260804090500_10_grants_domain_tables_service_role.sql`).

#### Scenario: A repeated cron run on the same unresolved condition does not re-notify

- GIVEN a `user_consumption` row below threshold, already notified once by a prior cron run
- WHEN the next cron run evaluates the same row with the condition still unresolved
- THEN no new `StockBajoDetectado`/`RefillAutoSolicitado` is emitted for that row

#### Scenario: The marker clears once stock is replenished above threshold, allowing a future notification

- GIVEN a `user_consumption` row whose debounce marker is active from a prior below-threshold notification
- WHEN its stock is replenished above threshold and later drops below threshold again
- THEN the row is eligible to notify again on the later drop

#### Scenario: A new migration adds the marker, without touching applied migrations

- GIVEN the currently applied migrations that define `user_consumption` with no debounce marker
- WHEN the marker for D5 lands
- THEN it ships as a new migration file, and no line of an already-applied migration is edited

### Requirement: user_consumption has no activo/status column — there is no way to pause an item

`user_consumption` MUST NOT gain an `activo`/`status` column as part of this change. A row `procesarConsumosVencidos` finds via `findDueForCheck` is processed identically regardless of whether the user still actively tracks it — there is no "paused" state distinct from any other row. Pausing an item is a deferred product decision, not built here (D-C).

#### Scenario: Every row findDueForCheck returns is processed the same way, with no notion of an inactive item

- GIVEN two `user_consumption` rows below threshold, one the user actively uses and one they stopped using
- WHEN the daily cron runs
- THEN both rows are evaluated identically — no column or flag distinguishes them, and both may emit `StockBajoDetectado`
