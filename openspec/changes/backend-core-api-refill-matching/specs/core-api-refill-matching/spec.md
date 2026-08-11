# core-api-refill-matching Specification

## Purpose

The `refill-matching` domain vertical: the 4 public use cases from `SPEC.md` (`crearSolicitud`, `buscarProveedoresCompatibles`, `marcarComoOfertada`, `marcarComoConfirmada`) plus `completarBorrador`, the first real consumer of `catalogo`'s `CatalogQueryPort`, cross-tenant authorization (D13), the `'borrador'` incomplete-entity state and its completion invariant (D3/D4), the transactional/non-transactional split between request creation and matching (D14/D15), and the single `RefillAutoSolicitado` listener (D2).

## Requirements

### Requirement: RefillAutoSolicitado creates exactly one borrador request; StockBajoDetectado creates none

The `adapters/events/` listener MUST subscribe only to the `consumo.refill_auto_solicitado` channel by string name (never importing `consumo`'s event class, same pattern as `CompanyVisibilityListener`) and MUST invoke `crearBorradorRefill` — a dedicated internal-only use case (design.md D-G.1), never `crearSolicitud` — exactly once per event. There is no "borrador path" through `crearSolicitud`: under D3+D12 that use case requires `direccion`/`comuna` (which the event does not carry) and always produces `estado: 'abierta'`. The domain MUST NOT subscribe to `consumo.stock_bajo_detectado` in any form (D2).

#### Scenario: RefillAutoSolicitado produces a borrador request

- GIVEN a `RefillAutoSolicitado` event carrying a valid `StockBajoPayload`
- WHEN the listener handles it
- THEN exactly one `RefillRequest` is persisted with `estado: 'borrador'`

#### Scenario: StockBajoDetectado alone creates nothing

- GIVEN a `StockBajoDetectado` event is emitted, with no corresponding `RefillAutoSolicitado`
- WHEN the event bus dispatches it
- THEN no listener in `refill-matching` handles it, and no `RefillRequest` is created

### Requirement: Requests born from the listener start in 'borrador'; manually created requests start in 'abierta'

`crearSolicitud` invoked by the D2 listener MUST persist the resulting `RefillRequest` with `estado: 'borrador'`. `crearSolicitud` invoked via HTTP (the manual path) MUST persist it with `estado: 'abierta'` (D3).

#### Scenario: Listener-originated request starts in borrador

- GIVEN the D2 listener handling a `RefillAutoSolicitado`
- WHEN it creates the `RefillRequest`
- THEN `estado` is `'borrador'`

#### Scenario: HTTP-originated request starts in abierta

- GIVEN an authenticated user calling `crearSolicitud` via HTTP with a complete payload
- WHEN the request is created
- THEN `estado` is `'abierta'`, never `'borrador'`

### Requirement: crearSolicitud's manual path requires comuna as an explicit parameter

`crearSolicitud(userId, items, direccion, comuna, urgencia)` MUST accept `comuna` as an explicit parameter for the manual (HTTP) path — the raw `SPEC.md` signature predates the `comuna` column and is inexecutable without it (D12).

#### Scenario: A manual crearSolicitud call without comuna is rejected

- GIVEN a user calling `crearSolicitud` via HTTP with no `comuna` value
- WHEN the use case validates the input
- THEN the call is rejected before any insert — the manual path always requires `comuna`

### Requirement: completarBorrador enforces direccion + comuna + every item's categoria + precioReferencia before transitioning to 'abierta'

A new `completarBorrador` use case MUST transition a `'borrador'` request to `'abierta'` only when `direccion`, `comuna`, and every item's `categoria` and `precioReferencia` are present. Any missing field MUST reject the transition and leave `estado` unchanged (D3/D4).

#### Scenario: A fully completed borrador transitions to abierta

- GIVEN a `'borrador'` request with `direccion`, `comuna`, and every item's `categoria`/`precioReferencia` filled in
- WHEN `completarBorrador` executes
- THEN `estado` becomes `'abierta'`

#### Scenario: A borrador missing direccion or comuna is rejected

- GIVEN a `'borrador'` request missing `direccion` or `comuna`
- WHEN `completarBorrador` executes
- THEN it throws a validation error, and `estado` remains `'borrador'`

#### Scenario: A borrador with any item missing categoria or precioReferencia is rejected

- GIVEN a `'borrador'` request whose items are complete except one item missing `categoria` or `precioReferencia`
- WHEN `completarBorrador` executes
- THEN it throws a validation error, and `estado` remains `'borrador'`

### Requirement: buscarProveedoresCompatibles is owner-scoped; cross-tenant access is 404, never 403

`buscarProveedoresCompatibles(refillRequestId)` MUST derive the caller's identity from `actor.profileId`, look up the `RefillRequest`, and verify ownership before running any matching. A request that does not exist OR belongs to another user MUST respond 404 — never 403 (D13).

#### Scenario: Owner queries their own request

- GIVEN `RefillRequest` R belongs to user A, `estado: 'abierta'`
- WHEN user A calls `buscarProveedoresCompatibles(R.id)`
- THEN compatible providers are returned

#### Scenario: Cross-tenant read returns 404, not 403

- GIVEN `RefillRequest` R belongs to user B, and user A is authenticated
- WHEN user A calls `buscarProveedoresCompatibles(R.id)`
- THEN the response is HTTP 404 — never 403 — and no provider data leaks

### Requirement: No DTO in this domain accepts a client-supplied userId

`crearSolicitud`'s owner MUST come only from `actor.profileId`; no request DTO in `refill-matching` MUST expose a `userId` field (D13).

#### Scenario: The actor's profileId becomes the owner

- GIVEN an authenticated user actor with `profileId` P
- WHEN the actor calls `crearSolicitud` with an otherwise-valid payload
- THEN the created `RefillRequest.userId` equals P, and the DTO carries no `userId` field

### Requirement: crearSolicitud persists the request and its items in one transaction; RefillCreado publishes only after commit

`crearSolicitud` MUST persist the `RefillRequest` and its N `RefillItem`s inside a single `TRANSACTION_MANAGER.runInTransaction` call. A failure persisting any item MUST leave the request unpersisted. `RefillCreado` MUST publish only after the transaction commits (D14).

#### Scenario: Request and items commit together

- GIVEN a valid `crearSolicitud` call with 3 items
- WHEN it executes successfully
- THEN the request and all 3 items are persisted, and `RefillCreado` publishes only after commit

#### Scenario: An item failure leaves no partial request

- GIVEN a `crearSolicitud` call where persisting one item fails inside the transaction
- WHEN the use case runs
- THEN neither the request nor any item is persisted, and `RefillCreado` does not publish

### Requirement: buscarProveedoresCompatibles never runs inside a transaction; infra failures map to 503, never an empty array

`buscarProveedoresCompatibles`'s use case class MUST NOT inject `TRANSACTION_MANAGER` — an inspectable structural property, not a convention to remember. It MUST call `CatalogQueryPort.buscarCoincidencias` outside any `runInTransaction` block. A `CatalogQueryUnavailableError` thrown by that port MUST be mapped to HTTP 503 `CATALOG_UNAVAILABLE` at the controller boundary, and matching MUST NOT degrade to `[]` on an infrastructure failure (D15, C2/C8 of `CatalogQueryPort`).

#### Scenario: The matching use case has no transaction manager injected

- GIVEN `BuscarProveedoresCompatiblesUseCase`'s constructor
- WHEN its injected DI tokens are inspected
- THEN `TRANSACTION_MANAGER` does not appear among them

#### Scenario: A catalog outage maps to 503, not an empty result

- GIVEN `CatalogQueryPort.buscarCoincidencias` throws `CatalogQueryUnavailableError`
- WHEN `buscarProveedoresCompatibles` is called via HTTP
- THEN the response is HTTP 503 `CATALOG_UNAVAILABLE`, never `200` with `[]`

### Requirement: RefillCreado publishes only when a request becomes 'abierta'; a borrador publishes nothing

`RefillCreado` MUST publish after commit for both `crearSolicitud` (manual, born `'abierta'`) and `completarBorrador` (`'borrador' → 'abierta'` transition) — never for the D2 listener's borrador creation. This corrects `refill-matching/SPEC.md`'s original text, which described `RefillCreado` as what `ofertas` listens to "para notificar a los proveedores compatibles" — impossible under D15, since matching has not run yet when `RefillCreado` publishes; that list travels on `MatchEncontrado` instead (design.md D-C, declared delta).

#### Scenario: The listener's borrador creation publishes no event

- GIVEN the D2 listener creates a `RefillRequest` in `'borrador'`
- WHEN the insert commits
- THEN neither `RefillCreado` nor any other event publishes

#### Scenario: completarBorrador publishes RefillCreado after commit

- GIVEN a `'borrador'` request satisfying every completeness field
- WHEN `completarBorrador` transitions it to `'abierta'` and the write commits
- THEN `RefillCreado` publishes exactly once, after the commit

### Requirement: RefillCreado and MatchEncontrado carry only this domain's own facts and computed outputs — never catalogo's vocabulary or a priced snapshot

Both events MUST share a `RefillSolicitudPayload` base (`refillRequestId`, `userId`, `comuna`, `urgencia`, `items[]` — each item carrying `refillItemId`, `nombre`, `categoria`, `precioReferencia`, `catalogProductId`), following the same publish-only-what-you-own discipline `consumo`'s D-D already established. `direccion` MUST NOT travel in either payload — free-text PII not needed to compose an offer, relevant only later at `pedidos-pagos` dispatch. `MatchEncontrado` MUST extend the base with `companyIds` (deduplicated, first-appearance order) and `providerCatalogItemIds` — reference IDs only. Neither event MUST embed a `ProviderCatalogItem` snapshot: `ofertas` re-queries `CatalogQueryPort.buscarCoincidencias` per `companyId` for fresh prices and current visibility, never trusting a stale embedded price (design.md D-C).

#### Scenario: MatchEncontrado carries provider references, not priced snapshots

- GIVEN a `buscarProveedoresCompatibles` call that finds matches across 2 companies
- WHEN `MatchEncontrado` publishes
- THEN its payload contains `companyIds`/`providerCatalogItemIds` only — no `precioBase`, `precioMaximo`, `stock`, or any other `ProviderCatalogItem` field appears anywhere in the payload

#### Scenario: direccion never appears in either event's payload

- GIVEN any `RefillCreado` or `MatchEncontrado` instance
- WHEN its payload's fields are enumerated
- THEN `direccion` is not among them

### Requirement: MatchEncontrado publishes even when zero providers match

`buscarProveedoresCompatibles` MUST publish `MatchEncontrado` with `companyIds: []` when no provider matches, never suppress the event. Suppressing it would make "searched, found nobody" and "matching never ran" indistinguishable to `ofertas`, the same silent-failure family D3 and the 409-on-borrador rule both guard against.

#### Scenario: A zero-match search still publishes MatchEncontrado

- GIVEN a `buscarProveedoresCompatibles` call where `CatalogQueryPort.buscarCoincidencias` returns no items
- WHEN the use case completes
- THEN `MatchEncontrado` publishes with `companyIds: []` and `providerCatalogItemIds: []` — the event is not skipped

### Requirement: EmpresaSuspendida is not consumed by this domain

`refill-matching` MUST NOT subscribe to any channel for `EmpresaSuspendida`. Exclusion of suspended companies from matching results is already enforced transitively inside `CatalogQueryPort`'s implementation (the anti-join against `catalog_hidden_companies`), and this domain has no catalog store of its own to filter (D5).

#### Scenario: No listener exists for EmpresaSuspendida

- GIVEN `refill-matching`'s `adapters/events/`
- WHEN its listeners are enumerated
- THEN none subscribes to `EmpresaSuspendida`, and a suspended company's items still do not appear in `buscarProveedoresCompatibles` results (enforced by `CatalogQueryPort`, not by this domain)

### Requirement: marcarComoOfertada and marcarComoConfirmada exist with no HTTP surface and no caller

Both use cases MUST be implemented and unit-tested but MUST NOT be reachable via any HTTP route, and no other use case or listener in this change MUST call them (D6).

#### Scenario: Neither method is HTTP-reachable

- GIVEN `refill-matching`'s `adapters/http/` controller
- WHEN its routes are enumerated
- THEN none of them invoke `marcarComoOfertada` or `marcarComoConfirmada`

#### Scenario: No caller exists in this change

- GIVEN the full `refill-matching` module graph in this change
- WHEN it is inspected
- THEN nothing invokes `marcarComoOfertada`/`marcarComoConfirmada` — they wait for `ofertas`' own SDD change to wire them via new listeners

### Requirement: No AuditLogPort in this domain

No use case or listener in `refill-matching` MUST inject `AuditLogPort` (D16).

#### Scenario: No use case audits

- GIVEN every `ports-in` use case and the D2 listener
- WHEN their constructors are inspected
- THEN none injects `AuditLogPort`

### Requirement: refill-matching's folder contains adapters/events/ and no contracts/ or adapters/scheduling/

`services/core-api/src/domains/refill-matching/` MUST contain `adapters/events/` (the D2 listener) and MUST NOT contain `contracts/` or `adapters/scheduling/`. This is `core-api-hexagonal-layout`'s existing conditional-presence rule applied to this domain — no new rule (D7/D8).

#### Scenario: Folder shape matches D7/D8

- GIVEN `refill-matching`'s folder tree after this change
- WHEN it is inspected
- THEN it contains `adapters/events/` with exactly one `@OnEvent` listener, and no `contracts/` or `adapters/scheduling/` directory exists

### Requirement: buscarProveedoresCompatibles on a 'borrador' request fails explicitly, never []

Resolved by design.md D-F: a `'borrador'` request MUST reject matching with HTTP 409, error class `SolicitudEnBorradorError`, code `REFILL_REQUEST_EN_BORRADOR` — chosen over 404 to keep D13's 404 semantics reserved strictly for non-ownership/non-existence, and over `[]` because that is exactly the silent-failure mode D3 exists to prevent. `EN_BORRADOR` names the concrete state in the domain's Spanish vocabulary (`rules.apply`), rather than a generic "not ready" condition. Ownership is still checked first: a `'borrador'` request belonging to another user still responds 404, not 409.

#### Scenario: Matching on a borrador request is rejected explicitly

- GIVEN `RefillRequest` R belongs to user A, `estado: 'borrador'`
- WHEN user A calls `buscarProveedoresCompatibles(R.id)`
- THEN the response is HTTP 409 `REFILL_REQUEST_EN_BORRADOR` — never `200` with `[]`

#### Scenario: Ownership is still checked before state, on a borrador request too

- GIVEN `RefillRequest` R belongs to user B, `estado: 'borrador'`, and user A is authenticated
- WHEN user A calls `buscarProveedoresCompatibles(R.id)`
- THEN the response is HTTP 404 — the borrador state is never revealed to a non-owner

### Requirement: HTTP surface

Resolved by design.md D-E: `POST /refill/mis-solicitudes` (`crearSolicitud`), `POST /refill/mis-solicitudes/:refillRequestId/completar` (`completarBorrador`), `POST /refill/mis-solicitudes/:refillRequestId/matching` (`buscarProveedoresCompatibles`). The prefix is `refill`, not `refill-matching` — a hyphenated domain exposes its resource family, not its internal name, a rule `pedidos-pagos` will inherit. Matching MUST be `POST`, never `GET`: the use case publishes `MatchEncontrado`, so it is neither safe nor idempotent — a prefetch/retry/caching proxy on a `GET` would fan out duplicate auto-offers into `ofertas`. No `listarMisSolicitudes` route — the raw `SPEC.md` does not declare one, and owner-scoped listing is already served by the direct-RLS read path the migration already grants. No `@Roles()` on any route — same reasoning `GET /catalogo/productos` and every `consumo` route already used: any authenticated user, ownership enforced by `actor.profileId`, never by role.

#### Scenario: All three routes derive ownership from the actor, never a path/body userId

- GIVEN any of the three routes above
- WHEN a request is dispatched
- THEN the handler derives the owner from `actor.profileId`, and no `userId` path or body parameter exists on any of them
