# Delta for core-api-catalogo

## ADDED Requirements

### Requirement: CatalogQueryPort gains a second, additive, company-scoped by-id read

`CatalogQueryPort` gains a second method, needed only by `ofertas`' `enviarOfertaProactiva` (D9). **Confirmed signature** (design.md D-B, locked): `obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>` — `companyId` first, because it is the query's mandatory scope, unlike `buscarCoincidencias`'s optional, narrowing `companyId?` (which sorts last for exactly that reason). It MUST inherit `buscarCoincidencias`'s C1–C8 unchanged (no `tx?` param, no side effects, throws `CatalogQueryUnavailableError` on infra failure, single round-trip for the whole `ids` array; C7's trigram-matching rule does not apply — this method matches by exact PK) and add its own rule: ids that do not belong to `companyId`, that do not exist, or that are `disponible = false`, MUST be silently discarded from the result — never thrown as an error — leaving the caller responsible for detecting the resulting cardinality mismatch. An empty `ids` array returns `[]` with zero round-trips. `MAX_COINCIDENCIAS_POR_ITEM` does not apply here — it exists to bound a fuzzy trigram expansion, and this method has none.

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
