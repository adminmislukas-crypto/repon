# Apply Progress: `backend-core-api-catalogo`

**Artifact store**: hybrid (this file + Engram `sdd/backend-core-api-catalogo/apply-progress`)
**Strict TDD Mode**: active (`test_command: pnpm test`)
**Last updated**: 2026-08-05T18:10:00Z — PR3a batch (merged with PR1+PR2; both unchanged below)

## Status: 7/7 tasks complete for PR1 (Phase 1: DB foundation). 7/7 tasks complete for PR2 (Phase 2: Seams). 3/3 tasks complete for PR3a (Phase 3a: Read side — domain entity + invariant). 17/~90 tasks complete overall across all 13 planned PRs.

**Engram note**: no `mem_*` tools were exposed in this batch's tool set either (same as PR1/PR2) — this file remains the authoritative record. If Engram becomes available in a later batch, the topic key to upsert is `sdd/backend-core-api-catalogo/apply-progress`, content = this full file merged.

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

## What PR4a (next batch) Needs to Know

(Superseded PR3b handoff notes below, kept for the entity/port background — PR3b itself is now done, see section above.)

- **Start here**: `## Phase 4a: Unit writes — use cases + repository save()` in `tasks.md` (tasks 4a.1–4a.8). Depends on PR3a's entity and PR3b's repository (both done).
- **The entity is functional, not class-based**: `crear(input: CrearProviderCatalogItemInput): ProviderCatalogItem`, `actualizarPrecio(item, precioBase, precioMaximo): ProviderCatalogItem`, `aplicarPorcentaje(item, porcentaje): ProviderCatalogItem` — all pure, all return NEW objects, none mutate their input. Import from `domains/catalogo/domain/provider-catalog-item.entity.ts`.
- **`crear()` does NOT validate nombre/categoria non-empty, finite prices, or stock >= 0 integer** — deferred to the DTO/type layer per `shared-types-package`'s own doc comment on `NuevoProductoProveedor` (PR2). This is PR4a/4b's use case + DTO validation to add, not the entity's.
- **`PrecioInvalidoError` lives in `domain/catalogo.errors.ts`** — append to this file, do not create a second errors file. PR4a adds `CatalogItemNotFoundError`, `EmpresaNoActivaError` here.
- **`CatalogRepository.save()` currently THROWS a named "not implemented, see PR4a" error** — task 4a.6/4a.7 (RED/GREEN on `save()`) replaces that throw with the real D-C upsert-bifurcation implementation (branch on `catalogProductId` presence, matching PR1's two partial unique indexes). `saveMany()` still throws until PR6 — do not implement it in PR4a.
- **`mapProviderCatalogRow` is exported from `kysely-catalog.repository.ts`** — reuse it for `save()`'s reverse (entity→row) mapping if needed, or add a symmetric `toProviderCatalogRow` next to it; don't re-derive the column mapping from scratch.
- **`contracts/catalog-query.port.ts` and `KyselyCatalogQueryAdapter` are done and verified (PR2/PR3b)** — not touched by PR4a.
- **`CatalogProductRepository`/`KyselyCatalogProductRepository` are done and verified (PR3b, gap-fill not in original design.md)** — powers `buscarProductos` only; irrelevant to PR4a's mutating use cases.
- **`CatalogVisibilityProjection` port exists but has zero implementation and zero consumers until PR8a.**
- **`catalogo.module.ts` now binds real providers** (`CATALOG_REPOSITORY`→`KyselyCatalogRepository`, `CATALOG_QUERY_PORT`→`KyselyCatalogQueryAdapter`, plus `BuscarProductosUseCase` + controller, `exports: [CATALOG_QUERY_PORT]`) — PR4a appends `CargarProductoCatalogoUseCase`/`ActualizarPrecioUseCase` registrations in its own task 4b (module wiring is actually task 4b.7 per `tasks.md`, not 4a — the use cases are registered together with their controller routes).
- **ESLint zone verification method for future contracts/-adjacent work**: if a later PR needs to re-verify the boundary rule, the fastest check is a small Node script that imports `eslint.config.js` directly and inspects `buildCrossDomainZones()`'s output (used for task 2.7) — faster than writing a throwaway cross-domain import just to watch ESLint reject it, though that manual-violation approach also works and is more "black box."
