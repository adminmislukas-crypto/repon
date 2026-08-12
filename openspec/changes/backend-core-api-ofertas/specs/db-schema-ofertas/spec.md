# Delta for db-schema-ofertas

## ADDED Requirements

### Requirement: offer_opportunities, offer_opportunity_companies, offer_opportunity_items model the discovery projection

Three new tables, owned by `ofertas`, fed exclusively by `MatchEncontrado` (D1): `offer_opportunities` (PK `refill_request_id`; `user_id`, `comuna`, `urgencia`, `matched_at`, `cerrada_at`) — the opportunity header, closed by `aceptarOferta`; `offer_opportunity_companies` (PK `(refill_request_id, company_id)`) — the fact of eligibility, one row per currently-eligible company; `offer_opportunity_items` (PK `refill_item_id`; `refill_request_id`, `nombre`, `categoria`, `precio_referencia`, `catalog_product_id`) — the solicitud's own items, re-declared here (never a snapshot of a `catalogo` type) so `enviarOferta` can validate item membership without a cross-domain join. The exact physical representation of `urgencia` (reused `refill_urgencia` enum vs. `text`) is **provisional, pending design.md's Q1**.

#### Scenario: A MatchEncontrado with companyIds: [] still writes the header

- GIVEN a `MatchEncontrado` for `refillRequestId` R with `companyIds: []`
- WHEN the projection writer runs
- THEN R's `offer_opportunities` row exists with zero rows in `offer_opportunity_companies`

#### Scenario: The 3 tables carry exactly the columns D1 declares

- GIVEN the batch-16 migration
- WHEN its 3 new tables are inspected
- THEN their columns match D1's list exactly — no extra domain column, no `jsonb`

### Requirement: The projection replaces its eligible set per solicitud; it never accumulates, and never uses a physical DELETE

Each write for a given `refill_request_id` MUST leave the table reflecting only the eligible companies/items of the MOST RECENT `MatchEncontrado` for it — a company or item absent from the latest run MUST NOT remain readable as current. Consistent with this schema's repo-wide "no DELETE anywhere" rule, the exact mechanism (a `vigente boolean`, a `retirado_at timestamptz`, or a versioned `matched_at`) is **provisional, pending design.md's Q1** — this requirement constrains the observable read result, not the column that implements it.

#### Scenario: A company that no longer matches is no longer readable as eligible

- GIVEN R's eligible companies are [A, B] after one `MatchEncontrado`
- WHEN a second `MatchEncontrado` for R arrives with only [A]
- THEN a read of R's current eligible companies returns only [A] — B is gone from the observable result, regardless of the underlying storage mechanism

#### Scenario: No row is ever physically deleted

- GIVEN any replace operation on the projection
- WHEN the underlying SQL is inspected
- THEN no `DELETE` statement is issued — only `INSERT`/`UPDATE`, consistent with the schema-wide rule

### Requirement: The projection tables have RLS enabled, zero policies, and zero grants to anon/authenticated

Same shape as `catalog_hidden_companies` (D4): RLS enabled with **zero** policies on all 3 tables; `select`/`insert`/`update` granted **only** to `service_role`; no grant to `anon` or `authenticated`. No client — user or provider mobile app — ever reads these tables directly; `listarSolicitudesElegibles` is the only access path, over HTTP.

#### Scenario: No authenticated client can query the projection directly

- GIVEN a provider authenticated via Supabase Auth
- WHEN their client attempts a direct `select` against any of the 3 projection tables
- THEN RLS rejects it — zero policies means zero rows are ever visible to `anon`/`authenticated`

#### Scenario: service_role can read and write

- GIVEN `core-api`'s service-role connection
- WHEN it selects/inserts/updates any of the 3 tables
- THEN the operation succeeds, unblocked by RLS

### Requirement: The projection tables have no FK to refill_requests, refill_items, companies, or profiles

None of the 3 tables MUST declare a foreign key against `refill_requests`, `refill_items`, `companies`, or `profiles` — same rationale as `catalog_hidden_companies`'s no-FK-to-`companies`: this data's source of truth is another bounded context's event payload, and an FK would need dropping the day that context is extracted. The residual risk of a garbage `refill_request_id` is bounded by `offers.refill_request_id`'s real FK — the final lock before an orphan offer could ever be created.

#### Scenario: No cross-domain FK exists on any of the 3 tables

- GIVEN the batch-16 migration
- WHEN the 3 new tables' constraints are inspected
- THEN none declares a `REFERENCES` clause to `refill_requests`, `refill_items`, `companies`, or `profiles`

#### Scenario: A garbage refill_request_id cannot produce an orphan offer

- GIVEN a hypothetical bad `refill_request_id` in `offer_opportunities`
- WHEN `enviarOferta` attempts to use it
- THEN `offers.refill_request_id`'s real FK against `refill_requests(id)` rejects the write if the id does not truly exist
