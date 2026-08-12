# Delta for core-api-catalogo

## ADDED Requirements

### Requirement: CatalogQueryPort gains a second, additive, company-scoped by-id read

`CatalogQueryPort` gains a second method, needed only by `ofertas`' `enviarOfertaProactiva` (D9). **Provisional signature, pending design.md's Q2**: `obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>`. It MUST inherit `buscarCoincidencias`'s C1–C8 unchanged (no `tx?` param, no side effects, throws `CatalogQueryUnavailableError` on infra failure, single round-trip for the whole `ids` array) and add its own rule: ids that do not belong to `companyId`, or do not exist, MUST be silently discarded from the result — never thrown as an error — leaving the caller responsible for detecting the resulting cardinality mismatch.

#### Scenario: An id belonging to another company is silently discarded

- GIVEN company A calls with `ids` containing X, which belongs to company B
- WHEN `obtenerItemsDeProveedor(A, ids)` executes
- THEN X is absent from the result — no error is thrown for it, and the caller observes a shorter array than requested

#### Scenario: An infrastructure failure still throws, never a degraded empty array

- GIVEN `catalogo`'s database is unavailable
- WHEN `obtenerItemsDeProveedor` is called
- THEN `CatalogQueryUnavailableError` is thrown — never a `[]` standing in for "could not ask" (C8 inherited)

#### Scenario: All requested ids belonging to the caller's company are returned

- GIVEN every id in `ids` belongs to company A
- WHEN `obtenerItemsDeProveedor(A, ids)` executes
- THEN all matching `ProviderCatalogItem`s are returned, one round-trip, no N+1

#### Scenario: buscarCoincidencias is untouched

- GIVEN `CatalogQueryPort`'s existing `buscarCoincidencias` method and its C1–C8 rules
- WHEN this delta is applied
- THEN its signature and behavior are unchanged — this is the repo's first purely additive delta over a frozen `contracts/` file
