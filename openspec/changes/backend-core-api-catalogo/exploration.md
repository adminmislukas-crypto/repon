# Exploration: `backend-core-api-catalogo` — second domain vertical (`catalogo`)

**Status**: partial (ready for proposal)
**Date**: 2026-08-05

## Executive Summary

Investigated `catalogo` domain build-out against the `identidad` reference implementation; confirmed and resolved the `CatalogQueryPort` `ports-out/` → `contracts/` placement gap (WARNING-3) with a concrete move, compared 3 approaches for `cargarCatalogoMasivo` (recommend row-level processing, no wrapping transaction) and 3 for `ajustarPreciosPorCategoria` (no clear winner — flagged for design), and surfaced a real authorization gap (client-trusted `companyId`, ownerless `actualizarPrecio`) plus a narrower-than-expected event-consumption need.

## Current State

**Placeholder scaffold** (`services/core-api/src/domains/catalogo/`) — confirmed minimal, exactly 3 files:
- `ports-out/catalog-repository.port.ts` — `CatalogRepository` interface (`save`, `findByCompany`, `findMatching`, all with trailing `tx?: TransactionContext`) + `CATALOG_REPOSITORY` token. Doc comment explicitly says the real `KyselyCatalogRepository` is deferred to this change.
- `ports-out/catalog-query.port.ts` — `CatalogQueryPort` (`buscarCoincidencias`) + `CATALOG_QUERY_PORT` token. Its own doc comment already states the exact placement gap WARNING-3 flagged, and defers the fix to "when `catalogo` gets its own SDD change" — that change is this one.
- `catalogo.module.ts` — empty `@Module({})`, already imported by `app.module.ts`. No providers bound (correct per design.md: "un token sin proveedor es correcto... prohibido `useValue: {}`").

No `domain/`, `ports-in/`, `contracts/`, or `adapters/` folders exist yet — this is a genuine green-field build inside an established hexagonal shape.

**`@repon/types`** (`packages/types/src/catalogo.ts`) already has `CatalogProduct` and `ProviderCatalogItem` (camelCase, matches `shared-types-package` spec's D-A rule). `RefillItem` also exists (`refill-matching.ts`). **Missing**: `ArchivoCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` — these appear only as unresolved type names in `catalogo/SPEC.md`'s prose interface block, never promoted to real code (same gap `shared-types-package` closed for the other 6 files during the foundation change — this domain still owes that promotion for its own 3 types).

**Database**: fully migrated already (`supabase/migrations/20260803120300_03_catalogo.sql`) — `catalog_products` (reference catalog, GIN trigram indexes, `authenticated`-only SELECT, no `anon`) and `provider_catalog` (two RLS SELECT policies: public-available + owner-sees-all, `precio_maximo >= precio_base` CHECK, `catalog_product_id` nullable by design). `service_role` grants (`select, insert, update`, no `delete`) exist via the fix-forward migration `20260804090500_10_grants_domain_tables_service_role.sql` — consistent with the repo's "no physical DELETE" rule.

**Gap found (not previously flagged anywhere)**: `services/core-api/src/shared/database/schema.ts` (Kysely `DB` interface) currently only types `companies`, `profiles`, `admin_roles`, `audit_log` — its own header comment says the other 13 tables "get typed here as their owning domain change lands." **`CatalogProductsTable`/`ProviderCatalogTable` row types do not exist yet.** This is required groundwork for this change regardless of which implementation approach is chosen for the two non-trivial use cases below.

## Affected Areas

- `services/core-api/src/domains/catalogo/` — full vertical build: `domain/`, `ports-in/` (5 use cases), `contracts/` (new folder), `adapters/http|persistence|events`, `catalogo.module.ts` providers.
- `services/core-api/src/shared/database/schema.ts` — add `CatalogProductsTable`, `ProviderCatalogTable`, extend `DB`.
- `packages/types/src/catalogo.ts` — add `ArchivoCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor`.
- `services/core-api/src/domains/refill-matching/` and `.../ofertas/` — currently pure placeholders (confirmed via glob: only a `ports-out/*-repository.port.ts` + empty module each), so **nothing consumes `CatalogQueryPort` cross-domain yet** — the move is safe with zero breaking blast radius today, but the contract's shape becomes load-bearing the moment either domain's own SDD change lands.
- `services/core-api/src/app.module.ts` — no change expected (already imports `CatalogoModule`).

## Resolved: `CatalogQueryPort` placement (WARNING-3)

Confirmed in code: `catalog-query.port.ts` currently sits in `ports-out/`, and its own doc comment already names this exact gap. Per `core-api-hexagonal-layout` spec's explicit scenario ("`ofertas` imports `CatalogQueryPort` from `domains/catalogo/contracts/`"), and given `CatalogQueryPort` is **domain-owned** (declared by `catalogo` itself in its SPEC.md, not kernel-declared like `ActorPort`), the concrete move is:

1. Create `services/core-api/src/domains/catalogo/contracts/` (doesn't exist yet).
2. Move `catalog-query.port.ts` (interface `CatalogQueryPort` + token `CATALOG_QUERY_PORT`) from `ports-out/` → `contracts/`, byte-identical otherwise.
3. `CatalogRepository`/`CATALOG_REPOSITORY` **stays** in `ports-out/` — it's catalogo's own internal persistence port, never cross-domain imported (mirrors `CompanyRepository`, which stayed in `identidad/ports-out/` while only `IdentidadActorAdapter` moved to `contracts/`).
4. **Nuance for `sdd-design` to confirm** (no exact precedent exists — `identidad`'s `contracts/` only holds an *implementation* of a kernel-declared interface, never a domain-owned interface's own declaration+implementation together): the concrete class implementing `CatalogQueryPort` (e.g. a Kysely-backed adapter querying `provider_catalog`/`catalog_products`) can legitimately live in `adapters/persistence/` like any other repository adapter, since cross-domain consumers (`ofertas`, `refill-matching`) only ever need `@Inject(CATALOG_QUERY_PORT)` + the interface type — they never import the concrete class. Only the interface + token need to physically sit in `contracts/`. Recommend this as the pattern; flag it explicitly in the proposal since it's the first domain-owned (non-kernel) cross-domain contract this repo will actually implement.
5. Resolving this simultaneously informs (does not fully close) **WARNING-2** (`identidad/adapters/events/` absence): `catalogo` will likely be the **first domain in the codebase to consume events** (see below), which is the natural test case for whether `adapters/events/` is "required when a domain consumes events, optional when it only publishes."

## Approaches: `cargarCatalogoMasivo` (bulk load)

Signature: `cargarCatalogoMasivo(companyId: string, archivo: ArchivoCarga): Promise<ResultadoCargaMasiva>`. SPEC.md's own extraction note calls this table "la que más volumen de escritura tiene — cientos de productos por proveedor."

**Sub-decision 0 — `ArchivoCarga` shape**: per `core-api-hexagonal-layout`'s "DTOs and framework decorators stay in adapters/http" rule, the ports-in use case must receive a plain parsed array, never a raw `Express.Multer.File`/HTTP-framework type. File parsing (CSV/XLSX) belongs in `adapters/http/` (the mapper), producing something like `ArchivoCarga = { items: NuevoProductoProveedorRow[] }` before the use case ever sees it. This needs to be pinned in `sdd-spec`.

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. Single wrapping transaction** | One `TransactionManager.runInTransaction` around every row's upsert | All-or-nothing consistency; matches the `tx?` pattern precedent from identidad's admin mutations | One malformed row (e.g. bad price) aborts the whole 300-row file — poor UX for a provider fixing a typo; long-held transaction/connection under real write volume; contradicts `ResultadoCargaMasiva`'s own return shape, which implies a per-item result report, not a boolean success | Low |
| **B. Row-level processing, no wrapping transaction** | Validate + upsert each row independently; `ResultadoCargaMasiva` reports per-row success/failure | Matches `ResultadoCargaMasiva`'s implied shape (actionable partial-failure report); no giant lock; `provider_catalog` upserts have no cross-row invariant to protect (unlike identidad's mutation+audit pairing); safe to re-run the same file (idempotent per row via upsert) | No atomicity — acceptable here since there's no audit-log pairing requirement and no cross-row invariant | Medium |
| **C. Chunked transactions** | Batches of N rows per transaction | Bounds lock/transaction duration while keeping partial atomicity per chunk | Extra complexity; still needs per-row reporting; chunk-boundary failure semantics need explicit design | Medium-High |

**Recommendation**: **B**. `ResultadoCargaMasiva`'s very existence as a distinct return type (not `void`) signals partial success is a first-class outcome the product spec already anticipated, and there is no cross-row invariant analogous to identidad's mutation+audit atomicity requiring a transaction here.

**Event fan-out sub-decision**: should each row's insert fire a `ProductoAgregado`, meaning up to hundreds of events per bulk-load request? `EventEmitterPublisher.publish` uses `emitAsync` (awaits every listener), so N events in one request means N synchronous listener-fan-outs inside the same HTTP call. Neither `refill-matching` nor `ofertas` consume `ProductoAgregado`/`PrecioActualizado` today (they use `CatalogQueryPort` as a synchronous pull, not event-driven push) — there is no current consumer that needs per-row granularity. **Recommendation**: `cargarCatalogoMasivo` emits **only** `CatalogoCargaMasivaCompletada` (one summary event, e.g. `{ companyId, totalCargados, totalFallidos }`); `ProductoAgregado` stays scoped to the single-item `cargarProductoCatalogo` use case. Flag for `sdd-propose` to confirm — it's a reasonable default, not something to lock silently.

## Approaches: `ajustarPreciosPorCategoria` (category-wide price adjustment)

Signature: `ajustarPreciosPorCategoria(companyId: string, categoria: string, porcentaje: number): Promise<void>`.

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. Application-level loop** | `findByCompany`/a new `findByCompanyAndCategoria` fetches matching rows; use case computes new prices per row (pure function, unit-testable with mocked ports-out); `save()` per row | Business math (rounding, `precio_maximo >= precio_base` invariant handling) stays in the testable application layer — matches `docs/ARCHITECTURE.md`'s "Supabase = infraestructura pura" and design.md's own rejection of Postgres-RPC business logic for the same reason | N round-trips for a company with hundreds of matching items — slower under real write volume | Low-Medium |
| **B. Repository-level bulk `UPDATE`** | New `CatalogRepository` method issuing one SQL `UPDATE ... WHERE company_id = ? AND categoria = ?` with the percentage math done in SQL | One round-trip regardless of row count; atomic by nature (single statement) | Pushes business calculation into the adapter/SQL layer — exactly what D-A/hexagonal-layout's "domain doesn't know DB, DB doesn't know business rules" principle warns against; not unit-testable without a DB integration test; expands `CatalogRepository`'s currently-thin interface (`save`/`findByCompany`/`findMatching`) with a bulk-math method not in the product SPEC.md | Low |
| **C. Hybrid — fetch, compute in use case, batch-write** | One `SELECT` for matching rows, pure calculation in the use case, one batched `UPDATE ... FROM (VALUES ...)` (or Kysely equivalent) for the write | Keeps calculation testable in the domain/use-case layer while bounding round-trips to ~2 | More adapter-layer complexity than A or B; still new territory for this codebase (no existing batch-write precedent to copy) | Medium |

**No single approach is unambiguously correct here** — A is most consistent with established architectural precedent (design.md explicitly rejected DB-side business logic for identidad on the same grounds), but C is the more scale-appropriate choice given the domain's own "highest write volume" framing. **This is a genuine open decision for `sdd-propose`/`sdd-design`**, not resolved here.

**Invariant risk regardless of approach**: does `porcentaje` scale `precio_base` only, or both `precio_base` and `precio_maximo` proportionally? If only `precio_base` scales and can end up exceeding an unchanged `precio_maximo`, the DB `CHECK (precio_maximo >= precio_base)` constraint rejects the row — this must be a named business rule before implementation, not discovered at the first failed `UPDATE`.

**Event fan-out sub-decision (same shape as bulk load, but SPEC.md itself is asymmetric here)**: unlike `cargarCatalogoMasivo`, which gets its own summary event (`CatalogoCargaMasivaCompletada`), `catalogo/SPEC.md`'s "Eventos que publica" list has no batch-specific counterpart for `ajustarPreciosPorCategoria` — only the single-item `PrecioActualizado`. If `refill-matching`'s own future microservice-extraction plan ("mantiene actualizada [su caché] escuchando `PrecioActualizado`" — SPEC.md's own words) is taken as the eventual target architecture, firing `PrecioActualizado` once per affected row for a company-wide category adjustment could mean hundreds of events for one request. **Flag to `sdd-propose` explicitly**: either (a) add a symmetrical summary event (a spec delta over the product SPEC.md, must be flagged per project rules — "flag conflicts instead of silently overriding"), or (b) accept per-row `PrecioActualizado` fan-out now since today's `EventEmitter2` is in-process/cheap compared to the future broker, and defer the summary-event question to whichever domain (`refill-matching`) actually builds the described denormalized cache.

## Open Question: `EmpresaAprobada`/`EmpresaSuspendida` consumption — narrower than it first looks

A non-obvious finding: catalogo does **not** need to consume these events for the write-side self-service gate ("habilita a esa empresa a cargar catálogo"). `AuthenticatedActor.companyStatus` is already resolved fresh, uncached, per request (`core-api-auth-guard` spec, D-E: "blocking on it is a business rule owned by each use case (`ofertas`/`catalogo`)") — so `cargarProductoCatalogo`/`cargarCatalogoMasivo`/`actualizarPrecio`/`ajustarPreciosPorCategoria` can simply check `actor.companyStatus === 'activo'` at request time, live, with zero event-driven state needed.

Where event consumption **does** matter: the **read side** — `buscarProductos`/`CatalogQueryPort.buscarCoincidencias` must exclude a suspended company's `provider_catalog` rows from *other* users' search/matching results system-wide. Two approaches, both real design decisions:

1. **Query-time join** against `companies.status` inside `CatalogRepository`'s Kysely queries — no event listener needed, but creates an adapter-level coupling to identidad's table shape (allowed at the shared `DB` schema level, but not "hexagonally pure").
2. **Event-driven denormalization** — `catalogo` consumes `EmpresaAprobada`/`EmpresaSuspendida` via a new `adapters/events/` listener (`@OnEvent`, first real use of that folder in the codebase, resolving WARNING-2's ambiguity in practice) and maintains its own flag/table, filtered without touching `companies` at all. This mirrors the exact denormalization pattern SPEC.md's own "al extraer como microservicio" section already prescribes for `refill-matching`'s future cache — doing it here for `EmpresaSuspendida` today keeps `catalogo` shaped the same way from day one.

Leaning toward (2) for consistency with the product spec's own stated direction, but this needs a schema decision (new column vs. new table) that belongs in `sdd-design`, not here.

## Open Question: authorization/ownership gaps in the raw SPEC.md signatures

Mirrors the class of gap the foundation change closed for identidad (4 signature fixes, e.g. `asignarRolAdmin` needing `adminId`). The product SPEC.md's `CatalogoInboundPort` signatures take `companyId` as a caller-supplied argument for `cargarProductoCatalogo`/`cargarCatalogoMasivo`/`ajustarPreciosPorCategoria` — if the controller trusts a client-supplied `companyId` rather than forcing it to `actor.companyId` (the `core-api-auth-guard` pattern: pass explicit actor-derived scalars, never trust client identity fields), any authenticated provider could act on another company's catalog. Worse, `actualizarPrecio(itemId, ...)` takes **no** `companyId` at all — the use case must look up the item first and verify `item.companyId === actor.companyId` before allowing the update, or any provider can silently mutate any other company's prices by guessing/enumerating `itemId`. **This must be closed explicitly in `sdd-spec`**, same treatment as identidad's 4 gaps.

## Open Question: `AuditLogPort` usage

None of catalogo's 5 use cases obviously qualify as "admin-mutating" per `shared-audit-log` spec's scope — they're provider self-service actions on their own inventory, closer to `registrarEmpresa`/`registrarUsuario` (no audit) than `aprobarEmpresa`/`suspenderEmpresa` (audited). Default assumption: **no** `AuditLogPort` calls in this domain, unless product wants an admin-visible audit trail for price disputes — flag for `sdd-propose` to confirm rather than assume either way.

## Risks

- **R-cat-1 — Cross-domain contract stability (High prob. once `refill-matching`/`ofertas` land)**: `CatalogQueryPort.buscarCoincidencias` is currently unconsumed everywhere (confirmed via glob — both `refill-matching` and `ofertas` are still pure placeholders), so this is the cheapest possible moment to fix its shape and latency/error contract. Once 2+ domains implement against it, any signature change becomes a coordinated multi-domain breaking change. Recommend nailing the exact contract (including failure semantics — what happens if `catalogo`'s own DB is slow/down during a synchronous in-process call from `refill-matching`) in this change's `sdd-design`.
- **R-cat-2 — Event fan-out volume (Medium prob. / Medium-High impact)**: `EventEmitterPublisher.publish` uses `emitAsync`, so N in-process listeners for N events all execute within the same request/transaction boundary. A 300-row bulk load or category-wide adjustment emitting one event per row could materially slow the HTTP response or let one slow/failing listener affect completion-event ordering for an otherwise-successful batch. Needs an explicit per-row-vs-summary decision before implementation (see both use-case sections above).
- **R-cat-3 — Missing DB row types**: `CatalogProductsTable`/`ProviderCatalogTable` absent from `shared/database/schema.ts` — required groundwork, independent of which approach wins, should be an early task so it doesn't silently block adapter work.
- **R-cat-4 — Authorization gaps in the raw product SPEC.md**: `companyId`-trusting signatures and the ownerless `actualizarPrecio(itemId, ...)` are real cross-tenant-mutation risks if copied verbatim from SPEC.md into `ports-in` without the actor-derived-scalar pattern (see above). Given `core-api-auth-guard`'s R1 framing ("RLS is bypassed on the service-role connection... zero DB-level backstop"), an unclosed gap here is not cosmetic — it's the same class of risk R1 already named for identidad.
- **R-cat-5 — First strict-TDD domain**: unlike identidad (Standard Mode during bootstrap), this is the first domain built under `strict_tdd: true`. No existing reference PR sequence shows how to red-green-refactor a bulk/batch operation over "hundreds of rows" — `sdd-tasks` needs to define testable increments (single-row happy path → partial-failure reporting → batch/category-adjustment math) rather than one large PR.
- **R-cat-6 — `@repon/types` promotion debt**: `ArchivoCarga`/`ResultadoCargaMasiva`/`NuevoProductoProveedor` don't exist as real types yet; per `shared-types-package` spec, validation rules (e.g. per-row price checks before hitting the DB CHECK constraint) belong at the type/DTO layer, not discovered via raw Postgres constraint violations surfacing mid-batch.

## Ready for Proposal

**Yes.** The `CatalogQueryPort` placement question is fully resolved with a concrete move (see above). The two flagged non-trivial use cases have clear tradeoff tables but two genuinely open decisions each (transaction/write-batching strategy for `cargarCatalogoMasivo`; calculation-placement and event-granularity for `ajustarPreciosPorCategoria`) that `sdd-propose`/`sdd-design` should decide explicitly and record as spec deltas — not silently default. The authorization-signature gaps and the `EmpresaAprobada`/`EmpresaSuspendida` consumption scope are also concrete enough for `sdd-propose` to scope directly.
