# core-api-catalogo Specification

## Purpose

The `catalogo` domain vertical: the 5 use cases (`buscarProductos`, `cargarProductoCatalogo`, `cargarCatalogoMasivo`, `actualizarPrecio`, `ajustarPreciosPorCategoria`), the price invariant, partial-failure and event-emission semantics for batch operations, cross-tenant authorization (D7/D8), suspended-company visibility (D9/D16), and the `CatalogQueryPort` cross-domain contract (D1).

## Requirements

### Requirement: buscarProductos reads the shared reference catalog, with no company dimension

`buscarProductos(query, categoria?)` MUST return `CatalogProduct[]` matching the search term, read from `catalog_products` — the shared reference catalog. `catalog_products` has no `company_id` column; `buscarProductos` MUST NOT attempt to filter by company or by suspension status, and no requirement in this spec constrains it to do so. **Corrects an over-broad proposal success criterion**: `catalogo`'s per-company visibility filtering (see next requirement) applies only to reads that return `provider_catalog` rows, not to the reference catalog.

#### Scenario: Happy path search

- GIVEN active catalog products matching "detergente"
- WHEN `buscarProductos('detergente')` is called
- THEN matching `CatalogProduct[]` are returned, drawn only from `catalog_products`

### Requirement: Cross-tenant matching reads exclude a suspended company's catalog; the owner's own read does not

`CatalogQueryPort.buscarCoincidencias` and `CatalogRepository.findMatching` — the two reads that can surface one company's `provider_catalog` rows to a **different** actor — MUST NOT return items belonging to a company whose latest known status (tracked via the `EmpresaSuspendida`/`EmpresaAprobada`/`EmpresaReactivada` event stream) is `suspendido`, and MUST NOT determine this by querying the `companies` table directly (D9). `CatalogRepository.findByCompany` — the provider reading their **own** catalog — MUST NOT apply this filter: an authenticated actor of a suspended company still reads their own inventory unfiltered (same principle as the foundation's actor-can-always-read-own-state rule).

#### Scenario: A suspended company's catalog is excluded from cross-tenant matching and search

- GIVEN company A has been suspended (`EmpresaSuspendida` already consumed) and has `provider_catalog` items
- WHEN another user's search invokes `CatalogQueryPort.buscarCoincidencias`, or `CatalogRepository.findMatching` is called
- THEN no item belonging to company A appears in the results, and no query in `catalogo` reads the `companies` table directly

#### Scenario: A reactivated company's catalog reappears in cross-tenant reads

- GIVEN company A was suspended and `identidad` later publishes `EmpresaReactivada` for it (D16)
- WHEN `CatalogQueryPort.buscarCoincidencias`/`findMatching` runs again
- THEN company A's catalog items appear again

#### Scenario: A suspended company's own provider still reads their own catalog

- GIVEN company A has been suspended and has `provider_catalog` items
- WHEN an authenticated actor of company A calls `CatalogRepository.findByCompany`
- THEN company A's own items are returned, unfiltered by the suspension

### Requirement: The 4 mutating use cases require an active company

`cargarProductoCatalogo`, `cargarCatalogoMasivo`, `actualizarPrecio`, and `ajustarPreciosPorCategoria` MUST derive `companyStatus` from `actor.companyStatus` — a second actor-derived scalar alongside `companyId` (D-E) — and MUST reject the call with `EmpresaNoActivaError` (mapped to HTTP 403) when `companyStatus !== 'activo'`, before any read or write. This is one rule with four applications, not four separate checks. `buscarProductos` MUST NOT apply this gate — reading the reference catalog does not require an active company.

#### Scenario: A suspended company cannot write to its own catalog

- GIVEN an authenticated provider actor whose `companyStatus` is `'suspendido'` (or `'pendiente'`)
- WHEN the actor calls any of `cargarProductoCatalogo`, `cargarCatalogoMasivo`, `actualizarPrecio`, or `ajustarPreciosPorCategoria`
- THEN the call is rejected with `EmpresaNoActivaError` (HTTP 403) before any repository read or write, and no event is published

#### Scenario: An active company can write normally

- GIVEN an authenticated provider actor whose `companyStatus` is `'activo'`
- WHEN the actor calls any of the 4 mutating use cases with an otherwise-valid request
- THEN the call proceeds normally

### Requirement: cargarProductoCatalogo scopes the new item to the actor's company

`cargarProductoCatalogo(producto: NuevoProductoProveedor)` MUST derive `companyId` exclusively from `actor.companyId`, never from the request body (D8), create exactly one `ProviderCatalogItem`, and publish `ProductoAgregado`.

#### Scenario: Provider loads their own product

- GIVEN an authenticated provider actor of company A
- WHEN `cargarProductoCatalogo` is called with a valid `NuevoProductoProveedor`
- THEN a `ProviderCatalogItem` is created with `companyId = A`, and `ProductoAgregado` is published

#### Scenario: A client-supplied companyId cannot influence the write

- GIVEN an authenticated provider actor of company A
- WHEN the controller invokes the use case
- THEN the DTO for this route has no `companyId` field for a client to populate, and the only `companyId` reaching the use case is `actor.companyId`

### Requirement: cargarCatalogoMasivo processes rows independently and reports partial failure

`cargarCatalogoMasivo(archivo: ArchivoCarga)` MUST process each row of the already-parsed `archivo` independently, without a wrapping transaction (D2). `archivo` arrives already parsed and framework-free (never an `Express.Multer.File`, per D11). A row-level validation or persistence failure MUST NOT abort other rows. The use case MUST return one `ResultadoCargaMasiva` identifying, per row, success or failure. `companyId` MUST derive exclusively from `actor.companyId` (D8), applied to every row regardless of any company reference inside the file. Re-uploading the same product MUST update the existing row, not create a duplicate (D15).

#### Scenario: Partial failure is reported per row, not aborted

- GIVEN an `ArchivoCarga` with N rows, where M fail validation (e.g. negative price) and N-M are valid
- WHEN `cargarCatalogoMasivo` runs
- THEN `ResultadoCargaMasiva` reports N-M successes and M individually identifiable failures, and the N-M valid rows are persisted

#### Scenario: Re-uploading the same file updates instead of duplicating

- GIVEN company A already loaded a row for product P via a prior upload
- WHEN company A uploads the same product P again with a different price
- THEN the existing row for P is updated and no duplicate row is created

#### Scenario: Two rows identifying the same product within one file are rejected as a duplicate, not silently merged

- GIVEN an `ArchivoCarga` where two rows resolve to the same identity (same `catalogProductId`, or same `nombre`+`categoria` when `catalogProductId` is absent)
- WHEN `cargarCatalogoMasivo` processes the file
- THEN the second occurrence is reported in `ResultadoCargaMasiva.fallos` as a duplicate-within-file failure, not silently applied as an update over the first row's result

#### Scenario: companyId is derived from the actor, never the upload

- GIVEN an authenticated provider actor of company A
- WHEN `cargarCatalogoMasivo` is called
- THEN every row created/updated has `companyId = A`, regardless of any company reference inside the uploaded file

### Requirement: cargarCatalogoMasivo emits exactly one summary event

Regardless of row count, `cargarCatalogoMasivo` MUST publish exactly one `CatalogoCargaMasivaCompletada` (`{ companyId, totalCargados, totalFallidos }`) per invocation — never one event per row (D3).

#### Scenario: One event for a 300-row upload

- GIVEN an `ArchivoCarga` with 300 rows
- WHEN `cargarCatalogoMasivo` completes
- THEN exactly one `CatalogoCargaMasivaCompletada` is published, with `totalCargados + totalFallidos = 300`

### Requirement: actualizarPrecio is scoped to the caller's own company; cross-tenant access is a 404

`actualizarPrecio(itemId, precioBase, precioMaximo)` MUST derive `companyId` from `actor.companyId` (D8) and use it to authorize the target item (D7). It MUST call `findById(itemId)`; if the item does not exist OR `item.companyId !== actor.companyId`, it MUST throw `CatalogItemNotFoundError`, mapped to HTTP 404 — never 403. On success it MUST validate the price invariant in the entity, then persist via `save`.

#### Scenario: Owner updates their own item's price

- GIVEN item I belongs to company A, and an authenticated provider actor of company A
- WHEN `actualizarPrecio(I, precioBase, precioMaximo)` is called with a valid range
- THEN I's price is updated and the call resolves

#### Scenario: Cross-tenant update attempt returns 404, not 403, and does not mutate

- GIVEN a proveedor actor authenticated for company A, and item I belongs to company B (A ≠ B)
- WHEN the actor calls `actualizarPrecio(I, precioBase, precioMaximo)`
- THEN the response is HTTP 404 (never 403), `CatalogItemNotFoundError` is thrown, and I's price in the database is unchanged

### Requirement: ajustarPreciosPorCategoria scales both price bounds and preserves the price invariant

`ajustarPreciosPorCategoria(categoria, porcentaje)` MUST derive `companyId` from `actor.companyId` (D8) and only read/write items where `companyId = actor.companyId`. It MUST scale both `precio_base` and `precio_maximo` of every matching item by the same factor `(1 + porcentaje/100)` (D5). It MUST reject `porcentaje <= -100` as a validation error before any repository read/write. The invariant `precio_maximo >= precio_base` MUST be preserved by construction in the domain — it MUST NOT rely on the DB `CHECK` to catch a violation.

#### Scenario: Both bounds scale proportionally

- GIVEN item I of company A with `precio_base: 1000, precio_maximo: 1500`, and `porcentaje: 10`
- WHEN `ajustarPreciosPorCategoria` runs for company A on I's `categoria`
- THEN I's `precio_base` becomes 1100 and `precio_maximo` becomes 1650

#### Scenario: porcentaje <= -100 is rejected before touching the database

- GIVEN any items in company A's catalog for a given `categoria`
- WHEN `ajustarPreciosPorCategoria(categoria, -100)` or a more negative value is called
- THEN a validation error is raised, no repository call is made, and no item is modified

#### Scenario: The CHECK constraint is never at risk

- GIVEN any valid `porcentaje > -100` and any starting pair satisfying `precio_maximo >= precio_base`
- WHEN the adjustment is applied
- THEN `precio_maximo >= precio_base` holds for every affected row afterward, by construction of the scaling factor — no test can produce a `CHECK (precio_maximo >= precio_base)` violation

#### Scenario: companyId is derived from the actor

- GIVEN an authenticated provider actor of company A, and company B also has items in the same `categoria`
- WHEN `ajustarPreciosPorCategoria` is called by A's actor
- THEN only company A's items are read and written; company B's items in the same `categoria` are untouched

### Requirement: ajustarPreciosPorCategoria emits exactly one summary event

Regardless of match count, the use case MUST publish exactly one `PreciosCategoriaAjustados` (`{ companyId, categoria, porcentaje, totalActualizados }`) per invocation — never one event per item (D6). **Declared delta over `services/core-api/domains/catalogo/SPEC.md`**: `PreciosCategoriaAjustados` is not listed under its "Eventos que publica" — see D6.

#### Scenario: One event regardless of match count

- GIVEN 40 items of company A match `categoria: "limpieza"`
- WHEN `ajustarPreciosPorCategoria('limpieza', 10)` completes for company A
- THEN exactly one `PreciosCategoriaAjustados` is published with `totalActualizados: 40`

### Requirement: Per-item events never fire during batch operations

`ProductoAgregado` MUST be published only by `cargarProductoCatalogo`. `PrecioActualizado` MUST be published only by `actualizarPrecio`. Neither `cargarCatalogoMasivo` nor `ajustarPreciosPorCategoria` MUST publish either event, even once per affected row (D3, D6).

#### Scenario: A batch operation never emits per-item events

- GIVEN `cargarCatalogoMasivo` processes 50 rows successfully
- WHEN the operation completes
- THEN zero `ProductoAgregado` events are published — only the single `CatalogoCargaMasivaCompletada` summary event

### Requirement: CatalogQueryPort is the only cross-domain entry point into catalogo

`CatalogQueryPort` (`buscarCoincidencias(itemsSolicitados, companyId?)`) and its DI token `CATALOG_QUERY_PORT` MUST live in `domains/catalogo/contracts/` (D1). The concrete implementing class MUST live in `adapters/persistence/`, and MUST NOT be exported from `contracts/`.

#### Scenario: A future consumer only imports the contract

- GIVEN a future consumer domain needs `catalogo` data
- WHEN it is implemented
- THEN it imports `CatalogQueryPort`/`CATALOG_QUERY_PORT` from `domains/catalogo/contracts/` only, never `adapters/persistence/`

### Requirement: CatalogQueryPort fails closed on infrastructure failure — never a silent empty result

`CatalogQueryPort.buscarCoincidencias` MUST throw `CatalogQueryUnavailableError` when it cannot complete the query due to an infrastructure failure (database unavailable, connection pool exhausted, query timeout). It MUST NOT return `[]` or a partial result to represent an infrastructure failure — an empty array MUST mean only "no matches", never "could not ask". A caller exposing this over HTTP MUST map `CatalogQueryUnavailableError` to HTTP 503, never 200 with an empty list.

#### Scenario: A database failure surfaces as an explicit error, not an empty match list

- GIVEN `catalogo`'s database is unavailable when `CatalogQueryPort.buscarCoincidencias` is called
- WHEN the call is made
- THEN `CatalogQueryUnavailableError` is thrown — the caller never receives `[]` as a stand-in for "the catalog could not be queried"

#### Scenario: A genuine zero-match result is distinguishable from a failure

- GIVEN `catalogo`'s database is healthy and no `provider_catalog` item matches the requested items
- WHEN `CatalogQueryPort.buscarCoincidencias` is called
- THEN it resolves to `[]` without throwing — a real "no matches" answer, not conflated with the failure case above

### Declared deltas over `services/core-api/domains/catalogo/SPEC.md`

| Product SPEC.md says | This spec requires | Rationale |
|---|---|---|
| `actualizarPrecio(itemId, precioBase, precioMaximo): Promise<void>` — no company parameter | `actualizarPrecio` derives `companyId` from the actor and returns 404 (never 403) on cross-tenant access | D7 |
| "Eventos que publica": `ProductoAgregado`, `PrecioActualizado`, `CatalogoCargaMasivaCompletada` | Adds `PreciosCategoriaAjustados` as a 4th published event | D6 |
| The 4 mutating use cases' signatures list only their product-facing parameters | Each also derives `companyStatus` from the actor and rejects with `EmpresaNoActivaError` (403) when not `'activo'` | D-E (`sdd-design`) |
| "Consulta que expone a otros dominios" describes `CatalogQueryPort` with no stated failure behavior | `buscarCoincidencias` MUST throw `CatalogQueryUnavailableError` on infrastructure failure, never return a degraded `[]` | D-B (`sdd-design`) |
| No requirement in the proposal constrained which reads apply the D9 visibility filter | Filter applies to `buscarCoincidencias`/`findMatching` only — NOT to `buscarProductos` (`catalog_products` has no `company_id`) or `findByCompany` (owner reads own catalog unfiltered) | D-A (`sdd-design`), corrects an over-broad proposal success criterion |

### Open item deferred beyond this spec

Exact upload limits for `ArchivoCarga` (max rows, max file size, accepted formats beyond "CSV/XLSX") are not fixed here — validation rules live in the type/DTO layer per `shared-types-package`, but their numeric thresholds are a design-level parameter, consistent with how Q5b's exact index columns are deferred to `sdd-design` (proposal Q4).
