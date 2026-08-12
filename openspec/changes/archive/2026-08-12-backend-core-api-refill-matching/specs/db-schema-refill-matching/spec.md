# Delta for db-schema-refill-matching

## ADDED Requirements

### Requirement: refill_estado gains a fourth value, 'borrador', for system-created incomplete requests

`refill_estado` MUST gain a fourth enum value, `'borrador'`, added `BEFORE 'abierta'` via its own fix-forward migration (`ALTER TYPE ... ADD VALUE 'borrador' BEFORE 'abierta'`), never by editing the already-applied `20260803120400_04_refill_matching.sql` (design.md D-A). This value MUST land in its own migration file, separate from the nullable-column relaxation below: Postgres does not allow a newly added enum value to be used within the same transaction that adds it, and the nullable-column migration's partial unique index (design.md D-D.2) references `'borrador'` in its predicate. `BEFORE 'abierta'`, not appended: enum position drives `ORDER BY`/comparison, and this ordering makes `estado >= 'abierta'` read as "already matchable" (D3), matching the lifecycle order. A `RefillRequest` in `'borrador'` is the entity this domain deliberately allows to be incomplete (D3).

#### Scenario: A borrador row can be persisted alongside the 3 existing states

- GIVEN `refill_estado`'s 3 existing values (`abierta`/`ofertada`/`confirmada`) plus the new `'borrador'`
- WHEN the D2 listener inserts a request with `estado = 'borrador'`
- THEN the insert succeeds against the enum type

#### Scenario: Existing abierta/ofertada/confirmada rows are unaffected by the migration

- GIVEN rows already persisted with one of the 3 original states
- WHEN the migration adding `'borrador'` runs
- THEN no existing row's `estado` value changes

### Requirement: direccion and refill_items' categoria/precio_referencia relax to nullable; cross-table completeness is enforced by core-api, not Postgres

`refill_requests.direccion` and `refill_items.categoria`/`refill_items.precio_referencia` MUST become NULLABLE columns via a new fix-forward migration (D4) — a `'borrador'` row (and its items) may have any of them NULL, because `StockBajoPayload` (the source of a listener-created request) carries none of the four fields this requirement plus the `comuna` requirement below cover. Their presence — together with `comuna` — is enforced only by `core-api`'s `'borrador' → 'abierta'` transition (`completarBorrador`), never by a Postgres `CHECK` or trigger. This is the same rule and the same literal phrasing `ofertas/SPEC.md` already fixed for `offers.user_id`: "Regla enforceada aquí, no en Postgres (ni CHECK ni trigger)". A cross-table completeness rule (every item's fields, not just the parent row's) is not expressible as a single-table `CHECK` regardless of where the invariant is meant to live.

#### Scenario: A borrador's items may omit categoria/precioReferencia

- GIVEN the D2 listener creating a `'borrador'` request whose items carry no `categoria`/`precioReferencia` (the source payload has neither)
- WHEN the items insert
- THEN it succeeds — both columns are nullable

#### Scenario: No CHECK constraint enforces cross-table completeness

- GIVEN a `'borrador'` request with some items complete and one item incomplete
- WHEN a direct Postgres insert/update produces exactly that combination
- THEN Postgres accepts it — completeness is validated only by `core-api`'s `completarBorrador`, never a DB-level constraint

### Requirement: refill_requests gains a nullable consumption_id correlation key with a partial unique index, to deduplicate borrador creation — additional to D3/D4

`refill_requests` MUST gain a new nullable `consumption_id uuid` column and a partial unique index on `(user_id, consumption_id) WHERE estado = 'borrador'` (design.md D-D.2). This is declared explicitly as scope ADDITIONAL to D3/D4, not something either already covered: it exists so the D2 listener can deduplicate — a second `RefillAutoSolicitado` for the same `consumptionId` while an earlier borrador is still open (undismissed) MUST be skipped, never creating a second, content-identical draft. The column carries no foreign key: it is a correlation key arriving over the event bus from `consumo`, not a relationship this domain owns or can validate — a FK would break the day `consumo` is extracted to its own service. This is a deliberate asymmetry with `refill_items.catalog_product_id` (which IS a FK, because the user actively chooses that product via a synchronous `catalogo` contract call).

#### Scenario: A second RefillAutoSolicitado for the same consumption while a borrador is open is skipped

- GIVEN an open `'borrador'` `RefillRequest` with `consumption_id = C` for user U
- WHEN the D2 listener receives another `RefillAutoSolicitado` for the same user U and `consumptionId: C`
- THEN no second row is inserted — the existing borrador is left untouched, zero events publish

#### Scenario: A completed request's consumption_id no longer blocks a new borrador

- GIVEN a `RefillRequest` with `consumption_id = C` that has since transitioned out of `'borrador'` (via `completarBorrador`)
- WHEN the D2 listener receives a new `RefillAutoSolicitado` for the same `consumptionId: C`
- THEN a new borrador row is created — the partial index only constrains rows currently in `'borrador'`

#### Scenario: consumption_id has no foreign key to user_consumption

- GIVEN `refill_requests.consumption_id`
- WHEN its constraints are inspected
- THEN no `REFERENCES` clause exists — it is a bare correlation key, not a validated relationship

## MODIFIED Requirements

### Requirement: comuna is populated by crearSolicitud's manual path; relaxed to nullable for borrador rows; matching runs in core-api, never an Edge Function

`refill_requests.comuna` MUST be a NULLABLE column at the Postgres level (fix-forward migration, D4) — a `'borrador'` request created by the D2 listener may have `comuna: null`, because `StockBajoPayload` carries no comuna. `crearSolicitud`'s manual (HTTP) path MUST still always populate it — unchanged from before this delta. The completeness invariant (that `comuna` is present, alongside `direccion` and every item's `categoria`/`precioReferencia`) is enforced by `core-api`'s `'borrador' → 'abierta'` transition, never by Postgres `NOT NULL`, `CHECK`, or a trigger (D4). Separately: matching runs in `core-api` via `buscarProveedoresCompatibles` + `CatalogQueryPort` — never in a Supabase Edge Function. The "matching Edge Function" framing in this requirement's prior text is stale and is corrected here (D9); it does not describe zone/comuna filtering either, which remains out of scope for the matching predicate itself (D1).

(Previously: `comuna` was a required, `NOT NULL` column enforced physically by Postgres with no distinction between the manual and automatic creation paths, and its rationale text described "the matching Edge Function" as a real, currently-relevant component.)

#### Scenario: A manual request submission still requires comuna

- GIVEN a user submits `crearSolicitud` with `direccion` and no `comuna`
- WHEN the use case validates the input (application layer, not a DB constraint)
- THEN the use case rejects the call before any insert — `comuna` is still required for the manual path

#### Scenario: A borrador row is a valid state with comuna NULL

- GIVEN the D2 listener creates a `'borrador'` `RefillRequest` with `comuna: null`
- WHEN the insert runs
- THEN it succeeds — the column is nullable at the Postgres level

#### Scenario: comuna's absence is caught at the borrador -> abierta transition, not by a CHECK constraint

- GIVEN a `'borrador'` row with `comuna: null`
- WHEN `completarBorrador` attempts the transition without a `comuna` value supplied
- THEN the transition is rejected by the use case — no Postgres `CHECK` or trigger exists for this rule
