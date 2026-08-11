# Delta for db-schema-consumo

## ADDED Requirements

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
