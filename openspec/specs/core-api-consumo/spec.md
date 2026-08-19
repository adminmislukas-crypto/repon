# core-api-consumo Specification

## Purpose

The `consumo` domain vertical: the 4 public use cases (`registrarMascota`, `configurarConsumo`, `marcarDosisTomada`, `calcularDiasRestantes`), the internal cron-only use case (`procesarConsumosVencidos`), cross-tenant authorization on health data (D7/D8), the CQS split between the pure query and the side-effecting internal use case (D2), `marcarDosisTomada`'s transactional guarantee (D6), and the daily cron's threshold/debounce/fan-out/failure-isolation semantics (D3/D4/D5).

## Requirements

### Requirement: registrarMascota and configurarConsumo derive userId exclusively from the actor

`registrarMascota(userId, datos)` and `configurarConsumo(userId, config)` MUST receive `userId` derived only from `actor.profileId`. No `consumo` DTO MUST expose a `userId` field for a client to populate (D8) — one rule, two applications.

#### Scenario: The actor's own profileId becomes the owner

- GIVEN an authenticated user actor with `profileId` P
- WHEN the actor calls `registrarMascota` or `configurarConsumo` with an otherwise-valid payload
- THEN the created `Pet`/`UserConsumption` has `userId = P`

#### Scenario: A client-supplied userId cannot influence the write

- GIVEN an authenticated user actor
- WHEN the controller invokes either use case
- THEN the DTO for these routes has no `userId` field, and the only `userId` reaching the use case is `actor.profileId`

### Requirement: configurarConsumo verifies a client-supplied petId belongs to the same user, before creating the consumption

When `configurarConsumo(userId, config)`'s `config.petId` is present (`ownerType === 'pet'`), the use case MUST verify the referenced `Pet` exists AND belongs to `userId` before creating the `UserConsumption`. If the `Pet` does not exist or belongs to a different user, it MUST throw a not-found error mapped to HTTP 404 — never 403 — and MUST NOT create the `UserConsumption`. This is D7's ownership rule applied to the one foreign key the client selects, not a new rule.

#### Scenario: Configuring a consumption for the caller's own pet succeeds

- GIVEN `Pet` PT belongs to user A
- WHEN user A calls `configurarConsumo` with `petId: PT.id`
- THEN the `UserConsumption` is created, scoped to `PT`

#### Scenario: A client-supplied petId belonging to another user is rejected as 404, not 403

- GIVEN `Pet` PT belongs to user B, and user A is authenticated
- WHEN user A calls `configurarConsumo` with `petId: PT.id`
- THEN the response is HTTP 404 (never 403), and no `UserConsumption` is created

### Requirement: marcarDosisTomada is scoped to the caller's own consumption; cross-tenant access is a 404, never 403

`marcarDosisTomada(consumptionId, timestamp)` MUST derive the owner from `actor.profileId`, look up the `UserConsumption` by `consumptionId`, and verify `entity.userId === actor.profileId` before any write. If the entity does not exist OR belongs to a different user, it MUST throw a not-found error mapped to HTTP 404 — never 403 — and MUST NOT append a `ConsumptionLog` or modify stock (D7).

#### Scenario: Owner marks their own dose

- GIVEN `UserConsumption` UC belongs to user A
- WHEN user A calls `marcarDosisTomada(UC.id, timestamp)`
- THEN the dose is recorded normally

#### Scenario: Cross-tenant attempt returns 404, not 403, and does not mutate

- GIVEN `UserConsumption` UC belongs to user B, and user A is authenticated
- WHEN user A calls `marcarDosisTomada(UC.id, timestamp)`
- THEN the response is HTTP 404 (never 403), no `ConsumptionLog` is appended, and UC's stock is unchanged in the database

### Requirement: marcarDosisTomada writes the log and decrements stock in one transaction; DosisRegistrada publishes only after commit

`ConsumptionLogRepository.append` and the stock decrement on `UserConsumption` (via `ConsumptionRepository.save`) MUST run inside a single `TRANSACTION_MANAGER.runInTransaction` call. A failure in either write MUST leave neither persisted. `DosisRegistrada` MUST be published only after the transaction commits (D6).

#### Scenario: Both writes commit together

- GIVEN `UserConsumption` UC with `stockActual: 10`, owned by user A
- WHEN user A calls `marcarDosisTomada(UC.id, timestamp)` and both writes succeed
- THEN a `ConsumptionLog` is appended, UC's stock reflects the decrement, and `DosisRegistrada` publishes only after both are committed

#### Scenario: A failure in either write leaves neither persisted

- GIVEN `UserConsumption` UC owned by user A
- WHEN `marcarDosisTomada(UC.id, timestamp)` runs and the stock-decrement write fails inside the same transaction as the log append
- THEN neither the `ConsumptionLog` nor the stock decrement is persisted, and `DosisRegistrada` is not published

### Requirement: marcarDosisTomada decrements by the configured dose and never drives stock negative

`marcarDosisTomada` MUST decrement `UserConsumption.stockActual` by exactly `dosisPorToma` (the client never supplies a quantity). The resulting stock MUST be clamped at a minimum of 0 — a dose marked when the remaining stock is less than `dosisPorToma` MUST NOT produce a negative value.

#### Scenario: A dose marked when stock is less than one full dose clamps to zero, not negative

- GIVEN `UserConsumption` UC owned by user A with `stockActual` less than `dosisPorToma`
- WHEN user A calls `marcarDosisTomada(UC.id, timestamp)`
- THEN UC's `stockActual` becomes 0, never a negative number, and the dose is still recorded in the `ConsumptionLog`

### Requirement: calcularDiasRestantes is scoped to the caller's own consumption; cross-tenant access is a 404, never 403

`calcularDiasRestantes(consumptionId)` MUST apply the same ownership check as `marcarDosisTomada`: derive the owner from `actor.profileId`, and return 404 — never 403 — for a `consumptionId` belonging to another user, before returning any value (D7).

#### Scenario: Owner queries their own remaining days

- GIVEN `UserConsumption` UC belongs to user A
- WHEN user A calls `calcularDiasRestantes(UC.id)`
- THEN a numeric result is returned

#### Scenario: Cross-tenant read attempt returns 404, not 403

- GIVEN `UserConsumption` UC belongs to user B, and user A is authenticated
- WHEN user A calls `calcularDiasRestantes(UC.id)`
- THEN the response is HTTP 404 (never 403) — a 403 would confirm the resource exists and belongs to someone else

### Requirement: calcularDiasRestantes remains a pure query, structurally decoupled from events and notifications

`CalcularDiasRestantesUseCase`'s constructor MUST NOT inject `EVENT_PUBLISHER` or `NOTIFICATION_PORT`. This is an inspectable structural property, not a convention to remember (D2).

#### Scenario: The pure-query use case cannot reach events or notifications

- GIVEN `CalcularDiasRestantesUseCase`'s constructor
- WHEN its injected DI tokens are inspected
- THEN neither `EVENT_PUBLISHER` nor `NOTIFICATION_PORT` appears among them

### Requirement: procesarConsumosVencidos is internal-only — never HTTP-reachable and carries no @Roles decorator

A new internal use case, `procesarConsumosVencidos`, MUST own the threshold comparison against each due `UserConsumption`, the emission of `StockBajoDetectado`/`RefillAutoSolicitado`, and the best-effort push. It MUST NOT be exposed via any HTTP route and MUST NOT carry an `@Roles()` decorator anywhere (D2).

#### Scenario: procesarConsumosVencidos has no HTTP surface

- GIVEN `consumo`'s `adapters/http/` controller
- WHEN its routes are enumerated
- THEN none of them invoke `procesarConsumosVencidos`, and no `@Roles()` decorator exists for it anywhere in the codebase

### Requirement: procesarConsumosVencidos emits at most one notification pair per UserConsumption while a condition stays unresolved across cron runs

While a `UserConsumption`'s below-threshold condition remains unresolved across repeat cron runs, `procesarConsumosVencidos` MUST NOT re-emit `StockBajoDetectado`/`RefillAutoSolicitado` for it more than once. The debounce state MUST clear once the condition resolves (stock replenished above threshold) or is explicitly reset, allowing a future breach to notify again. The exact state shape is a `sdd-design` decision (Q1) — this requirement describes only the observable behavior (D5).

#### Scenario: Two consecutive cron runs on the same unresolved condition emit exactly one event pair

- GIVEN a `UserConsumption` UC below threshold, `autoCrearRefill: true`, not yet notified
- WHEN the cron runs `procesarConsumosVencidos` twice in a row without UC's stock changing
- THEN exactly one `StockBajoDetectado` and exactly one `RefillAutoSolicitado` are published in total across both runs

#### Scenario: Debounce clears once the condition resolves, allowing a fresh notification

- GIVEN UC was already notified once, then its stock was replenished above threshold, then dropped below threshold again
- WHEN the cron runs `procesarConsumosVencidos` after the second drop
- THEN a new `StockBajoDetectado` is published for UC

### Requirement: procesarConsumosVencidos emits one event per affected item, never a daily summary

For every `UserConsumption` newly crossing the threshold in a single cron run, `procesarConsumosVencidos` MUST publish a separate `StockBajoDetectado` identifying that item — never one aggregate event for the run (D3, the opposite conclusion from `catalogo`'s D3/D6 summary-event pattern, deliberately).

#### Scenario: N due items crossing the threshold emit N events

- GIVEN a cron run where N distinct `UserConsumption` rows newly cross the threshold, none previously debounced
- WHEN `procesarConsumosVencidos` completes
- THEN exactly N `StockBajoDetectado` events are published, each identifying a different `UserConsumption` — never one summary event

### Requirement: A single item's processing failure does not block the rest of the cron run

`procesarConsumosVencidos` MUST NOT wrap its per-item loop in one enclosing transaction. A failure processing one `UserConsumption` MUST be caught and logged for that item; processing MUST continue for the remaining items (D4).

#### Scenario: One item's failure doesn't stop the others

- GIVEN a cron run with item I1 that will fail during processing, and items I2/I3 that are healthy and due for notification
- WHEN `procesarConsumosVencidos` runs
- THEN I1's failure is caught and logged, and I2/I3 are processed and notified normally

### Requirement: procesarConsumosVencidos never fails because a user has no registered push token

A missing push token for a given `profileId` MUST NOT raise an exception that aborts processing of that `UserConsumption` or any other. This relies on `NotificationPort.sendPush`'s no-op-safe contract (see `shared-notifications`) as an observable property (D10).

#### Scenario: A due item with no registered device still completes normally

- GIVEN a `UserConsumption` due for notification whose owner has no push token registered
- WHEN `procesarConsumosVencidos` processes it
- THEN `StockBajoDetectado` (and `RefillAutoSolicitado` if applicable) still publish, no exception propagates from the push attempt, and the item is not logged as a failure

### Requirement: Listar mascotas returns only the caller's own pets

The system MUST expose an authenticated read returning every `Pet` owned by the actor, with the owner scope derived exclusively from `actor.profileId` (same rule as `registrarMascota`/`configurarConsumo`). The route MUST NOT accept any client-supplied user/owner filter.

#### Scenario: A user with pets sees only their own

- GIVEN user A owns pets PT1 and PT2, and user B owns pet PT3
- WHEN user A calls the list-pets read
- THEN the response contains PT1 and PT2 only, HTTP 200

#### Scenario: A user with zero pets gets an empty array, not 404

- GIVEN user A has registered no pets
- WHEN user A calls the list-pets read
- THEN the response is HTTP 200 with an empty array

### Requirement: Listar consumos returns only the caller's own consumptions, each carrying a server-computed diasRestantes

The system MUST expose an authenticated read returning every `UserConsumption` owned by the actor, with each item carrying a `diasRestantes` value computed server-side using the same formula as `calcularDiasRestantes` (D6/D7 of this change). The client MUST NOT need a separate per-item request to obtain this value.

#### Scenario: List includes diasRestantes without a follow-up call

- GIVEN user A owns `UserConsumption` UC with a known stock/dose configuration
- WHEN user A calls the list-consumptions read
- THEN UC appears in the response carrying a `diasRestantes` value equal to what `calcularDiasRestantes(UC.id)` would return, with no additional request required

#### Scenario: A user with zero consumptions gets an empty array, not 404

- GIVEN user A has configured no consumptions
- WHEN user A calls the list-consumptions read
- THEN the response is HTTP 200 with an empty array

### Requirement: A 7-day adherence/history read returns server-computed values scoped to the caller

The system MUST expose an authenticated read returning adherence/history data bounded to the trailing 7 days, scoped to the actor's own consumptions, computed on the same basis as `adherenciaUltimos7Dias`. The response MUST carry finished, server-computed values; the client MUST NOT be required to re-derive adherence from raw logs.

#### Scenario: History is bounded to 7 days, not a month

- GIVEN user A has consumption logs older than 7 days and within the last 7 days
- WHEN user A requests the adherence/history read
- THEN only data within the trailing 7-day window is reflected in the response

#### Scenario: History read is scoped to the caller and empty is 200, not 404

- GIVEN user A has consumptions with no logs yet
- WHEN user A requests the adherence/history read
- THEN the response is HTTP 200 reflecting no adherence activity, never HTTP 404

### Requirement: Collection reads extend the existing cross-tenant rule — actor-derived scoping, 200 [] on empty, never 404

All three new collection-read routes (pets, consumptions, adherence/history) MUST derive scope exclusively from `actor.profileId`. None MUST accept a client-supplied `userId`/owner query parameter. An empty result set MUST be HTTP 200 with an empty array; HTTP 404 MUST NOT be used to signal "no rows" — that status stays reserved for the existing point-read requirements (resource not found or owned by another user).

#### Scenario: No client-supplied filter can widen or redirect scope

- GIVEN user A is authenticated
- WHEN user A calls any of the three new collection reads, with or without a `userId`-like query parameter present in the request
- THEN the response reflects only user A's own rows regardless of any such parameter

#### Scenario: Empty is never confused with not-found

- GIVEN user A has no pets, no consumptions, and no logs
- WHEN user A calls each of the three new collection reads
- THEN each responds HTTP 200 with an empty array, never HTTP 404

### Declared deltas over `services/core-api/domains/consumo/SPEC.md`

| Product SPEC.md says | This spec requires | Rationale |
|---|---|---|
| `calcularDiasRestantes(consumptionId): Promise<number> // usado también por el cron` — one method serves both the HTTP query and the cron | `calcularDiasRestantes` is HTTP-reachable and pure; a new internal `procesarConsumosVencidos` (never HTTP-reachable, no `@Roles`) owns the threshold check, event emission, and push, and is what the cron actually invokes | D2 |
| `marcarDosisTomada(consumptionId, timestamp)` and `calcularDiasRestantes(consumptionId)` — no owner/actor parameter in either signature | Both derive the owner from `actor.profileId`, verify it against `UserConsumption.userId`, and return 404 — never 403 — for a `consumptionId` belonging to another user | D7 |
| "Job programado" section describes the cron with no cross-day idempotency behavior | Repeat cron runs against an unresolved condition MUST NOT re-emit `StockBajoDetectado`/`RefillAutoSolicitado` more than once; state lives in `consumo`'s own schema | D5 |
| No distinction stated between a per-item event and a run-level summary | `StockBajoDetectado`/`RefillAutoSolicitado` are emitted once per affected `UserConsumption`, never a daily summary event | D3 |
| `configurarConsumo(userId, config)` — no ownership check stated on `config.petId` | A client-supplied `petId` belonging to another user is rejected as 404 before creating the `UserConsumption` | D7 (found during `sdd-design`, D-H.3) |
| `marcarDosisTomada` — no stated floor on the stock decrement | Stock is clamped at a minimum of 0; a dose is still recorded even when remaining stock is less than one full dose | D-H.2 (found during `sdd-design`) |
| "Puertos de salida" lists no repository for `Pet` | `registrarMascota` requires a `PetRepository` (new port) — none exists today | D-H.1 (found during `sdd-design`, port-shape detail, not a behavioral scenario here) |
