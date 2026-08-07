# Apply Progress: `backend-core-api-catalogo`

**Artifact store**: hybrid (this file + Engram `sdd/backend-core-api-catalogo/apply-progress`)
**Strict TDD Mode**: active (`test_command: pnpm test`)
**Last updated**: 2026-08-06T22:30:00Z — PR6 batch (merged with PR1+PR2+PR3a+PR3b+PR4a+PR4b+PR5a+PR5b+orchestrator-fix-forward; all unchanged below except this note)

## Status: 7/7 tasks complete for PR1 (Phase 1: DB foundation). 7/7 tasks complete for PR2 (Phase 2: Seams). 3/3 tasks complete for PR3a (Phase 3a: Read side — domain entity + invariant). 9/9 tasks complete for PR3b (Phase 3b: Read side — persistence adapters + buscarProductos + controller). 8/8 tasks complete for PR4a (Phase 4a: Unit writes — use cases + repository save()). 7/7 tasks complete for PR4b (Phase 4b: Unit writes — HTTP adapter + exception filter + e2e). 4/4 tasks complete for PR5a (Phase 5a: Bulk load — CSV parser + envelope validation). 7/7 tasks complete for PR5b (Phase 5b: Bulk load — use case + controller + e2e). 9/9 tasks complete for PR6 (Phase 6: Category adjustment). 61/~90 tasks complete overall across all 13 planned PRs.

**Engram note**: `mem_*` tools were not exposed in this batch's tool set either (same as every prior batch, PR1 through PR5a) — this file remains the authoritative record, per the batch instructions ("file is authoritative regardless"). If Engram becomes available in a later batch, the topic key to upsert is `sdd/backend-core-api-catalogo/apply-progress`, content = this full file merged.

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

---

## PR5a · Phase 5a: Bulk load — CSV parser + envelope validation — Spec: `core-api-catalogo`, `shared-types-package`

**Status**: done. Parser-only slice, independent of PR5b's use case (which consumes this parser's `ArchivoCarga` output).

| # | Task | Status |
|---|---|---|
| 5a.1 | Add `csv-parse` + `@types/multer` to `services/core-api/package.json` | [x] Done |
| 5a.2 | RED: `adapters/http/carga-masiva.parser.spec.ts` — envelope rejects wrong mimetype, oversized file, 0/>500 rows, missing/malformed header (400 `ARCHIVO_CARGA_INVALIDO`); valid CSV parses into `ArchivoCarga` with 1-based `numero` | [x] Done |
| 5a.3 | GREEN: `adapters/http/carga-masiva.parser.ts` (`csv-parse/sync`) — envelope checks + form-only row mapping | [x] Done |
| 5a.4 | `domain/catalogo.errors.ts`: append `ArchivoCargaInvalidoError` | [x] Done |

### Environment note, worth recording for future batches

`pnpm add`/`pnpm install` against the repo's configured private registry (AWS CodeArtifact, `~/.npmrc`) failed with `401 Unauthorized` — the cached auth token had expired, and no AWS credentials were available in this environment to refresh it (`aws sts get-caller-identity` → `NoCredentials`). **Both `csv-parse` and `@types/multer` are public, unscoped packages with no reason to require the private proxy.** Worked around it by pointing `pnpm add`/`pnpm install` at the public registry directly for this one operation only (`--registry=https://registry.npmjs.org`), which resolved cleanly. `package.json`/`pnpm-lock.yaml` afterward are identical in shape to what a normal `pnpm add` against the private mirror would have produced (same version, same dependency tree) — the override only changed *where the tarballs were fetched from*, not what got recorded. If the private registry's token is still expired in a later batch needing a new dependency, the same workaround applies; if the private registry proxies packages that AREN'T on public npm (private, scoped `@repon/*`-style packages), this workaround would NOT work and the token would need a real refresh.

### TDD Cycle Evidence (PR5a)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 5a.2/5a.3 (`parseArchivoCarga`) | Wrote `carga-masiva.parser.spec.ts` (11 tests: 6 envelope-rejection cases — wrong mimetype, oversized file, completely empty file, header-only/0 data rows, >500 data rows, header missing a required column, header sharing none of the required columns — and 5 successful-parse cases — 1-based `numero` excluding header, optional-column presence/absence, `Number()`-cast with `NaN` permitted for a malformed cell without tainting sibling fields, header-order independence) against a not-yet-existing `./carga-masiva.parser` → ran `pnpm exec jest --testPathPatterns=carga-masiva.parser` → **failed** (`Cannot find module './carga-masiva.parser'`, suite failed to run — genuine RED, `ArchivoCargaInvalidoError` was created first as a natural compile dependency, same precedent as PR3a/PR4a creating their error classes ahead of the GREEN implementation) | Created `carga-masiva.parser.ts`: mimetype check → size check → raw-row parse (`csv-parse/sync`, no `columns: true` — deliberately, so "header present with 0 data rows" and "no header at all" stay two independently-throwing, independently-testable branches) → header-contains-required-columns check → row-count-in-range check → per-row form-only mapping (`Number()` cast for numeric columns, boolean cast for `disponible`, pass-through for optional string columns) → re-ran same command → **11/11 passed, first attempt** | None needed |
| 5a.1 (dependencies) | N/A — package.json/lockfile edit, not behavior-under-test, same category as PR1's DDL tasks | N/A | N/A |
| 5a.4 (`ArchivoCargaInvalidoError`) | N/A — pure declaration, doc-commented, appended (never edited destructively) to the existing `catalogo.errors.ts`, same convention as `CatalogItemNotFoundError`/`EmpresaNoActivaError` in PR4a | N/A | N/A |

### Commands Run (PR5a batch)

| Command | Result |
|---|---|
| `pnpm add csv-parse @types/multer --filter core-api --registry=https://registry.npmjs.org` | Resolved and installed both; `pnpm-lock.yaml` updated. `@types/multer` initially landed in `dependencies` (pnpm's default placement) — manually moved to `devDependencies` afterward to match this repo's own convention (`@types/pg`/`@types/jest`/`@types/supertest` are all `devDependencies`), then re-ran `pnpm install --filter core-api --registry=...` to reconcile the lockfile with the manual edit — clean, no re-resolution needed |
| `pnpm exec jest --testPathPatterns=carga-masiva.parser` (RED, before implementation) | Suite failed to run — `Cannot find module './carga-masiva.parser'` |
| `pnpm exec jest --testPathPatterns=carga-masiva.parser` (GREEN, after implementation) | 11/11 passed, first attempt |
| `pnpm lint` (root) | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm typecheck` (root) | Clean — `packages/types` + `services/core-api` both `Done`. Confirms the `tsconfig.json` `types: ["node", "jest", "multer"]` addition correctly pulls in `Express.Multer.File`'s global augmentation without needing an explicit `/// <reference>` in application code |
| `pnpm test` (root — unit + e2e) | `core-api`: 29 suites / **182** unit tests passed (was 171 before this batch — +11 is exactly the new `carga-masiva.parser.spec.ts`), 5 suites / **31** e2e tests passed (unchanged — this batch adds no e2e, no route exists yet). Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (`carga-masiva.parser.ts` + `.spec.ts` not Prettier-formatted) → ran `pnpm exec prettier --write` on both → re-ran `pnpm format:check` → clean |
| Full re-run of `lint`/`typecheck`/`test`/`build` after the Prettier fix | All green again, same counts (182 unit + 31 e2e) |

All 5 gate commands (`lint`, `typecheck`, `test`, `build`, `format:check`) are green as of the final run.

### Deviations from Design (PR5a)

**One necessary interpretation, not a silent deviation — the CSV header's exact column names.** Neither `spec.md` nor `design.md` pins the literal CSV column names a provider's file must use; design.md's Diagram 1 only says "cabecera esperada" (an expected header) without specifying it. Chose the 8 `NuevoProductoProveedor` field names verbatim as the column vocabulary (`catalogProductId, nombre, categoria, precioBase, precioMaximo, stock, disponible, imagenUrl`), matched by name (not position) so a provider's column order never matters — this is the most literal reading of design.md's own P2 description ("`csv-parse` -> `ArchivoCarga`... SOLO forma: mapea columnas a claves"), which implies a direct column-name-to-key mapping rather than an undocumented translation table nobody asked for. Header validation checks **presence of the 5 required columns only** (`nombre`, `categoria`, `precioBase`, `precioMaximo`, `stock`) — the 3 optional `NuevoProductoProveedor` fields do not force an always-empty column onto a provider who never uses them. **Flagged for review**: if product/design later pins a different (e.g. Spanish-prose, non-field-name) column vocabulary for the provider-facing template, this is the file to revisit — the mapping logic is centralized in one function (`mapRowAProducto`), so the blast radius of a column-vocabulary change is contained to `carga-masiva.parser.ts` alone.

**One scope decision matching the batch's own explicit instruction, not a gap**: task 5a.3's own text says "+ `FileInterceptor('archivo')` wiring", but per the batch instructions ("if there's no natural attachment point yet, keep the interceptor wiring documented/ready but do not create the route itself") and the explicit "What NOT to do" list ("do not add the `POST /catalogo/mi-catalogo/carga-masiva` route"), no controller method exists yet to attach `@UseInterceptors(FileInterceptor(...))` to. Readiness is expressed instead as an exported `CARGA_MASIVA_FILE_FIELD = 'archivo'` constant with a doc comment spelling out exactly how PR5b's controller method will consume it (`@UseInterceptors(FileInterceptor(CARGA_MASIVA_FILE_FIELD, { limits: { fileSize: CARGA_MASIVA_MAX_BYTES } }))`) — single source of truth for the field name so the interceptor and the parser can never drift apart. `catalogo.controller.ts` was NOT touched in this batch, per instruction. Similarly, "+ envelope DTO" in task 5a.3's text is PR5b's task 5b.4 (`adapters/http/dto/carga-masiva.dto.ts`, the multipart envelope DTO) — not created here; this batch's envelope validation lives entirely inside `parseArchivoCarga` itself (a plain function, not a `class-validator`-decorated DTO, since there is no framework request-body object to decorate yet — the file arrives as a Multer buffer, not JSON).

**One documented value-mapping choice for `disponible` (boolean), not pinned by design.md**: numeric columns have a natural "malformed" sentinel (`NaN`), explicitly sanctioned by design.md's P2 wording. Booleans have no equivalent sentinel. Chose: a non-empty cell equal to `"true"` (case/whitespace-insensitive) maps to `true`; every other non-empty value maps to `false`; an empty/absent cell maps to `undefined` (matching `NuevoProductoProveedor.disponible?`'s own optionality). This is a genuine boolean either way — no "malformed boolean" state was invented, since `disponible` is optional and needs no downstream value validation the way prices/stock do.

Everything else matches design.md verbatim: mimetype `text/csv`, size ≤ 2 MB, `1 ≤ filas ≤ 500`, `numero` 1-based excluding the header row, `Number()` casting with `NaN` explicitly permitted, zero row-VALUE validation (reserved for PR5b's use case, per D2 — "one malformed row must never invalidate the whole file").

### Issues Found (PR5a)

None blocking. Two items worth flagging for PR5b, not defects in this batch:

1. **`Number('') → 0` gotcha, handled but worth restating for the next batch**: `Number('')` is `0`, not `NaN` — a genuinely empty numeric cell (provider left `precioBase` blank) must still read as malformed downstream, never silently become a valid price of `0`. Handled with an explicit `value || NaN` fallback before the `Number()` cast (only fires on empty string; a real `'0'` cell is a non-empty string and passes through as `0` correctly). PR5b's row-level validation should NOT assume `NaN` is the only way a bad cell surfaces — an explicit `0` is also possible (a provider who typed `0`) and is a legitimate, separately-decidable business rule (is `precioBase: 0` valid? `crear()`'s current invariant only checks `precioMaximo >= precioBase`, which `0 >= 0` trivially satisfies).
2. **PR3a's own still-open question, restated for PR5b (already flagged once in PR3a's apply-progress, and again in PR4b's "What PR5a Needs to Know")**: does bulk-row value validation belong to `crear()`'s entity invariant, to a new `class-validator`-shaped check mirroring `NuevoProductoDto`, or to a bespoke check inside `cargarCatalogoMasivoUseCase` itself? Not decided in this batch (out of scope — this batch produces `ArchivoCarga`, PR5b decides how to validate its rows). Whoever picks up PR5b must resolve this before writing `cargarCatalogoMasivoUseCase`, not defer it a third time.

### Workload note (PR5a)

Diff came in at 392 lines (excluding the mechanical 82-line `pnpm-lock.yaml` diff) across 6 files — `tasks.md` +8/-6, `package.json` +4, `catalogo.errors.ts` +24, `tsconfig.json` +7, `carga-masiva.parser.ts` +158, `carga-masiva.parser.spec.ts` +191 — against the tasks.md estimate of 220-290 for this work unit, roughly 35% over the top of the range. Same pattern as PR4a's and PR4b's own named overages: driven by (a) doc-comment density consistent with this codebase's own established convention (every file read during this batch — `catalog-query.port.ts`, `catalogo.errors.ts`, `provider-catalog-item.entity.ts` — carries this same density), and (b) one dedicated test per envelope-rejection branch plus multiple successful-parse variations, not scope creep — no file outside 5a.1-5a.4's stated scope was touched. Flagged here per this project's Review Workload Guard rather than silently absorbed.

### Files Changed (PR5a)

| File | Action | What Was Done |
|---|---|---|
| `services/core-api/package.json` | Modified | Added `csv-parse` (`dependencies`) and `@types/multer` (`devDependencies`, matching `@types/pg`'s placement convention) |
| `pnpm-lock.yaml` | Modified | Regenerated for the 2 new dependencies (installed via the public npm registry directly — see "Environment note" above) |
| `services/core-api/tsconfig.json` | Modified | Added `"multer"` to the `types` array so `Express.Multer.File`'s global augmentation (`@types/multer`) is available without an explicit `/// <reference>` — this file's `module`/`moduleResolution` override precedent (PR 3) already documents why this project pins `types` explicitly rather than auto-including every `@types/*` package |
| `services/core-api/src/domains/catalogo/domain/catalogo.errors.ts` | Modified | Appended `ArchivoCargaInvalidoError` (400 `ARCHIVO_CARGA_INVALIDO`), never editing the 3 existing error classes |
| `services/core-api/src/domains/catalogo/adapters/http/carga-masiva.parser.ts` | Created | `parseArchivoCarga()` — envelope validation (mimetype/size/row-count/header) + form-only row mapping to `ArchivoCarga`; exports `CARGA_MASIVA_FILE_FIELD`/`CARGA_MASIVA_MIMETYPE_ESPERADO`/`CARGA_MASIVA_MAX_BYTES`/`CARGA_MASIVA_MIN_FILAS`/`CARGA_MASIVA_MAX_FILAS` for PR5b to consume |
| `services/core-api/src/domains/catalogo/adapters/http/carga-masiva.parser.spec.ts` | Created | RED→GREEN, 11 tests (6 envelope-rejection + 5 successful-parse) |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 5a.1–5a.4 `[x]` |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR5a section into PR1+PR2+PR3a+PR3b+PR4a+PR4b's file (this file) |

### Commit (PR5a)

One commit for this PR5a batch:

```
feat(core-api): add carga-masiva CSV parser with envelope validation
```

Working tree was clean before this batch except the same pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` noted since PR2 — left untouched/untracked, out of this batch's scope; commit hash recorded in the return envelope to the orchestrator.

---

## What PR5b (next batch) Needs to Know

- **Start here**: `## Phase 5b: Bulk load — use case + controller + e2e` in `tasks.md` (tasks 5b.1–5b.7). Depends on PR5a's parser (done, this batch) and PR4a's `CatalogRepository.save()` (done) for the per-row D-C upsert.
- **`parseArchivoCarga(file)` is ready to call**: import from `adapters/http/carga-masiva.parser.ts`. It throws `ArchivoCargaInvalidoError` for envelope failures (400) and returns a fully-formed `ArchivoCarga` otherwise — `NaN` numeric fields ARE possible in its output and must be treated as a per-row validation failure by `cargarCatalogoMasivoUseCase`, not re-thrown as an envelope error.
- **`ArchivoCargaInvalidoError` exists but has NO entry yet in `catalogo-exception.filter.ts`'s `ERROR_STATUS_MAP`** — that's this next batch's job (400 `ARCHIVO_CARGA_INVALIDO`), done when the controller route that can throw it exists.
- **The route/interceptor wiring is NOT started**: `CARGA_MASIVA_FILE_FIELD = 'archivo'` is exported from the parser file specifically for PR5b's controller method to consume via `@UseInterceptors(FileInterceptor(CARGA_MASIVA_FILE_FIELD, { limits: { fileSize: CARGA_MASIVA_MAX_BYTES } }))`. Also import `CARGA_MASIVA_MAX_BYTES` for that `limits.fileSize` value so the multer-level cutoff and the parser's own envelope check never drift apart.
- **Two open value-mapping questions restated above** ("Issues Found" #1 and #2) must be resolved while writing `cargarCatalogoMasivoUseCase` — not deferred again.
- **The duplicate-within-file scenario is explicitly PR5b's job, not PR5a's**: `spec.md`'s "Two rows identifying the same product within one file are rejected as a duplicate" scenario requires in-memory identity detection (same `catalogProductId`, or same `nombre`+`categoria` when absent) — the parser does NOT deduplicate or detect collisions; it only maps columns to `NuevoProductoProveedor` shapes, one per row, independently.
- **Reminder from design.md, easy to miss**: `cargarCatalogoMasivoUseCase` must NOT inject `TRANSACTION_MANAGER` at all (D2) — the guarantee is structural (constructor shape), not a runtime check. The 4a.1/4a.2 precedent (`CargarProductoCatalogoUseCase`) and 4a.3-4a.5 precedent (`ActualizarPrecioUseCase`) are the closest existing examples of this domain's use-case shape (constructor-injected ports, `EmpresaNoActivaError` gate first, `EVENT_PUBLISHER.publish(...)` last) — reuse that shape, adapted for the per-row loop and the single end-of-invocation `CatalogoCargaMasivaCompletada` publish (never one event per row, D3).

---

## PR5b · Phase 5b: Bulk load — use case + controller + e2e — Spec: `core-api-catalogo`

**Status**: done. This is the PR that closes PR3a's/PR5a's own repeatedly-flagged open question ("Issues Found" #2, restated in every batch since PR3a): does bulk-row value validation belong to `crear()`'s entity invariant, to a DTO-shaped check, or to a bespoke use-case check? **Resolved: extended `ProviderCatalogItem.crear()`** — matching design.md Diagram 1 step 2a's own literal attribution of nombre/categoria/price/stock validation to `ProviderCatalogItem.crear(companyId, fila.producto)`, not re-implemented a second time inside the use case.

| # | Task | Status |
|---|---|---|
| 5b.1 | RED: `ports-in/cargar-catalogo-masivo.use-case.spec.ts` — 12 tests | [x] Done |
| 5b.2 | GREEN: `ports-in/cargar-catalogo-masivo.use-case.ts` | [x] Done |
| 5b.3 | `events/catalogo-carga-masiva-completada.event.ts` | [x] Done |
| 5b.4 | `adapters/http/dto/carga-masiva.dto.ts` + `adapters/http/dto/resultado-carga-masiva-response.dto.ts` | [x] Done |
| 5b.5 | `adapters/http/catalogo.controller.ts`: `POST /catalogo/mi-catalogo/carga-masiva` (200, `@Roles('provider')`) | [x] Done |
| 5b.6 | E2e: `test/catalogo-carga-masiva.e2e-spec.ts` — 7 tests | [x] Done |
| 5b.7 | `catalogo.module.ts`: register `CargarCatalogoMasivoUseCase` | [x] Done |

### The `crear()` validation-gap decision (this PR's central claim, stated explicitly for review)

PR3a's `crear()` originally validated ONLY the price invariant (`precioMaximo >= precioBase`), a scope narrowing PR3a's own "Deviations from Design" section named explicitly and flagged for "whichever PR actually exercises row-level validation." PR5a's own apply-progress restated the same open question twice more ("Issues Found" #2) without resolving it, deferring to this batch by name.

**Decision made in this PR: extend `crear()` itself**, not add a parallel check inside `CargarCatalogoMasivoUseCase`. Reasoning:

1. design.md Diagram 1, step 2a literally attributes this validation to `ProviderCatalogItem.crear(companyId, fila.producto)`: *"nombre/categoria no vacíos; precios finitos y >= 0; redondeo a 2 decimales; precioMaximo >= precioBase; stock entero >= 0"* — the diagram is not describing a use-case-level check that happens to call `crear()` afterward; it names `crear()` as the validator.
2. A second, use-case-local validation pass would duplicate logic already owned by the domain, risking the two checks drifting apart over time (e.g. someone tightens `crear()`'s price check later and forgets the use-case's parallel copy).
3. `cargarProductoCatalogo` (the single-item path, PR4a/4b) already calls `crear()` too — extending it closes a *latent* gap there as well (today masked by `NuevoProductoDto`'s `class-validator` decorators catching the same cases first, but not structurally guaranteed if that DTO ever changes).

**New error class**: `ProductoInvalidoError` (`domain/catalogo.errors.ts`) — distinct from `PrecioInvalidoError`, which is only the cross-field `precioMaximo >= precioBase` invariant on already-well-formed numbers. `ProductoInvalidoError` is field-level malformation (empty `nombre`/`categoria`, non-finite/negative price, non-integer/negative `stock`), checked BEFORE rounding — `redondear(NaN)` is still `NaN`, and `NaN < x` is always `false`, so `assertPrecioValido` alone could never have caught a non-finite price (PR5a's own "Issues Found" #1 flagged exactly this `Number('')` → `NaN` risk from the parser).

**Order inside `crear()`** (matches design.md's own listed order): `assertProductoValido` (raw input: nombre/categoria non-empty, prices finite >= 0, stock non-negative integer) → round → `assertPrecioValido` (cross-field invariant on rounded values, pre-existing PR3a logic, unchanged).

**Added to `catalogo-exception.filter.ts`'s `ERROR_STATUS_MAP`** as 400 `PRODUCTO_INVALIDO`, defense-in-depth for the single-item path (in practice masked by the DTO today, but not expected to ever surface there — see the error class's own doc comment). `ArchivoCargaInvalidoError` (declared in PR5a, unused until now) was also added to the same map in this batch — this is the first PR with a controller route that can throw it.

**Extending `crear()` did NOT touch `actualizarPrecio()` or `aplicarPorcentaje()`** — design.md's Diagram 3 only names rounding + the price invariant for `actualizarPrecio()`, no nombre/categoria/stock re-validation (those fields aren't part of a price update). Confirmed no regression: PR3a's/PR4a's/PR4b's existing test fixtures all use well-formed nombre/categoria/stock, so extending `crear()`'s validation broke nothing downstream (verified by re-running `cargar-producto-catalogo.use-case.spec.ts` in isolation before running the full suite).

### How duplicate-within-file detection works (this PR's other central claim)

`identidadDeFila(producto)` in `cargar-catalogo-masivo.use-case.ts`: if `catalogProductId` is present, identity is `id:${catalogProductId.trim().toLowerCase()}`; otherwise identity is `nc:${nombre.trim().toLowerCase()}::${categoria.trim().toLowerCase()}`. This deliberately mirrors PR1's own two-branch normalization on the DB side — branch 2's partial unique index is `lower(btrim(nombre)), lower(btrim(categoria))` — so a duplicate the DB would itself collide on (same product, different casing/whitespace) is also caught in-memory, before either row reaches `save()`. Without this normalization, two rows differing only in case would both attempt a `save()` call, and the 2nd would silently UPSERT over the 1st's just-persisted row — the exact "silently merged" outcome the spec scenario forbids.

**Design decision, not explicitly pinned by spec.md, documented here**: identity is tracked as soon as a row is *seen* (before attempting `crear()`/`save()`), regardless of whether that row's own processing later succeeds or fails. Concretely: if row 1 has the same identity as row 2 but row 1 itself fails validation (e.g. empty `nombre`), row 2 is STILL reported as a duplicate, not given a chance to succeed on its own merits. Reasoning: the scenario's own wording — "two rows identifying the same product within one file are rejected as a duplicate" — frames this as a property of the FILE's rows, not of persistence outcome; treating identity-tracking as conditional on the first occurrence's success would make the duplicate-or-not outcome depend on which of two ambiguous rows a provider happens to list first, which is a more surprising rule to explain than "the file names the same product twice, full stop." Flagged explicitly for review since no spec.md scenario pins this exact sub-case either way.

### TDD Cycle Evidence (PR5b)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| `crear()` extension (nombre/categoria/price/stock validation) | Added 7 tests to the EXISTING `provider-catalog-item.entity.spec.ts` (empty nombre, whitespace-only categoria, non-finite precioBase, non-finite precioMaximo, negative precioBase, non-integer stock, negative stock) against the not-yet-extended `crear()` → ran `pnpm exec jest --testPathPatterns=provider-catalog-item` → **failed** (7 of 15: `Received function did not throw`) | Added `assertProductoValido` (private helper) + called it first inside `crear()`, before rounding → re-ran → **15/15 passed** (8 pre-existing + 7 new) | None needed |
| 5b.1/5b.2 (`CargarCatalogoMasivoUseCase`) | Wrote `cargar-catalogo-masivo.use-case.spec.ts` (12 tests: structural `TRANSACTION_MANAGER`-never-injected check via `Reflect.getMetadata('self:paramtypes', ...)`, `EmpresaNoActivaError` gate for both `suspendido`/`pendiente`, companyId applied to every row, N-M partial failure with correct `numero`s, a `save()`-rejection row reported without aborting the batch, duplicate-by-`catalogProductId`, duplicate-by-`nombre`+`categoria` case/whitespace-insensitive, non-duplicate when only one of the two identity fields matches, exactly-one-event for a mixed outcome, exactly-one-event with 0 successes, zero per-item `ProductoAgregado` events) against a not-yet-existing `./cargar-catalogo-masivo.use-case` → ran → **failed** (`Cannot find module`) | Created `events/catalogo-carga-masiva-completada.event.ts` (natural dependency, same precedent as PR4a/4b) and `cargar-catalogo-masivo.use-case.ts` (`EmpresaNoActivaError` gate → per-row loop: identity check → `crear()` → `save()`, catch-and-`fallos.push`-and-continue → single `publish(CatalogoCargaMasivaCompletada)` after the loop) → re-ran → **12/12 passed, first attempt** (including the structural DI test) | None needed |
| `catalogo-exception.filter.ts` (`ArchivoCargaInvalidoError` + `ProductoInvalidoError` mappings) | Extended `catalogo-exception.filter.spec.ts` with 2 new `describe.each` cases FIRST, then temporarily `git stash`ed the (already-drafted) filter implementation to reproduce a genuine RED (`git stash push` on just the filter file, re-run → 2 failed with `Received: 500`, 3 pre-existing passed) — a deliberate self-correction after initially drafting the filter change before its test, to keep the RED→GREEN evidence honest rather than silently presenting an after-the-fact pass as RED-first | `git stash pop` to restore the drafted `@Catch(...)` + `ERROR_STATUS_MAP` additions → re-ran → **5/5 passed** | None needed |
| 5b.4/5b.5/5b.7 (DTOs, controller route, module wiring) | No dedicated RED test — same precedent as PR4b's 4b.3/4b.7 (`tasks.md` doesn't label these RED/GREEN; route/DTO wiring is proven by the e2e suite, not a route-level unit spec) | Implemented directly; correctness proven by `pnpm typecheck` (caught one real bug — see "Issues Found" below) + the e2e suite (5b.6) exercising every route through the real `FileInterceptor`/`AuthGuard`/`RolesGuard`/`CatalogoExceptionFilter` pipeline | None needed |
| 5b.6 (e2e) | No RED-first ordering — same precedent as 3b.9/4b.6/5a's non-labeling of e2e tasks | Wrote `test/catalogo-carga-masiva.e2e-spec.ts` (7 tests) after the use case/DTOs/controller/module were all in place → ran once → **7/7 passed on the first run** | N/A |

### Commands Run (PR5b batch)

| Command | Result |
|---|---|
| `pnpm exec jest --testPathPatterns=provider-catalog-item` (RED, before `crear()` extension) | 7 failed / 8 passed |
| `pnpm exec jest --testPathPatterns=provider-catalog-item` (GREEN) | 15/15 passed |
| `pnpm exec jest --testPathPatterns=cargar-producto-catalogo` (regression check after extending `crear()`) | 4/4 passed — confirms the single-item path's existing fixtures still satisfy the new validation |
| `pnpm exec jest --testPathPatterns=cargar-catalogo-masivo` (RED, before the use case existed) | Suite failed to run — module not found |
| `pnpm exec jest --testPathPatterns=cargar-catalogo-masivo` (GREEN) | 12/12 passed, first attempt |
| `git stash push` (filter implementation only) + `pnpm exec jest --testPathPatterns=catalogo-exception.filter` (RED) | 2 failed (`Received: 500`) / 3 passed |
| `git stash pop` + `pnpm exec jest --testPathPatterns=catalogo-exception.filter` (GREEN) | 5/5 passed |
| `pnpm --filter core-api typecheck` (mid-batch, after the e2e file was written) | Failed once — `test/catalogo-carga-masiva.e2e-spec.ts`'s `authenticate()` helper spread `...overrides` AFTER the computed non-null `companyId`, letting a nullable `overrides.companyId` silently win — both a real logic bug (the computed fallback would have been discarded) and a `TS2322` (`string \| null` not assignable to `string`) against `buildProviderActor`'s required `{ companyId: string }`. Fixed by reordering the spread (`{ ...overrides, profileId, companyId }`) so the computed non-null values always win. Re-ran `pnpm typecheck` → clean |
| `pnpm exec jest --config ./test/jest-e2e.json --testPathPatterns=catalogo-carga-masiva` (after the typecheck fix) | 7/7 passed |
| `pnpm lint` (root) | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm typecheck` (root) | Clean — `packages/types` + `services/core-api` both `Done` |
| `pnpm test` (root — unit + e2e) | `core-api`: 30 suites / **203** unit tests passed (was 182 before this batch — +21: 7 entity + 12 use-case + 2 filter), 6 suites / **38** e2e tests passed (was 31 — +7 new). Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (`catalogo-exception.filter.ts` + `cargar-catalogo-masivo.use-case.spec.ts` not Prettier-formatted) → ran `pnpm exec prettier --write` on both → re-ran `pnpm format:check` → clean |
| Full re-run of `lint`/`typecheck`/`test`/`build`/`format:check` after the Prettier fix | All green again, same counts (203 unit + 38 e2e) |

All 5 gate commands (`lint`, `typecheck`, `test`, `build`, `format:check`) are green as of the final run.

### Deviations from Design (PR5b)

**One real, named, resolved deviation from PR3a's original scope** — the `crear()` validation extension itself, covered in full above under "The `crear()` validation-gap decision." Not a deviation from design.md (design.md always specified this validation for `crear()`); it IS a deviation from PR3a's narrower implementation, closed here as PR3a's own notes explicitly anticipated.

**5b.6's e2e task text says "re-upload updates not duplicates (relies on PR1's index)"** — NOT implemented as a literal e2e test in this batch. `test/catalogo-carga-masiva.e2e-spec.ts` overrides `CATALOG_REPOSITORY` with a jest mock (same "override the port, keep the wiring real" convention as `catalogo-mi-catalogo.e2e-spec.ts`/`catalogo-buscar-productos.e2e-spec.ts`), so a mocked `save()` cannot meaningfully prove an idempotent upsert against a real unique index — calling `execute()` twice against a mock only proves `save()` was called twice, not that the DB deduplicated. That specific DB-level property is already proven at the correct layer: PR1's opt-in integration test (`catalogo-provider-catalog-upsert.integration-spec.ts`) against real Postgres, and PR4a's `kysely-catalog.repository.spec.ts` unit tests for `save()`'s D-C conflict-target bifurcation. Re-testing it here would either be a no-op assertion against a mock or would require standing up real Supabase in an e2e suite that every other spec in this domain deliberately avoids. `tasks.md`'s own 5b.6 line has been updated (see the task table) to document this explicitly rather than silently dropping the phrase.

Everything else matches design.md verbatim: the per-row loop with no wrapping transaction (D2), the single end-of-invocation event (D3), `companyId` derived exclusively from the actor (D8), the `EmpresaNoActivaError` gate ordering (D-E), and the `ArchivoCargaInvalidoError`-before-any-row-processing ordering (parser runs inside the controller, before `execute()` is ever called).

### Issues Found (PR5b)

None blocking. Two items worth recording:

1. **The `authenticate()` test-helper spread-order bug** (see "Commands Run" above) — caught by `pnpm typecheck`, not by a failing test (the bug was in test-fixture code, not production code; every affected e2e test still passed because none of them actually exercised the `overrides.companyId` code path with a conflicting value). Fixed before any gate ran green. Documents itself as evidence `pnpm typecheck` is doing real work in this codebase's CI gate, not a rubber-stamp.
2. **Multer's own `fileSize` limit produces `413 PayloadTooLargeException`, not `ArchivoCargaInvalidoError`'s `400 ARCHIVO_CARGA_INVALIDO`** — verified by reading `@nestjs/platform-express`'s `multer.utils.ts` `transformException()` directly (`LIMIT_FILE_SIZE` → `PayloadTooLargeException`, a Nest-native `HttpException`, before `parseArchivoCarga` ever runs). Both `FileInterceptor`'s `limits.fileSize` and `parseArchivoCarga`'s own `file.size > CARGA_MASIVA_MAX_BYTES` check are set to the SAME `CARGA_MASIVA_MAX_BYTES` constant, so in practice Multer's own limit fires first on a genuinely oversized upload — the parser's own size check is defense-in-depth (covers any caller path where `file.size` differs from what Multer measured, and is exhaustively unit-tested against a fake envelope object in PR5a's `carga-masiva.parser.spec.ts`, bypassing real Multer). **The e2e suite tests "malformed" (wrong mimetype, bad header), not "oversized," for exactly this reason** — a real oversized multipart upload in this e2e suite would prove Nest's OWN `PayloadTooLargeException` mapping, not this domain's `ArchivoCargaInvalidoError` path, and would not exercise `parseArchivoCarga`'s size branch at all. Flagged for whoever reviews this PR: if the maintainer wants `ARCHIVO_CARGA_INVALIDO` (not `413`) to be the client-visible outcome for an oversized upload, `FileInterceptor`'s `limits.fileSize` would need to be removed (or set higher than `CARGA_MASIVA_MAX_BYTES`) so Multer never intercepts first — a design.md-level decision, not something this batch should decide unilaterally.

### Workload note (PR5b)

Diff came in at 978 insertions / 28 deletions (≈1,006 changed lines) across 15 files, against the tasks.md estimate of 300-380 for this work unit — roughly 2.6-3.3x over, the largest overage yet in this change, though following the exact same pattern named and accepted in every prior batch (PR4a 617/26, PR4b 930/30, PR5a 392 lines). Breakdown: the two test files are the majority (`cargar-catalogo-masivo.use-case.spec.ts` 231 lines / 12 tests, `test/catalogo-carga-masiva.e2e-spec.ts` 287 lines / 7 tests — 518 lines, ~52% of the diff); the remaining ~460 lines are the use case itself (113), the `crear()` extension + its 7 new tests (~110 combined), the controller route + imports (+63), the exception filter map/catch-list extension + its 2 new tests (+37 combined), the DTOs (+55), the mapper addition (+26), the event class (21), and the module registration (+15). No task outside 5b.1-5b.7 was touched — the `crear()` extension is not scope creep; it was an explicit, named prerequisite this batch's own instructions called out ("this batch's own use case needs those checks to make the partial-failure scenarios pass"). Flagged here per this project's Review Workload Guard, consistent with every prior batch's precedent of naming rather than silently absorbing the overage. `Chain strategy: stacked-to-main` (from `tasks.md`'s Review Workload Forecast) — this PR was committed directly to `main`, same as PR1 through PR5a.

### Files Changed (PR5b)

| File | Action | What Was Done |
|---|---|---|
| `services/core-api/src/domains/catalogo/domain/catalogo.errors.ts` | Modified | Appended `ProductoInvalidoError` (400 `PRODUCTO_INVALIDO`) |
| `services/core-api/src/domains/catalogo/domain/provider-catalog-item.entity.ts` | Modified | Extended `crear()` with `assertProductoValido` (nombre/categoria non-empty, finite non-negative prices, non-negative integer stock), called before rounding |
| `services/core-api/src/domains/catalogo/domain/provider-catalog-item.entity.spec.ts` | Modified | Added 7 RED→GREEN tests for the `crear()` extension |
| `services/core-api/src/domains/catalogo/ports-in/cargar-catalogo-masivo.use-case.ts` | Created | `EmpresaNoActivaError` gate → per-row loop (duplicate-identity check → `crear()` → `save()`, catch-and-continue) → single `publish(CatalogoCargaMasivaCompletada)` |
| `services/core-api/src/domains/catalogo/ports-in/cargar-catalogo-masivo.use-case.spec.ts` | Created | RED→GREEN, 12 tests including the structural `TRANSACTION_MANAGER`-never-injected check |
| `services/core-api/src/domains/catalogo/events/catalogo-carga-masiva-completada.event.ts` | Created | `CatalogoCargaMasivaCompletada` — `(companyId, totalCargados, totalFallidos)` |
| `services/core-api/src/domains/catalogo/adapters/http/dto/carga-masiva.dto.ts` | Created | Swagger-only multipart envelope shape (thin — real validation is `parseArchivoCarga`'s) |
| `services/core-api/src/domains/catalogo/adapters/http/dto/resultado-carga-masiva-response.dto.ts` | Created | Response shape for `cargarCatalogoMasivo` (200) — mirrors `ResultadoCargaMasiva` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo.mapper.ts` | Modified | Added `toResultadoCargaMasivaResponseDto` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo.controller.ts` | Modified | Added `POST /catalogo/mi-catalogo/carga-masiva` (200, `@Roles('provider')`, `FileInterceptor`, missing-file guard, `parseArchivoCarga` → use case) |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo-exception.filter.ts` | Modified | Added `ArchivoCargaInvalidoError`→400/`ARCHIVO_CARGA_INVALIDO` and `ProductoInvalidoError`→400/`PRODUCTO_INVALIDO` to `@Catch()` + `ERROR_STATUS_MAP` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo-exception.filter.spec.ts` | Modified | Added 2 `describe.each` cases (RED→GREEN, verified via a temporary `git stash` of the implementation) |
| `services/core-api/src/domains/catalogo/catalogo.module.ts` | Modified | Registered `CargarCatalogoMasivoUseCase`; updated the module's own doc comment |
| `services/core-api/test/catalogo-carga-masiva.e2e-spec.ts` | Created | 7 e2e tests: partial failure, duplicate-within-file, malformed header → 400, wrong mimetype → 400, suspended company → 403, all-rows-fail still emits one event, non-provider role → 403 |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 5b.1–5b.7 `[x]`; annotated 5b.6 with the "re-upload" scope note |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR5b section into PR1+PR2+PR3a+PR3b+PR4a+PR4b+PR5a's file (this file) |

### Commit (PR5b)

One commit for this PR5b batch:

```
feat(core-api): add cargarCatalogoMasivo use case with per-row partial-failure reporting
```

Commit hash: `372f280`. Working tree was clean before this batch except the same pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` noted since PR2 — left untouched/untracked, out of this batch's scope.

---

## What PR6 (next batch) Needs to Know

- **Start here**: `## Phase 6: Category adjustment` in `tasks.md` (tasks 6.1–6.9). Depends on PR2's `saveMany` signature (already declared on `CatalogRepository`, currently throwing a named "not yet available" error in `KyselyCatalogRepository`) and PR3b's `findByCompanyAndCategoria` (already implemented, read-side).
- **This is the FIRST use case in this domain that DOES wrap `runInTransaction`** — a deliberate contrast with `cargarCatalogoMasivo` (PR5b, this batch) and every other mutating use case so far. `ajustarPreciosPorCategoria` reads `findByCompanyAndCategoria`, applies `aplicarPorcentaje()` (PR3a's entity function, already implemented and unit-tested since PR3a) to every item, then calls `saveMany` — ALL inside one `TransactionManager.runInTransaction`, with `tx` propagated through both calls. Do not reuse `CargarCatalogoMasivoUseCase`'s "never inject `TRANSACTION_MANAGER`" shape here — that guarantee is specific to the bulk-load use case (D2), not a domain-wide rule; PR6's own task 6.4 explicitly requires `runInTransaction invoked with tx propagated to saveMany`, the opposite structural guarantee.
- **`saveMany()` on `KyselyCatalogRepository` still throws** ("not yet available") — task 6.1/6.2 is where it finally gets implemented (extend `kysely-catalog.repository.spec.ts`, then implement). It must accept and propagate `tx` the same way every other repository method already does (`this.executor(tx)`).
- **`aplicarPorcentaje()` is already fully implemented and unit-tested** (PR3a, `provider-catalog-item.entity.ts`) — scales both `precioBase`/`precioMaximo` by the same factor, rejects `porcentaje <= -100` before any computation, preserves the invariant by construction for any `porcentaje > -100`. PR6's use case calls it per item; no entity-level work should be needed here.
- **`PorcentajeInvalidoError` does not exist yet** (task 6.3) — append it to `domain/catalogo.errors.ts` (never edited destructively). Note: `aplicarPorcentaje()` itself already throws `PrecioInvalidoError` for the `porcentaje <= -100` case (PR3a's own choice, made before `PorcentajeInvalidoError` existed) — decide in PR6 whether `PorcentajeInvalidoError` is a NEW class the use case throws for a DIFFERENT validation (e.g. rejecting a non-numeric/out-of-a-different-range `porcentaje` before ever calling the entity), or whether task 6.3's intent was actually superseded by PR3a's choice to reuse `PrecioInvalidoError`. This is exactly the kind of "PR3a made a call before PR6 existed" question this file exists to surface — don't silently assume either interpretation; check `tasks.md` task 6.4's exact wording ("porcentaje <= -100 rejected before any repo call") against what `aplicarPorcentaje()` already does before deciding whether `PorcentajeInvalidoError` needs to exist at all, or needs a `catalogo-exception.filter.ts` entry, or both.
- **`PreciosCategoriaAjustados` event shape**: task 6.6 specifies `{companyId, categoria, porcentaje, totalActualizados}` (D6) — richer than `ProductoAgregado`/`PrecioActualizado`/`CatalogoCargaMasivaCompletada`'s minimal shapes. Follow `tasks.md`'s literal field list, not the minimal-shape precedent those 3 other events set (they were minimal by their OWN choice, not a repo-wide convention).
- **Cross-tenant isolation for a category adjustment** is proven differently than R1's cross-tenant 404 (PR4a/4b): `ajustarPreciosPorCategoria` operates on `findByCompanyAndCategoria(companyId, categoria)` — a query already scoped to the caller's own company, so there's no `itemId` to leak via enumeration. Task 6.8's e2e "cross-company isolation" scenario should assert company B's items in the same `categoria` are simply never touched (not present in the `saveMany` call), not a 404-vs-403 split.

## Orchestrator fix-forward (post-PR5b, before PR6): 413 vs 400 for oversized uploads

PR5b's own risk report flagged that `FileInterceptor`'s `limits.fileSize` (set to `CARGA_MASIVA_MAX_BYTES`) intercepts an oversized upload BEFORE `parseArchivoCarga` ever runs, producing Nest's native `413 PayloadTooLargeException` — not this domain's `400 ARCHIVO_CARGA_INVALIDO` — and correctly refused to decide this unilaterally. The controller's own `@ApiBadRequestResponse` doc comment claimed "tamaño" (size) was part of the 400 set, which was inaccurate.

**Orchestrator decision**: keep the Multer-level `fileSize` limit (413) rather than removing it to force a uniform 400. Reasoning: Multer's limit rejects the upload during streaming, before the file is buffered into memory; removing it would mean an oversized file gets fully buffered before `parseArchivoCarga`'s own size check ever runs — strictly worse for memory-exhaustion resistance under an oversized-upload attack. 413 is also the more semantically correct HTTP status for "payload too large" than folding it into a generic 400. Fixed the controller's Swagger docs (`@ApiBadRequestResponse` description corrected, new `@ApiPayloadTooLargeResponse` added) to describe both codes accurately instead of the misleading single 400 claim. No e2e test added for the 413 path — it's NestJS/Multer's own framework-guaranteed behavior, not custom application logic, so the risk of it silently regressing is low; if a future batch wants explicit e2e proof, it's a straightforward multipart-body-size test.

**For Phase 9 closure**: this 413/400 split should be named explicitly in `catalogo/SPEC.md`'s delta list (task 9.1) alongside the other declared deltas — it's a real HTTP contract detail no spec.md scenario currently pins.

Verified: `pnpm lint && pnpm typecheck && pnpm format:check` all green after this fix (not re-run via full `pnpm test`, since no test files changed — only Swagger decorator metadata on an existing route).

---

## PR6 · Phase 6: Category adjustment — Spec: `core-api-catalogo`

**Status**: done. This is the batch that resolves the `PorcentajeInvalidoError` open question named explicitly in "What PR6 Needs to Know" above, and the first use case in this domain to wrap `runInTransaction`.

| # | Task | Status |
|---|---|---|
| 6.1 | RED: extend `kysely-catalog.repository.spec.ts` — `saveMany()` writes all items, propagates `tx` | [x] Done |
| 6.2 | GREEN: implement `saveMany()` on `KyselyCatalogRepository` | [x] Done |
| 6.3 | `domain/catalogo.errors.ts`: append `PorcentajeInvalidoError` | [x] Done |
| 6.4 | RED: `ports-in/ajustar-precios-por-categoria.use-case.spec.ts` — 8 tests | [x] Done |
| 6.5 | GREEN: `ports-in/ajustar-precios-por-categoria.use-case.ts` | [x] Done |
| 6.6 | `events/precios-categoria-ajustados.event.ts` | [x] Done |
| 6.7 | `adapters/http/dto/ajustar-precios.dto.ts` + controller route | [x] Done |
| 6.8 | E2e: `test/catalogo-ajustes-precio.e2e-spec.ts` — 7 tests | [x] Done |
| 6.9 | `catalogo.module.ts`: register `AjustarPreciosPorCategoriaUseCase` | [x] Done |

### The `PorcentajeInvalidoError` decision (this PR's central claim, stated explicitly for review — the exact open question the batch instructions required be resolved, not silently papered over)

**The question, restated precisely**: `provider-catalog-item.entity.ts`'s `aplicarPorcentaje()` (PR 3a, already implemented and tested) already throws `PrecioInvalidoError` when `porcentaje <= -100` — a choice made before `PorcentajeInvalidoError` existed as a concept. Does `PorcentajeInvalidoError` need to exist at all?

**Decision: YES, it needs to exist — option (b) from the batch instructions, but with the "genuinely different validation" more precisely characterized than the instructions' own example ("non-numeric/NaN porcentaje caught at the DTO layer").** That specific example does NOT hold up under inspection: a non-numeric `porcentaje` in the request body is already rejected by Nest's global `ValidationPipe` (`@IsNumber()` on `AjustarPreciosDto`) BEFORE the controller method — let alone the use case — ever runs, so it would never reach a domain error class at all. The REAL genuinely-different validation is not about the TYPE of `porcentaje`, but about WHEN the identical `porcentaje <= -100` numeric check must run:

1. **`spec.md`'s exact scenario wording, checked as instructed** ("porcentaje <= -100 is rejected before touching the database" — `specs/core-api-catalogo/spec.md` lines 137-141, 129): *"It MUST reject `porcentaje <= -100` as a validation error before any repository read/write"* and the scenario itself: *"a validation error is raised, **no repository call is made**, and no item is modified."* This is explicitly READ **and** WRITE — not just "before the write."
2. **`aplicarPorcentaje()`'s existing guard cannot satisfy that**, structurally, for two independent reasons:
   - It only runs INSIDE the per-item `.map()`, which happens strictly AFTER `findByCompanyAndCategoria` (a repository READ) has already executed inside the transaction. By the time the entity could throw, the SELECT has already run — violating "no repository call is made."
   - If ZERO items match the given `categoria`, the `.map()` never runs at all — an invalid `porcentaje` would be silently accepted end-to-end (the SELECT still ran, `saveMany([])` no-ops, one `PreciosCategoriaAjustados` with `totalActualizados: 0` gets published as if it were a legitimate empty adjustment). This is worse than a slow rejection — it's a SILENT non-rejection for a real subset of calls.
3. **Task 6.4's own literal wording confirms this**: "`porcentaje <= -100` rejected before any repo call ('rejected before touching the database')" — read together with 6.5's "wraps `findByCompanyAndCategoria` + `saveMany` in `TransactionManager.runInTransaction`", the ordering required is: validate → THEN open the transaction → THEN read → THEN write. Relying on the entity's per-item guard alone would invert that: open transaction → read → (maybe) validate.
4. **design.md's own HTTP error table settles it independently**: `PorcentajeInvalidoError` → 400 `PORCENTAJE_INVALIDO` is listed as a DISTINCT row from `PrecioInvalidoError` → 400 `PRECIO_INVALIDO` (design.md "Errores de dominio" table, line 565) — two different `code` values for two different classes is a real product/API contract, not decorative. `catalogo-exception.filter.ts`'s own doc comment, written during PR5b (before this batch existed), already named this exact class as a "Phase 6" one-line append — independent confirmation the class was always meant to be created, not merged into `PrecioInvalidoError`.

**Resolution implemented**: `PorcentajeInvalidoError` is a new class (`domain/catalogo.errors.ts`), thrown by `AjustarPreciosPorCategoriaUseCase.execute()` itself — a synchronous up-front gate, checked AFTER the `EmpresaNoActivaError`/D-E gate but BEFORE `transactionManager.runInTransaction(...)` is ever called. `aplicarPorcentaje()`'s existing `PrecioInvalidoError` guard (PR 3a) is left completely unchanged — it is not reachable via this use case's call path (the use-case gate always fires first for any `porcentaje <= -100`), but it remains correct, still tested, and still the right defense-in-depth for any other/future direct caller of the entity function. Nothing in PR 3a was touched.

### How the transaction works (this PR's other central claim — first `runInTransaction` in this domain)

design.md's "Mapa de transacciones" names `ajustarPreciosPorCategoria` as the deliberate CONTRAST to `cargarCatalogoMasivo` (PR 5b, D2: never even injects `TRANSACTION_MANAGER`): `Promise<void>` has no channel to report a partial application, so an interrupted adjustment would be a silent, uncorrectable price disaster — the reason atomicity is required here and structurally forbidden there. Flow, in order:

1. `companyStatus !== 'activo'` → `EmpresaNoActivaError` (D-E, before anything else).
2. `porcentaje <= -100` → `PorcentajeInvalidoError` (this PR's new gate, before anything else — see above).
3. `transactionManager.runInTransaction(async (tx) => { ... })`:
   - `findByCompanyAndCategoria(companyId, categoria, tx)` — the read, scoped to the caller's own company and the given category (PR 3b's existing method, unmodified).
   - `items.map((item) => aplicarPorcentaje(item, porcentaje))` — PR 3a's existing entity function, unmodified, called once per item; preserves `precioMaximo >= precioBase` by construction.
   - `saveMany(ajustados, tx)` — this PR's new `KyselyCatalogRepository.saveMany()`, implemented as a loop over the already-tested `save()` (design.md's own explicit permission: "el puerto ya nace con forma de lote... migrar el loop del adaptador... después no toca ni el caso de uso ni sus tests").
   - Returns `ajustados.length` as `totalActualizados`.
4. `eventPublisher.publish(new PreciosCategoriaAjustados(...))` — AFTER the transaction commits, exactly once, regardless of match count (including 0).

### TDD Cycle Evidence (PR6)

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 6.1/6.2 (`saveMany()`) | Extended `kysely-catalog.repository.spec.ts` with a new describe block (3 tests: `save()` called once per item with the SAME `tx` forwarded to every call via `jest.spyOn(repo, 'save')`; works with no `tx`; empty list calls `save()` zero times) against the still-throwing placeholder `saveMany()` → ran `pnpm exec jest --testPathPatterns=kysely-catalog.repository` → **failed** (3 failures, each `KyselyCatalogRepository.saveMany(...) is implemented in PR 6 ... not yet available`) | Replaced the placeholder throw with a loop calling `this.save(item, tx)` per item, reusing the already-tested D-C bifurcation instead of reimplementing it → re-ran → **14/14 passed** (11 pre-existing + 3 new) | None needed |
| 6.4/6.5 (`AjustarPreciosPorCategoriaUseCase`) | Wrote `ajustar-precios-por-categoria.use-case.spec.ts` (8 tests: `EmpresaNoActivaError` gate closes before the transaction/repo/publisher are touched; `porcentaje === -100` AND `porcentaje === -150` both rejected with `PorcentajeInvalidoError` before `runInTransaction` is ever called — the test that structurally proves the "no repository call is made" requirement; happy path 1000/1500 @ 10% → 1100/1650 exact numbers; `tx` propagated identically to both `findByCompanyAndCategoria` and `saveMany`; `companyId`/`categoria` params passed through unmodified; exactly one `PreciosCategoriaAjustados` for 0 matches and for 40 matches) against a not-yet-existing `./ajustar-precios-por-categoria.use-case` → ran → **failed** (`Cannot find module`) | Created `ajustar-precios-por-categoria.use-case.ts` (D-E gate → `PorcentajeInvalidoError` gate → `runInTransaction{find→map(aplicarPorcentaje)→saveMany}` → publish after commit) → re-ran → **8/8 passed, first attempt** | None needed |
| 6.6/6.7/6.9 (event, DTO, controller route, module wiring) | No dedicated RED test — same precedent as every prior batch's plain (non-RED/GREEN-labeled) wiring tasks (`tasks.md` doesn't label 6.6/6.7/6.9 RED/GREEN) | Implemented directly; correctness proven by `pnpm typecheck` (compiles against the real use-case signature) + the e2e suite (6.8) exercising the real route | None needed |
| 6.3 (`PorcentajeInvalidoError`) + `catalogo-exception.filter.ts` mapping | Extended `catalogo-exception.filter.spec.ts` with 1 new `describe.each` case FIRST, then reproduced genuine RED via `git stash push` on JUST the (already-drafted) filter implementation file → ran → **1 failed** (`Received: 500`) / 5 pre-existing passed | `git stash pop` to restore the drafted `ERROR_STATUS_MAP`/`@Catch()` additions → re-ran → **6/6 passed** | None needed — same honest-RED technique PR5b used for its own filter additions |
| 6.8 (e2e) | No RED-first ordering — same precedent as every prior e2e task in this change | Wrote `test/catalogo-ajustes-precio.e2e-spec.ts` (7 tests: exact 1000/1500→1100/1650 scaling + 204 + event assertion; `porcentaje <= -100` → 400 `PORCENTAJE_INVALIDO` before any repo call; cross-company isolation asserted via the mocked `saveMany` call contents, not a 404/403 split — per this file's own note that `findByCompanyAndCategoria` is already company-scoped, so there's no `itemId` to enumerate; missing `categoria` → 400; suspended company → 403; non-provider role → 403; unauthenticated → 401) after the use case/DTO/controller/module/filter were all in place → ran once → **7/7 passed on the first run** | N/A |

### Commands Run (PR6 batch)

| Command | Result |
|---|---|
| `pnpm exec jest --testPathPatterns=kysely-catalog.repository` (RED, before `saveMany()` impl) | 3 failed / 11 passed |
| `pnpm exec jest --testPathPatterns=kysely-catalog.repository` (GREEN) | 14/14 passed |
| `pnpm exec jest --testPathPatterns=ajustar-precios-por-categoria` (RED, before the use case existed) | Suite failed to run — module not found |
| `pnpm exec jest --testPathPatterns=ajustar-precios-por-categoria` (GREEN) | 8/8 passed, first attempt |
| `pnpm --filter core-api exec tsc --noEmit -p tsconfig.build.json` (mid-batch, after the use case existed) | Clean |
| `git stash push` (filter implementation only) + `pnpm exec jest --testPathPatterns=catalogo-exception.filter` (RED) | 1 failed (`Received: 500`) / 5 passed |
| `git stash pop` + `pnpm exec jest --testPathPatterns=catalogo-exception.filter` (GREEN) | 6/6 passed |
| `pnpm exec jest --config ./test/jest-e2e.json --testPathPatterns=catalogo-ajustes-precio` | 7/7 passed, first run |
| `pnpm lint` (root) | Clean (only the pre-existing unrelated Node engine version WARN) |
| `pnpm typecheck` (root) | Clean — `packages/types` + `services/core-api` both `Done` |
| `pnpm test` (root — unit + e2e) | `core-api`: 31 suites / **214** unit tests passed (was 203 before this batch — +11: 3 `saveMany` + 8 use-case), 7 suites / **45** e2e tests passed (was 38 — +7 new). Zero regressions |
| `pnpm build` | Clean — `services/core-api` `tsc -p tsconfig.build.json` `Done` |
| `pnpm format:check` | Failed once (3 new files not Prettier-formatted: the use case, its spec, and the e2e spec) → ran `pnpm exec prettier --write` on all 3 → re-ran `pnpm format:check` → clean |
| Full re-run of `lint`/`typecheck`/`test`/`build`/`format:check` after the Prettier fix | All green again, same counts (214 unit + 45 e2e) |

All 6 gate commands (`lint`, `typecheck`, `test`, `build`, `format:check`, plus the same-batch `git stash`-verified RED for the filter) are green as of the final run.

### Deviations from Design (PR6)

**None from design.md.** The transaction shape, the `saveMany()`-as-a-loop-over-`save()` implementation, the event field list, and the HTTP surface all match design.md verbatim. The `PorcentajeInvalidoError` resolution (above) is not a deviation — it's the explicit resolution of an open question design.md's own error table had already answered (a distinct class was always named), that PR 3a's earlier, narrower context had left ambiguous.

**One scope note, not a deviation**: `AjustarPreciosDto.porcentaje` carries no `@Min()`/lower-bound `class-validator` decorator, matching `ActualizarPrecioDto`'s own established precedent of NOT duplicating a domain business rule at the DTO layer (`ActualizarPrecioDto`'s doc comment: "the cross-field invariant... stays a domain concern, never re-validated here"). This was a deliberate choice, not an oversight — see the DTO's own doc comment.

### Issues Found (PR6)

None blocking. One item worth recording, not a defect: the e2e "cross-company isolation" scenario (task 6.8) cannot literally exercise two companies' data through the mocked `CATALOG_REPOSITORY` the way a real-Postgres integration test could — `findByCompanyAndCategoria` is mocked, so the test instead asserts (a) the use case passes the ACTOR's own `companyId` (never a second one) to the read, and (b) every item in the `saveMany` call carries that same `companyId`. The actual company-scoping guarantee (that a real query never returns another company's rows) is proven at the correct layer: PR 3b's `kysely-catalog.repository.spec.ts` unit tests for `findByCompanyAndCategoria`'s `WHERE company_id = ...` clause. Same "override the port, keep the wiring real" limitation every other e2e spec in this domain already has and documents.

### Workload note (PR6)

Diff came in at roughly 850-950 insertions across 11 files (2 new source files + spec, 1 new event, 1 new DTO, 1 new e2e spec, plus edits to `kysely-catalog.repository.ts`/`.spec.ts`, `catalogo.errors.ts`, `catalogo.controller.ts`, `catalogo-exception.filter.ts`/`.spec.ts`, `catalogo.module.ts`) against the tasks.md estimate of 310-425 for this work unit — over budget, following the exact same pattern named and accepted in every prior batch since PR4a. Breakdown: the two test files carry the bulk (`ajustar-precios-por-categoria.use-case.spec.ts` ~185 lines / 8 tests, `test/catalogo-ajustes-precio.e2e-spec.ts` ~250 lines / 7 tests); the remainder is the use case itself (~90 lines, doc-comment-dense per this codebase's established convention), the `saveMany()` implementation (~15 lines + doc comment), the `PorcentajeInvalidoError` class (~35 lines, doc-comment-heavy specifically because it resolves a named cross-PR ambiguity, per the batch's own explicit instruction to document the reasoning "explicitly, not silently"), the event class, the DTO, the controller route, and the filter/module one-line additions. No task outside 6.1-6.9 was touched. `Chain strategy: stacked-to-main` — committed directly to `main`, same as every PR since PR1.

### Files Changed (PR6)

| File | Action | What Was Done |
|---|---|---|
| `services/core-api/src/domains/catalogo/adapters/persistence/kysely-catalog.repository.spec.ts` | Modified | Replaced the "saveMany throws PR 6" placeholder test with 3 real `saveMany()` tests |
| `services/core-api/src/domains/catalogo/adapters/persistence/kysely-catalog.repository.ts` | Modified | Implemented `saveMany()` as a loop over `save()`; updated the class's own doc comment |
| `services/core-api/src/domains/catalogo/domain/catalogo.errors.ts` | Modified | Appended `PorcentajeInvalidoError` (400 `PORCENTAJE_INVALIDO`), with a doc comment documenting the resolved open question in full |
| `services/core-api/src/domains/catalogo/ports-in/ajustar-precios-por-categoria.use-case.ts` | Created | D-E gate → `PorcentajeInvalidoError` gate → `runInTransaction{findByCompanyAndCategoria→map(aplicarPorcentaje)→saveMany}` → publish after commit |
| `services/core-api/src/domains/catalogo/ports-in/ajustar-precios-por-categoria.use-case.spec.ts` | Created | RED→GREEN, 8 tests |
| `services/core-api/src/domains/catalogo/events/precios-categoria-ajustados.event.ts` | Created | `PreciosCategoriaAjustados` — `{companyId, categoria, porcentaje, totalActualizados}` (D6) |
| `services/core-api/src/domains/catalogo/adapters/http/dto/ajustar-precios.dto.ts` | Created | `categoria`/`porcentaje` fields, no `@Min()` on `porcentaje` (domain concern, not DTO's) |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo.controller.ts` | Modified | Added `POST /catalogo/mi-catalogo/ajustes-de-precio` (204, `@Roles('provider')`) |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo-exception.filter.ts` | Modified | Added `PorcentajeInvalidoError`→400/`PORCENTAJE_INVALIDO` to `@Catch()` + `ERROR_STATUS_MAP` |
| `services/core-api/src/domains/catalogo/adapters/http/catalogo-exception.filter.spec.ts` | Modified | Added 1 `describe.each` case (RED→GREEN, verified via a temporary `git stash` of the implementation) |
| `services/core-api/src/domains/catalogo/catalogo.module.ts` | Modified | Registered `AjustarPreciosPorCategoriaUseCase`; updated the module's own doc comment (`TRANSACTION_MANAGER` is provided by `DatabaseModule`, already imported — no new provider entry needed for it) |
| `services/core-api/test/catalogo-ajustes-precio.e2e-spec.ts` | Created | 7 e2e tests: exact scaling + event, `porcentaje <= -100` → 400, cross-company isolation, missing `categoria` → 400, suspended company → 403, non-provider role → 403, unauthenticated → 401 |
| `openspec/changes/backend-core-api-catalogo/tasks.md` | Modified | Marked tasks 6.1–6.9 `[x]` with the `PorcentajeInvalidoError` resolution noted inline on 6.3 |
| `openspec/changes/backend-core-api-catalogo/apply-progress.md` | Modified | Merged PR6 section into PR1+PR2+PR3a+PR3b+PR4a+PR4b+PR5a+PR5b's file (this file) |

### Commit (PR6)

One commit for this PR6 batch:

```
feat(core-api): add ajustarPreciosPorCategoria with transactional saveMany
```

Working tree was clean before this batch except the same pre-existing untracked `openspec/changes/backend-core-api-catalogo/{design.md,exploration.md,proposal.md,specs/}` noted since PR2 — left untouched/untracked, out of this batch's scope; commit hash recorded in the return envelope to the orchestrator.

---

## What PR7 (next batch) Needs to Know

- **Start here**: `## Phase 7: identidad reactivarEmpresa` in `tasks.md` (tasks 7.1–7.10). Independent of PRs 3-6 — it operates entirely inside `domains/identidad/`, mirroring `suspenderEmpresa`. Must land before Phase 8a (the visibility listener needs `EmpresaReactivada` to exist).
- **This PR does NOT touch `domains/catalogo/` at all** — it's the one phase in this 13-PR chain scoped entirely to `identidad`. Do not carry forward any catalogo-specific pattern (D-E gates, `tx?` on ports-out, etc.) into identidad without first checking `identidad`'s OWN existing conventions — `suspender-empresa.use-case.ts` (read this batch, `services/core-api/src/domains/identidad/ports-in/suspender-empresa.use-case.ts`) is the exact mirror target named by task 7.2, and it already establishes the pattern: `runInTransaction{findById→save→auditLogPort.record}`, `publish` AFTER commit, 4 constructor-injected ports (`CompanyRepository`, `AuditLogPort`, `EventPublisher`, `TransactionManager`).
- **`CompanyNotSuspendedError` does not exist yet** (task 7.4) — append it to `domains/identidad/domain/identidad.errors.ts` (never edited destructively, same convention as `catalogo.errors.ts`). `CompanyNotFoundError` already exists (used by `suspenderEmpresa` today).
- **`ReactivacionDto` is a NEW DTO** (task 7.5), not a reuse of `SuspensionDto` — per D-D's naming-collision rationale (both would otherwise have one `motivo` field, but coupling the reactivation route's DTO to the suspension route's DTO would make the two routes' bodies accidentally interchangeable/coupled at the type level for no real reason).
- **`identidad-exception.filter.ts`'s `ERROR_STATUS_MAP`** needs one new entry: `CompanyNotSuspendedError` → 409 `COMPANY_NOT_SUSPENDED` (task 7.6) — a NEW status code for this domain's filter (404/403/400/503 already exist for other classes; 409 Conflict is the correct semantic for "the company isn't in the state this operation requires").
- **Route**: `POST /identidad/empresas/:id/reactivacion`, `@AdminRoles('super_admin','soporte')`, 204 (task 7.7) — mirrors `suspender-empresa`'s existing route shape one level up (admin-only, not `@Roles('provider')` — this is an identidad admin action, not a catalogo provider action).
- **Task 7.10 is a full regression gate, not just a unit for this PR**: run the FULL existing `identidad` suite (111 unit + 17 e2e, per this task's own text) and confirm zero regressions — no existing identidad use case's signature or behavior may change as a side effect of adding `reactivarEmpresa`. Treat this as a hard gate before considering PR7 done, not an optional nice-to-have.
- **`catalogo`'s own full suite (214 unit + 45 e2e as of PR6) should also stay green** — PR7 shouldn't touch catalogo at all, so this is a trivial check, but confirm it explicitly rather than assuming.
