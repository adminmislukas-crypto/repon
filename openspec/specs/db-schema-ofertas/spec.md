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
