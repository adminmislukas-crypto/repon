# db-schema-ofertas Specification

## Purpose

Provider offers against a refill request, including alternate-presentation items, delivered to the user's bandeja in real time via Supabase Realtime.

## Schema

### offers

Columns fixed by `Offer` (`packages/types/SPEC.md`), plus physical: `user_id` REFERENCES `profiles(id)` **NOT NULL** (recipient — denormalized per D-2, required because `enviarOfertaProactiva` creates offers with no `refill_request`); `refill_request_id` REFERENCES `refill_requests(id)` **NULLABLE** (present only for `kind = 'reactiva'`); `company_id` REFERENCES `companies(id)` NOT NULL; `created_at`/`updated_at`; **partial unique index** `UNIQUE(refill_request_id) WHERE status = 'aceptada' AND refill_request_id IS NOT NULL` (proactive offers have no request to deduplicate against).

Invariant (enforced in the `ofertas` use case in `core-api`, not in Postgres): when `refill_request_id IS NOT NULL`, `offers.user_id` MUST equal `refill_requests.user_id`. See `db-access-control` D-2 rationale for why this single denormalization is the only one needed across all owner-less child tables.

### offer_items

Columns fixed by `OfferItem`, plus: `offer_id` REFERENCES `offers(id)` NOT NULL; `refill_item_id` REFERENCES `refill_items(id)` **NULLABLE** (present only when the parent offer is `kind = 'reactiva'` — a `refill_item` cannot exist without a `refill_request`, which proactive offers don't have); `provider_catalog_item_id` REFERENCES `provider_catalog(id)` **NULLABLE** (present only when `kind = 'proactiva'` — what the provider is proactively pushing from their own listings); CHECK `(refill_item_id IS NOT NULL) <> (provider_catalog_item_id IS NOT NULL)` (exactly one, never both/neither); `created_at`. No owner column (Q8) — see `db-access-control` for the `EXISTS`-against-`offers` read policy.

**Gap found and closed here, not present in propose/design** (analogous to Q4's free-text-vs-FK tradeoff, applied to a field neither `sdd-propose` nor `sdd-design` addressed): `OfferItem.refillItemId` was `NOT NULL` in the original `packages/types/SPEC.md`, which made `enviarOfertaProactiva`'s items unrepresentable — a proactive offer has no `refill_request`, therefore no `refill_items` to reference. Resolution: dual-nullable FK with a CHECK enforcing exactly one, mirroring how `kind` already branches `Offer` itself.

`offer_status` enum: `'pendiente' | 'aceptada' | 'rechazada' | 'expirada'`.

## Requirements

### Requirement: SELECT allowlist for offers is required for Realtime to deliver anything

The system MUST allow two SELECT policies on `offers`: (a) the recipient, via `offers.user_id = (select auth.uid())` — a direct column compare, not an `EXISTS`, since `user_id` is denormalized onto `offers` precisely to cover proactive offers that have no `refill_request`; (b) the offering company, via `EXISTS (SELECT 1 FROM profiles p WHERE p.company_id = offers.company_id AND p.id = auth.uid())`. Realtime respects RLS — without (a), the bandeja receives nothing for either reactive or proactive offers.

#### Scenario: Realtime delivers offer events only to the recipient

- GIVEN user A owns refill request R and is subscribed to `offers` via Realtime
- WHEN provider P inserts a new offer for R
- THEN A's client receives the INSERT event because `offers.user_id = A` matches A's SELECT policy

#### Scenario: A proactive offer (no refill_request) is still visible to its recipient

- GIVEN provider P sends a proactive offer to user A via `enviarOfertaProactiva` (no `refillRequestId`)
- WHEN the resulting row has `refill_request_id = NULL` and `user_id = A`
- THEN A's SELECT policy still matches via the direct `user_id` compare, and A receives the Realtime event
- AND this would NOT be possible if ownership were derived only via `EXISTS` against `refill_requests`, since no such row exists

#### Scenario: Provider sees their own sent offers

- GIVEN provider P's company sent offer O1 (reactive or proactive)
- WHEN P's profile queries `offers`
- THEN O1 is returned

#### Scenario: A user with no relation to the offer receives nothing

- GIVEN offer O belongs to user A and company C
- WHEN user B (not A, not affiliated with C) subscribes to `offers` via Realtime
- THEN B receives no event for O

### Requirement: At most one accepted offer per refill request

The system MUST enforce, at the database level, that no more than one `offers` row per `refill_request_id` can have `status = 'aceptada'` simultaneously, via the partial unique index.

#### Scenario: Second acceptance attempt is rejected

- GIVEN offer B is already `'aceptada'` for refill request R
- WHEN a write attempts to set offer C (also for R) to `'aceptada'`
- THEN the partial unique index rejects the write

### Requirement: Accepting an offer displaces sibling pending offers to 'rechazada'

When `aceptarOferta` transitions an offer to `'aceptada'`, the system MUST, as part of the same operation, transition every other `'pendiente'` offer for the same `refill_request_id` to `'rechazada'`. This resolves D2's open question: the trigger for `'rechazada'` is exactly this displacement, not a separate use case.

#### Scenario: Accepting one offer rejects the others

- GIVEN refill request R has offers A (`pendiente`), B (`pendiente`), C (`pendiente`)
- WHEN the user accepts offer B
- THEN B becomes `'aceptada'` AND A and C become `'rechazada'`
- AND no offer for R remains `'pendiente'`

#### Scenario: expirada is schema-supported but not yet triggered by any use case

- GIVEN the `offer_status` enum includes `'expirada'`
- WHEN no scheduled job exists yet (Edge Functions are out of scope for this change)
- THEN no offer transitions to `'expirada'` today — the value exists so a future time-based expiry job does not require an enum migration

### Requirement: offers is published to Realtime; offer_items is not

`offers` MUST be added to the `supabase_realtime` publication. `offer_items` is NOT published in v1 — clients refetch full offer detail (including items) on any `offers` change event.

### Requirement: offer_items references exactly one item source, matching the parent offer's kind

Every `offer_items` row MUST reference exactly one of `refill_item_id` (reactive) or `provider_catalog_item_id` (proactive), enforced by a CHECK constraint — never both, never neither.

#### Scenario: Reactive offer items reference the requested refill_item

- GIVEN offer O has `kind = 'reactiva'` and `refill_request_id = R`
- WHEN an `offer_items` row is inserted for O
- THEN it MUST set `refill_item_id` to one of R's `refill_items` and leave `provider_catalog_item_id` NULL

#### Scenario: Proactive offer items reference the provider's own catalog listing

- GIVEN offer O has `kind = 'proactiva'` and `refill_request_id = NULL`
- WHEN an `offer_items` row is inserted for O
- THEN it MUST set `provider_catalog_item_id` to one of the offering company's `provider_catalog` rows and leave `refill_item_id` NULL

#### Scenario: Setting both or neither is rejected

- GIVEN any `offer_items` insert
- WHEN both `refill_item_id` and `provider_catalog_item_id` are NULL, or both are set
- THEN the CHECK constraint rejects the write

#### Scenario: Authenticated read receives events

- GIVEN the SELECT policy above and `offers` in the publication
- WHEN an authenticated client subscribes to `offers` filtered by its own ownership
- THEN it receives INSERT/UPDATE events for matching rows

## ADDED Requirements

### Requirement: offer_opportunities, offer_opportunity_companies, offer_opportunity_items model the discovery projection

Three new tables, owned by `ofertas`, fed exclusively by `MatchEncontrado` (D1): `offer_opportunities` (PK `refill_request_id`; `user_id`, `comuna`, `urgencia`, `matched_at`, `cerrada_at`) — the opportunity header, closed by `aceptarOferta`; `offer_opportunity_companies` (PK `(refill_request_id, company_id)`) — the fact of eligibility, one row per currently-eligible company; `offer_opportunity_items` (PK `refill_item_id`; `refill_request_id`, `nombre`, `categoria`, `precio_referencia`, `catalog_product_id`) — the solicitud's own items, re-declared here (never a snapshot of a `catalogo` type) so `enviarOferta` can validate item membership without a cross-domain join. `urgencia` is stored as `text`, with no `CHECK` (design.md D-A.1, locked): reusing `public.refill_urgencia` would couple this table's schema to a type owned by `refill-matching`'s own migration, the same physical coupling D4 already rejects for a foreign key — the value is validated at its one write path (the listener's local payload types it as `Urgencia` from `@repon/types`), never in Postgres.

#### Scenario: A MatchEncontrado with companyIds: [] still writes the header

- GIVEN a `MatchEncontrado` for `refillRequestId` R with `companyIds: []`
- WHEN the projection writer runs
- THEN R's `offer_opportunities` row exists with zero rows in `offer_opportunity_companies`

#### Scenario: The 3 tables carry exactly the columns D1 declares

- GIVEN the batch-16 migration
- WHEN its 3 new tables are inspected
- THEN their columns match D1's list exactly — no extra domain column, no `jsonb`

### Requirement: The projection replaces its eligible set per solicitud; it never accumulates, and never uses a physical DELETE

Each write for a given `refill_request_id` MUST leave the table reflecting only the eligible companies/items of the MOST RECENT `MatchEncontrado` for it — a company or item absent from the latest run MUST NOT remain readable as current. Consistent with this schema's repo-wide "no DELETE anywhere" rule, the mechanism is a `vigente boolean` column on `offer_opportunity_companies`/`offer_opportunity_items` (design.md D-A.2, locked), written by a retire-blanket-then-upsert sequence inside one transaction: `UPDATE ... SET vigente = false WHERE refill_request_id = $R AND vigente = true`, then an upsert of the current set with `vigente = true`. Same precedent as `catalog_hidden_companies.oculto` — a `retirado_at timestamptz` was rejected because "becoming eligible again" would require resetting it to `null`, destroying the history it exists to keep; a versioned `matched_at` was rejected because it would use a timestamp as generation identity, and two writes landing in the same instant are indistinguishable in theory even if unlikely in practice.

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
