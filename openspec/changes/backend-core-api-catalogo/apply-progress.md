# Apply Progress: `backend-core-api-catalogo`

**Artifact store**: hybrid (this file + Engram `sdd/backend-core-api-catalogo/apply-progress`)
**Strict TDD Mode**: active (`test_command: pnpm test`)
**Last updated**: 2026-08-06T19:45:00Z — PR4b batch (merged with PR1+PR2+PR3a+PR3b+PR4a; all unchanged below except this note)

## Status: 7/7 tasks complete for PR1 (Phase 1: DB foundation). 7/7 tasks complete for PR2 (Phase 2: Seams). 3/3 tasks complete for PR3a (Phase 3a: Read side — domain entity + invariant). 9/9 tasks complete for PR3b (Phase 3b: Read side — persistence adapters + buscarProductos + controller). 8/8 tasks complete for PR4a (Phase 4a: Unit writes — use cases + repository save()). 7/7 tasks complete for PR4b (Phase 4b: Unit writes — HTTP adapter + exception filter + e2e). 41/~90 tasks complete overall across all 13 planned PRs.

**Engram note**: no `mem_*` tools were exposed in this batch's tool set either (same as PR1/PR2, and still true as of the PR4a batch) — this file remains the authoritative record. If Engram becomes available in a later batch, the topic key to upsert is `sdd/backend-core-api-catalogo/apply-progress`, content = this full file merged.

---

## PR1 · Phase 1: DB foundation — Spec: `db-schema-catalogo`

| # | Task | Status |
|---|---|---|
| 1.1 | `supabase/migrations/20260805120000_11_catalogo_provider_catalog_upsert_index.sql` — two mutually-exclusive partial unique indexes on `provider_catalog` (D-C) | [x] Done |
| 1.2 | `supabase/migrations/20260805120100_12_catalogo_hidden_companies.sql` — `catalog_hidden_companies` table, trigger, RLS, grants | [x] Done |
| 1.3 | Apply both migrations locally (`supabase db reset`); verify no applied migration edited | [x] Done |
| 1.4 | `shared/database/schema.ts` — `CatalogProductsTable`, `ProviderCatalogTable` (`precio_base`/`precio_maximo: string`), `CatalogHiddenCompaniesTable`, registered on `DB` | [x] Done |
| 1.5 | RED: `shared/database/pool.provider.spec.ts` | [x] Done |
| 1.6 | GREEN: `shared/database/pool.provider.ts` — `connectionTimeoutMillis: 2000` + `options: '-c statement_timeout=5000'` | [x] Done |
| 1.7 | Opt-in integration test — partial unique indexes + `numeric`-as-`string` | [x] Done |

### TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.5/1.6 (pool timeout config) | Wrote `pool.provider.spec.ts` asserting `Pool` constructor called with `connectionTimeoutMillis: 2000` + `options: '-c statement_timeout=5000'`; ran `pnpm exec jest --testPathPatterns=pool.provider` → **failed** (`Received: {"connectionString": "..."}`, missing both keys) | Edited `pool.provider.ts` to add both options inside the existing `new Pool({...})` call, preserving the full pre-existing doc comment untouched; re-ran same command → **1/1 passed** | None needed — 2-line, additive change; existing doc comment left intact per instructions |
| 1.7 (opt-in integration, DB behavior) | Test-first for a DB-behavior scenario, not source code: wrote `catalogo-provider-catalog-upsert.integration-spec.ts` asserting both index branches upsert correctly *before* confirming DDL behavior; first run had 1 failing assertion (wrong expectation about `nombre` refresh — my `DO UPDATE SET` clause in the test's raw SQL didn't include `nombre`, so I'd asserted behavior I hadn't written) | Fixed the assertion (removed the incorrect `nombre` refresh claim, scoped to what `DO UPDATE SET precio_base, precio_maximo` actually does) → 3/3 passed against real local Postgres | None needed |
| 1.1/1.2/1.3/1.4 | N/A — DDL/type declarations, not TDD-cycle work (no failing-test-first form applies to a `CREATE INDEX` statement or a Kysely interface). Verified instead via `supabase db reset` (both migrations apply cleanly) + `pnpm typecheck` (schema.ts row types compile against all existing Kysely call sites) | N/A | N/A |

Note on 1.1/1.2/1.3/1.4: these are schema/typedeclaration tasks, not behavior-under-test in the RED/GREEN sense — the same category `tasks.md`'s own phrasing already implies (only 1.5/1.6 and 1.7 are labeled RED/GREEN in the tasks artifact). Verification method for these four: `supabase db reset` (real apply, `psql \d` schema inspection) + `pnpm typecheck`/`pnpm build` (row types compile) — documented in "Commands Run" below, not silently skipped.

---

## Commands Run (this batch)

| Command | Result |
|---|---|
| `supabase status` | Local stack running (DB on 54322) |
| `supabase db reset` | All 14 migrations applied cleanly, including the 2 new ones; seed ran; no errors |
| `git status --porcelain supabase/migrations/` + `git diff --stat supabase/migrations/` | Only 2 new untracked files; zero diff against any existing migration file — confirms task 1.3's acceptance criterion |
| `psql ... \d public.catalog_hidden_companies` / `\d public.provider_catalog` | Confirmed table shape, both partial unique indexes present with correct predicates, trigger present, RLS enabled with no policies |
| `pnpm exec jest --testPathPatterns=pool.provider` (RED, before edit) | 1 failed — confirms test fails without the implementation |
| `pnpm exec jest --testPathPatterns=pool.provider` (GREEN, after edit) | 1 passed |
| `DATABASE_URL=... pnpm exec jest --config ./test/jest-integration.json --testPathPatterns=catalogo-provider-catalog-upsert` | 3 passed (new opt-in integration test) |
| `DATABASE_URL=... pnpm exec jest --config ./test/jest-integration.json` (full opt-in suite) | 3 suites / 10 tests passed — zero regression on the 2 pre-existing integration specs |
| `pnpm lint` | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm typecheck` | Clean — `packages/types` + `services/core-api` both `Done` |
| `pnpm test` (root — unit + e2e, `pnpm -r --if-present run test`) | `core-api`: 20 suites / **112** unit tests passed (was 111 before this batch — +1 is the new `pool.provider.spec.ts`), 3 suites / 17 e2e tests passed. Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (new integration-spec file not Prettier-formatted) → ran `pnpm exec prettier --write` on that one file → re-ran `pnpm format:check` → clean |
| Full re-run of `pnpm test` after the Prettier fix | Same result: 112 unit + 17 e2e passed |

All 6 gate commands from the batch instructions (`lint`, `typecheck`, `test`, `build`, `format:check`, plus the opt-in integration suite) are green as of the final run.

---

## Deviations from Design

**None on the DDL.** Both migration files are the verbatim SQL from design.md's "Migraciones (forma exacta del DDL)" section — I added only file-header prose comments (following the repo's own convention from batches 09/10/03) above the DDL, never inside or altering it.

**One test-scope deviation, self-corrected during TDD, not a design deviation**: my first draft of the opt-in integration test (task 1.7) asserted that a re-upload's `DO UPDATE SET` refreshes the `nombre` column verbatim (a real design.md D-C claim: *"`nombre` sí se refresca"*). But that specific `DO UPDATE SET nombre = excluded.nombre, ...` clause is part of `KyselyCatalogRepository.save()` — PR 4a's scope, not PR 1's. My test's own raw SQL only set `precio_base`/`precio_maximo` in `DO UPDATE SET` (matching what a migration-level test should prove: the index/conflict-target mechanics, not the eventual repository's full column list), so the assertion was checking something the test itself hadn't written. Caught by the RED→GREEN loop (first integration run failed with `Received: "Arena Sanitaria 5Kg"` vs expected the re-uploaded casing) — fixed by narrowing the assertion and adding a comment pointing to PR 4a as the place that full behavior gets tested. No production code or migration DDL changed as a result.

## Issues Found

None blocking. One open item worth flagging for review, not a blocker: `service_role` has no `DELETE` grant on any table in this schema (repo-wide convention), so the new opt-in integration test cannot truncate/clean up its own rows between runs. Mitigation used: every test creates its own company (and, for branch A, its own reference catalog product) with a fresh `randomUUID()` identity per run, so re-running the suite without `supabase db reset` between runs is safe (no collision) — same latent property the pre-existing `database.integration-spec.ts`/`identidad-actor.integration-spec.ts` don't have to deal with because they truncate (`audit_log` specifically) or only read seeded fixtures.

---

## Files Changed (PR1)

| File | Action | What Was Done |
|---|---|---|
| `supabase/migrations/20260805120000_11_catalogo_provider_catalog_upsert_index.sql` | Created | Two mutually-exclusive partial unique indexes on `provider_catalog` (D-C/D15/Q5b) |
| `supabase/migrations/20260805120100_12_catalogo_hidden_companies.sql` | Created | `catalog_hidden_companies` deny-list table + trigger + RLS + grants (D-A/D9/Q1) |
| `services/core-api/src/shared/database/schema.ts` | Modified | Added `CatalogProductsTable`, `ProviderCatalogTable`, `CatalogHiddenCompaniesTable` row types + registered on `DB`; updated the file's header comment to reflect the 7-of-17-table state |
| `services/core-api/src/shared/database/pool.provider.spec.ts` | Created | RED→GREEN test for the pool timeout config (mocked `pg.Pool`) |
| `services/core-api/src/shared/database/pool.provider.ts` | Modified | Added `connectionTimeoutMillis: 2_000` + `options: '-c statement_timeout=5000'` to the existing `new Pool({...})` call; pre-existing doc comment left untouched |
| `services/core-api/test/catalogo-provider-catalog-upsert.integration-spec.ts` | Created | Opt-in integration test (excluded from CI via the existing `test/*.integration-spec.ts` + `jest-integration.json` convention) — 3 tests: branch A upsert, branch B upsert, mutual-exclusivity of the two indexes |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 1.1–1.7 `[x]` |

---

## Commit

One commit created for this PR1 batch:

```
feat(core-api): add catalogo DB foundation — migrations, row types, pool timeouts
```

(Working tree was clean before this batch; commit hash recorded in the return envelope to the orchestrator.)

---

## PR2 · Phase 2: Seams — Spec: `shared-types-package`, `core-api-hexagonal-layout`, `core-api-catalogo`

| # | Task | Status |
|---|---|---|
| 2.1 | `packages/types/src/catalogo.ts` — added `NuevoProductoProveedor`, `FilaCarga`, `ArchivoCarga`, `ResultadoCargaMasiva` (D12); already re-exported via barrel's `export * from './catalogo.js'` (no barrel edit needed) | [x] Done |
| 2.2 | `pnpm typecheck` (packages/types `tsc --noEmit`) — green, no dedicated unit tests (pure declarations, existing convention) | [x] Done |
| 2.3 | `domains/catalogo/contracts/catalog-query.port.ts` created — `CatalogQueryPort`, `CATALOG_QUERY_PORT`, `CatalogQueryUnavailableError`, `MAX_COINCIDENCIAS_POR_ITEM = 50`, no `tx?` (C1), verbatim from design.md D-B | [x] Done |
| 2.4 | Old `domains/catalogo/ports-out/catalog-query.port.ts` deleted — confirmed zero real consumers first (`grep` found only 3 prose-comment mentions of `CatalogQueryPort`/`CATALOG_QUERY_PORT`, no actual `import` statements) | [x] Done |
| 2.5 | `domains/catalogo/ports-out/catalog-repository.port.ts` extended — added `saveMany`, `findById`, `findByCompanyAndCategoria`, all with trailing `tx?: TransactionContext` | [x] Done |
| 2.6 | `domains/catalogo/ports-out/catalog-visibility-projection.port.ts` created — `CatalogVisibilityProjection` (`ocultarEmpresa`, `mostrarEmpresa`) + `CATALOG_VISIBILITY_PROJECTION` token | [x] Done |
| 2.7 | ESLint boundary rule verified — inspected `buildCrossDomainZones()` output directly (Node script importing `eslint.config.js`): a zone exists for `catalogo/ports-out/**/*` (blocked cross-domain) but **no zone exists for `catalogo/contracts/**/*`** — confirms `contracts/` is the only cross-domain-importable path. `pnpm lint` also green (zero consumers today, so nothing to violate yet) | [x] Done |

### TDD Cycle Evidence (PR2)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 2.1–2.7 (all) | N/A — this PR is declared "cero comportamiento, solo costuras" in design.md's own PR table (row **2**: *"Cero comportamiento, solo costuras. La regla de borde de ESLint valida el movimiento con cero consumidores"*). Every task is a type/interface declaration, a file move, or a port extension with zero runtime logic to fail-first against. `tasks.md` itself does not label any PR2 task RED/GREEN (only Phase 1's 1.5/1.6/1.7 and later phases' `ports-in`/`adapters` tasks carry that label) | N/A | N/A |

Verification method used instead of RED/GREEN (consistent with PR1's precedent for non-behavioral tasks): `pnpm typecheck` (all new/changed interfaces compile against every existing call site — zero today, since nothing consumes them yet), `pnpm lint` (ESLint boundary rule + the rest of the flat config), and a direct inspection of the generated ESLint zone config (task 2.7's own verification method, per design.md's explicit framing that the ESLint rule itself **is** the check, not a Jest test). No test file was invented for pure type declarations — matches PR1's documented convention and this repo's existing pattern (`packages/types/src/*.ts` has zero spec files).

### Commands Run (PR2 batch)

| Command | Result |
|---|---|
| `grep -rn "ports-out/catalog-query" ...` + `grep -rln "CatalogQueryPort\|CATALOG_QUERY_PORT" ...` | Confirmed zero real `import` consumers of the old `ports-out/catalog-query.port.ts` before deleting it — only 3 files with prose-comment mentions (`refill-repository.port.ts`, `catalogo.module.ts`, `pool.provider.ts`), none of them an actual import |
| `pnpm --filter @repon/types typecheck` | `Done` — green after adding the 4 new types |
| `pnpm lint` (root) | Clean (only the pre-existing unrelated Node engine version WARN) |
| Node script importing `eslint.config.js` directly, filtering `buildCrossDomainZones()` output for `catalogo` | Confirmed: zones exist for `catalogo/ports-out`, `catalogo/adapters/persistence`, `catalogo/adapters/events`, `catalogo/domain` (all blocked cross-domain) — **no zone for `catalogo/contracts`**, proving it's the only importable path (task 2.7's verification) |
| `pnpm typecheck` (root) | `packages/types` + `services/core-api` both `Done` |
| `pnpm test` (root) | `core-api`: 20 suites / **112** unit tests passed (unchanged from PR1 — PR2 added zero test files, as expected for a costuras-only PR), 3 suites / 17 e2e tests passed. Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Clean on first run — no manual Prettier fix needed this batch |

All 5 gate commands from the batch instructions (`lint`, `typecheck`, `test`, `build`, `format:check`) are green.

### Deviations from Design (PR2)

None. `contracts/catalog-query.port.ts`'s interface/token/error-class/constant match design.md's D-B code block verbatim; only additive JSDoc (the C1–C8 clause table, already present in design.md's own prose) was added around the verbatim code, not inside it. `catalog-repository.port.ts` and `catalog-visibility-projection.port.ts` match design.md's "Puertos extendidos" block verbatim (method signatures, token names).

### Issues Found (PR2)

None blocking. One observation carried forward for PR3a, not a PR2 defect: `NuevoProductoProveedor`/`FilaCarga`/`ArchivoCarga`/`ResultadoCargaMasiva` are declared as plain TypeScript interfaces with zero validation decorators, matching this file's existing `CatalogProduct`/`ProviderCatalogItem` style and `shared-types-package`'s explicit delta ("validation rules... enforced at the type/DTO layer in `core-api`'s `adapters/http/`... never here"). PR3a/5a's DTOs are where `class-validator` decorators (or branded types) actually land — confirmed this is by design, not an oversight, by re-reading the delta spec before writing the types.

### Files Changed (PR2)

| File | Action | What Was Done |
|---|---|---|
| `packages/types/src/catalogo.ts` | Modified | Added `NuevoProductoProveedor`, `FilaCarga`, `ArchivoCarga`, `ResultadoCargaMasiva` (D12) |
| `services/core-api/src/domains/catalogo/contracts/catalog-query.port.ts` | Created | `CatalogQueryPort` interface, `CATALOG_QUERY_PORT` token, `CatalogQueryUnavailableError`, `MAX_COINCIDENCIAS_POR_ITEM` — moved out of `ports-out/` per D1/D-B |
| `services/core-api/src/domains/catalogo/ports-out/catalog-query.port.ts` | Deleted | Old placeholder location — zero consumers, pure move |
| `services/core-api/src/domains/catalogo/ports-out/catalog-repository.port.ts` | Modified | Added `saveMany`, `findById`, `findByCompanyAndCategoria` |
| `services/core-api/src/domains/catalogo/ports-out/catalog-visibility-projection.port.ts` | Created | `CatalogVisibilityProjection` (`ocultarEmpresa`, `mostrarEmpresa`) + `CATALOG_VISIBILITY_PROJECTION` token |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 2.1–2.7 `[x]` |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR2 section into PR1's file (this file) |

### Commit (PR2)

One commit created for this PR2 batch:

```
feat(core-api): move CatalogQueryPort to contracts/, extend catalogo ports-out
```

(Working tree was clean before this batch except for pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` — left untouched/untracked, out of this batch's scope; commit hash recorded in the return envelope to the orchestrator.)

---

## PR3a · Phase 3a: Read side — domain entity + invariant — Spec: `core-api-catalogo`

| # | Task | Status |
|---|---|---|
| 3a.1 | RED: `domain/provider-catalog-item.entity.spec.ts` — `crear()` rejects `precioMaximo < precioBase`; prices round to 2 decimals; `aplicarPorcentaje` scales both bounds by the same factor (D5); `porcentaje <= -100` rejected before any other computation | [x] Done |
| 3a.2 | GREEN: `domain/provider-catalog-item.entity.ts` — `crear()`, `actualizarPrecio()`, `aplicarPorcentaje()`, invariant enforced in the entity (never the DB CHECK) | [x] Done |
| 3a.3 | `domain/catalogo.errors.ts`: declare `PrecioInvalidoError` (used by the entity's invariant) | [x] Done |

### TDD Cycle Evidence (PR3a)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 3a.1/3a.2/3a.3 | Wrote `provider-catalog-item.entity.spec.ts` (8 tests: `crear()` rejects `precioMaximo < precioBase`, rounds to 2 decimals, builds the full shape; `actualizarPrecio()` rejects an invalid new pair without mutating the original and rounds+validates a valid new pair; `aplicarPorcentaje()` scales both bounds proportionally per spec.md's exact "Both bounds scale proportionally" scenario (1000/1500 @10% → 1100/1650), rejects `porcentaje <= -100` and `< -100`, and preserves the invariant by construction for a positive porcentaje) against not-yet-existing `./catalogo.errors` and `./provider-catalog-item.entity` → ran `pnpm exec jest --testPathPatterns=provider-catalog-item` → **failed** (`Cannot find module './catalogo.errors'`, suite failed to run — confirms RED before any implementation existed) | Created `catalogo.errors.ts` (`PrecioInvalidoError`) and `provider-catalog-item.entity.ts` (`redondear` + `assertPrecioValido` private helpers, `crear`/`actualizarPrecio`/`aplicarPorcentaje` exported, all pure functions returning new objects — no entity classes, matching `identidad`'s `company.entity.ts`/`profile.entity.ts` plain-factory-function convention exactly, since this is the first entity in `catalogo`) → re-ran same command → **8/8 passed** | None needed — file split (errors vs entity) already matched the target shape from the first GREEN pass; no further restructuring required |

### Commands Run (PR3a batch)

| Command | Result |
|---|---|
| `pnpm exec jest --testPathPatterns=provider-catalog-item` (RED, before implementation) | Suite failed to run — `Cannot find module './catalogo.errors'` |
| `pnpm exec jest --testPathPatterns=provider-catalog-item` (GREEN, after implementation) | 8/8 passed |
| `pnpm lint` | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm typecheck` | Clean — `packages/types` + `services/core-api` both `Done` |
| `pnpm test` (root — unit + e2e) | `core-api`: 21 suites / **120** unit tests passed (was 112 before this batch — +8 is the new `provider-catalog-item.entity.spec.ts`), 3 suites / 17 e2e tests passed. Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (`provider-catalog-item.entity.ts` not Prettier-formatted — a JSDoc-adjacent long line in `aplicarPorcentaje`) → ran `pnpm exec prettier --write` on that one file → re-ran `pnpm format:check` → clean |
| Full re-run of `lint`/`typecheck`/`test`/`build` after the Prettier fix | All green again, same counts (120 unit + 17 e2e) |

All 5 gate commands (`lint`, `typecheck`, `test`, `build`, `format:check`) are green as of the final run.

### Deviations from Design (PR3a)

**One deliberate scope narrowing, not a silent deviation**: design.md's Diagram 1 (step 2a) describes `crear()` as also validating "nombre/categoria no vacíos; precios finitos y >= 0; ... stock entero >= 0" for the bulk-load row-validation path. This batch's `crear()` implements ONLY the price invariant (`precioMaximo >= precioBase`) and rounding — the two invariants task 3a.3 scoped an error class for (`PrecioInvalidoError`) and the only ones D14's own "Estrategia de testing" table lists as entity-level unit tests ("Entidad: invariante precioMaximo >= precioBase, redondeo a 2 decimales, porcentaje <= -100 rechazado, escalado proporcional de D5" — nombre/categoria/stock are not in that list). Reason: no test or error class for those broader checks was in this batch's assigned scope (tasks 3a.1–3a.3), and adding unrequested validation without a driving RED test would violate strict TDD. **Flagged for whichever PR actually exercises row-level validation** (PR4b's `cargarProductoCatalogo` DTO for the single-item path, and/or PR5b's `cargarCatalogoMasivo` for the per-row bulk path, per spec.md's "Partial failure is reported per row" scenario, e.g. "negative price") — that PR must either extend `crear()` with these checks (new RED tests + likely a reused or new error class) or implement them at the DTO/use-case layer. Not resolved here; explicitly not silently dropped.

Everything else matches design.md verbatim: `redondear` is `Math.round(x * 100) / 100` exactly as D-C specifies; rounding happens before invariant validation in all three functions; `aplicarPorcentaje`'s `porcentaje <= -100` guard runs before any scaling/rounding, exactly as the spec.md scenario requires (and the "0 >= 0 would trivially pass" reasoning documented in the code comment is why the guard can't be replaced by the invariant check alone).

### Issues Found (PR3a)

None blocking. Implementation style choice made explicit for the record: `identidad`'s two existing domain entities (`company.entity.ts`, `profile.entity.ts`) are plain interfaces + standalone factory functions — no classes, no methods on the data shape itself. `provider-catalog-item.entity.ts` follows the exact same convention (`crear`/`actualizarPrecio`/`aplicarPorcentaje` are module-level functions returning new `ProviderCatalogItem` objects, never mutating their input) even though design.md's prose/diagrams write call sites as `item.actualizarPrecio(...)` / `ProviderCatalogItem.crear(...)` (dot-notation, reads like instance/static methods). Treated that as design.md's narrative shorthand, not a literal class-based API mandate — `crear(input)` and `actualizarPrecio(item, precioBase, precioMaximo)` are the free-function equivalents, and matching the established repo convention (per this batch's explicit instruction to look at `identidad/domain/` as "the reference pattern... since this is the first entity in catalogo") took priority over diagram notation literalism.

### Files Changed (PR3a)

| File | Action | What Was Done |
|---|---|---|
| `services/core-api/src/domains/catalogo/domain/catalogo.errors.ts` | Created | `PrecioInvalidoError` — zero framework imports, matches `identidad.errors.ts`'s doc-comment-per-class convention |
| `services/core-api/src/domains/catalogo/domain/provider-catalog-item.entity.ts` | Created | `crear()`, `actualizarPrecio()`, `aplicarPorcentaje()` — pure functions, price invariant enforced in the entity, rounding before validation (D-C) |
| `services/core-api/src/domains/catalogo/domain/provider-catalog-item.entity.spec.ts` | Created | RED→GREEN, 8 tests covering the invariant, rounding, proportional scaling (exact spec.md numbers), and the `porcentaje <= -100` guard-ordering scenario |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 3a.1–3a.3 `[x]` |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR3a section into PR1+PR2's file (this file) |

### Commit (PR3a)

One commit created for this PR3a batch:

```
feat(core-api): add ProviderCatalogItem entity with price invariant
```

(Working tree was clean before this batch except the same pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` noted in PR2 — left untouched/untracked, out of this batch's scope; commit hash recorded in the return envelope to the orchestrator.)

---

## PR3b — Read side: persistence adapters + `buscarProductos` + controller

**Status**: done. Implemented by a sub-agent that hit the session's monthly spend limit right after confirming all 5 gates were green, before it could commit — the orchestrator independently re-ran all 5 gates from scratch (lint/typecheck/test/build/format:check, all green: 140 unit + 19 e2e, up from 120/17), reviewed the two most novel files (`kysely-catalog.repository.ts`, `kysely-catalog-query.adapter.ts`) directly, and committed on the sub-agent's behalf.

**Gap-fill, documented in-code**: design.md's port list only named `CatalogRepository` (all `ProviderCatalogItem`/`provider_catalog`-shaped) and `CatalogVisibilityProjection`, with no port for `buscarProductos`'s read of `catalog_products` (a structurally different table, no `company_id`, returns `CatalogProduct[]`). Rather than overloading `CatalogRepository`, the batch added a minimal `CatalogProductRepository` port (`ports-out/catalog-product-repository.port.ts`, `buscar(query, categoria?)`) + `KyselyCatalogProductRepository` adapter, mirroring the exact same pattern (interface+token in `ports-out/`, Kysely class in `adapters/persistence/`). Flagged inline in the port's own doc comment as a "gap-fill note," not silently introduced. **Must be added to the Phase 9 SPEC.md-delta list** (task 9.1) — it's a new port not named in the original design.md decision D1/D4/D7, small but real scope beyond what `sdd-design` enumerated.

**`CatalogRepository.save`/`saveMany` are declared but throw named "not yet implemented" errors** pointing at PR4a/PR6 respectively — deliberate choice over a silent no-op stub, consistent with the placeholder-module precedent already set for `catalogo.module.ts` before this change started.

**`findMatching`/`buscarCoincidencias` visibility anti-join**: both apply the exact D-A predicate against `catalog_hidden_companies`; both proven a no-op today via test fixtures (table is empty until PR8a). `findByCompany`/`findByCompanyAndCategoria` deliberately do NOT apply it (owner reads own catalog unfiltered, matches the corrected spec.md).

**`buscarCoincidencias`'s per-item result cap** (C7) is implemented as one aggregate `LIMIT` (`MAX_COINCIDENCIAS_POR_ITEM * itemsSolicitados.length`) rather than N independent per-item caps — the trade-off that keeps C6's "one round trip, no UNION" property; documented inline as a deliberate choice, not a silent gap (no spec.md scenario claims a strict per-item cap).

**Files** (13 files, ~1,063 lines — over the original 420-520 estimate, mostly test code: the two `.spec.ts` files are 234 and 215 lines): `adapters/persistence/{kysely-catalog.repository.ts,kysely-catalog-query.adapter.ts}` + their specs, `adapters/persistence/kysely-catalog-product.repository.ts`, `ports-out/catalog-product-repository.port.ts`, `ports-in/buscar-productos.use-case.ts` + spec, `adapters/http/{catalogo.controller.ts,catalogo.mapper.ts,dto/catalog-product-response.dto.ts}`, `catalogo.module.ts` (now binds real providers for the first time), `test/catalogo-buscar-productos.e2e-spec.ts`.

**Commit**: `feat(core-api): add catalogo read-side adapters, buscarProductos, and visibility filter` (orchestrator-committed after independent gate re-verification).

---

## PR4a · Phase 4a: Unit writes — use cases + repository `save()` — Spec: `core-api-catalogo`

**Status**: done. R1 (cross-tenant mutation) closes in this PR.

| # | Task | Status |
|---|---|---|
| 4a.1 | RED: `ports-in/cargar-producto-catalogo.use-case.spec.ts` | [x] Done |
| 4a.2 | GREEN: `ports-in/cargar-producto-catalogo.use-case.ts` | [x] Done |
| 4a.3 | RED (test negativo primero): `ports-in/actualizar-precio.use-case.spec.ts` — cross-tenant/not-found byte-identical rejection | [x] Done |
| 4a.4 | RED: happy-path, `EmpresaNoActivaError`, price-invariant-delegates-to-entity cases | [x] Done |
| 4a.5 | GREEN: `ports-in/actualizar-precio.use-case.ts` | [x] Done |
| 4a.6 | RED: extend `kysely-catalog.repository.spec.ts` — `save()` D-C bifurcation | [x] Done |
| 4a.7 | GREEN: implement `save()` on `KyselyCatalogRepository` | [x] Done |
| 4a.8 | `domain/catalogo.errors.ts`: append `CatalogItemNotFoundError`, `EmpresaNoActivaError` | [x] Done |

### TDD Cycle Evidence (PR4a)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 4a.1/4a.2 (`CargarProductoCatalogoUseCase`) | Wrote `cargar-producto-catalogo.use-case.spec.ts` (4 tests: happy path creates+saves+publishes exactly one `ProductoAgregado`; `companyId` derives from the explicit param, never `producto`; `EmpresaNoActivaError` before any repo call for both `suspendido` and `pendiente`) against a not-yet-existing `./cargar-producto-catalogo.use-case` → `pnpm exec jest --testPathPatterns=cargar-producto-catalogo` → **failed** (`Cannot find module './cargar-producto-catalogo.use-case'`) | Created `cargar-producto-catalogo.use-case.ts` (`EmpresaNoActivaError` gate first, then `crear()` from the entity, `save()`, `publish(ProductoAgregado)`) and, as a natural dependency, `events/producto-agregado.event.ts` (didn't exist yet — needed to compile/publish) → re-ran same command → **4/4 passed** | None needed |
| 4a.3/4a.4/4a.5 (`ActualizarPrecioUseCase`) | Wrote `actualizar-precio.use-case.spec.ts` test-negativo-first (per design.md Diagram 3): cross-tenant item and missing item both throw `CatalogItemNotFoundError`, byte-identical (`constructor`/`message` equality asserted directly), never call `save`; then added `EmpresaNoActivaError` gate, happy path, and price-invariant-delegation cases (6 tests total) against a not-yet-existing `./actualizar-precio.use-case` and not-yet-existing `CatalogItemNotFoundError`/`EmpresaNoActivaError` → ran → **failed** (`Cannot find module './actualizar-precio.use-case'`) | Appended `CatalogItemNotFoundError`/`EmpresaNoActivaError` to `domain/catalogo.errors.ts`, created `actualizar-precio.use-case.ts` (`EmpresaNoActivaError` gate → `findById` → `!item \|\| item.companyId !== companyId` → `CatalogItemNotFoundError` (same throw, both branches) → `actualizarPrecio()` from the entity → `save`) → re-ran → **6/6 passed** | `typecheck` caught a `.catch((e: unknown) => e as Error)` union-type issue in the byte-identical-error test (the promise's resolved type `ProviderCatalogItem` leaked into the union) — refactored to a `try/catch`-based `captureError` helper instead; re-ran `pnpm exec jest` to confirm the refactor didn't change test outcomes (still 6/6) before moving on |
| 4a.6/4a.7 (`KyselyCatalogRepository.save()`) | Extended `kysely-catalog.repository.spec.ts` with a new `buildInsertDb()` fake (observes `insertInto().values().onConflict(oc => ...)` calls, mirroring the file's existing `buildDb()`/fake-`eb` convention for reads) and 4 new tests: branch 1 conflict target is `columns(['company_id','catalog_product_id'])` + `where('catalog_product_id','is not',null)`; branch 2 conflict target is `.expression(sql\`company_id, lower(btrim(nombre)), lower(btrim(categoria))\`)` (asserted by compiling the captured `RawBuilder` via its own `.toOperationNode().sqlFragments`) + `where('catalog_product_id','is',null)`; `DO UPDATE SET` never contains `catalog_product_id`/`company_id` in either branch; `precioBase`/`precioMaximo` round-trip as 2-decimal strings → ran against the still-throwing placeholder `save()` → **failed** (4 failures, each `KyselyCatalogRepository.save(...) is implemented in PR 4a ... not yet available`) | Replaced the placeholder throw with the real D-C bifurcation (branch on `item.catalogProductId`, `oc.columns([...])` for branch 1 vs `oc.expression(sql\`...\`)` for branch 2 — Kysely's documented mechanism for a conflict target on an expression/partial index), added a `toProviderCatalogValues()` reverse mapper next to `mapProviderCatalogRow` → re-ran → **12/12 passed** (8 pre-existing + 4 new) | None needed |

### Commands Run (PR4a batch)

| Command | Result |
|---|---|
| `pnpm exec jest --testPathPatterns=cargar-producto-catalogo` (RED, before impl) | Suite failed to run — module not found |
| `pnpm exec jest --testPathPatterns=cargar-producto-catalogo` (GREEN) | 4/4 passed |
| `pnpm exec jest --testPathPatterns=actualizar-precio.use-case` (RED, before impl) | Suite failed to run — module not found |
| `pnpm exec jest --testPathPatterns=actualizar-precio.use-case` (GREEN) | 6/6 passed |
| `pnpm exec jest --testPathPatterns=kysely-catalog.repository` (RED, before `save()` impl) | 4 failed / 8 passed (the 4 new `save()` tests failed against the placeholder throw; the 8 pre-existing read-side tests were untouched and green) |
| `pnpm exec jest --testPathPatterns=kysely-catalog.repository` (GREEN, after `save()` impl) | 12/12 passed |
| `pnpm typecheck` (root) | Failed once — `actualizar-precio.use-case.spec.ts`'s `.catch()`-based error capture produced a `ProviderCatalogItem \| Error` union `TS2339` on `.message` — fixed with a `try/catch` helper, re-ran → `packages/types` + `services/core-api` both `Done` |
| `pnpm lint` (root) | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm test` (root — unit + e2e) | `core-api`: 26 suites / **153** unit tests passed (was 140 before this batch — +13: 4 + 6 + net 3 on the repository spec, since 2 old "not implemented" tests were replaced by 5 new ones), 4 suites / 19 e2e tests passed. Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (`actualizar-precio.use-case.ts` + its `.spec.ts` not Prettier-formatted after the `try/catch` refactor) → ran `pnpm exec prettier --write` on both files → re-ran `pnpm format:check` → clean |
| Full re-run of `lint`/`typecheck`/`test`/`build`/`format:check` after the Prettier fix | All green again, same counts (153 unit + 19 e2e) |

All 5 gate commands (`lint`, `typecheck`, `test`, `build`, `format:check`) are green as of the final run.

### How the R1 cross-tenant rejection works (this PR's central claim, stated explicitly for review)

`ActualizarPrecioUseCase.execute(companyId, companyStatus, itemId, precioBase, precioMaximo)`:

1. `companyStatus !== 'activo'` → `EmpresaNoActivaError` (403), before any repository call. Same gate, same order, as `CargarProductoCatalogoUseCase`.
2. `catalogRepository.findById(itemId)` — one lookup, no company filter in the query itself.
3. `if (!item || item.companyId !== companyId) throw new CatalogItemNotFoundError(itemId)` — **one `if`, one `throw`, one error class, for both the "doesn't exist" and "exists but isn't yours" cases.** There is no `else if` branch, no second error class, no conditional message. The constructor call is textually identical regardless of which half of the `||` was true.
4. `CatalogItemNotFoundError`'s message is `` `Ítem de catálogo ${itemId} no encontrado.` `` — the only variable in it is `itemId`, which the caller already supplied in the request; nothing about company B's existence, name, or any other attribute ever reaches the message.
5. A dedicated test (`'both branches produce byte-identical errors'`) proves this by capturing both rejections independently and asserting `notFoundError.constructor === crossTenantError.constructor` AND `notFoundError.message === crossTenantError.message` — not just "both are 404-mappable," but literally indistinguishable at the `Error` level. Since HTTP status mapping (Phase 4b's exception filter) is keyed by constructor, byte-identical constructor + message guarantees byte-identical HTTP response body too.
6. Happy path (`item.companyId === companyId`) is a separate, later branch: `actualizarPrecioEnLaEntidad(item, precioBase, precioMaximo)` (the existing PR3a entity function — rounds to 2 decimals, validates `precioMaximo >= precioBase` in the domain) → `save(actualizado)`.

No transaction wraps `findById`+`save` (matches design.md Diagram 3's explicit rationale: `company_id` never changes so the ownership check can't go stale mid-request, no `DELETE` grant exists on this schema so the row can't vanish between the two calls, and concurrent same-tenant updates are both intentional with last-write-wins as the expected semantic) — this PR did not need to add anything here; it's a property of the existing schema/grants (PR1) plus this use case's own structure, not a new mechanism.

### Deviations from Design (PR4a)

**One scope decision, not a silent deviation**: `ActualizarPrecioUseCase` in this PR does **not** publish `PrecioActualizado`. Task 4a.5's own GREEN description (`tasks.md`) lists the flow as `findById → ownership check → item.actualizarPrecio() → save` — no publish step — while task 4a.1 for `CargarProductoCatalogoUseCase` explicitly required testing "publishes exactly one `ProductoAgregado`." This asymmetry is deliberate at the task-breakdown level: `ProductoAgregado`'s publish is covered by an explicit spec.md scenario cited in 4a.1's own task text ("Provider loads their own product" — "...and `ProductoAgregado` is published"), while no scenario assigned to 4a.3/4a.4 makes the same claim for `PrecioActualizado`. `events/precio-actualizado.event.ts` and the publish call are Phase 4b's task 4b.1/4b.3 scope — consistent with this exact change's own precedent (PR3b left `save`/`saveMany` throwing "not yet implemented" for PR4a/PR6 to finish; a chained-PR sequence is allowed to have individual PRs that don't yet satisfy 100% of every spec requirement, as long as the full chain does by the time it's done). **Flagged explicitly for PR4b**: `ActualizarPrecioUseCase` will need `EVENT_PUBLISHER` added as a new constructor dependency and a `publish(new PrecioActualizado(...))` call added after `save()`, plus the corresponding spec test — this is a real, not-yet-closed gap that PR4b must close, not an oversight to silently carry forward past 4b.

Everything else matches design.md verbatim: the D-C upsert bifurcation (branch on `catalogProductId`, `DO UPDATE SET` excludes `catalog_product_id`/`company_id` in both branches), the D-E `companyStatus` gate ordering (checked before any repository call, identical shape in both use cases), and the D7/Diagram 3 byte-identical 404 behavior.

### Issues Found (PR4a)

None blocking. Two items to know about, not defects:

1. **`toFixed(2)` vs `Math.round(x*100)/100`**: the entity (`provider-catalog-item.entity.ts`, PR3a) already rounds `precioBase`/`precioMaximo` to 2 decimals before this use case ever sees them (`crear`/`actualizarPrecio` both round-then-validate). `toProviderCatalogValues()` in `save()` calls `.toFixed(2)` purely to produce the `string` shape the `numeric` column needs (D-C's gotcha) — it is formatting an already-rounded value, not re-rounding. No double-rounding risk.
2. **Kysely's `.expression()` conflict target**: branch 2's `ON CONFLICT` target is an expression index (`lower(btrim(nombre)), lower(btrim(categoria))`), which Kysely's query builder cannot express via `.columns([...])` (that method only accepts plain column names). `.expression(sql\`...\`)` is Kysely's own documented mechanism for exactly this case ("Specify an expression as the conflict target. This can be used if the unique index is an expression index."). The exact SQL text this produces was already proven correct against real Postgres by PR1's opt-in integration test (`catalogo-provider-catalog-upsert.integration-spec.ts`, task 1.7) — this PR's unit test only proves the application code builds the right conflict-target/predicate/update-set shape, mocked.

### Files Changed (PR4a)

| File | Action | What Was Done |
|---|---|---|
| `services/core-api/src/domains/catalogo/ports-in/cargar-producto-catalogo.use-case.ts` | Created | `companyStatus` gate → `crear()` → `save()` → `publish(ProductoAgregado)` |
| `services/core-api/src/domains/catalogo/ports-in/cargar-producto-catalogo.use-case.spec.ts` | Created | RED→GREEN, 4 tests |
| `services/core-api/src/domains/catalogo/ports-in/actualizar-precio.use-case.ts` | Created | `companyStatus` gate → `findById` → byte-identical `CatalogItemNotFoundError` for both not-found/cross-tenant → `actualizarPrecio()` → `save()` |
| `services/core-api/src/domains/catalogo/ports-in/actualizar-precio.use-case.spec.ts` | Created | RED→GREEN, 6 tests, test-negativo-first per design.md Diagram 3 |
| `services/core-api/src/domains/catalogo/events/producto-agregado.event.ts` | Created | `ProductoAgregado` — natural dependency of `CargarProductoCatalogoUseCase`, created early per the batch's explicit instruction |
| `services/core-api/src/domains/catalogo/domain/catalogo.errors.ts` | Modified | Appended `CatalogItemNotFoundError`, `EmpresaNoActivaError` |
| `services/core-api/src/domains/catalogo/adapters/persistence/kysely-catalog.repository.ts` | Modified | Implemented `save()` (D-C bifurcation); added `toProviderCatalogValues()` reverse mapper |
| `services/core-api/src/domains/catalogo/adapters/persistence/kysely-catalog.repository.spec.ts` | Modified | Replaced the "save throws PR4a" placeholder test with 4 real `save()` tests; `saveMany` placeholder test kept as-is (still PR6) |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 4a.1–4a.8 `[x]` |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR4a section into PR1+PR2+PR3a+PR3b's file (this file) |

### Commit (PR4a)

One commit created for this PR4a batch:

```
feat(core-api): add catalogo unit-write use cases with cross-tenant 404 protection
```

Commit hash: `ab097e8`. Working tree was clean before this batch except the same pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` noted since PR2 — left untouched/untracked, out of this batch's scope.

### Workload note

Diff came in at 591 insertions / 26 deletions (≈617 changed lines) against the tasks.md estimate of 320-400 for this work unit — over budget, driven by the depth of the R1 test coverage (byte-identical-error assertions, both `save()` conflict-target branches independently verified) rather than scope creep; no task outside 4a.1-4a.8 was touched. Flagged here rather than silently absorbed, per this project's Review Workload Guard — this PR was already called out in `tasks.md` as "the PR that most deserves dedicated review," so the overage is a deliberate trade (more test evidence on the highest-risk PR) rather than an oversight.

---

## PR4b · Phase 4b: Unit writes — HTTP adapter + exception filter + e2e — Spec: `core-api-catalogo`

**Status**: done. This is the batch that makes R1 provable end-to-end over real HTTP (unit-level proof already existed since PR4a).

| # | Task | Status |
|---|---|---|
| 4b.1 | `events/precio-actualizado.event.ts` (`producto-agregado.event.ts` already existed from PR4a) | [x] Done |
| 4b.2 | `adapters/http/dto/nuevo-producto.dto.ts`, `adapters/http/dto/actualizar-precio.dto.ts` (no `companyId` field on either, D8), `catalogo.mapper.ts` additions | [x] Done |
| 4b.3 | `adapters/http/catalogo.controller.ts`: `POST /catalogo/mi-catalogo` (201, `@Roles('provider')`), `PUT /catalogo/mi-catalogo/:itemId/precio` (204, `@Roles('provider')`) | [x] Done |
| 4b.4 | RED: `catalogo-exception.filter.spec.ts` — one test per mapped error class | [x] Done |
| 4b.5 | GREEN: `adapters/http/catalogo-exception.filter.ts` mirroring `IdentidadExceptionFilter`, `@UseFilters` at controller level | [x] Done |
| 4b.6 | E2e: `test/catalogo-mi-catalogo.e2e-spec.ts` — 404 not 403 cross-tenant, DTO rejection, 403 suspended company, happy paths for both routes | [x] Done |
| 4b.7 | `catalogo.module.ts`: register `CargarProductoCatalogoUseCase`, `ActualizarPrecioUseCase` | [x] Done |

**PR4a gap explicitly closed in this batch (not its own numbered task, called out separately per the batch instructions)**: `ActualizarPrecioUseCase` did NOT publish `PrecioActualizado` before this PR (flagged by PR4a's own "Deviations from Design" section as a deliberate, named gap for PR4b to close). Closed by:
1. Creating `events/precio-actualizado.event.ts` — deliberately minimal shape (`companyId`, `itemId`), mirroring `ProductoAgregado`'s precedent (no scenario in `spec.md`/`design.md` pins a richer payload; documented as an additive extension point in the file's own doc comment).
2. Adding `EVENT_PUBLISHER` as a new constructor dependency on `ActualizarPrecioUseCase`, and a `publish(new PrecioActualizado(companyId, itemId))` call immediately after `save()`.
3. Extending the EXISTING `actualizar-precio.use-case.spec.ts` (not a second spec file, per instruction) — every one of its 6 tests now also asserts the publish behavior: `toHaveBeenCalledTimes(1)`/`toHaveBeenCalledWith(expect.objectContaining({...}))` on the happy path, `not.toHaveBeenCalled()` on all 4 rejection paths (cross-tenant, not-found, `EmpresaNoActivaError`, `PrecioInvalidoError`).

### TDD Cycle Evidence (PR4b)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| PR4a gap-close (`PrecioActualizado` publish) | Created `events/precio-actualizado.event.ts` first (natural dependency to compile the test, same precedent as `ProductoAgregado` in PR4a), then extended `actualizar-precio.use-case.spec.ts` with `buildEventPublisher()` + a new assertion block on every existing test + a new happy-path assertion (`toHaveBeenCalledTimes(1)`/`toHaveBeenCalledWith(...)`) → ran `pnpm exec jest --testPathPatterns=actualizar-precio.use-case` → **failed** (1 of 6: `Expected number of calls: 1, Received number of calls: 0` on the happy-path publish assertion — the other 5 rejection-path assertions passed vacuously since `publish` was never called from any branch yet) | Added `EVENT_PUBLISHER`/`EventPublisher` as a 2nd constructor param and a `publish(new PrecioActualizado(companyId, itemId))` call after `save()` → re-ran → **6/6 passed** | None needed |
| 4b.2 (`NuevoProductoDto`/`ActualizarPrecioDto`) | **Self-corrected ordering slip**: wrote both DTO implementation files, then wrote `catalogo-dto.spec.ts` (15 tests) — implementation-before-test, not RED-first. Caught before moving on: deleted both DTO files, re-ran `pnpm exec jest --testPathPatterns=catalogo-dto` → **failed** (`Cannot find module './actualizar-precio.dto'`, suite failed to run — confirms genuine RED, not a rubber-stamp) | Restored both DTO files (unchanged content from the pre-deletion version) → re-ran → **15/15 passed** | None — flagged explicitly in this table rather than silently presented as clean RED-first, per this batch's non-negotiable instruction |
| 4b.4/4b.5 (`CatalogoExceptionFilter`) | Wrote `catalogo-exception.filter.spec.ts` (3 `describe.each` cases: `CatalogItemNotFoundError`→404, `EmpresaNoActivaError`→403, `PrecioInvalidoError`→400) against a not-yet-existing `./catalogo-exception.filter` → ran → **failed** (`Cannot find module './catalogo-exception.filter'`) | Created `catalogo-exception.filter.ts`, `ERROR_STATUS_MAP` keyed by constructor, mirroring `IdentidadExceptionFilter` verbatim in shape → re-ran → **3/3 passed** | None needed |
| 4b.3/4b.7 (controller routes + module wiring) | No dedicated RED test — `tasks.md` labels these plain (not RED/GREEN), consistent with `IdentidadController`'s own precedent (route wiring is proven by the e2e suite, not a route-level unit spec) | Implemented directly; correctness proven by `pnpm typecheck` (compiles against both use cases' real signatures) + the e2e suite (4b.6) exercising every route through the real HTTP pipeline | None needed |
| 4b.6 (e2e) | No RED-first ordering — `tasks.md` does not label e2e tasks RED/GREEN anywhere in this change (3b.9/5b.6/6.8/7.9 are the same pattern); e2e proves the full wiring AFTER the pieces exist, consistent with every prior PR in this change | Wrote `test/catalogo-mi-catalogo.e2e-spec.ts` (12 tests) after the controller/DTOs/filter/module were all in place → ran once → **12/12 passed on the first run**, no iteration needed | N/A |

### Commands Run (PR4b batch)

| Command | Result |
|---|---|
| `pnpm exec jest --testPathPatterns=actualizar-precio.use-case` (RED, before publish wiring) | 5 passed / 1 failed — confirms the gap-close test fails without the implementation |
| `pnpm exec jest --testPathPatterns=actualizar-precio.use-case` (GREEN) | 6/6 passed |
| `pnpm exec jest --testPathPatterns=catalogo-dto` (RED, DTO files deleted to correct the ordering slip) | Suite failed to run — module not found |
| `pnpm exec jest --testPathPatterns=catalogo-dto` (GREEN, DTO files restored) | 15/15 passed |
| `pnpm exec jest --testPathPatterns=catalogo-exception.filter` (RED, before impl) | Suite failed to run — module not found |
| `pnpm exec jest --testPathPatterns=catalogo-exception.filter` (GREEN) | 3/3 passed |
| `pnpm --filter core-api typecheck` (mid-batch, after controller/module wiring) | `Done` — confirms controller compiles against `CargarProductoCatalogoUseCase`/`ActualizarPrecioUseCase`'s real signatures |
| `pnpm exec jest --config ./test/jest-e2e.json --testPathPatterns=catalogo-mi-catalogo` | 12/12 passed, first run |
| `pnpm lint` (root) | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm typecheck` (root) | Clean — `packages/types` + `services/core-api` both `Done` |
| `pnpm test` (root — unit + e2e) | `core-api`: 28 suites / **171** unit tests passed (was 153 before this batch — +18: 15 from `catalogo-dto.spec.ts`, 3 from `catalogo-exception.filter.spec.ts`; `actualizar-precio.use-case.spec.ts` grew its assertions but kept the same 6-test count), 5 suites / **31** e2e tests passed (was 19 — +12 from the new `catalogo-mi-catalogo.e2e-spec.ts`). Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (`catalogo-exception.filter.spec.ts` + `test/catalogo-mi-catalogo.e2e-spec.ts` not Prettier-formatted) → ran `pnpm exec prettier --write` on both → re-ran `pnpm format:check` → clean |
| Full re-run of `lint`/`typecheck`/`test`/`build`/`format:check` after the Prettier fix | All green again, same counts (171 unit + 31 e2e) |

All 5 gate commands (`lint`, `typecheck`, `test`, `build`, `format:check`) are green as of the final run.

### Deviations from Design (PR4b)

**None on the HTTP surface, DTOs, or exception filter** — routes, status codes, guards, and the error-mapping table all match design.md's "Superficie HTTP"/"Errores de dominio" tables verbatim.

**One documented process deviation, self-corrected, not a design deviation**: task 4b.2's two DTOs were implemented before their validation spec was written (ordering slip, not a scope or design issue). Caught before moving to the next task — both files were deleted, the RED failure was reproduced and confirmed genuine (`Cannot find module`, not a vacuous pass), then restored unchanged to reach GREEN honestly. Documented in the TDD Cycle Evidence table above rather than silently presented as clean RED-first. No other task in this batch had this issue — `PrecioActualizado`'s publish wiring and `CatalogoExceptionFilter` were both genuinely RED-first on the first attempt.

**`PrecioActualizado`'s field shape is a scope judgment call, flagged for review**: neither `spec.md` nor `design.md` pins exact fields for this event (only its name and "published after `save()`" are specified). Chose the minimal `(companyId, itemId)` shape mirroring `ProductoAgregado`, over a richer shape carrying the new `precioBase`/`precioMaximo` (which `catalogo/SPEC.md`'s "Al extraer como microservicio" note hints a future `refill-matching` cache consumer might eventually want). Documented as an additive, non-breaking extension point in the event class's own doc comment — not a blocker, but worth a reviewer's explicit sign-off since no scenario constrains this choice either way.

### Issues Found (PR4b)

None blocking. One workload note, not a defect: see below.

### Workload note (PR4b)

Diff came in at 930 insertions / 30 deletions (≈960 changed lines) across 14 files, against the tasks.md estimate of 260-340 for this work unit — significantly over budget, same pattern as PR4a's own overage (591/26, also flagged). Breakdown: the e2e suite (`test/catalogo-mi-catalogo.e2e-spec.ts`, 334 lines, 12 tests covering both routes' happy/unhappy paths) and the DTO validation spec (`catalogo-dto.spec.ts`, 108 lines, 15 tests) together account for roughly half the diff; the remaining ~490 lines are the controller (+102), exception filter + its spec (+111), DTOs + response DTO (+131), mapper additions (+47), the `PrecioActualizado` event (+25), and the `ActualizarPrecioUseCase` gap-close (+74 across impl+spec). No task outside 4b.1-4b.7 was touched, and no scope was added beyond what the batch instructions specified — the overage is test-coverage depth (every route's happy path, DTO rejection, and 403/404 split independently proven at the e2e layer, exactly as task 4b.6 required), not scope creep. Flagged here per this project's Review Workload Guard, consistent with PR4a's own precedent of naming the overage rather than silently absorbing it.

### Files Changed (PR4b)

| File | Action | What Was Done |
|---|---|---|
| `services/core-api/src/domains/catalogo/events/precio-actualizado.event.ts` | Created | `PrecioActualizado` — minimal `(companyId, itemId)` shape |
| `services/core-api/src/domains/catalogo/ports-in/actualizar-precio.use-case.ts` | Modified | Added `EVENT_PUBLISHER` dependency + `publish(new PrecioActualizado(...))` after `save()` (closes the PR4a gap) |
| `services/core-api/src/domains/catalogo/ports-in/actualizar-precio.use-case.spec.ts` | Modified | Extended with `buildEventPublisher()` + publish assertions on all 6 existing tests |
| `services/core-api/src/domains/catalogo/adapters/http/dto/nuevo-producto.dto.ts` | Created | `class-validator` decorators, no `companyId` field (D8) |
| `services/core-api/src/domains/catalogo/adapters/http/dto/actualizar-precio.dto.ts` | Created | `class-validator` decorators, no `companyId`/`itemId` field |
| `services/core-api/src/domains/catalogo/adapters/http/dto/provider-catalog-item-response.dto.ts` | Created | Response shape for `POST /catalogo/mi-catalogo` (201) |
| `services/core-api/src/domains/catalogo/adapters/http/dto/catalogo-dto.spec.ts` | Created | 15 tests covering both DTOs (field validation + D8's "no companyId" rejection) |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo.mapper.ts` | Modified | Added `toNuevoProductoProveedor`, `toProviderCatalogItemResponseDto` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo.controller.ts` | Modified | Added `POST /catalogo/mi-catalogo` (201, `@Roles('provider')`), `PUT /catalogo/mi-catalogo/:itemId/precio` (204, `@Roles('provider')`), `@UseFilters(CatalogoExceptionFilter)` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo-exception.filter.ts` | Created | `ERROR_STATUS_MAP` for `CatalogItemNotFoundError`/`EmpresaNoActivaError`/`PrecioInvalidoError`, mirrors `IdentidadExceptionFilter` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo-exception.filter.spec.ts` | Created | RED→GREEN, 3 tests (one per mapped error class) |
| `services/core-api/src/domains/catalogo/catalogo.module.ts` | Modified | Registered `CargarProductoCatalogoUseCase`, `ActualizarPrecioUseCase` as providers |
| `services/core-api/test/catalogo-mi-catalogo.e2e-spec.ts` | Created | 12 e2e tests: cross-tenant 404 (not 403), missing-item 404, DTO rejection (missing/extra field → 400), 403 suspended company (both routes), 403 non-provider role, happy paths for both routes with event-publish assertions |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 4b.1–4b.7 `[x]` |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR4b section into PR1+PR2+PR3a+PR3b+PR4a's file (this file) |

### Commit (PR4b)

One commit created for this PR4b batch:

```
feat(core-api): add catalogo write HTTP surface, exception filter, and PrecioActualizado event
```

Commit hash: `1accff1`. Working tree was clean before this batch except the same pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` noted since PR2 — left untouched/untracked, out of this batch's scope.

---

## What PR5a (next batch) Needs to Know

- **Start here**: `## Phase 5a: Bulk load — CSV parser + envelope validation` in `tasks.md` (tasks 5a.1–5a.4). Depends on PR2's `ArchivoCarga` type (done). Independent of PR5b's use case — this slice is parser-only.
- **The full write path (single-item) is now done and proven end-to-end**: `cargarProductoCatalogo`/`actualizarPrecio` both exist, are unit-tested, HTTP-wired, exception-filtered, and e2e-proven. PR5b's bulk-load use case will reuse `crear()` (PR3a's entity factory) per-row and `CatalogRepository.save()` (PR4a's D-C bifurcation) per-row — nothing new needed from either.
- **`csv-parse` + `@types/multer` are NOT yet installed** — task 5a.1 is the first task of PR5a, add them to `services/core-api/package.json` before writing the parser.
- **D11's boundary**: the CSV parser lives ONLY in `adapters/http/` (`carga-masiva.parser.ts`) — `ports-in`/`domain` must never see a framework buffer type (`Express.Multer.File`). The parser's output is `ArchivoCarga` (already declared in `@repon/types` since PR2), which is framework-free.
- **`ArchivoCargaInvalidoError` does not exist yet** (task 5a.4) — append it to `domain/catalogo.errors.ts` (same file as `CatalogItemNotFoundError`/`EmpresaNoActivaError`/`PrecioInvalidoError`, never edited destructively, only appended to). It will need its own entry in `catalogo-exception.filter.ts`'s `ERROR_STATUS_MAP` eventually (400 `ARCHIVO_CARGA_INVALIDO`) — but that wiring is PR5b's job (the filter change happens when the controller route that can throw it exists), not PR5a's; PR5a only needs the error class to exist so the parser can throw it.
- **Envelope validation, per design.md Diagram 1 (P1)**: mimetype `text/csv`, size ≤ 2 MB, 1 ≤ rows ≤ 500, header matches expected columns. These are placeholder values per design.md's own "Riesgos residuales" list ("Límites del upload... son placeholders: Q4 es de sdd-spec, que fija los valores duros en el DTO") — `spec.md` is where the hard numeric thresholds should already be fixed; re-check `spec.md`'s "Open item deferred beyond this spec" section before hardcoding, in case a later spec revision pinned exact numbers.
- **`numero` is 1-based, excluding the header row** — the field `ResultadoCargaMasiva.fallos[].numero` (already declared in `@repon/types`) must line up with this exactly so a provider can find the offending row in their original file.
- **CERO validation of row VALUES during parsing** (design.md Diagram 1, P2): the parser only maps CSV columns to `NuevoProductoProveedor` keys and casts with `Number()` (`NaN` is an acceptable parse result at this stage) — row-level value validation (non-empty `nombre`, non-negative prices, etc.) happens later, per row, in PR5b's use case (reusing the same `class-validator`-shaped checks that `NuevoProductoDto` already has for the single-item path, OR reusing `crear()`'s entity-level invariant — check design.md's Diagram 1 step 2a again before deciding which layer owns it for the bulk path; PR3a's own apply-progress note flags this exact question as still open).
- **This PR's `NuevoProductoDto`/`ActualizarPrecioDto`/`catalogo.mapper.ts` are NOT reused directly by PR5a/5b** — the bulk path works from `ArchivoCarga`/`FilaCarga` (already-parsed, framework-free), not from a per-row DTO instance. Do not force a DTO validation pass onto bulk rows just because the single-item path has one; re-derive whatever validation the bulk path needs at the point design.md's diagram says it belongs (the use case, not the parser).
