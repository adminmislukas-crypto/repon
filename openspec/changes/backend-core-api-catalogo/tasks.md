# Tasks: `catalogo` — segundo vertical, primer contrato cross-dominio, primera proyección event-driven

Expands design.md's finalized **9-PR chained sequence** (§"Secuencia de implementación") into checkable, test-first tasks. Order and rationale are design.md's, not re-derived here.

**Restructured post-forecast**: PR3, PR4, PR5, and PR8 individually risked exceeding the 400-line review budget. Per the `ask-on-risk` delivery strategy, the maintainer chose to sub-split all 4 using the fallback boundaries already sketched in the original forecast, rather than requesting a `size:exception`. **9 PRs become 13** — every dependency edge below is unchanged from design.md; only the granularity of PRs 3/4/5/8 changed.

## Review Workload Forecast (revised)

| Field | Value |
|---|---|
| Estimated changed lines | ~3,200-4,300 total, now across **13** chained PRs; per-PR range 130-430 |
| 400-line budget risk | **Low-Medium overall** — every PR now targets ≤~430 lines; no PR bundles more than one reviewable concern |
| Chained PRs recommended | Yes — 13 sequential PRs, dependency-ordered, cannot parallelize (same constraints as the 9-PR sequence, plus each split pair is itself sequential) |
| Chain strategy | stacked-to-main (each PR merges to `main` in order) |
| Delivery strategy | ask-on-risk (cached this session) — **resolved**: maintainer chose "sub-divide the 4 large PRs" over `size:exception` |

```text
Decision needed before apply: No (resolved by maintainer — sub-split chosen)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main, 13 PRs
400-line budget risk: Low-Medium (post-split)
```

### Per-PR estimate

| PR | Slice | Est. lines | Risk | Note |
|---|---|---|---|---|
| 1 | 0a · DB (migrations + row types + pool timeouts) | 200-260 | Low | 2 SQL files, `schema.ts` additions, `pool.provider.ts` edit + 1 unit test |
| 2 | 0b · seams (`@repon/types`, `contracts/` move, extended ports) | 180-260 | Low-Medium | "Cero comportamiento, solo costuras" per design — mostly interfaces, no dedicated behavior tests |
| 3a | 1a · domain entity + invariant | 130-180 | Low | Entity, invariant, errors — pure domain, no adapters |
| 3b | 1b · persistence adapters + `buscarProductos` + controller | 420-520 | Medium | Still the largest single slice (2 full Kysely adapters), but isolated from entity review and independently testable |
| 4a | 2a · unit-write use cases + repository `save()` | 320-400 | Medium | Both use cases + the D-C upsert bifurcation on `save()`; R1 (cross-tenant 404) closes here — highest review priority, now isolated from HTTP plumbing |
| 4b | 2b · HTTP adapter + exception filter + e2e | 260-340 | Low-Medium | DTOs, controller routes, exception filter, e2e — depends on 4a |
| 5a | 3a-i · CSV parser + envelope validation | 220-290 | Low-Medium | Parser + envelope DTO, independent of the use case |
| 5b | 3a-ii · bulk-load use case + controller + e2e | 300-380 | Medium | Depends on 5a's parsed shape and PR1's unique index for the upsert conflict target |
| 6 | 3b · category adjustment | 310-425 | Medium | Unchanged — borderline but accepted as-is (single `categoria` scope keeps it naturally smaller than 3/4/5) |
| 7 | 4a · identidad `reactivarEmpresa` | 230-320 | Low-Medium | Unchanged — purely additive (R9), mirrors `suspenderEmpresa` |
| 8a | 4b-i · visibility listener + projection use cases + adapter | 280-360 | Medium | Listener + 2 use cases + Kysely projection adapter |
| 8b | 4b-ii · mandatory cross-domain contract test | 130-200 | Low | Isolated for dedicated review — it's the entire D-A mitigation for the string-keyed event coupling; small in lines but high in importance |
| 9 | 5 · closure | 150-220 | Low | Docs-only: 3 SPEC.md deltas + module-exports audit + full-suite verification |

### Suggested Work Units

| Unit | Goal | PR | Base | Notes |
|---|---|---|---|---|
| 1 | DB: migrations, row types, pool timeouts | PR 1 | `main` | No dependency; blocks all others |
| 2 | Seams: types, contracts/ move, extended ports | PR 2 | `main` | Depends on PR 1's row types |
| 3a | Domain entity + invariant | PR 3a | `main` | Depends on PR 2's `@repon/types`. Pure domain — no adapters, no DB |
| 3b | Persistence adapters + `buscarProductos` + controller | PR 3b | `main` | Depends on 3a's entity. Filter is a no-op until PR 8a writes to the projection — zero observable behavior change |
| 4a | Unit-write use cases + repository `save()` | PR 4a | `main` | Depends on 3a/3b's entity + repository. Highest review priority per design.md |
| 4b | HTTP adapter + exception filter + e2e for the writes | PR 4b | `main` | Depends on 4a's use cases existing |
| 5a | CSV parser + envelope validation | PR 5a | `main` | Depends on PR 2's `ArchivoCarga` type. Independent of 5b's use case |
| 5b | Bulk-load use case + controller + e2e | PR 5b | `main` | Depends on 5a's parser, PR 1's unique index, and 4a's `save()` |
| 6 | Category adjustment | PR 6 | `main` | Depends on PR 2's `saveMany` signature and 3b's `findByCompanyAndCategoria` |
| 7 | identidad `reactivarEmpresa` | PR 7 | `main` | Independent of PRs 3-6; must precede PR 8a because the listener needs `EmpresaReactivada` to exist |
| 8a | Visibility listener + projection use cases + adapter | PR 8a | `main` | Depends on 3b (filter already reads the projection) and PR 7 (event exists) |
| 8b | Cross-domain contract test | PR 8b | `main` | Depends on 8a's listener + projection existing |
| 9 | Closure | PR 9 | `main` | Depends on 8b; SPEC.md deltas describe behavior that must already exist |

---

## Phase 1: DB foundation — Spec: `db-schema-catalogo`

- [x] 1.1 Write `supabase/migrations/20260805120000_11_catalogo_provider_catalog_upsert_index.sql`: two mutually-exclusive partial unique indexes on `provider_catalog` per D-C (`(company_id, catalog_product_id) WHERE catalog_product_id IS NOT NULL` and `(company_id, lower(btrim(nombre)), lower(btrim(categoria))) WHERE catalog_product_id IS NULL`).
- [x] 1.2 Write `supabase/migrations/20260805120100_12_catalogo_hidden_companies.sql`: `catalog_hidden_companies` (PK `company_id`, `oculto boolean default true`, `motivo`, timestamps), `updated_at` trigger, RLS enabled with zero policies, grants `select,insert,update` to `service_role` only (no DELETE).
- [x] 1.3 Apply both migrations locally (`supabase start`/`db reset`); verify neither edits `20260803120300_03_catalogo.sql` or any other applied file (db-schema-catalogo Scenario "A new migration adds the index").
- [x] 1.4 `shared/database/schema.ts`: add `CatalogProductsTable`, `ProviderCatalogTable` (`precio_base`/`precio_maximo` typed `string`, D-C's `numeric`-as-string gotcha), `CatalogHiddenCompaniesTable`; register all 3 on `DB`.
- [x] 1.5 RED: `shared/database/pool.provider.spec.ts` — asserts `Pool` is constructed with `connectionTimeoutMillis: 2000` and `options: '-c statement_timeout=5000'` (mocked `pg.Pool`).
- [x] 1.6 GREEN: edit `shared/database/pool.provider.ts` to add both options (D-B), satisfying 1.5.
- [x] 1.7 Opt-in integration test (`supabase start` local, excluded from CI): both partial unique indexes reject a duplicate and `ON CONFLICT` resolves via `DO UPDATE` on each branch; a `numeric` column round-trips as `string` (db-schema-catalogo Scenario "Re-uploading the same product updates instead of duplicating").

## Phase 2: Seams — Spec: `shared-types-package`, `core-api-hexagonal-layout`, `core-api-catalogo`

- [x] 2.1 `packages/types/src/catalogo.ts`: add `ArchivoCarga`, `FilaCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` (D12); export from barrel `index.ts` (shared-types-package Scenario "catalogo imports without re-declaring").
- [x] 2.2 Verify `tsc --noEmit` passes for `packages/types` (no dedicated unit tests — pure declarations, per existing convention).
- [x] 2.3 Create `domains/catalogo/contracts/catalog-query.port.ts`: `CatalogQueryPort` interface, `CATALOG_QUERY_PORT` token, `CatalogQueryUnavailableError`, `MAX_COINCIDENCIAS_POR_ITEM = 50` — no `tx?` param, deliberately (C1).
- [x] 2.4 Delete `domains/catalogo/ports-out/catalog-query.port.ts` (old placeholder location, zero consumers exist — pure move, core-api-catalogo Scenario "A future consumer only imports the contract").
- [x] 2.5 Extend `domains/catalogo/ports-out/catalog-repository.port.ts`: add `saveMany`, `findById`, `findByCompanyAndCategoria`, all with trailing `tx?: TransactionContext`.
- [x] 2.6 Create `domains/catalogo/ports-out/catalog-visibility-projection.port.ts`: `CatalogVisibilityProjection` (`ocultarEmpresa`, `mostrarEmpresa`) + `CATALOG_VISIBILITY_PROJECTION` token.
- [x] 2.7 Run the ESLint boundary rule (`import-x/no-restricted-paths`) — confirm `contracts/` is the only cross-domain-importable path for the new file (core-api-hexagonal-layout Scenario "A domain query port is consumed correctly").

## Phase 3a: Read side — domain entity + invariant — Spec: `core-api-catalogo`

- [x] 3a.1 RED: `domain/provider-catalog-item.entity.spec.ts` — `crear()` rejects `precioMaximo < precioBase`; prices round to 2 decimals; `aplicarPorcentaje` scales both bounds by the same factor (D5).
- [x] 3a.2 GREEN: `domain/provider-catalog-item.entity.ts` — `crear()`, `actualizarPrecio()`, `aplicarPorcentaje()`, invariant enforced in the entity (never the DB CHECK).
- [x] 3a.3 `domain/catalogo.errors.ts`: declare `PrecioInvalidoError` (used by the entity's invariant).

## Phase 3b: Read side — persistence adapters + `buscarProductos` + controller — Spec: `core-api-catalogo`, `core-api-hexagonal-layout`

Depends on Phase 3a's entity.

- [x] 3b.1 RED: `adapters/persistence/kysely-catalog.repository.spec.ts` — `findMatching` applies the visibility anti-join (`NOT EXISTS ... catalog_hidden_companies ... oculto`); `findByCompany` does NOT (core-api-catalogo Scenarios "excluded from cross-tenant matching" / "own provider still reads their own catalog").
- [x] 3b.2 GREEN: `adapters/persistence/kysely-catalog.repository.ts` — `findById`, `findByCompany`, `findByCompanyAndCategoria`, `findMatching` (with anti-join), `precio_base`/`precio_maximo` string→number mapping.
- [x] 3b.3 RED: `adapters/persistence/kysely-catalog-query.adapter.spec.ts` — exact `catalogProductId` match OR trigram `categoria`+`nombre` match, unioned+deduped by `provider_catalog.id`, capped at `MAX_COINCIDENCIAS_POR_ITEM`, wraps any Kysely/pg error as `CatalogQueryUnavailableError`, applies the visibility filter (core-api-catalogo "A database failure surfaces as an explicit error" / "genuine zero-match result is distinguishable").
- [x] 3b.4 GREEN: `adapters/persistence/kysely-catalog-query.adapter.ts` implementing `CatalogQueryPort`.
- [x] 3b.5 RED: `ports-in/buscar-productos.use-case.spec.ts` — returns `CatalogProduct[]` from `catalog_products`, no company filter applied (core-api-catalogo Scenario "Happy path search").
- [x] 3b.6 GREEN: `ports-in/buscar-productos.use-case.ts`.
- [x] 3b.7 `adapters/http/dto/catalog-product-response.dto.ts` + `catalogo.mapper.ts` + `adapters/http/catalogo.controller.ts`: `GET /catalogo/productos?q=&categoria=` (authenticated, no `@Roles`, not `@Public()`).
- [x] 3b.8 `catalogo.module.ts`: bind `CATALOG_REPOSITORY`→`KyselyCatalogRepository`, `CATALOG_QUERY_PORT`→`KyselyCatalogQueryAdapter`, register `BuscarProductosUseCase` + controller; `exports: [CATALOG_QUERY_PORT]`.
- [x] 3b.9 E2e: `test/catalogo-buscar-productos.e2e-spec.ts` — happy path, 401 with no token.

## Phase 4a: Unit writes — use cases + repository `save()` — Spec: `core-api-catalogo`

Highest review priority per design.md ("el PR que más merece review dedicada"). R1 closes here. Depends on Phase 3a/3b's entity + repository.

- [ ] 4a.1 RED: `ports-in/cargar-producto-catalogo.use-case.spec.ts` — `companyId` derives only from `actor.companyId`; `companyStatus !== 'activo'` → `EmpresaNoActivaError` before any repo call; publishes exactly one `ProductoAgregado` (core-api-catalogo "Provider loads their own product" / "A client-supplied companyId cannot influence the write" / "A suspended company cannot write").
- [ ] 4a.2 GREEN: `ports-in/cargar-producto-catalogo.use-case.ts`.
- [ ] 4a.3 RED (test negativo primero, per design.md's diagram 3): `ports-in/actualizar-precio.use-case.spec.ts` — cross-tenant item (company B) → `CatalogItemNotFoundError`, never a 403-shaped error; item not found → same error (core-api-catalogo "Cross-tenant update attempt returns 404, not 403, and does not mutate").
- [ ] 4a.4 RED: add happy-path, `EmpresaNoActivaError`, and price-invariant-delegates-to-entity cases to the same spec file.
- [ ] 4a.5 GREEN: `ports-in/actualizar-precio.use-case.ts` — `findById` → ownership check → `item.actualizarPrecio()` → `save`.
- [ ] 4a.6 RED: extend `kysely-catalog.repository.spec.ts` — `save()` bifurcates the `ON CONFLICT` target by `catalogProductId` presence (D-C); `DO UPDATE SET` never touches `catalog_product_id`/`company_id`.
- [ ] 4a.7 GREEN: implement `save()` on `KyselyCatalogRepository`.
- [ ] 4a.8 `domain/catalogo.errors.ts`: append `CatalogItemNotFoundError`, `EmpresaNoActivaError`.

## Phase 4b: Unit writes — HTTP adapter + exception filter + e2e — Spec: `core-api-catalogo`

Depends on Phase 4a's use cases.

- [ ] 4b.1 `events/producto-agregado.event.ts`, `events/precio-actualizado.event.ts`.
- [ ] 4b.2 `adapters/http/dto/nuevo-producto.dto.ts`, `adapters/http/dto/actualizar-precio.dto.ts` (no `companyId` field on either, D8), `catalogo.mapper.ts` additions.
- [ ] 4b.3 `adapters/http/catalogo.controller.ts`: `POST /catalogo/mi-catalogo` (201, `@Roles('provider')`), `PUT /catalogo/mi-catalogo/:itemId/precio` (204, `@Roles('provider')`).
- [ ] 4b.4 RED: `catalogo-exception.filter.spec.ts` — one test per mapped error class.
- [ ] 4b.5 GREEN: `adapters/http/catalogo-exception.filter.ts` mirroring `IdentidadExceptionFilter` (404/403/400/503 map), `@UseFilters` at controller level.
- [ ] 4b.6 E2e: `test/catalogo-mi-catalogo.e2e-spec.ts` — 404 not 403 cross-tenant, DTO rejection (extra/missing field → 400), 403 suspended company, happy paths for both routes.
- [ ] 4b.7 `catalogo.module.ts`: register `CargarProductoCatalogoUseCase`, `ActualizarPrecioUseCase`.

## Phase 5a: Bulk load — CSV parser + envelope validation — Spec: `core-api-catalogo`, `shared-types-package`

- [ ] 5a.1 Add `csv-parse` + `@types/multer` to `services/core-api/package.json`.
- [ ] 5a.2 RED: `adapters/http/carga-masiva.parser.spec.ts` — envelope validation rejects wrong mimetype, >2MB, 0 or >500 rows, missing header (400 `ARCHIVO_CARGA_INVALIDO`); valid CSV parses into `ArchivoCarga` with 1-based `numero` excluding header.
- [ ] 5a.3 GREEN: `adapters/http/carga-masiva.parser.ts` (`csv-parse/sync`) + `FileInterceptor('archivo')` wiring + envelope DTO.
- [ ] 5a.4 `domain/catalogo.errors.ts`: append `ArchivoCargaInvalidoError`.

## Phase 5b: Bulk load — use case + controller + e2e — Spec: `core-api-catalogo`

Depends on Phase 5a's parser and PR 1's unique index for a real `ON CONFLICT` target.

- [ ] 5b.1 RED: `ports-in/cargar-catalogo-masivo.use-case.spec.ts` — N rows/M invalid → `totalCargados = N-M`, `fallos` with correct `numero`s, rows independent (core-api-catalogo "Partial failure is reported per row"); duplicate identity within one file → 2nd occurrence reported as failure, not merged ("Two rows identifying the same product... rejected as a duplicate"); exactly one `CatalogoCargaMasivaCompletada` regardless of count; constructor never injects `TRANSACTION_MANAGER` (D2); `companyId` from actor only.
- [ ] 5b.2 GREEN: `ports-in/cargar-catalogo-masivo.use-case.ts`.
- [ ] 5b.3 `events/catalogo-carga-masiva-completada.event.ts`.
- [ ] 5b.4 `adapters/http/dto/carga-masiva.dto.ts` (multipart envelope) + `adapters/http/dto/resultado-carga-masiva-response.dto.ts`.
- [ ] 5b.5 `adapters/http/catalogo.controller.ts`: `POST /catalogo/mi-catalogo/carga-masiva` (200, `@Roles('provider')`, `EmpresaNoActivaError` gate).
- [ ] 5b.6 E2e: `test/catalogo-carga-masiva.e2e-spec.ts` — partial failure report, re-upload updates not duplicates (relies on PR1's index), oversized/malformed file → 400.
- [ ] 5b.7 `catalogo.module.ts`: register `CargarCatalogoMasivoUseCase`.

## Phase 6: Category adjustment — Spec: `core-api-catalogo`

- [ ] 6.1 RED: extend `kysely-catalog.repository.spec.ts` — `saveMany()` writes all items, propagates `tx`.
- [ ] 6.2 GREEN: implement `saveMany()` on `KyselyCatalogRepository`.
- [ ] 6.3 `domain/catalogo.errors.ts`: append `PorcentajeInvalidoError`.
- [ ] 6.4 RED: `ports-in/ajustar-precios-por-categoria.use-case.spec.ts` — both `precio_base`/`precio_maximo` scale by the same factor ("Both bounds scale proportionally"); `porcentaje <= -100` rejected before any repo call ("rejected before touching the database"); invariant preserved by construction; company B's items in the same `categoria` untouched; exactly one `PreciosCategoriaAjustados`; `runInTransaction` invoked with `tx` propagated to `saveMany`.
- [ ] 6.5 GREEN: `ports-in/ajustar-precios-por-categoria.use-case.ts` — wraps `findByCompanyAndCategoria` + `saveMany` in `TransactionManager.runInTransaction`.
- [ ] 6.6 `events/precios-categoria-ajustados.event.ts` (`{companyId, categoria, porcentaje, totalActualizados}`, D6).
- [ ] 6.7 `adapters/http/dto/ajustar-precios.dto.ts` + controller route `POST /catalogo/mi-catalogo/ajustes-de-precio` (204, `@Roles('provider')`).
- [ ] 6.8 E2e: `test/catalogo-ajustes-precio.e2e-spec.ts` — proportional scaling happy path, `porcentaje <= -100` → 400, cross-company isolation.
- [ ] 6.9 `catalogo.module.ts`: register `AjustarPreciosPorCategoriaUseCase`.

## Phase 7: identidad `reactivarEmpresa` — Spec: `core-api-identidad`

Purely additive (R9). Must land before Phase 8a — the listener needs `EmpresaReactivada` to exist.

- [ ] 7.1 RED: `ports-in/reactivar-empresa.use-case.spec.ts` (mirror `suspender-empresa.use-case.spec.ts`) — happy path audits inside the transaction; `status !== 'suspendido'` → `CompanyNotSuspendedError` before any write; company not found → `CompanyNotFoundError`; a mutation failure rolls back the audit entry (core-api-identidad, all 4 scenarios under "reverses a suspension").
- [ ] 7.2 GREEN: `domains/identidad/ports-in/reactivar-empresa.use-case.ts` — same 4 ports as `suspenderEmpresa`, `runInTransaction{findById→save→auditLogPort.record}`, `publish` after commit.
- [ ] 7.3 `domains/identidad/events/empresa-reactivada.event.ts`: `type='empresa.reactivada'`, `(companyId, motivo)`.
- [ ] 7.4 `domains/identidad/domain/identidad.errors.ts`: append `CompanyNotSuspendedError` (no existing class edited).
- [ ] 7.5 `adapters/http/dto/reactivacion.dto.ts`: new DTO, one `motivo` field (not reusing `SuspensionDto`, per D-D's naming-collision rationale).
- [ ] 7.6 `adapters/http/identidad-exception.filter.ts`: append `CompanyNotSuspendedError`→409 `COMPANY_NOT_SUSPENDED` to `ERROR_STATUS_MAP` + `@Catch()`.
- [ ] 7.7 `adapters/http/identidad.controller.ts`: append `POST /identidad/empresas/:id/reactivacion` (`@AdminRoles('super_admin','soporte')`, 204).
- [ ] 7.8 `identidad.module.ts`: append `ReactivarEmpresaUseCase` to providers (all 4 tokens already provided).
- [ ] 7.9 E2e: extend `test/identidad.e2e-spec.ts` — soporte can reactivate ("soporte can reactivate a company"), 409 on non-suspended target, 404 on missing company.
- [ ] 7.10 Run the full existing `identidad` regression suite (111 unit + 17 e2e); confirm zero regressions — no existing use case's signature or behavior changed (R9, Scenario "no regression").

## Phase 8a: Visibility listener + projection use cases + adapter — Spec: `core-api-catalogo`, `core-api-hexagonal-layout`

Closes WARNING-2 in practice. The read-side filter already exists since Phase 3b — this phase only adds the writer. Depends on Phase 3b (filter reads the projection) and Phase 7 (`EmpresaReactivada` exists).

- [ ] 8a.1 `adapters/events/identidad-event.payloads.ts`: locally-declared `EmpresaOcultablePayload { companyId, motivo? }` — no import of `identidad`'s event classes.
- [ ] 8a.2 RED: `ports-in/ocultar-catalogo-empresa.use-case.spec.ts` + `ports-in/restaurar-catalogo-empresa.use-case.spec.ts` — each calls the projection port, mocked.
- [ ] 8a.3 GREEN: `ports-in/ocultar-catalogo-empresa.use-case.ts` + `ports-in/restaurar-catalogo-empresa.use-case.ts`.
- [ ] 8a.4 RED: `adapters/persistence/kysely-catalog-visibility.projection.spec.ts` — `ocultarEmpresa` upserts `oculto=true` on conflict; `mostrarEmpresa` updates `oculto=false`, 0-rows-affected is success (already visible).
- [ ] 8a.5 GREEN: `adapters/persistence/kysely-catalog-visibility.projection.ts`.
- [ ] 8a.6 RED: `adapters/events/company-visibility.listener.spec.ts` — routes `empresa.suspendida`→ocultar, `empresa.reactivada`/`empresa.aprobada`→mostrar (same handler); catches and `logger.error({evento, companyId})` without re-throwing when the projection call fails.
- [ ] 8a.7 GREEN: `adapters/events/company-visibility.listener.ts` (`@OnEvent` on the 3 channels).
- [ ] 8a.8 `catalogo.module.ts`: bind `CATALOG_VISIBILITY_PROJECTION`→`KyselyCatalogVisibilityProjection`, register `CompanyVisibilityListener` + the 2 use cases; folder now has `adapters/events/` (core-api-hexagonal-layout Scenario "catalogo has adapters/events because it consumes events").

## Phase 8b: Cross-domain contract test — Spec: `core-api-catalogo`

Depends on Phase 8a's listener + projection. Isolated for dedicated review — this is the entire structural mitigation for D-A's string-keyed event coupling (no compile-time link to `identidad`'s event classes).

- [ ] 8b.1 RED+GREEN (mandatory D-A mitigation): `services/core-api/test/catalogo-visibility.contract-spec.ts` — publish REAL `EmpresaSuspendida`/`EmpresaReactivada`/`EmpresaAprobada` instances through the real `EVENT_PUBLISHER`, assert `catalog_hidden_companies` changes. Lives in `test/`, outside `domains/`, so the zone-boundary ESLint rule does not apply.
- [ ] 8b.2 Verify end-to-end: `core-api-catalogo` Scenarios "A suspended company's catalog is excluded" / "A reactivated company's catalog reappears" now hold with a real writer, closing the loop opened in Phase 3b.

## Phase 9: Closure — Spec: all 5 delta specs

- [ ] 9.1 `services/core-api/domains/catalogo/SPEC.md`: apply the 7 declared deltas from design.md's table — `actualizarPrecio` signature, `PreciosCategoriaAjustados` event, `companyStatus` gate on the 4 mutating use cases, visibility filter scope correction (`buscarCoincidencias`/`findMatching` only, not `buscarProductos`/`findByCompany`), `CatalogRepository` additions, `CatalogQueryPort` in `contracts/` with `CatalogQueryUnavailableError`.
- [ ] 9.2 `services/core-api/domains/identidad/SPEC.md`: append `reactivarEmpresa` + `EmpresaReactivada` (purely additive, D16).
- [ ] 9.3 `packages/types/SPEC.md`: append `ArchivoCarga`/`FilaCarga`/`ResultadoCargaMasiva`/`NuevoProductoProveedor`.
- [ ] 9.4 Audit `catalogo.module.ts` `exports:` — confirm it is exactly `[CATALOG_QUERY_PORT]`, nothing else crosses the module boundary.
- [ ] 9.5 Run full workspace verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit+e2e+contract; opt-in integration excluded), `pnpm build` — all green, including the Phase 7 identidad regression suite.
- [ ] 9.6 Confirm the 6 open items design.md left unresolved (RLS-bypass reads the projection, no self-catalog-listing endpoint, `ajustarPreciosPorCategoria` 204-no-count, cross-file `(nombre,categoria)` collision, timeout values unmeasured, `aprobarEmpresa` still no state precondition) are carried forward as documented follow-ups, not silently dropped.

---

## Dependency Notes

13 PRs, strictly sequential per design.md's dependency chain plus the maintainer-chosen splits: PR1 → PR2 → PR3a → PR3b → PR4a → PR4b → PR5a → PR5b → PR6 → PR7 → PR8a → PR8b → PR9. Notable non-adjacent edges: PR5b also depends on PR1 (unique index) and PR4a (`save()`); PR6 depends on PR2 (`saveMany` signature) and PR3b (`findByCompanyAndCategoria`); PR8a depends on PR3b (filter already reads the projection) and PR7 (event exists), not on PR4-6. Per this project's DoD (`openspec/config.yaml`): implementation + its unit/e2e tests + the relevant `SPEC.md` delta land in the same commit/PR — Phase 9 is the exception by design. `strict_tdd: true` is active for every task introducing real logic — RED items are failing tests written first, GREEN items are the minimal implementation that passes them.
