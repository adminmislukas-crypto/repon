# db-schema-catalogo Specification

## Purpose

Reference catalog (`catalog_products`) and each provider's own priced listings (`provider_catalog`). Read-heavy; `refill-matching` and `ofertas` consume `CatalogQueryPort` through core-api (service-role) — no direct client business logic.

## Schema

### catalog_products (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| nombre | text | NOT NULL |
| categoria | text | NOT NULL |
| marca | text | NULL |
| presentacion | text | NULL |
| imagen_url | text | NULL |
| status | catalog_product_status | NOT NULL DEFAULT `'activo'` |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | GIN trigram index on (categoria, nombre) via `pg_trgm` |

`catalog_product_status` enum: `'activo' | 'inactivo'` (soft-delete only).

### provider_catalog (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| company_id | uuid | NOT NULL REFERENCES companies(id) |
| catalog_product_id | uuid | NULL REFERENCES catalog_products(id) — nullable by design (Q4) |
| nombre | text | NOT NULL (denormalized fallback for matching) |
| categoria | text | NOT NULL (denormalized fallback) |
| precio_base | numeric(12,2) | NOT NULL, CHECK (precio_base >= 0) |
| precio_maximo | numeric(12,2) | NOT NULL, CHECK (precio_maximo >= precio_base) |
| stock | int | NOT NULL DEFAULT 0, CHECK (stock >= 0) |
| disponible | boolean | NOT NULL DEFAULT true |
| imagen_url | text | NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |
| — | — | INDEX(company_id); trigram INDEX(categoria, nombre) |

## Requirements

### Requirement: catalog_products is authenticated-only (Q6)

The system MUST allow `authenticated` SELECT on `catalog_products` and MUST NOT allow `anon` SELECT, because unauthenticated access would let scrapers pull the full reference catalog.

#### Scenario: Authenticated user searches the catalog

- GIVEN `catalog_products` has active rows
- WHEN a request is made with an authenticated session
- THEN matching rows are returned

#### Scenario: Anonymous request is denied

- GIVEN the same table and rows
- WHEN a request uses the `anon` key with no session
- THEN zero rows are returned

### Requirement: provider_catalog visibility splits public vs. owner

The system MUST allow two SELECT policies on `provider_catalog`: (a) `authenticated` WHERE `disponible = true` (public marketplace view); (b) the owning company's own profile, via `EXISTS (SELECT 1 FROM profiles p WHERE p.company_id = provider_catalog.company_id AND p.id = auth.uid())`, seeing ALL its own rows including `disponible = false`.

#### Scenario: Public sees only available items

- GIVEN items I1 (`disponible`) and I2 (not `disponible`) from company C
- WHEN a user not affiliated with C queries `provider_catalog`
- THEN only I1 is returned

#### Scenario: Owner sees unavailable inventory too

- GIVEN the same I1, I2 from company C
- WHEN a profile with `company_id = C.id` queries `provider_catalog`
- THEN both I1 and I2 are returned

#### Scenario: A provider MUST NOT read another provider's rows via the client path

- GIVEN item I3 from company C2, with `disponible = false`
- WHEN a profile of company C1 queries `provider_catalog`
- THEN I3 is not returned to C1 (neither the public policy nor the owner policy matches)

### Requirement: precio_maximo cannot be below precio_base

The system MUST reject any `provider_catalog` row where `precio_maximo < precio_base` at the database level, independent of `core-api` validation.

#### Scenario: Invalid price range is rejected

- GIVEN an insert with `precio_base = 10000, precio_maximo = 8000`
- WHEN the insert executes
- THEN the CHECK constraint raises an error and no row is created

### Requirement: catalog_product_id stays nullable (Q4)

`provider_catalog.catalog_product_id` MUST remain a nullable FK. Providers MUST be able to create a row with `catalog_product_id = NULL`, relying on denormalized `nombre`/`categoria` for matching, since backfilling free text to IDs later is lossy while adding the column later is cheap.

#### Scenario: Provider loads a product not in the reference catalog

- GIVEN no `catalog_products` row matches the provider's product name
- WHEN the provider calls `cargarProductoCatalogo`
- THEN the row is created with `catalog_product_id = NULL` and the operation succeeds
