# Delta for core-api-consumo

The 4 existing routes (`registrarMascota`, `configurarConsumo`, `marcarDosisTomada`, `calcularDiasRestantes`) and their cross-tenant 404 rule are unmodified. This delta is purely additive: three new collection reads.

## ADDED Requirements

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
