# Apply Progress: `backend-core-api-catalogo`

**Artifact store**: hybrid (this file + Engram `sdd/backend-core-api-catalogo/apply-progress`)
**Strict TDD Mode**: active (`test_command: pnpm test`)
**Last updated**: 2026-08-05T15:41:33Z — PR1 batch (first batch, no prior progress existed)

## Status: 7/7 tasks complete for PR1 (Phase 1: DB foundation). 0/~90 tasks complete overall across all 13 planned PRs.

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

## What PR2 (next batch) Needs to Know

- **Start here**: `## Phase 2: Seams` in `tasks.md` (tasks 2.1–2.7) — `packages/types/src/catalogo.ts` additions, `contracts/catalog-query.port.ts` (moved from `ports-out/`), extended `CatalogRepository` port, new `CatalogVisibilityProjection` port.
- **Do NOT touch** `catalogo.module.ts` or anything under `domains/catalogo/{domain,ports-in,ports-out,contracts,adapters}/` was explicitly out of scope for PR1 and untouched — confirmed via `git status`, nothing under `services/core-api/src/domains/catalogo/` appears in this batch's diff.
- **Row types are ready**: `DB['catalog_products']`, `DB['provider_catalog']`, `DB['catalog_hidden_companies']` all exist and typecheck. `precio_base`/`precio_maximo` are `string` — any PR2+ code that does arithmetic on them (the entity's `crear()`/`actualizarPrecio()`/`aplicarPorcentaje()` in Phase 3a) must convert via `Number(...)` in the persistence adapter's mapper, never compare/operate on the raw row string, per design.md D-C.
- **Pool timeouts are live process-wide now** (`connectionTimeoutMillis: 2000`, `statement_timeout: 5000` via `-c` option) — this already affects `identidad`'s existing queries too, not just future `catalogo` code. All 112 unit + 17 e2e + 10 opt-in-integration tests passed with this change in place, so no existing code path depends on the old "wait forever" defaults.
- **Migration timestamp window used**: `20260805120000`/`20260805120100` (own window, does not collide with `20260803120000-...0800` or `20260804090000`/`20260804090500`). PR2 introduces no new migrations (per design.md's 9-PR sequence, migrations only land in PR1), so this is informational only, not a constraint PR2 needs to extend.
- **The opt-in integration test's cleanup gap** (no DELETE grant, so tests rely on fresh random identities rather than teardown) is a pattern PR2+ opt-in integration tests should probably follow too, if any are added — flagging so it's a deliberate choice repeated, not silently copied.
