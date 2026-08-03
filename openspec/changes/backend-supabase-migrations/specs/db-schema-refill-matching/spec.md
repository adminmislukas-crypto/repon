# db-schema-refill-matching Specification

## Purpose

User-built refill requests and their line items. Matching against provider catalogs happens in core-api (service-role, per `CatalogQueryPort`), never via RLS.

## Schema

### refill_requests

Columns fixed by `packages/types/SPEC.md` (`RefillRequest`), plus physical additions: `user_id` REFERENCES `profiles(id)` NOT NULL (owner); **new column `comuna text NOT NULL`** (Q2 — structured dispatch-zone join key, alongside the existing free-text `direccion`); `created_at`/`updated_at`.

### refill_items

Columns fixed by `RefillItem`, plus: `refill_request_id` REFERENCES `refill_requests(id)` NOT NULL; **`catalog_product_id uuid NULL REFERENCES catalog_products(id)`** (Q4, same nullable rationale as `provider_catalog`); `created_at`. No owner column by design (Q8).

## Requirements

### Requirement: comuna is a structured join key, not derived from free text

`refill_requests.comuna` MUST be a required column populated at creation time (`crearSolicitud`), separate from the free-text `direccion`, because neither the matching Edge Function nor RLS can join on unstructured addresses.

#### Scenario: Request creation requires comuna

- GIVEN a user submits a refill request with `direccion = "Av. Siempre Viva 742"` and no `comuna`
- WHEN `crearSolicitud` executes
- THEN the insert fails the NOT NULL constraint

### Requirement: refill_requests SELECT is owner-only — provider matching is not an RLS concern

(Flags a conflict) `supabase/SPEC.md` states `refill_requests`/`refill_items` are "visibles (solo lectura) para proveedores cuyo catálogo coincide" — superseded by D1: cross-tenant matching reads are RLS-inexpressible without a self-defeating predicate. Provider-facing matched requests MUST be exposed only through core-api (`buscarProveedoresCompatibles`, service-role). The SELECT RLS policy on `refill_requests` MUST be owner-only: `user_id = auth.uid()`.

#### Scenario: Owner sees their own request

- GIVEN request R belongs to user A
- WHEN A queries `refill_requests` directly
- THEN R is returned

#### Scenario: Provider cannot read another user's request directly

- GIVEN request R belongs to user A, and provider profile P has a catalog item matching R's category and comuna
- WHEN P queries `refill_requests` directly (bypassing core-api)
- THEN R is NOT returned to P — P must call the matching endpoint instead

### Requirement: refill_items SELECT via EXISTS on parent (Q8 pattern)

Per `db-access-control`'s Owner-less Child Table Read Policy: `EXISTS (SELECT 1 FROM refill_requests r WHERE r.id = refill_items.refill_request_id AND r.user_id = auth.uid())`.

#### Scenario: Owner reads their own request's items

- GIVEN request R (user A) has items I1, I2
- WHEN A queries `refill_items`
- THEN I1 and I2 are returned

#### Scenario: A non-owner, non-provider-endpoint read returns nothing

- GIVEN request R belongs to user A
- WHEN user B (unrelated) queries `refill_items`
- THEN no items of R are returned to B
