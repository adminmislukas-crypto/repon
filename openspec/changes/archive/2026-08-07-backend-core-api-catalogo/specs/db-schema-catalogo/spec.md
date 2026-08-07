# Delta for db-schema-catalogo

## ADDED Requirements

### Requirement: provider_catalog has an idempotency target for repeat uploads

`provider_catalog` MUST gain at least one new unique index (D15) that gives `cargarCatalogoMasivo` and `cargarProductoCatalogo` a real conflict target. Uploading the same product for the same company a second time MUST update the existing row's price/stock/availability fields rather than insert a duplicate row. Exact column set and partial-index predicate are a `sdd-design` decision (proposal Q5b) — not fixed here. The index MUST land via a new fix-forward migration; an already-applied migration file MUST NOT be edited (repo convention, e.g. `20260804090500_10_grants_domain_tables_service_role.sql`).

#### Scenario: Re-uploading the same product updates instead of duplicating

- GIVEN company A already has a `provider_catalog` row for product P, created by a prior `cargarProductoCatalogo` or `cargarCatalogoMasivo` call
- WHEN company A uploads product P again (same identifying attributes) with a different price
- THEN exactly one row for P exists afterward, with the new price, and no second row was inserted

#### Scenario: A new migration adds the index, without touching applied migrations

- GIVEN the currently applied `20260803120300_03_catalogo.sql` migration, which defines `provider_catalog` with no UNIQUE constraint beyond its primary key
- WHEN the new unique index for D15 lands
- THEN it ships as a new migration file, and no line of the already-applied migration is edited
