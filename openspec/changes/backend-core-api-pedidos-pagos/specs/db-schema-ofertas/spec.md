# db-schema-ofertas Specification (delta)

This is a delta on `db-schema-ofertas`, the main spec of the already-archived `backend-core-api-ofertas` change (`openspec/changes/archive/2026-08-15-backend-core-api-ofertas/`). `pedidos-pagos` is the second change in the repo to write inside an archived sibling domain's own schema spec — the first was `ofertas` itself extending `catalogo`'s port. This delta is scoped to exactly one column; it does not restate `offer_items`' existing requirements.

## ADDED Requirements

### Requirement: offer_items carries a frozen nombre, populated when the offer is composed

`offer_items.nombre` MUST be a `text NOT NULL` column, added by this change's migration batch (`17b`). It MUST be written once, at the same moment `offer_items.precio` is computed and persisted (`crearOfertaReactiva`/`crearOfertaProactiva`), and MUST NOT be written or modified afterward. The behavioral rule for what value gets written on each path (reactive vs. proactive) is specified in `core-api-ofertas`' own delta for this change, not restated here — this requirement covers only the column's existence and immutability at the schema level.

Clients MUST NOT be able to supply this value: it is derived server-side at composition time, never accepted from `NuevoOfferItem` or any DTO. This mirrors `offer_items`' own existing immutability discipline for `precio`, `is_alt`, `alt_size`, `alt_qty`, and `alt_note` — none of those are client-writable either, and none are corrected in place after the row exists.

#### Scenario: nombre is set at composition, not left null

- GIVEN a new `offer_items` row inserted by `crearOfertaReactiva` or `crearOfertaProactiva`
- WHEN the insert completes
- THEN `nombre` is `NOT NULL` and populated in the same statement/transaction that sets `precio`

#### Scenario: nombre is never sourced from client input

- GIVEN a `NuevoOfferItem` payload submitted by a provider
- WHEN it is mapped into an `offer_items` insert
- THEN no field of the client payload supplies `nombre` — the use case resolves it server-side (from the requested `RefillItem.nombre` on the reactive path, or from `ProviderCatalogItem.nombre` on the proactive path)
