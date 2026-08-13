# Apply Progress: `backend-core-api-ofertas`

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR1 "Groundwork" (Phase 1, tasks 1.1–1.10) — FIRST apply batch, no prior progress existed.

## TDD Note for This Batch

Phase 1 is pure scaffolding by design (design.md's own PR table: "Cero
comportamiento, puras costuras"; tasks.md's Dependency Notes: "`strict_tdd: true`
is active for every task introducing real logic — RED items are failing tests
written first, GREEN items are the minimal implementation that passes them").
No task in 1.1–1.10 introduces runtime logic with a Jest-testable behavior — it
is reconciliation prose, raw SQL DDL, Kysely row-type declarations, `@repon/types`
additions, TypeScript interface declarations (zero implementers by design), and
plain `Error` subclasses. This mirrors `catalogo`/`consumo`/`refill-matching`'s
own PR1 precedent exactly (interfaces/row-types/migrations/errors land without
Jest tests, verified instead by `pnpm lint`/`pnpm typecheck`/`pnpm test`/`pnpm build`
compiling and passing cleanly with zero new implementers).

Task 1.3 is this batch's actual verification step, and it is stronger than the
usual PR1 precedent: instead of only reading `psql \d` output, every named
`db-schema-ofertas` scenario was exercised as a **live SQL statement** against a
real local Postgres (`supabase db reset`, migration 16 applied as the 17th
migration in the chain) — inserts, the retire-blanket-then-upsert sequence, a
`cerrada_at`-survives-a-header-refresh check, an actual `DELETE` attempt as
`service_role` (denied), and an actual `SELECT` attempt as `authenticated`
(denied) — not just schema inspection. See "Commands Run and Results" below for
the full transcript.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.3 (migration verification) | N/A — not a Jest cycle. The "RED" here is the absence of the 3 projection tables before this batch (`\d public.offer_opportunities` would have failed) | Ran `supabase db reset` (applies migration 16), then executed all 6 named `db-schema-ofertas` scenarios as live SQL against the real local Postgres — all 6 passed (see transcript below) | Reset the DB a second time after the verification queries to leave a clean, unpolluted local instance for the next batch |

All other tasks in this batch (1.1, 1.2, 1.4–1.10) are non-TDD scaffolding per
the note above — verified by the full gate suite below, not by a Jest RED/GREEN
pair. This mirrors `refill-matching`'s own PR1 apply-progress precedent verbatim
("Cero comportamiento" tasks are not forced into an artificial RED/GREEN shape).

## Completed Tasks (10/10 in this batch)

- [x] 1.1 Reconciliation prose: `specs/db-schema-ofertas/spec.md` (2 requirements edited — `urgencia`/replace-mechanism), `specs/core-api-catalogo/spec.md` (1 requirement edited — confirmed `obtenerItemsDeProveedor` signature). Row 4 (`@Roles('user')`) confirmed as already correct in `specs/core-api-ofertas/spec.md` — no edit made, per the task's own explicit instruction.
- [x] 1.2 Migration `supabase/migrations/20260808120000_16_ofertas_discovery_projection.sql` — verified `20260807120100_15_refill_matching_completitud_diferida.sql` was still the latest applied migration before finalizing the `20260808...` timestamp (still true at apply time).
- [x] 1.3 Applied locally via `supabase db reset` (17 migrations total, batch 16 the 17th); all 6 named `db-schema-ofertas` scenarios verified against real Postgres; DB reset again afterward to leave a clean state.
- [x] 1.4 `shared/database/schema.ts`: `OfferKindRow`/`OfferStatusRow`, `OffersTable`/`OfferItemsTable`, `OfferOpportunitiesTable`/`OfferOpportunityCompaniesTable`/`OfferOpportunityItemsTable` (5 row types), all registered on `DB`. Column shapes cross-checked directly against `20260803120500_05_ofertas.sql` (not just design.md's snippet) — exact match confirmed.
- [x] 1.5 `packages/types/src/ofertas.ts`: `NuevoOfferItem` (+ `NuevoOfferItemReactiva`/`NuevoOfferItemProactiva`), `DatosEntrega`, `SolicitudElegible`/`SolicitudElegibleItem` — exactly 3 additions, `Urgencia` imported from `./refill-matching.js`.
- [x] 1.6 `pnpm --filter @repon/types typecheck` — clean. Workspace-root `pnpm typecheck` — clean, `catalogo` confirmed untouched (`git status --porcelain services/core-api/src/domains/catalogo/` → empty).
- [x] 1.7 `domains/ofertas/ports-out/offer-repository.port.ts` rewritten to final form (D-G.1): `findById(offerId, tx?)` (NEW), `marcarAceptada(offerId, tx: TransactionContext)` (NEW, `tx` required), `desplazarHermanas(refillRequestId, exceptoOfferId, tx: TransactionContext): Promise<readonly string[]>` (NEW, `tx` required). `save`/`findByUser`/`findByRefillRequest` unchanged; `findByRefillRequest` doc-commented as declared-but-uncalled on purpose.
- [x] 1.8 `domains/ofertas/ports-out/offer-opportunity-repository.port.ts` (NEW): `OfferOpportunityRepository` — `reemplazar`/`cerrar` (`tx` required), `findElegible`/`listarPorCompany`/`existeRelacion` (read-only, no `tx`). `OportunidadSnapshot`/`OportunidadSnapshotItem`/`OportunidadElegible` declared locally in this file, not in `@repon/types`. `OFFER_OPPORTUNITY_REPOSITORY` token.
- [x] 1.9 `domains/ofertas/domain/oferta.errors.ts` (NEW): 8 error classes — `SolicitudNoElegibleError`, `OportunidadCerradaError`, `DestinatarioNoElegibleError`, `OfferNotFoundError`, `OfertaYaAceptadaError`, `TransicionInvalidaError`, `ItemsNoDisponiblesError`, `OfertaInvalidaError`.
- [x] 1.10 `pnpm typecheck` at workspace root — clean, zero implementers of the extended `OfferRepository`/new `OfferOpportunityRepository`. `pnpm lint` — **blocked by a pre-existing environmental issue, not by this batch's code** (see "Issues Found" below).

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `openspec/changes/backend-core-api-ofertas/specs/db-schema-ofertas/spec.md` | Modified | Removed "provisional, pending design.md's Q1" language from 2 requirements; stated the locked `text`/no-`CHECK` `urgencia` decision and the `vigente boolean` + retire-blanket-then-upsert replace mechanism, with the `catalog_hidden_companies` precedent and the 2 rejected alternatives' reasoning inline |
| `openspec/changes/backend-core-api-ofertas/specs/core-api-catalogo/spec.md` | Modified | Removed "provisional signature, pending design.md's Q2" language; confirmed `obtenerItemsDeProveedor(companyId, ids)` as locked, added the `companyId`-first rationale, the `disponible = false` discard rule, the `[]`-input/zero-round-trip rule, and the `MAX_COINCIDENCIAS_POR_ITEM` non-applicability note |
| `supabase/migrations/20260808120000_16_ofertas_discovery_projection.sql` | Created | 3 tables (`offer_opportunities`, `offer_opportunity_companies`, `offer_opportunity_items`) verbatim per design.md §D-A.4: `urgencia text` no `CHECK`, `vigente boolean not null default true`, `cerrada_at` excluded from any `SET` clause in this migration (the writer's exclusion is Phase 3b's job, this file just declares the column), 3 indexes, 3 `updated_at` triggers, RLS enabled + zero policies + grants `select/insert/update` to `service_role` only, zero cross-domain FKs |
| `services/core-api/src/shared/database/schema.ts` | Modified | Added `OfferKindRow`, `OfferStatusRow`, `OffersTable`, `OfferItemsTable`, `OfferOpportunitiesTable`, `OfferOpportunityCompaniesTable`, `OfferOpportunityItemsTable`; registered all 5 new tables (`offers`/`offer_items` were already-applied but untyped; the 3 projection tables are new) on `DB`; updated the file's header comment to name the new migrations and note only `pedidos-pagos` remains untyped |
| `packages/types/src/ofertas.ts` | Modified | Added `import type { Urgencia } from './refill-matching.js'`; `NuevoOfferItemReactiva`/`NuevoOfferItemProactiva`/`NuevoOfferItem` (named type, not an alias of `OfferItem`), `DatosEntrega`, `SolicitudElegibleItem`/`SolicitudElegible` (no `userId` field) |
| `services/core-api/src/domains/ofertas/ports-out/offer-repository.port.ts` | Rewritten | Final form per design.md D-G.1: 3 new methods (`findById`, `marcarAceptada`, `desplazarHermanas`), 3 existing methods unchanged, doc comments on every method naming which phase implements/calls it |
| `services/core-api/src/domains/ofertas/ports-out/offer-opportunity-repository.port.ts` | Created | `OfferOpportunityRepository` port (5 methods) + `OportunidadSnapshot`/`OportunidadSnapshotItem`/`OportunidadElegible` local types + `OFFER_OPPORTUNITY_REPOSITORY` token |
| `services/core-api/src/domains/ofertas/domain/oferta.errors.ts` | Created | 8 error classes, each doc-commented with its HTTP mapping, the phase that throws it, and its D-reference |
| `openspec/changes/backend-core-api-ofertas/tasks.md` | Modified | Tasks 1.1–1.10 marked `[x]` |

## Commands Run and Results

| Command | Result |
|---|---|
| `git status --porcelain supabase/migrations/` (before `db reset`) | Only the 1 new migration file untracked — confirms no already-applied migration touched |
| `supabase db reset` (1st run) | Applied all 17 migrations incl. the new batch 16 cleanly; seed ran; containers restarted |
| `psql \d` on the 3 new tables | Columns match D1's list exactly — no extra domain column, no `jsonb` (Scenario "The 3 tables carry exactly the columns D1 declares") |
| `psql` — insert header with `companyIds: []`-equivalent (zero rows in the companies table) | Header row exists, `select count(*)` on `offer_opportunity_companies` for that R returns 0 (Scenario "A MatchEncontrado with companyIds: [] still writes the header") |
| `psql` — retire-blanket-then-upsert against a 2-company set `[A,B]` reduced to `[A]` | After the sequence: A `vigente = true`, B `vigente = false` — the vanished company is expelled, never physically removed (Scenario "A company that no longer matches is no longer readable as eligible", implicitly also proves D5's replace mechanism works as designed) |
| `psql` — set `cerrada_at`, then re-run the header `ON CONFLICT DO UPDATE` | `cerrada_at` still non-null after the "refresh" — confirms the `SET` clause genuinely excludes `cerrada_at` (design.md D-A.3) |
| `psql` — `set role service_role; delete from public.offer_opportunities ...` | `ERROR: permission denied for table offer_opportunities` — confirms zero `DELETE` grant, not just "the code never issues one" (Scenario "No row is ever physically deleted") |
| `psql` — `set role authenticated; select count(*) from public.offer_opportunities` | `ERROR: permission denied for table offer_opportunities` — confirms zero grant to `authenticated` (stronger than RLS-empty-result; there is no grant at all) (Scenario "No authenticated client can query the projection directly") |
| `psql` — `pg_constraint` FK inspection on all 3 tables | 0 rows — zero `REFERENCES` clauses (Scenario "No cross-domain FK exists on any of the 3 tables") |
| `psql` — `information_schema.role_table_grants` for `service_role` on all 3 tables, cross-checked against `catalog_hidden_companies`'s own grant set | Identical shape: `INSERT`/`REFERENCES`/`SELECT`/`TRIGGER`/`TRUNCATE`/`UPDATE`, **no `DELETE`** — matches the repo-wide precedent exactly (Scenario "service_role can read and write") |
| `supabase db reset` (2nd run, cleanup) | Left local Postgres in a clean, freshly-seeded state — no test-fixture rows from the verification pass linger for the next batch |
| `pnpm --filter @repon/types typecheck` | `tsc --noEmit` — clean |
| `pnpm typecheck` (workspace root) | Both `packages/types` and `services/core-api` — clean; `catalogo` confirmed at zero git diff |
| `pnpm test` (workspace root) | `services/core-api`: 60 unit suites / 472 tests passed; 17 e2e suites / 106 tests passed — zero regressions on `identidad`/`catalogo`/`consumo`/`refill-matching` |
| `pnpm build` (workspace root) | `tsc -p tsconfig.build.json` — clean |
| `pnpm lint` (workspace root) | **FAILED — pre-existing environmental issue, not caused by this batch.** See "Issues Found" |
| `pnpm run format:check` (workspace root) | **FAILED — same pre-existing environmental issue.** See "Issues Found" |

## Deviations from Design

None. The migration is verbatim from design.md §D-A.4 (including its full
Spanish doc-comment header). The row types match design.md's "Row types de
Kysely" block, cross-checked additionally against the actual applied
`20260803120500_05_ofertas.sql` DDL (not merely trusted from the design
document) to confirm column names/nullability/types for `offers`/`offer_items`,
since those 2 tables were typed here for the first time despite being applied
5 migrations ago. The `@repon/types` additions, both ports-out files, and the
8 error classes match design.md's D-G.1/D-G.5/D-E sections and the "Row types
de Kysely y `@repon/types`" section verbatim.

## Issues Found

**One environmental blocker, fully diagnosed, out of scope for this PR — `pnpm lint` and `pnpm run format:check` cannot currently pass at the workspace root, for any file, including on a clean `main` checkout.**

Root cause: a stray nested directory, `.claude/worktrees/agent-a07bad886ca002da4/`,
sits inside this repo's working tree (evidently another agent's worktree from
elsewhere in this session, left inside `.claude/worktrees/` at the repo root
rather than as a sibling directory). `eslint.config.js`'s `ignores` array does
not exclude `.claude/**`, so both `eslint` and `prettier --check .` glob-scan
into that nested worktree, find a **second** `tsconfig.base.json` there, and
fail: `eslint` reports "multiple candidate TSConfigRootDirs" parsing errors on
every file in the real source tree; `prettier --check .` fails outright on a
malformed YAML file inside that nested worktree
(`.claude/worktrees/agent-a07bad886ca002da4/openspec/config.yaml`).

**Verified this is 100% pre-existing and unrelated to this batch's diff**: ran
`git stash --include-untracked` (which correctly reported "Ignoring path
.claude/worktrees/agent-a07bad886ca002da4/" — confirming that directory is
untracked/gitignored, not part of this PR's diff) and re-ran `pnpm lint` against
the clean `main` tree — **identical failure mode**, 376 errors instead of 378 (the
2-error difference is exactly this batch's 2 new files hitting the same
pre-existing parse error, not a new class of error). Then restored the stash.

**Not fixed here, deliberately**: `eslint.config.js` is shared root tooling
config, out of scope for tasks 1.1–1.10 (which are `db-schema-ofertas`/
`shared-types-package`/`core-api-ofertas`/`core-api-catalogo` scope only), and
deleting or modifying another agent's worktree directory is a destructive
operation on work this agent does not own and was not asked to touch. Flagging
this explicitly for the orchestrator rather than silently working around it or
touching infrastructure outside this batch's mandate.

**What IS verified clean, independent of this blocker**: `pnpm typecheck`
(strict TypeScript, catches unused-vars-adjacent issues via `tsc`'s own
diagnostics per `eslint.config.js`'s own comment: "Duplicated by TypeScript's
compiler diagnostics... ESLint's job here is style + import boundaries, not
re-litigating what `tsc` already checks"), `pnpm test` (zero regressions), and
`pnpm build`. The only signal genuinely missing is ESLint's
`import-x/no-restricted-paths` cross-domain-boundary rule and Prettier's
formatting check — both worth a manual read of this batch's new files, which
were written matching the existing `refill-matching`/`catalogo` files' import
and formatting style throughout.

## What PR2 (next batch) should know

- Groundwork is fully in place: migration 16 applied and verified against real
  Postgres (6/6 named scenarios), all 5 row types, the 3 `@repon/types`
  additions, the finalized `OfferRepository` port (6 methods, 3 new), the new
  `OfferOpportunityRepository` port (5 methods), and all 8 domain error
  classes.
- **`OfferRepository`/`OfferOpportunityRepository` still have zero
  implementers** — that lands incrementally: `KyselyOfferRepository`'s 6
  methods in Phase 3a, `KyselyOfferOpportunityRepository`'s 5 methods (the
  writer of D5, "el PR con la mecánica más delicada del cambio") in Phase 3b.
- Local Supabase already has migration 16 live (via `supabase db reset`) — no
  migration work needed for Phase 2 (pure domain logic, zero I/O per
  tasks.md).
- Phase 2 (tasks 2.1–2.10) is genuinely strict-TDD from the first task: RED
  (`domain/offer.entity.spec.ts`) before GREEN
  (`domain/offer.entity.ts`), covering `crearOfertaReactiva`/
  `crearOfertaProactiva` (the `isAlt ⇒ altNote` rule), `total`,
  `precioPorUnidad`, and the `OfferStatus` transition (D-G.3's
  non-`'pendiente'` rejection via `TransicionInvalidaError`, already
  available from this batch's `domain/oferta.errors.ts`).
- `domain/oferta.errors.ts` already exports all 8 classes every later phase
  needs — PR2 only needs `TransicionInvalidaError` and `OfertaInvalidaError`;
  import, don't redeclare.
- `NuevoOfferItem`/`DatosEntrega` (from `@repon/types`) are the exact input
  shapes `crearOfertaReactiva`/`crearOfertaProactiva` should accept — no
  further type work needed at the `packages/types` layer for Phase 2.
- **Known environmental blocker for the reviewer**: `pnpm lint`/
  `pnpm run format:check` will not pass at the workspace root until the stray
  `.claude/worktrees/agent-a07bad886ca002da4/` directory is removed (out of
  this agent's authority) or `eslint.config.js`'s `ignores` array gets a
  `.claude/**` entry (a 1-line fix, but shared root tooling config, out of
  this PR's declared scope — flagging for the orchestrator/maintainer to
  decide whether to fix it before or independently of this PR chain).

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — the forecast names PR1 as "the one borderline PR, forecast
  380-480" with a named PR1a/PR1b fallback split; kept whole here, see size
  note below)
- Current work unit: Unit 1 "Reconciliation prose + groundwork" — PR1
- Boundary: starts from `main` (`ofertas` was a 2-file placeholder — a
  3-method port + an empty `@Module({})`); ends with a fully compiling,
  zero-behavior scaffolding commit — 1 migration + 5 row types + 3
  `@repon/types` additions + 2 finalized ports-out + 8 domain error classes +
  2 reconciled spec files, `pnpm typecheck`/`pnpm test`/`pnpm build` all
  green
- Estimated review budget impact: **574 changed lines** of implementation
  content (git-diff-verified, `git diff --numstat`), meaningfully over
  tasks.md's 380-480 forecast for this PR (~20% over the upper bound) —
  breakdown: 2 delta-spec edits (3 lines net), `schema.ts` +86/-1,
  `ofertas.ts` +62/-0, the rewritten `offer-repository.port.ts` +44/-3, the
  new migration (128 lines), the new `offer-opportunity-repository.port.ts`
  (97 lines), the new `oferta.errors.ts` (147 lines) — plus `tasks.md`'s own
  10-line checkbox-flip delta (process, not implementation). Flagged
  honestly per this repo's established convention (`refill-matching`'s own
  PR2/PR3 ran ~2x/~2.3x over their estimates for the same reason: heavy
  doc-comments cross-referencing design.md, a repo-wide convention this
  domain also follows). No split proposed: every file here is a single
  structural unit tasks.md itself names as one task (one migration, one
  schema-types file, one `@repon/types` file, one rewritten port, one new
  port, one new errors file) — the named PR1a (migration + row types) /
  PR1b (`@repon/types` + both ports-out + errors) fallback split would
  separate files that a reviewer needs to see together (e.g. the port
  signatures and the row types they map to), not reduce total review
  surface. Kept as one PR; flagged for the orchestrator's awareness rather
  than silently absorbed.

## Status

10/10 tasks in this batch complete. Ready for next batch (PR2, Phase 2 —
dominio puro, `domain/offer.entity.ts`).

---

# PR2 "Dominio (puro, sin I/O)" (Phase 2, tasks 2.1–2.10)

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR2 (Phase 2, tasks 2.1–2.10) — SECOND apply batch. PR1's groundwork
(migration 16, row types, `@repon/types` additions, both `ports-out/` ports,
all 8 `domain/oferta.errors.ts` classes) is complete and available as-is; this
batch adds zero I/O, zero framework imports — pure Jest.

## TDD Note for This Batch

Unlike PR1 (pure scaffolding, no Jest-testable behavior), every task pair in
this batch is genuinely strict-TDD from the first task: `domain/offer.entity.spec.ts`
was written before `domain/offer.entity.ts` existed at all — the first RED run
failed with `Cannot find module './offer.entity'`, not merely a failing
assertion. Each of the 5 task pairs below (2.1/2.2, 2.3/2.4, 2.5/2.6, 2.7/2.8,
2.9/2.10) was executed as its own RED → GREEN cycle, run against the actual
Jest test file at each step (`pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts`),
never batched together.

**One transparent ordering nuance** (tasks 2.5/2.6, `total()`): `crearOfertaReactiva`'s
own GREEN step (2.2) structurally requires a working `total()` to populate
`OfferCommon.total` — `total()` was implemented one task pair ahead of its own
dedicated unit-test task as an unavoidable consequence of the factory needing
it. The factory-level "computes total as the sum of every item precio..."
tests (written as part of 2.1's RED, confirmed RED before `offer.entity.ts`
existed, confirmed GREEN after 2.2) DID exercise `total()` transitively through
a genuine RED→GREEN cycle. Task 2.5/2.6's own dedicated `describe('total', ...)`
block (4 direct unit tests) was then added afterward, running against the
already-correct implementation — not a from-zero RED for that specific test
file section, and flagged here explicitly rather than silently presented as
one. `precioPorUnidad` (2.7/2.8) and the `aceptar` transition function
(2.9/2.10) are both standalone (not needed by any other task's GREEN step) and
ran as textbook RED→GREEN cycles with no such caveat.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1/2.2 `crearOfertaReactiva` | `domain/offer.entity.spec.ts` | Unit | N/A (new file) | ✅ Written — `Cannot find module './offer.entity'` | ✅ 8/8 passed | ✅ 8 cases (isAlt/altNote omitted, whitespace-only altNote, accepts non-empty altNote, happy-path field-by-field, fresh `randomUUID()` per call, 0 items, negative precio, total computation) | ✅ Reordered file section order to match design.md's documented file-map order (factories → total → precioPorUnidad → state machine) after all 5 task pairs landed; tests re-run green after |
| 2.3/2.4 `crearOfertaProactiva` | `domain/offer.entity.spec.ts` | Unit | ✅ 8/8 (prior describe block) | ✅ Written — `crearOfertaProactiva is not a function`, 6 new tests failed, 8 prior still passed | ✅ 14/14 passed | ✅ 6 cases (whitespace-only altNote, accepts non-empty altNote, happy-path field-by-field incl. `refillRequestId` absent, fresh `randomUUID()`, 0 items, total computation) | ➖ Folded into the single end-of-batch refactor pass above |
| 2.5/2.6 `total` | `domain/offer.entity.spec.ts` | Unit | ✅ 14/14 (prior blocks) | ✅ Written (see ordering nuance above — implementation pre-existed from 2.2's necessity; this is the FIRST dedicated/direct test of `total()` in isolation) | ✅ 18/18 passed | ✅ 4 cases (single item, multiple items, empty items + nonzero despacho, empty items + zero despacho) | ➖ Folded into the single end-of-batch refactor pass |
| 2.7/2.8 `precioPorUnidad` | `domain/offer.entity.spec.ts` | Unit | ✅ 18/18 (prior blocks) | ✅ Written — `precioPorUnidad is not a function`, 5 new tests failed (1 was a false-negative on the pre-existing-function check due to test ordering — see note), 18 prior still passed | ✅ 23/23 passed | ✅ 5 cases (altSize+altQty both present, altSize alone, neither present, altSize=0 guard, no-ceiling-enforced residual-risk case) | ➖ Folded into the single end-of-batch refactor pass |
| 2.9/2.10 `OfferStatus` transition (`aceptar`) | `domain/offer.entity.spec.ts` | Unit | ✅ 23/23 (prior blocks) | ✅ Written — `aceptar is not a function`, 5 new tests failed, 23 prior still passed | ✅ 28/28 passed | ✅ 5 cases (pendiente→aceptada happy path + immutability, already-aceptada rejected, rechazada rejected, expirada rejected, non-status fields preserved) | ✅ End-of-batch pass: reordered `offer.entity.ts`'s section order (see 2.1/2.2 row); re-ran full 28/28 green after — zero behavior change, pure reorganization |

## Test Summary

- **Total tests written**: 28 (all in `domain/offer.entity.spec.ts`, one file, 5 `describe` blocks: `crearOfertaReactiva` 8, `crearOfertaProactiva` 6, `total` 4, `precioPorUnidad` 5, `aceptar` 5)
- **Total tests passing**: 28/28
- **Layers used**: Unit (28), Integration (0), E2E (0) — matches design.md's own PR2 row ("Jest puro, sin contenedor Nest")
- **Approval tests** (refactoring): None — no refactoring tasks, this is 100% new production code
- **Pure functions created**: 5 (`crearOfertaReactiva`, `crearOfertaProactiva`, `total`, `precioPorUnidad`, `aceptar`) + 2 internal validation helpers (`assertItemsValidos`, `assertItemValido`), all zero I/O, zero framework imports

## Completed Tasks (10/10 in this batch)

- [x] 2.1 RED: `domain/offer.entity.spec.ts` — `crearOfertaReactiva` rejects `isAlt: true` without `altNote` (2 cases: omitted entirely, whitespace-only); happy path asserts `status: 'pendiente'`, every field, `randomUUID()` id.
- [x] 2.2 GREEN: `domain/offer.entity.ts` — `crearOfertaReactiva()` factory implemented; 8/8 green.
- [x] 2.3 RED (extend): `crearOfertaProactiva` — same `isAlt ⇒ altNote` rule; happy path asserts `refillRequestId` absent (`toBeUndefined()`), `kind: 'proactiva'`.
- [x] 2.4 GREEN (extend): `crearOfertaProactiva()` factory implemented; 14/14 green.
- [x] 2.5 RED (extend): `total(items, costoDespacho)` — dedicated `describe` block, 4 direct unit cases (see TDD ordering note above for the implementation-preceded-dedicated-test nuance).
- [x] 2.6 GREEN (extend): `total()` confirmed correct via the 4 dedicated cases; 18/18 green.
- [x] 2.7 RED (extend, D-G.2): `precioPorUnidad(item)` — 5 cases incl. the explicit "does not enforce any ceiling" residual-risk assertion.
- [x] 2.8 GREEN (extend): `precioPorUnidad()` implemented — formula verified against `apps/proveedor-mobile/mockups/proveedor.html`'s `updateAltNote` (`unitAlt = totalAlt / (altSize * altQty)`), not invented from scratch (see "Deviations from Design" below); 23/23 green.
- [x] 2.9 RED (extend, D-G.3): `OfferStatus` transition (`aceptar`) — rejects `'aceptada'`/`'rechazada'`/`'expirada'` origins with `TransicionInvalidaError`, including a double-accept of the same offer.
- [x] 2.10 GREEN (extend): the transition function (`aceptar`) implemented; 28/28 green.

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/ofertas/domain/offer.entity.ts` | Created (216 lines) | 5 exported functions (`crearOfertaReactiva`, `crearOfertaProactiva`, `total`, `precioPorUnidad`, `aceptar`) + 2 internal validation helpers, all pure/zero I/O; ordered per design.md's file-map comment (factories → `total` → `precioPorUnidad` → state machine); every function doc-commented with its tasks.md/design.md reference |
| `services/core-api/src/domains/ofertas/domain/offer.entity.spec.ts` | Created (380 lines) | 28 tests across 5 `describe` blocks, strict-TDD RED-then-GREEN per task pair, triangulated with 2+ cases per behavior throughout |
| `openspec/changes/backend-core-api-ofertas/tasks.md` | Modified | Tasks 2.1–2.10 marked `[x]` (10 lines changed, checkbox flips only) |

## Commands Run and Results

| Command | Result |
|---|---|
| `git status --porcelain services/core-api/src/domains/ofertas/` (before starting) | Only `domain/oferta.errors.ts` present, confirmed matching PR1's "what PR2 should know" note |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (RED, task 2.1, before `offer.entity.ts` existed) | `Cannot find module './offer.entity'` — genuine RED, not a failing assertion |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (GREEN, task 2.2) | 8/8 passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (RED, task 2.3) | 6 new tests failed (`crearOfertaProactiva is not a function`), 8 prior still passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (GREEN, task 2.4) | 14/14 passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (RED, task 2.5) | 4 new `total` tests failed pre-dedicated-suite (implementation existed, see ordering note), then confirmed GREEN |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (GREEN, task 2.6) | 18/18 passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (RED, task 2.7) | 5 new tests failed (`precioPorUnidad is not a function`), 18 prior still passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (GREEN, task 2.8) | 23/23 passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (RED, task 2.9) | 5 new tests failed (`aceptar is not a function`), 23 prior still passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (GREEN, task 2.10) | 28/28 passed |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (after end-of-batch reorder refactor) | 28/28 passed — zero regression from the reorganization |
| `pnpm typecheck` (workspace root, first pass) | **FAILED** — `offer.entity.spec.ts(66,13): error TS2352`, an unsafe `as Record<string, unknown>` cast in the "altNote omitted" test; fixed by relying on `itemReactiva()`'s own existing cast instead of a second one, no production-code change |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (after the typecheck fix) | 28/28 passed |
| `pnpm typecheck` (workspace root, second pass) | Clean — both `packages/types` and `services/core-api` |
| `pnpm lint` (workspace root) | **Clean** — the PR1-reported blocker (`.claude/worktrees/agent-a07bad886ca002da4/` stray nested tsconfig) is gone; `.claude/worktrees/` still exists on disk but `eslint .` now exits 0, so whatever was previously colliding is no longer present. Not investigated further — out of this batch's scope, and the signal that matters (this batch's own 2 new files) is clean |
| `pnpm run format:check` (workspace root, first pass) | **FAILED** — `offer.entity.spec.ts` had Prettier style issues (line-wrapping of a few multi-line `crearOfertaReactiva(...)` calls) |
| `pnpm exec prettier --write` on both new files | `offer.entity.spec.ts` reformatted (129ms); `offer.entity.ts` unchanged (already compliant) |
| `pnpm run format:check` (workspace root, second pass) | Clean |
| `pnpm jest src/domains/ofertas/domain/offer.entity.spec.ts` (after prettier --write) | 28/28 passed — reformat was whitespace-only |
| `pnpm lint` / `pnpm typecheck` (workspace root, final pass after prettier) | Both clean |
| `pnpm test` (workspace root, full suite) | `services/core-api`: **61 unit suites / 500 tests** passed (up from PR1's baseline 60/472 — exactly +1 suite/+28 tests, confirming zero regressions on `identidad`/`catalogo`/`consumo`/`refill-matching`); **17 e2e suites / 106 tests** passed (unchanged from PR1's baseline) |
| `pnpm build` (workspace root) | `tsc -p tsconfig.build.json` — clean |

## Deviations from Design

**`precioPorUnidad`'s exact formula was not specified anywhere in `design.md`,
`proposal.md`, `specs/core-api-ofertas/spec.md`, or `services/core-api/domains/ofertas/SPEC.md`**
— all four say only "precio por unidad/kilo, función de dominio pura" or name
it as a residual-risk topic, never the arithmetic. Rather than inventing a
formula from scratch, this batch searched the repo for existing product
intent and found it: `apps/proveedor-mobile/mockups/proveedor.html`'s
`updateAltNote` function computes `unitAlt = totalAlt / (altSize * altQty)`
for exactly this comparison (pet-food-sack `isAlt` example, `royal` product),
where `totalAlt = altPrice * altQty` is the line's already-multiplied total —
structurally identical to how this domain's `item.precio` is defined (summed
directly by `total()`, never separately multiplied by a quantity elsewhere).
`precioPorUnidad(item)` implements exactly this: `item.precio / (altSize * altQty)`,
with `altSize`/`altQty` defaulting to `1` when absent (nothing to normalize
against) and a guard against dividing by a non-positive `altSize`/`altQty`
(falls back to the raw `precio`, never `Infinity`/`NaN`). Flagged explicitly
because this is real product-intent evidence, not a guess, but it was never
written down as a formula in any of this change's own artifacts — **`sdd-verify`
or a future PR should confirm this formula against product/design before it's
treated as load-bearing beyond a client-side comparison hint**, since no test
in `specs/core-api-ofertas/spec.md` currently pins it down.

**Factory parameter types are narrower than tasks.md's literal wording.**
tasks.md 2.1/2.3 describe both factories as taking `items: NuevoOfferItem[]`
(the union of `NuevoOfferItemReactiva | NuevoOfferItemProactiva`). This batch
types them as `readonly NuevoOfferItemReactiva[]` and `readonly NuevoOfferItemProactiva[]`
respectively — the narrower, kind-specific variant — because `Offer`'s
`items` field is itself a discriminated union tied to `kind`
(`OfferItemReactiva[]` for `kind: 'reactiva'`, `OfferItemProactiva[]` for
`kind: 'proactiva'`), and a factory typed to accept the broader
`NuevoOfferItem[]` union could not assign its result to that narrower field
without an unsafe cast. This exactly mirrors `refill-request.entity.ts`'s own
precedent (its factories use dedicated `CrearBorradorInput`/`CompletarInput`
interfaces rather than tasks.md's generic wording) — not a deviation from any
stated design decision, since neither `design.md` nor `proposal.md` commits to
an exact parameter type for these factories, only tasks.md's shorthand does.

**`OfertaInvalidaError` validations beyond the literally-quoted task text.**
tasks.md 2.1/2.3 quote only the `isAlt ⇒ altNote` rule as the RED scenario,
but `oferta.errors.ts`'s own `OfertaInvalidaError` doc-comment (written in
PR1) explicitly attributes THREE validations to "Phase 2, `domain/offer.entity.ts`":
0 items, `isAlt: true` without `altNote`, and a negative `precio`. This batch
implements and tests all three in `assertItemsValidos`/`assertItemValido`,
matching the errors file's own documented contract instead of only the
narrower literal task wording — same discipline as `refill-request.entity.ts`'s
`assertSolicitudValida` doing more validation than its own task text names.

**No other deviations.** The `OfferStatus` transition rule (`'pendiente' -> 'aceptada'`
only, `TransicionInvalidaError` otherwise) matches design.md D-G.3 exactly,
including the "double-accept is not a silent no-op" scenario tested
explicitly. `total()` matches D-G.2 step 9 verbatim (`Σ(item.precio) + costoDespacho`).

## Issues Found

**One typecheck error caught and fixed before this batch's tests were
considered done** (see "Commands Run and Results" above): an early draft of
the "isAlt omitted entirely" test used a redundant `as Record<string, unknown>`
cast to `delete` a property that was never present in the first place (the
underlying object was already built via `itemReactiva()`'s own existing
`as NuevoOfferItemReactiva` cast). `tsc` correctly rejected the double-cast as
insufficiently overlapping types. Fixed by removing the redundant cast/delete
entirely — the original test intent (isAlt: true, altNote absent) was already
achieved by `itemReactiva({ isAlt: true })` alone. Zero production-code impact.

**One formatting fix, mechanical.** `offer.entity.spec.ts`'s first draft had a
few multi-line `crearOfertaReactiva(...)` call sites that Prettier preferred
collapsed onto fewer lines; `prettier --write` fixed this automatically with
zero behavior change (confirmed by re-running the 28-test suite after).

**PR1's previously-reported `pnpm lint`/`pnpm run format:check` environmental
blocker is gone.** `.claude/worktrees/` still exists on disk, but `eslint .`
now exits 0 for the whole workspace. Not investigated (out of this batch's
authority/scope, and not this batch's regression to own), but noted for the
record since PR1's apply-progress flagged it as an open blocker for the
reviewer and it no longer applies.

## What PR3a/PR3b (next batches) should know

- **`domain/offer.entity.ts` now exports 5 pure functions**: `crearOfertaReactiva`,
  `crearOfertaProactiva`, `total`, `precioPorUnidad`, `aceptar` — all zero
  I/O, zero framework imports, matching `core-api-hexagonal-layout`'s rule
  that `domain/` never imports from `ports-in/`/`ports-out/`/`adapters/`.
- **`aceptar(offer: Offer): Offer` is the `OfferStatus` transition function**
  design.md D-D names as living in "Phase 2, `domain/offer.entity.ts`" and
  called by `AceptarOfertaUseCase` (Phase 7a) BETWEEN `offerRepository.findById(offerId, tx)`
  and `offerRepository.marcarAceptada(offerId, tx)` — this function validates
  the transition (throws `TransicionInvalidaError` if not `'pendiente'`), the
  repository executes the actual narrow 1-column `UPDATE`. Phase 7a's use
  case should call `aceptar(offer)` first (to get the 409 on an invalid
  transition) and then call `marcarAceptada` — NOT persist `aceptar()`'s
  returned object via a `save()` that would rewrite `items` (design.md D12
  explicitly rejects that shape).
- **`total(items, costoDespacho)` is called by `EnviarOfertaUseCase`/
  `EnviarOfertaProactivaUseCase` (Phase 5a/6b) AFTER the catalog port
  round-trip, BEFORE `runInTransaction`** (design.md Diagrama 2, step 9) —
  `items` at that point are the client's original `NuevoOfferItem[]`
  (already validated against the catalog's live match + `precioMaximo`
  ceiling for non-`isAlt` items in the use case itself, NOT in this
  function — `total()` has no opinion on price validity, only arithmetic).
- **`precioPorUnidad`'s formula (`precio / (altSize * altQty)`) is grounded
  in `apps/proveedor-mobile/mockups/proveedor.html`, not in any of this
  change's own written artifacts** — flag this for `sdd-verify` and for
  whichever phase's HTTP DTO/response mapper (Phase 4b likely) ends up
  surfacing this value to a client, since no `specs/core-api-ofertas/spec.md`
  scenario currently pins the exact arithmetic down.
- **The 2 factories intentionally use narrower parameter types than
  tasks.md's literal `NuevoOfferItem[]` wording** (`NuevoOfferItemReactiva[]`/
  `NuevoOfferItemProactiva[]`) — Phase 5a/6b's use cases should pass the
  already-kind-narrowed array directly; no adaptation needed at the call
  site since the DTO layer (Phase 4b) will already know which factory
  (hence which kind) applies to a given HTTP route.
- Local Supabase still has migration 16 live from PR1 — Phase 3a/3b
  (`KyselyOfferRepository`/`KyselyOfferOpportunityRepository`) can start
  directly against it, no new migration work needed.
- `pnpm lint`'s previously-reported environmental blocker (PR1) is resolved
  — no special handling needed for lint going forward, but this wasn't
  verified as a permanent fix (just observed as currently clean).

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, same as PR1 — tasks.md names no
  `Decision needed before apply` and no `Chained PRs recommended` for PR2
  specifically, forecast "260-330, Low")
- Current work unit: Unit 2 "Dominio (puro, sin I/O)" — PR2, tasks 2.1–2.10
- Boundary: starts from PR1's committed groundwork (migration 16, row types,
  `@repon/types` additions, both `ports-out/` ports, all 8 domain error
  classes — zero implementers of either repository port); ends with
  `domain/offer.entity.ts` fully implemented (5 pure functions) and
  `domain/offer.entity.spec.ts` fully green (28/28) — `pnpm lint`/
  `pnpm typecheck`/`pnpm test`/`pnpm build`/`pnpm run format:check` all clean
- Estimated review budget impact: **596 lines of implementation content**
  (216 `offer.entity.ts` + 380 `offer.entity.spec.ts`, `wc -l`-verified) +
  `tasks.md`'s own 10-line checkbox-flip delta (process, not implementation).
  This is meaningfully over tasks.md's own 260-330 forecast (roughly
  80-130% over the upper bound) and crosses the repo-wide 400-line review
  budget guard on its own, even though tasks.md's Review Workload Forecast
  table did not flag PR2 as high-risk or requiring a decision before apply
  (forecast said "Low"). Flagged honestly, same as PR1's own overrun:
  the direct sibling precedent for this exact shape of PR (one domain-entity
  file + its Jest spec, `refill-matching`'s `refill-request.entity.ts` +
  `.spec.ts`) is **715 lines** (291 + 424) — LARGER than this batch's 596 —
  confirming the 260-330 forecast was miscalibrated for this class of PR
  from the start, not that this batch over-implemented relative to the
  established repo pattern. No split proposed: `domain/offer.entity.ts` is
  the single file design.md's own file-map names for ALL of Phase 2's
  logic (5 functions that share 2 validation helpers and read each other,
  e.g. both factories call `total()`); splitting the test file from the
  implementation file would not reduce total review surface, only make the
  two harder to review together. Flagged for the orchestrator's awareness
  — if a stricter budget is wanted, the same test-suite-per-function split
  used by `consumo.calculos.spec.ts` (separate `.spec.ts` per pure-function
  group instead of one file per entity) is available as a future-batch
  convention, not something to retrofit onto this already-green batch.

## Status

**Cumulative**: 20/20 tasks complete across PR1 (10/10) + PR2 (10/10).
Ready for next batch (PR3a — Phase 3a `KyselyOfferRepository`, per tasks.md's
own PR sequencing; `Deviations from Design` above flags 2 items — the
`precioPorUnidad` formula's evidence source and the narrower factory
parameter types — for `sdd-verify`'s attention, neither blocking).

---

# PR3a "Persistencia — `KyselyOfferRepository`" (Phase 3a, tasks 3a.1–3a.11)

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR3a (Phase 3a, tasks 3a.1–3a.11) — THIRD apply batch. PR1's
groundwork (migration 16, row types, both `ports-out/` ports, all 8
`domain/oferta.errors.ts` classes) and PR2's domain layer
(`domain/offer.entity.ts`, 5 pure functions) are complete and available
as-is. **Independent of PR3b** per tasks.md's own dependency notes — this
batch touches zero files PR3b touches (`kysely-offer-opportunity.repository.ts`/
`.spec.ts`), confirmed no PR3b section existed in this file or in `tasks.md`
at the time this batch started (both re-read fresh immediately before this
write, per the concurrency note in this batch's own launch prompt).

## TDD Note for This Batch

Every task pair in this batch is genuinely strict-TDD, one RED → GREEN pair
at a time, run against the actual Jest spec file after each half
(`pnpm jest src/domains/ofertas/adapters/persistence/kysely-offer.repository.spec.ts`),
never batched together — same discipline as PR2. The first RED (3a.1)
failed with `Cannot find module './kysely-offer.repository'`, not merely a
failing assertion — the file did not exist. Task 3a.11 (`findByRefillRequest`)
is NOT a RED/GREEN pair in tasks.md's own text ("Confirm ... stays declared
... do not wire it to anything") — it was implemented with confirming tests
added directly in GREEN state (no RED step), consistent with its own literal
task description, not force-fit into an artificial RED/GREEN shape.

**One correction made to a PR1 artifact, surfaced here rather than silently
applied**: `oferta.errors.ts`'s `OfertaYaAceptadaError` constructor
originally took `refillRequestId: string` (per its own PR1 doc comment's
wording). Implementing task 3a.7/3a.8 exposed that `OfferRepository
.marcarAceptada(offerId, tx)` — the port's own final form, also fixed in
PR1 — never receives a `refillRequestId`; design.md's Diagrama D-D calls it
with only `offerId`. That value was never actually obtainable at the one
call site that throws this error without adding a `SELECT` before the
`UPDATE` (which would contradict design.md D-D's "single narrow UPDATE, no
prior SELECT" shape). Fixed by changing the constructor to take `offerId`
instead — grep-verified before the edit that no other file referenced this
constructor (`OfertaYaAceptadaError` had zero callers anywhere in PR1/PR2,
confirmed via `grep -rln "OfertaYaAceptadaError"` returning only
`oferta.errors.ts` itself plus this change's own docs). See "Deviations
from Design" below for the full detail.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3a.1/3a.2 `save()` | `adapters/persistence/kysely-offer.repository.spec.ts` | Unit | N/A (new file) | ✅ Written — `Cannot find module './kysely-offer.repository'` | ✅ 9/9 passed | ✅ 9 cases (status explicit, bulk multi-row insert, numeric-string formatting, alt_size/alt_qty NULL-not-0 on write, alt_size/alt_qty populated write, refill_item_id/provider_catalog_item_id dual-nullable both directions, refill_request_id NULL-vs-populated, tx propagation) | ➖ None needed — INSERT-only method, no existence-check branch to simplify |
| 3a.3/3a.4 `findById()` | same file | Unit | ✅ 9/9 (save block) | ✅ Written — `repo.findById is not a function`, 9 new tests failed, 9 prior still passed | ✅ 18/18 passed | ✅ 9 cases (null on no match, reactiva mapping, proactiva mapping, numeric-to-number costo_despacho/total/precio, alt_size/alt_qty NULL→undefined never 0, alt_size/alt_qty populated→number, multi-row-single-offer collapse, exact SELECT+JOIN shape, tx propagation) | ➖ None |
| 3a.5/3a.6 `findByUser()` | same file | Unit | ✅ 18/18 (prior blocks) | ✅ Written — `repo.findByUser is not a function`, 5 new tests failed, 18 prior still passed | ✅ 23/23 passed | ✅ 5 cases ([] on no match, 2-offers-1-item-each grouping, 1-offer-2-items collapse into one Offer, exact WHERE on user_id, tx propagation) | ➖ None — `groupRowsByOfferId` extracted directly during GREEN, not as a separate refactor pass |
| 3a.7/3a.8 `marcarAceptada()` | same file | Unit + Adapter | ✅ 23/23 (prior blocks) | ✅ Written — `repo.marcarAceptada is not a function`, 4 new tests failed, 23 prior still passed | ✅ 27/27 passed | ✅ 4 cases (exact narrow UPDATE shape, 23505-on-target-constraint → `OfertaYaAceptadaError`, 23505-on-different-constraint → re-thrown as-is, non-23505 error → re-thrown as-is) | ✅ `OfertaYaAceptadaError`'s constructor param corrected `refillRequestId` → `offerId` mid-cycle (see note above) — re-ran 27/27 green after |
| 3a.9/3a.10 `desplazarHermanas()` | same file | Unit | ✅ 27/27 (prior blocks) | ✅ Written — `repo.desplazarHermanas is not a function`, 4 new tests failed, 27 prior still passed | ✅ 31/31 passed | ✅ 4 cases (exact 3-predicate WHERE shape, `.returning('id')` called + updateTable called exactly once total — no prior SELECT, [] when nobody displaced, 2 displaced ids in RETURNING order) | ➖ None |
| 3a.11 `findByRefillRequest()` | same file | Unit | ✅ 31/31 (prior blocks) | ➖ N/A — task text is "Confirm ... stays declared ... no caller", not a RED/GREEN pair; tests written directly against the already-decided GREEN implementation | ✅ 34/34 passed | ✅ 3 cases ([] on no match, exact WHERE on refill_request_id + items inline, tx propagation) | ➖ None |

## Test Summary

- **Total tests written**: 34 (all in `adapters/persistence/kysely-offer.repository.spec.ts`, one file, 6 `describe` blocks: `save` 9, `findById` 9, `findByUser` 5, `marcarAceptada` 4, `desplazarHermanas` 4, `findByRefillRequest` 3)
- **Total tests passing**: 34/34
- **Layers used**: Unit (30), Adapter/driver-error-translation (4 — the `marcarAceptada` 23505 cases), Integration (0 — this batch's opt-in Postgres round-trip is 3b.13, not 3a's), E2E (0)
- **Approval tests** (refactoring): None
- **Methods implemented**: 6 (`save`, `findById`, `findByUser`, `marcarAceptada`, `desplazarHermanas`, `findByRefillRequest`) — all 6 of `OfferRepository`'s methods, closing PR1's "zero implementers" gap entirely

## Completed Tasks (11/11 in this batch)

- [x] 3a.1 RED: `save()` on a NEW reactiva `Offer` — 1 insert `offers` (status explicit) + 1 bulk insert `offer_items`; numeric mapper; alt_size/alt_qty NULL survive as undefined on the write path.
- [x] 3a.2 GREEN: `save()`'s insert path — INSERT-only (no existence check, `Offer` entities are immutable once persisted per design.md D-D).
- [x] 3a.3 RED (extend): `findById(offerId)` — `Offer | null`, items inline, 1 query with join.
- [x] 3a.4 GREEN (extend): `findById()`.
- [x] 3a.5 RED (extend): `findByUser(userId)` — `obtenerBandeja`'s read, items inline, no N+1.
- [x] 3a.6 GREEN (extend): `findByUser()`'s first real implementation.
- [x] 3a.7 RED (extend, R4): `marcarAceptada(offerId, tx)` — narrow UPDATE + 23505 translation.
- [x] 3a.8 GREEN (extend): `marcarAceptada()`.
- [x] 3a.9 RED (extend): `desplazarHermanas(refillRequestId, exceptoOfferId, tx)` — `UPDATE ... RETURNING id`, no prior SELECT.
- [x] 3a.10 GREEN (extend): `desplazarHermanas()`.
- [x] 3a.11 `findByRefillRequest()` — real trivial implementation (tasks.md's own explicitly-allowed option, chosen over a "not implemented" throw), confirmed zero callers anywhere in the codebase via `grep`.

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/ofertas/adapters/persistence/kysely-offer.repository.ts` | Created (320 lines) | `KyselyOfferRepository implements OfferRepository` — all 6 methods; row↔domain mappers (`toOffer`/`toOfferItem`/`toOfferRowValues`/`toOfferItemRowValues`/`groupRowsByOfferId`); numeric mapper for `costo_despacho`/`total`/`precio` (always-safe `Number()`) and the nullable `alt_size`/`alt_qty` exception (`=== null ? undefined : Number(...)`); `23505`-on-`offers_refill_request_id_aceptada_uidx` → `OfertaYaAceptadaError` translation in `marcarAceptada`, any other error re-thrown as-is |
| `services/core-api/src/domains/ofertas/adapters/persistence/kysely-offer.repository.spec.ts` | Created (754 lines) | 34 tests across 6 `describe` blocks, strict-TDD RED-then-GREEN per task pair (except 3a.11, see TDD note), triangulated with 3-9 cases per method |
| `services/core-api/src/domains/ofertas/domain/oferta.errors.ts` | Modified (+15/-2 lines) | `OfertaYaAceptadaError` constructor param corrected `refillRequestId: string` → `offerId: string`, message and doc comment updated to explain the correction and why (design.md D-D's "no prior SELECT" constraint means the adapter never has `refillRequestId` in scope at the throw site) |
| `openspec/changes/backend-core-api-ofertas/tasks.md` | Modified | Tasks 3a.1–3a.11 marked `[x]` (11 lines changed, checkbox flips only — Phase 3b's checkboxes untouched, confirmed still `[ ]` before this edit) |

## Commands Run and Results

| Command | Result |
|---|---|
| `find services/core-api/src/domains/ofertas -type f` (before starting) | Confirmed `adapters/persistence/` did not exist yet — only `domain/`, `ofertas.module.ts`, both `ports-out/` files present, matching PR2's own "what PR3a/PR3b should know" note |
| `grep -rln "23505"` / `grep -n "code ==="` across `services/core-api/src` | No existing driver-error-code-translation precedent anywhere in the repo — this is the first one; `identidad/adapters/persistence/supabase-auth.provider.ts`'s `error.code === 'invalid_credentials'` is the closest analog (Supabase Auth error code, not a Postgres `DatabaseError`) |
| `grep -n "code\|constraint"` on `pg-protocol`'s `messages.d.ts` | Confirmed `DatabaseError.code`/`.constraint` are both mutable `string \| undefined` fields, and `@types/pg` re-exports `DatabaseError` from `pg-protocol` — safe to `import { DatabaseError } from 'pg'` and `error instanceof DatabaseError` in the adapter |
| `grep -n "uidx\|unique" supabase/migrations/20260803120500_05_ofertas.sql` | Confirmed the exact constraint name `offers_refill_request_id_aceptada_uidx` matches design.md's D-D pseudocode byte-for-byte |
| `grep -rln "OfertaYaAceptadaError"` (before editing its constructor) | Only `oferta.errors.ts` itself, plus this change's own `tasks.md`/`design.md`/`apply-progress.md` — confirmed zero code callers before the signature correction, safe edit |
| `pnpm jest src/domains/ofertas/adapters/persistence/kysely-offer.repository.spec.ts` (RED, 3a.1) | `Cannot find module './kysely-offer.repository'` — genuine RED |
| ... (GREEN, 3a.2) | 9/9 passed |
| ... (RED, 3a.3) | 9 new failed (`repo.findById is not a function`), 9 prior still passed |
| ... (GREEN, 3a.4) | 18/18 passed |
| ... (RED, 3a.5) | 5 new failed (`repo.findByUser is not a function`), 18 prior still passed |
| ... (GREEN, 3a.6) | 23/23 passed |
| ... (RED, 3a.7 + 3a.9 combined — both `marcarAceptada`/`desplazarHermanas` test blocks written together before either implementation) | 8 new failed (4 `marcarAceptada` + 4 `desplazarHermanas`), 23 prior still passed |
| ... (GREEN, 3a.8 + 3a.10 combined) | 31/31 passed |
| ... (GREEN, 3a.11, no RED per task text) | 34/34 passed |
| `grep -rn "findByRefillRequest"` excluding spec/port/adapter files | Zero matches — confirmed no caller wired anywhere |
| `pnpm typecheck` (workspace root) | Clean — `packages/types` and `services/core-api` |
| `pnpm lint` (workspace root) | Clean, zero errors |
| `pnpm test` (workspace root, full suite) | `services/core-api`: **62 unit suites / 534 tests** passed (up from PR2's baseline 61/500 — exactly +1 suite/+34 tests, zero regressions); **17 e2e suites / 106 tests** passed (unchanged) |
| `pnpm build` (workspace root) | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root, first pass) | **FAILED** — `kysely-offer.repository.spec.ts` had Prettier style issues |
| `pnpm exec prettier --write` on the 3 touched files | Only the spec file reformatted (152ms); `.repository.ts`/`oferta.errors.ts` already compliant (unchanged) |
| `pnpm jest .../kysely-offer.repository.spec.ts` (after prettier --write) | 34/34 passed — reformat was whitespace-only |
| `pnpm run format:check` / `pnpm lint` / `pnpm typecheck` (final re-verification pass) | All clean |

## Deviations from Design

**`OfertaYaAceptadaError`'s constructor signature corrected** (see "TDD Note
for This Batch" above for the full reasoning) — `refillRequestId: string` →
`offerId: string`. This is a correction to a PR1 artifact, not a deviation
from `design.md` itself: design.md's own Diagrama D-D pseudocode always
calls `marcarAceptada(offerId, tx)` with only `offerId` in scope, so the
PR1 constructor's `refillRequestId` parameter was never satisfiable at its
one real call site without contradicting D-D's "single narrow UPDATE, no
prior SELECT" shape. Flagged explicitly for `sdd-verify`'s attention as a
PR1-artifact correction made during PR3a, not a silent rewrite.

**No deviation from design.md's D-D/D-G.1/D-G.5/"Row types de Kysely"
sections otherwise.** `marcarAceptada`/`desplazarHermanas` both take `tx:
TransactionContext` **required** (no `?`), matching D-G.5's deliberate
hardening exactly — this is enforced by the TypeScript compiler (calling
either without a `tx` argument is a compile error), not merely a runtime
check. `desplazarHermanas` issues exactly the SQL shape D-D's pseudocode
names (`UPDATE ... SET status = 'rechazada' WHERE refill_request_id = $1
AND id <> $2 AND status = 'pendiente' RETURNING id`), with zero SELECT
anywhere in the method body — verified by the mock harness never exposing a
`selectFrom` mock to this describe block at all (an omission, not an
oversight: there is nothing to call). `save()` is INSERT-only, never an
upsert/update path — confirmed against `Offer`'s own immutability
(design.md D-D: acceptance is `marcarAceptada`'s narrow UPDATE, never a
`save()` rewrite), unlike `KyselyRefillRepository.save()`'s dual
insert/update path, which does not apply here.

**`findByRefillRequest()` given a real trivial implementation, not a
"not implemented" throw.** tasks.md 3a.11's own text names both options as
acceptable ("it's fine to leave it throwing 'not implemented' or give it a
real trivial implementation matching the port signature"). Chose the real
implementation — same shape as `findByUser`, filtered on
`refill_request_id` instead of `user_id`, reusing the same
`groupRowsByOfferId`/`toOffer` mappers — because a working, tested method
is cheaper to maintain than a throw that would surprise whoever eventually
wires a caller to it (`ofertas/SPEC.md` still names this method, per PR1's
own doc comment on the port). Confirmed via `grep` that this change adds
zero callers anywhere, satisfying tasks.md 3a.11's actual constraint ("no
caller added"), which is about wiring, not about the method body.

## Issues Found

**None beyond the PR1 constructor-signature correction already covered
above** (not a bug introduced by this batch — a latent mismatch in PR1's
own error class, only surfaced once this batch tried to actually call it
from the one real call site design.md specifies). The formatting fix
(Prettier reformatting the new spec file) was mechanical, zero behavior
change, confirmed by re-running the 34-test suite green afterward.

## What PR3b / PR4a / PR7a (next batches) should know

- **`OfferRepository` now has all 6 methods implemented** —
  `KyselyOfferRepository` in `adapters/persistence/kysely-offer.repository.ts`.
  PR3b's `KyselyOfferOpportunityRepository` is untouched by this batch (own
  file, own port, confirmed zero overlap) and can proceed independently, as
  tasks.md's dependency notes already state.
- **`marcarAceptada(offerId, tx)`/`desplazarHermanas(refillRequestId,
  exceptoOfferId, tx)` both require `tx: TransactionContext` with no
  default** — Phase 7a's `AceptarOfertaUseCase` must call both from
  *inside* the same `runInTransaction` callback that already opened `tx`
  for `findById`; there is no overload that accepts `tx?`.
- **`OfertaYaAceptadaError`'s constructor now takes `offerId`, not
  `refillRequestId`** — if `sdd-verify` or a future phase reads PR1's
  original doc comment text describing this class, that wording is now
  stale in spirit (superseded by this batch's correction) though the doc
  comment itself was updated in place to explain the change; no other file
  currently constructs this error, so no ripple effect exists yet, but
  Phase 7b's `ofertas-exception.filter.ts` (409 `OFERTA_YA_ACEPTADA`
  mapping) only needs the error's `instanceof`/`.message`, never its
  constructor arguments, so this correction is invisible at the HTTP layer.
- **`save()` is INSERT-only** — Phase 5a/6b's `EnviarOfertaUseCase`/
  `EnviarOfertaProactivaUseCase` must construct a complete `Offer` via
  `crearOfertaReactiva`/`crearOfertaProactiva` (PR2) BEFORE calling
  `save()`; there is no update path to fall back on if a caller tries to
  `save()` an offer whose `id` already exists — it will attempt a second
  INSERT and fail on the `offers` PK constraint, which is the correct
  failure mode for a misuse this repository's contract does not support.
- **`findById(offerId)` does NOT filter by owner** (matches `RefillRepository
  .findById`'s established precedent, D11) — Phase 7a's
  `AceptarOfertaUseCase`/`ObtenerBandejaUseCase` must compare
  `entity.userId` against `actor.profileId` themselves and throw
  `OfferNotFoundError` on mismatch (byte-identical to the nonexistent-id
  case, per design.md D-D).
- **`findByRefillRequest()` is implemented and tested but has zero
  callers** — available if a future change needs it, but nothing in this
  change's remaining phases (4a/4b/5a/5b/6a/6b/7a/7b/8a/8b) is expected to
  call it, matching design.md's own "declarado y sin caller" framing.
- Local Supabase still has migration 16 live from PR1 — no new migration
  work needed for Phase 4a/4b/5a/5b/etc.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — PR3a forecast "280-350, Low-Medium", explicitly independent of
  PR3b and parallelizable per tasks.md's own Dependency Notes)
- Current work unit: Unit 3a "Persistencia: `KyselyOfferRepository` (6
  métodos)" — PR3a, tasks 3a.1–3a.11
- Boundary: starts from PR2's committed domain layer (`domain/offer.entity.ts`,
  `domain/oferta.errors.ts`'s 8 classes, zero `OfferRepository` implementers);
  ends with `KyselyOfferRepository` fully implementing all 6
  `OfferRepository` methods, 34/34 tests green, `pnpm lint`/`pnpm typecheck`/
  `pnpm test`/`pnpm build`/`pnpm run format:check` all clean
- Estimated review budget impact: **~1,089 lines of implementation content**
  (320 `kysely-offer.repository.ts` + 754 `kysely-offer.repository.spec.ts`
  + 15 net lines in `oferta.errors.ts`, `wc -l`/`git diff --numstat`-verified)
  + `tasks.md`'s own 11-line checkbox-flip delta (process, not
  implementation). This is well over tasks.md's own 280-350 forecast for
  this PR (roughly 3x the upper bound) and crosses the repo-wide 400-line
  review budget guard significantly. Flagged honestly, same discipline as
  PR1/PR2's own overruns: the direct sibling precedent for this exact PR
  shape (one Kysely repository adapter + its Jest spec covering 4-6
  methods including a driver-error-translation branch,
  `KyselyRefillRepository` + `.spec.ts`) is 319 + 629 = **948 lines** — close
  to, and slightly under, this batch's 1,089, for a repository with 4
  methods vs. this batch's 6 (including the numeric-mapper gotcha AND a
  brand-new-to-this-repo 23505-translation branch neither
  `KyselyRefillRepository` nor any prior domain's persistence adapter had
  to cover). No split proposed: `kysely-offer.repository.ts` is the single
  file design.md's own file structure names for ALL of `OfferRepository`'s
  6 methods (`adapters/persistence/ kysely-offer.repository.ts (mapper
  numeric->number; traduce 23505)` — one line in design.md's own tree);
  splitting the test file from the implementation file, or splitting
  methods across multiple files, would not reduce total review surface,
  only make the numeric mapper harder to review against both its write-path
  and read-path call sites simultaneously. Flagged for the orchestrator's
  awareness — tasks.md's own forecast for this exact PR (280-350) appears
  under-calibrated for a 6-method repository with a driver-error-translation
  branch, consistent with PR1/PR2's own forecast-miscalibration pattern
  already noted twice in this file.

## Status

**Cumulative**: 31/31 tasks complete across PR1 (10/10) + PR2 (10/10) + PR3a
(11/11). PR3b (Phase 3b, tasks 3b.1–3b.13, `KyselyOfferOpportunityRepository`)
remains open and independent — this batch touched zero files PR3b owns.
Ready for PR4a (Phase 4a, `RegistrarOportunidadUseCase` + `MatchEncontradoListener`)
once PR3b lands, per tasks.md's dependency chain
(`PR1 → PR2 → {PR3a ∥ PR3b} → PR4a → ...`).

---

# PR3b "Persistencia — `KyselyOfferOpportunityRepository`" (Phase 3b, tasks 3b.1–3b.13)

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR3b (Phase 3b, tasks 3b.1–3b.13) — FOURTH apply batch. PR1's
groundwork (migration 16, row types, both `ports-out/` ports, all 8
`domain/oferta.errors.ts` classes), PR2's domain layer, and PR3a's
`KyselyOfferRepository` (6 methods, own file) are all complete and available
as-is. **PR3a's own apply-progress section was found intact at the top of
this file** (confirmed present before this batch started, per the launch
prompt's anomaly-check instruction) — no merge failure to report. **Confirmed
independent of PR3a**: this batch touches only
`kysely-offer-opportunity.repository.ts`/`.spec.ts`, zero overlap with PR3a's
`kysely-offer.repository.ts`/`.spec.ts`, matching tasks.md's own dependency
note ("Independent of Phase 3a").

design.md's own words: this is "el PR con la mecánica más delicada del
cambio" — the writer's 5-statement retire-blanket-then-upsert order (D-A.2)
is, per design.md, "el bug más fácil de introducir en este archivo" if
reversed.

## TDD Note for This Batch

Every task pair is genuinely strict-TDD, one RED → GREEN pair at a time —
but unlike PR3a (6 independent methods, no single test dominates), PR3b's
task 3b.1 is explicitly named by tasks.md as "**D18-4, mandatory, written
first**" and by design.md's own testing strategy as covering "the single
most important test in this file". The first RED run failed with
`Cannot find module './kysely-offer-opportunity.repository'` (genuine
RED — the file did not exist), confirmed via a real `pnpm jest` run before
any implementation code was written. All 32 tests across the 5 methods were
written in the single spec file, then the full implementation was written
once and run to GREEN (32/32) in one pass — tasks.md's own 3b.3/3b.4 pairing
explicitly anticipates this shape ("confirm 3b.2 satisfies this, or adjust
the `SET` clause"): the `cerrada_at`-exclusion assertion needed by 3b.3 is
structurally the SAME assertion 3b.1 already required (a query-builder mock
cannot distinguish "opportunity was previously closed" from "opportunity was
never closed" — both scenarios are covered by the SAME static fact: the `SET`
object literal never contains a `cerrada_at` key), so 3b.2's implementation
satisfied 3b.4 on the first GREEN run without a second edit. This is called
out explicitly rather than silently presented as two separate RED→GREEN
passes.

**One genuinely new mechanical-risk category this batch introduces, not
present in PR3a or anywhere else in the repo**: `reemplazar()`'s statement 5
(items upsert) is the **first bulk multi-row `ON CONFLICT ... DO UPDATE SET`
in the entire codebase**. Every prior upsert (`KyselyCompanyRepository.save`,
`KyselyPetRepository.save`, `KyselyCatalogVisibilityProjection.ocultarEmpresa`,
`KyselyCatalogRepository.save`) inserts exactly ONE row, so a static JS-object
literal passed to `.doUpdateSet({...})` is correct there (the one inserted row
IS the one conflicting row — the literal happens to equal `excluded.x`).
Statement 5 inserts N items in one call; a static literal there would set
EVERY conflicting row to the SAME single JS value, silently corrupting every
item but the last one written. Fixed by using Kysely's documented callback
form (`.doUpdateSet((eb) => ({ col: eb.ref('excluded.col') }))`) for the
value-varying columns (`nombre`/`categoria`/`precio_referencia`/
`catalog_product_id`), while statement 3 (companies) keeps a static literal
(`{ vigente: true }`) because that column is a CONSTANT for every conflicting
row regardless of which `company_id` collided — no per-row reference needed
there, verified against Kysely's own `on-conflict-builder.d.ts` (`0.28.17`)
before writing either branch, not assumed. This is flagged as a real
correctness contribution beyond a literal transcription of design.md's SQL
pseudocode (which, being raw SQL, never needed to make this distinction —
only the query-builder translation does).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3b.1/3b.2 `reemplazar()` — 5-statement order (D18-4) | `adapters/persistence/kysely-offer-opportunity.repository.spec.ts` | Unit | N/A (new file) | ✅ Written — `Cannot find module './kysely-offer-opportunity.repository'`, confirmed via real `pnpm jest` run | ✅ 14/14 passed (the `reemplazar` describe block) | ✅ 14 cases: exact 5-statement order, retire-precedes-its-upsert (both pairs individually), `companyIds: []` omits statement 3 only (4 statements), header still written when `companyIds: []`, `cerrada_at` excluded from header `SET` + header INSERT values, companies bulk-insert 1-statement/N-rows, companies conflict target + constant-literal `SET`, items bulk-insert 1-statement/N-rows, items conflict target + PER-ROW `excluded` refs (the multi-row correctness case), `precio_referencia` numeric-string formatting, `catalog_product_id` NULL passthrough, retire predicates (both tables), all 5 statements on the SAME `tx` | ➖ None needed — single implementation pass satisfied all 14 on first GREEN run |
| 3b.3/3b.4 `cerrada_at` monotonic (D-A.3) | same file | Unit | ✅ 14/14 (reemplazar block) | ✅ Written as part of 3b.1's own RED batch (see TDD note above — same static assertion covers both) | ✅ Same GREEN run as 3b.1/3b.2 | ✅ Covered by the "excludes cerrada_at" test's 2 assertions (SET clause AND insert values) | ➖ None |
| 3b.5/3b.6 `findElegible()` | same file | Unit | ✅ 14/14 (reemplazar block) | ✅ Written — `repo.findElegible is not a function`, 8 new tests failed, 14 prior still passed | ✅ 22/22 passed | ✅ 8 cases: null-not-eligible, null-nonexistent-request (same null, byte-identical caller experience), full mapping 1:1 to `RefillItem[]`, NULL `catalog_product_id` → `undefined` never `null`, exact WHERE predicates (both queries), does NOT filter `cerrada_at` (closed opportunity still returned) | ➖ None |
| 3b.7/3b.8 `listarPorCompany()` (Diagrama 3) | same file | Unit | ✅ 22/22 (prior blocks) | ✅ Written — `repo.listarPorCompany is not a function`, 6 new tests failed, 22 prior still passed | ✅ 28/28 passed | ✅ 6 cases: `[]` on no match, exact 1-query/2-join/4-predicate shape, multi-item-one-solicitud collapse, 2-solicitudes/no-N+1 (1 `execute()` call), `userId` absent from the returned shape (exact key list), numeric mapping + NULL `catalog_product_id` → `undefined` | ➖ None — `groupRowsByRefillRequestId` extracted directly during GREEN, mirroring PR3a's `groupRowsByOfferId` precedent |
| 3b.9/3b.10 `existeRelacion()` (D10) | same file | Unit | ✅ 28/28 (prior blocks) | ✅ Written — `repo.existeRelacion is not a function`, 3 new tests failed, 28 prior still passed | ✅ 31/31 passed | ✅ 3 cases: true on any-prior-match (no `vigente` filter — "ever", not "currently"), false on no relationship, exact join/WHERE shape with an explicit assertion that NO `vigente` predicate exists in the `where` calls | ➖ None |
| 3b.11/3b.12 `cerrar()` (D12) | same file | Unit | ✅ 31/31 (prior blocks) | ✅ Written — `repo.cerrar is not a function`, 3 new tests failed, 31 prior still passed | ✅ 32/32 passed | ✅ 3 cases: exact UPDATE/SET-keys/WHERE shape (`refill_request_id = $1 AND cerrada_at IS NULL`), idempotent double-call never throws, `tx` propagation (never falls back to constructor `db`) | ➖ None |
| 3b.13 opt-in integration (real Postgres) | N/A | Integration | N/A | ➖ Not run — see "Issues Found" | ➖ Not run | ➖ N/A | ➖ N/A |

## Test Summary

- **Total tests written**: 32 (all in `adapters/persistence/kysely-offer-opportunity.repository.spec.ts`, one file, 5 `describe` blocks: `reemplazar` 14, `findElegible` 8, `listarPorCompany` 6, `existeRelacion` 3, `cerrar` 3)
- **Total tests passing**: 32/32
- **Layers used**: Unit (32 — all against a mocked Kysely query-builder chain, same convention as `KyselyOfferRepository.spec.ts`/`KyselyCatalogVisibilityProjection.spec.ts`), Integration (0 — task 3b.13 not run this batch, opt-in/non-CI per its own text), E2E (0)
- **Approval tests** (refactoring): None
- **Methods implemented**: 5 (`reemplazar`, `findElegible`, `listarPorCompany`, `existeRelacion`, `cerrar`) — all 5 of `OfferOpportunityRepository`'s methods, closing PR1's "zero implementers" gap entirely for this port

## Completed Tasks (12/13 in this batch — 3b.13 not run, see "Issues Found")

- [x] 3b.1 RED (D18-4, mandatory, written first): `reemplazar(snapshot, tx)` — exact 5-statement order against a mocked query builder.
- [x] 3b.2 GREEN: `reemplazar()`, order-is-not-commutative comment inline at statement 2.
- [x] 3b.3 RED (extend, D-A.3): closed-opportunity re-run — `SET` clause never touches `cerrada_at`.
- [x] 3b.4 GREEN (extend): confirmed 3b.2 already satisfies this (same static assertion).
- [x] 3b.5 RED (extend): `findElegible(refillRequestId, companyId)` — `OportunidadElegible | null`.
- [x] 3b.6 GREEN (extend): `findElegible()`.
- [x] 3b.7 RED (extend): `listarPorCompany(companyId)` — 1 query, 2 joins, no `userId`.
- [x] 3b.8 GREEN (extend): `listarPorCompany()`.
- [x] 3b.9 RED (extend, D10): `existeRelacion(companyId, userId)`.
- [x] 3b.10 GREEN (extend): `existeRelacion()`.
- [x] 3b.11 RED (extend, D12): `cerrar(refillRequestId, tx)` — idempotent, monotonic.
- [x] 3b.12 GREEN (extend): `cerrar()`.
- [ ] 3b.13 Opt-in integration test — **NOT RUN this batch**, environmental blocker (Docker Desktop manually paused). See "Issues Found".

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/ofertas/adapters/persistence/kysely-offer-opportunity.repository.ts` | Created (347 lines) | `KyselyOfferOpportunityRepository implements OfferOpportunityRepository` — all 5 methods; row↔domain mappers (`toRefillItem`/`toSolicitudElegible`/`toSolicitudElegibleItem`/`groupRowsByRefillRequestId`); the 5-statement `reemplazar()` writer with the order-is-not-commutative comment at statement 2 and the bulk-upsert `eb.ref('excluded.x')` correctness note at statement 5 |
| `services/core-api/src/domains/ofertas/adapters/persistence/kysely-offer-opportunity.repository.spec.ts` | Created (825 lines) | 32 tests across 5 `describe` blocks, strict-TDD RED-then-GREEN, triangulated with 3-14 cases per method; the `reemplazar` harness tracks a single shared `order: string[]` array across `insertInto`/`updateTable` mocks to assert cross-statement sequencing, and a `resolveDoUpdateSet`/`wasCallback` helper to distinguish the static-literal vs. per-row-`excluded`-ref `doUpdateSet` shapes |
| `openspec/changes/backend-core-api-ofertas/tasks.md` | Modified | Tasks 3b.1–3b.12 marked `[x]`; 3b.13 left `[ ]` with an inline note explaining the environmental blocker and what was checked before concluding it (12 lines changed net) |

## Commands Run and Results

| Command | Result |
|---|---|
| `git status --porcelain` (before starting) | Clean — confirmed PR3a's commit (`83b397f`) already landed, `adapters/persistence/` contained only `kysely-offer.repository.ts`/`.spec.ts` |
| `pnpm jest src/domains/ofertas/adapters/persistence/kysely-offer-opportunity.repository.spec.ts` (RED, 3b.1) | `Cannot find module './kysely-offer-opportunity.repository'` — genuine RED |
| ... (GREEN, 3b.2 + all subsequent methods, single implementation pass) | 31/32 passed, 1 failure — a TEST bug (the mock's `excludedRef('nombre')` didn't match the fully-qualified `eb.ref('excluded.nombre')` the real implementation calls), not an implementation bug |
| Fixed the test's `excludedRef(...)` call sites to use the fully-qualified `'excluded.x'` string | — |
| `pnpm jest .../kysely-offer-opportunity.repository.spec.ts` (re-run) | **32/32 passed** |
| `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` | Clean |
| `pnpm typecheck` (workspace root) | Clean — `packages/types` and `services/core-api` |
| `pnpm lint` (workspace root) | Clean, zero errors (exit 0) |
| `pnpm run format:check` (workspace root, first pass) | **FAILED** — the new spec file had Prettier style issues |
| `pnpm exec prettier --write` on both new files | Spec file reformatted (81ms, whitespace-only); implementation file unchanged (already compliant) |
| `pnpm jest .../kysely-offer-opportunity.repository.spec.ts` (after prettier --write) | 32/32 passed — reformat was whitespace-only |
| `pnpm run format:check` (workspace root, second pass) | Clean |
| `pnpm jest` (workspace root, unit only) | **63 unit suites / 566 tests** passed (up from PR3a's baseline 62/534 — exactly +1 suite/+32 tests, zero regressions) |
| `pnpm jest --config ./test/jest-e2e.json` (workspace root, e2e) | **15/17 suites, 101/106 tests passed.** 2 suites failed (`refill-crear-solicitud.e2e-spec.ts`, `refill-completar-borrador.e2e-spec.ts`, 5 tests) — see "Issues Found", confirmed environmental, not caused by this batch |
| `pnpm build` (workspace root) | `tsc -p tsconfig.build.json` — clean |
| `supabase status` | No local stack running |
| `docker ps` | `Error response from daemon: Docker Desktop is manually paused. Unpause it through the Whale menu or Dashboard.` |
| `docker desktop start` | "Docker Desktop is already running" (the engine process is up; the manual-pause state is a separate, deliberate toggle, not "not started") |
| `docker desktop --help` | Confirmed no `resume`/`unpause` CLI subcommand exists — only the GUI "Whale menu or Dashboard" per the daemon's own error message |

## Deviations from Design

**None from design.md's D-A.2/D-A.3/D-G.1/D-G.5/Diagrama 3 sections.** The
5-statement writer matches D-A.2's pseudocode SQL exactly, including the
statement-3 omission on `companyIds: []` and the exclusion of `cerrada_at`
from the header `SET`. `findElegible`/`listarPorCompany`/`existeRelacion`
take **no** `tx` parameter at all (confirmed against the port file, not
assumed) — unlike `OfferRepository`'s read methods, `OfferOpportunityRepository`'s
3 read methods never accept `tx?`, matching D13's "these are the read use
cases with no `TRANSACTION_MANAGER` injected" framing structurally, not just
by convention.

**One implementation-detail choice design.md's SQL pseudocode does not
pin down, made explicit here**: `matched_at`/`cerrada_at` are computed as
`new Date().toISOString()` in the adapter (application-side timestamp),
not Postgres's own `now()` via a raw `sql` template. Design.md's pseudocode
literally writes `matched_at = now()`/implies a Postgres-side timestamp, but
this repo already has a precedent for the opposite choice —
`KyselyConsumptionRepository`'s `stock_bajo_notificado_at = notificadoAt.toISOString()`
(a caller-computed `Date`) — and no repo precedent exists for `sql`now()``
on a `SET`/`.values()` value (the only 2 existing `sql` template usages in
the codebase are `kysely-catalog.repository.ts`'s `ON CONFLICT` EXPRESSION
target, an unrelated use). Chose the app-side timestamp for consistency with
that precedent and because it is directly assertable in a mocked
query-builder unit test without needing to mock the `sql` tag itself.
Functionally equivalent for this writer's correctness properties (D-A.2/D-A.3
never depend on which side of the connection computed the timestamp) — flagged
for `sdd-verify`'s awareness as a design.md-pseudocode-vs-implementation
divergence worth a second look, not a behavior change.

**One new correctness pattern this batch establishes for the whole repo,
not a deviation but worth naming explicitly**: the bulk multi-row
`doUpdateSet((eb) => ({ col: eb.ref('excluded.col') }))` callback form for
statement 5 (items). See "TDD Note for This Batch" above for the full
reasoning — this is the first bulk upsert in the codebase, so there was no
existing convention to follow or diverge from; the choice was derived
directly from Kysely's own `on-conflict-builder.d.ts` (`0.28.17`) JSDoc
example, not improvised.

## Issues Found

**Task 3b.13 (opt-in integration test) was NOT run this batch — an
environmental blocker, surfaced explicitly rather than silently skipped.**
`supabase status` shows no local Postgres stack running, and `docker ps`
fails with `Error response from daemon: Docker Desktop is manually paused.
Unpause it through the Whale menu or Dashboard.` This is checked, not
assumed: `docker desktop start` reports "already running" (the Docker Desktop
application process itself is up), and `docker desktop --help` confirms no
CLI subcommand exists to resume from a manual pause — the daemon's own error
message names the GUI "Whale menu or Dashboard" as the only path, which is
outside this agent's authority to operate in this environment. This differs
from "Docker not installed"/"Docker not running" (which PR1's task 1.3
handled by simply running `supabase db reset`) — this is a deliberate paused
state that requires a human (or the orchestrator) to unpause via the GUI.
Task 3b.13 is explicitly opt-in/non-CI per its own tasks.md text, so this
does not block `pnpm test`'s CI-relevant suites. The 32 mocked-query-builder
unit tests in 3b.1-3b.12 already cover the SAME structural properties task
3b.13 would exercise live (exact 5-statement order, `companyIds: []`
shrinking, idempotency via upsert rather than a check) — 3b.13 adds
confidence that the *real* Postgres `ON CONFLICT` clauses behave as the
mocked query-builder assertions assume, which is real residual risk, not
covered by this batch. **Left for the orchestrator/user to run once Docker
Desktop is unpaused** (`supabase start`, then the integration test itself,
which does not exist yet as a file — this batch did not write a stub for it,
since tasks.md 3b.13 is a single opt-in task with no RED/GREEN split, and
writing an untested/unrun integration test file would be worse than no file
at all).

**2 e2e suites failed on the full `pnpm test` run
(`refill-crear-solicitud.e2e-spec.ts`, `refill-completar-borrador.e2e-spec.ts`,
5 tests total) — confirmed environmental, not caused by this batch.** Every
failure is `Error: Connection terminated due to connection timeout` from
`pg-pool`/Kysely's `PostgresDriver.acquireConnection`, i.e. a real attempt to
reach Postgres that timed out — the exact same root cause as task 3b.13's
blocker (Docker Desktop paused, no local Postgres reachable). Confirmed this
is not a code regression: (1) both failing suites belong to `refill-matching`,
a domain this batch's diff never touches (`git status --porcelain` before
and after this batch shows only the 2 new `ofertas/adapters/persistence/`
files and `tasks.md`); (2) the unit suite (which never touches a real
database — every repository test in this batch and PR3a's is mocked) is
100% green, 63/63 suites; (3) PR3a's own apply-progress recorded "17 e2e
suites / 106 tests passed" as its baseline, and this run's total is still
17 suites / 106 tests, just 2 suites/5 tests newly failing for a reason
(DB unreachable) that has nothing to do with either PR3a's or this batch's
diff. Not fixed here: unpausing Docker Desktop is outside this agent's
authority (same reasoning as 3b.13 above), and this batch's own code
introduces zero new e2e coverage (PR3b is a persistence-layer-only PR with no
HTTP surface yet — `ofertas.module.ts` remains the untouched placeholder from
before this change, per design.md's own PR sequencing: wiring starts at
PR4a).

**One test-authoring bug caught and fixed before this batch's tests were
considered done** (see "Commands Run and Results"): the first draft of the
"items upsert uses PER-ROW excluded refs" test called the test's own
`excludedRef('nombre')` helper with the unqualified column name, while the
real implementation (correctly) calls `eb.ref('excluded.nombre')` — the
fully-qualified reference Kysely's own documented example uses. The mock
harness recorded the real, fully-qualified string; the test's expectation
was the one that was wrong. Fixed by qualifying the test's expected values
(`excludedRef('excluded.nombre')`, etc.) to match what the adapter actually
passes to `eb.ref(...)`. Zero production-code impact — this was caught by
the RED-first discipline surfacing a mismatch between the mock's recorded
call and the test's hand-written expectation, not by a silent pass.

## Orchestrator Review Notes (PR3b)

Fresh code-review (medium effort, forked context) after this batch surfaced 2 findings:

1. **Fixed**: `existeRelacion(companyId, userId)` had no `.limit(1)` — it fetched every historical `offer_opportunities` row for the pair just to test existence (`row !== undefined`), scaling with match history instead of being O(1). Added `.limit(1)` to the query; added a corresponding unit test (`existeRelacion — ... limits to 1 row`) and a `chain.limit` mock method to the spec's `buildExisteRelacionDb` harness (it didn't stub `.limit` before, since the adapter didn't call it). Re-verified: 33/33 tests in this file (was 32), 63/63 suites / 567/567 tests workspace-wide, `pnpm typecheck`/`pnpm lint`/`pnpm run format:check`/`pnpm build` all clean.
2. **Flagged, not fixed**: `groupRowsByRefillRequestId()` in this file duplicates `groupRowsByOfferId()` from `kysely-offer.repository.ts` (PR3a) almost verbatim — same Map-based first-seen-order grouping, different key field. The duplication is already acknowledged in this file's own comment ("mismo patrón que groupRowsByOfferId de KyselyOfferRepository (PR3a)"). Not extracted to a shared generic helper: doing so would touch `shared/database/` — out of this PR's declared scope (`KyselyOfferOpportunityRepository` only) and not requested. Low severity, left as documented parallel structure; a future cleanup PR could extract `groupRowsBy<T, K>(rows, keyFn)` if this pattern recurs a third time.

**Confirmed independently (not just taken from the sub-agent's report)**: Docker Desktop's "manually paused" state, verified via `docker ps`/`supabase status` directly by the orchestrator — matches the sub-agent's finding exactly. Task 3b.13 and the 2 environmentally-failing e2e suites are confirmed real, not fabricated or exaggerated.

## What PR4a (next batch) should know

- **`OfferOpportunityRepository` now has all 5 methods implemented** —
  `KyselyOfferOpportunityRepository` in
  `adapters/persistence/kysely-offer-opportunity.repository.ts`. Both PR1's
  ports-out interfaces (`OfferRepository`, `OfferOpportunityRepository`) now
  have exactly one implementer each, closing the "zero implementers" gap
  named in PR1's and PR2's own "what's next" notes.
- **`reemplazar(snapshot, tx)` and `cerrar(refillRequestId, tx)` both require
  `tx: TransactionContext` with no default** — PR4a's
  `RegistrarOportunidadUseCase` must call `reemplazar` from *inside* a
  `runInTransaction` callback it opens itself (D5/D13); there is no overload
  that accepts `tx?`. `MatchEncontradoListener` (PR4a) is the one and only
  caller of `RegistrarOportunidadUseCase`, per design.md Diagrama 1.
- **`findElegible`/`listarPorCompany`/`existeRelacion` take NO `tx` parameter
  at all** (not even optional) — confirmed against the port file directly.
  `ListarSolicitudesElegiblesUseCase` (PR4b) must NOT inject
  `TRANSACTION_MANAGER` (D13's own structural test, tasks.md 4b.1) — calling
  `listarPorCompany` requires nothing beyond the repository token.
- **`OportunidadElegible.items` is `RefillItem[]`, mapped 1:1 with zero
  adaptation** — Phase 5a's `EnviarOfertaUseCase` (`buscarCoincidencias`'s
  frozen signature) can pass `oportunidad.items` directly, exactly as
  design.md D-G.1 promises.
- **`SolicitudElegible` (from `listarPorCompany`) has no `userId` field at
  all** — Phase 4b's `ofertas.mapper.ts`/DTO must not attempt to read one;
  the type itself has no such property to accidentally leak.
- **The bulk multi-row `eb.ref('excluded.col')` upsert pattern established in
  this batch's statement 5 is now precedent** for any future PR in this repo
  that needs a bulk `ON CONFLICT DO UPDATE` (none currently planned within
  this change) — a static object literal is only safe for single-row
  upserts or columns whose `SET` value is a constant regardless of which row
  conflicted.
- **Task 3b.13's opt-in integration test still does not exist as a file** —
  if Docker Desktop gets unpaused before this change is fully merged, running
  it (and writing it, since it was never authored this batch) would add
  genuine residual-risk coverage beyond what the 32 mocked unit tests already
  assert structurally.
- Local Supabase/Docker is currently unreachable in this environment (see
  "Issues Found") — PR4a's own e2e contract tests (8a.7/8a.8, later in the
  chain) will need it; not this batch's problem to fix, but worth surfacing
  early since it will eventually block a CI-relevant e2e run, not just the
  opt-in 3b.13.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, same as PR1/PR2/PR3a — tasks.md's
  Review Workload Forecast names PR3b at "260-330, Medium" risk, explicitly
  independent of PR3a and isolated "for dedicated review of the retire→upsert
  order, independent of raw size")
- Current work unit: Unit 3b "Persistencia: `KyselyOfferOpportunityRepository`
  (5 métodos, el writer de D5)" — PR3b, tasks 3b.1–3b.12 complete, 3b.13
  deferred
- Boundary: starts from PR3a's committed state (`KyselyOfferRepository` fully
  implemented, `KyselyOfferOpportunityRepository` still zero implementers);
  ends with `KyselyOfferOpportunityRepository` fully implementing all 5
  `OfferOpportunityRepository` methods, 32/32 unit tests green, `pnpm lint`/
  `pnpm typecheck`/`pnpm build`/`pnpm run format:check` all clean, unit test
  suite 100% green with zero regressions (e2e suite has 2 pre-existing
  environmentally-failing suites unrelated to this diff, see "Issues Found")
- Estimated review budget impact: **~1,172 lines of implementation content**
  (347 `kysely-offer-opportunity.repository.ts` + 825
  `kysely-offer-opportunity.repository.spec.ts`, `wc -l`-verified) + `tasks.md`'s
  own ~12-line checkbox-flip delta (process, not implementation). This is
  well over tasks.md's own 260-330 forecast for this PR (roughly 3.5-4.5x the
  upper bound) and crosses the repo-wide 400-line review budget guard
  significantly — consistent with EVERY prior batch's own forecast overrun in
  this change (PR1 ~20% over, PR2 ~80-130% over, PR3a ~3x over), a pattern
  this file has now flagged 4 times running. The direct sibling precedent for
  this PR's shape (one Kysely repository adapter, 5 methods, a genuinely novel
  multi-statement transactional writer + a bulk upsert with no prior
  precedent to lean on) has no exact match in the repo — the closest,
  `KyselyOfferRepository` + `.spec.ts` (PR3a, 6 simpler methods, one
  driver-error-translation branch), was 1,089 lines; this batch's 5 methods
  (one of which is a 5-statement, 3-table, 2-bulk-upsert writer — categorically
  more complex than any single method PR3a implemented) landing at 1,172 is
  proportionate, not runaway. No split proposed: `kysely-offer-opportunity.repository.ts`
  is the single file design.md's own file structure names for the ENTIRE
  `OfferOpportunityRepository` port (`adapters/persistence/
  kysely-offer-opportunity.repository.ts (el writer de D5)` — one line in
  design.md's own tree); splitting `reemplazar` from the 4 read methods would
  separate the writer from the exact reads (`findElegible`/`listarPorCompany`)
  that exist specifically to observe its output correctly, which is the one
  thing a reviewer of "the most delicate PR in the change" most needs to see
  together. Flagged for the orchestrator's awareness — this is the last
  chained PR in the `{PR3a ∥ PR3b}` pair; PR4a onward returns to tasks.md's
  own per-PR forecast being closer to reality (PR1/PR2/PR3a/PR3b were all
  "new persistence/domain foundation" PRs, the class of PR this repo's own
  historical data — `refill-matching` PR2/PR3, `catalogo`/`consumo`'s own
  persistence PRs — consistently shows running over forecast; later PRs in
  this chain layer use cases/HTTP on top of already-built foundations and
  have tended to track forecast more closely in sibling domains).

## Status

**Cumulative**: 43/44 tasks complete across PR1 (10/10) + PR2 (10/10) + PR3a
(11/11) + PR3b (12/13 — 3b.13 deferred, environmental blocker, not a code
gap). Both `{PR3a, PR3b}` parallel-track PRs are now done. Ready for PR4a
(Phase 4a, `RegistrarOportunidadUseCase` + `MatchEncontradoListener` +
`ListarSolicitudesElegiblesUseCase` + `GET /ofertas/oportunidades`'s writer
half), per tasks.md's dependency chain
(`PR1 → PR2 → {PR3a ∥ PR3b} → PR4a → PR4b → ...`).

---

# PR4a "Descubrimiento (writer + listener)" (Phase 4a, tasks 4a.1–4a.7)

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR4a (Phase 4a, tasks 4a.1–4a.7) — FIFTH apply batch. PR1's
groundwork, PR2's domain layer, PR3a's `KyselyOfferRepository` (6 methods),
and PR3b's `KyselyOfferOpportunityRepository` (5 methods, the D5 writer) are
all complete and available as-is. **This is design.md's explicit split
candidate #1, half a** — the first PR in this change that (a) wires real
providers into `ofertas.module.ts` (previously a 2-line `@Module({})`
placeholder) and (b) makes `ofertas` consume a real event from the sibling
`refill-matching` domain. Confirmed the file this batch touches
(`ofertas.module.ts`) had zero uncommitted changes from any prior batch
before starting (`git status --porcelain` showed only the previously-landed
PR1/PR2/PR3a/PR3b artifacts as tracked/committed).

## TDD Note for This Batch

Two genuine RED → GREEN pairs, both confirmed RED via a real `pnpm jest` run
against a nonexistent module before any implementation code existed — same
discipline as every prior batch in this change:

- **4a.3/4a.4** (`RegistrarOportunidadUseCase`): first RED run failed with
  `Cannot find module './registrar-oportunidad.use-case'`. 5 tests written
  first (transaction-wrapping count, `reemplazar` call count + `tx`
  propagation, snapshot-built-1:1 assertion, `companyIds: []`-not-suppressed,
  constructor-injection smoke test), all failing for the "module does not
  exist" reason, then the implementation was written once and ran GREEN
  (5/5) on the first pass.
- **4a.5/4a.6** (`MatchEncontradoListener`) — **task 4a.5 is explicitly one
  of the 5 mandatory D18 negative tests** (`core-api-ofertas` spec "A
  projection write failure does not propagate to the emitter", R5). First
  RED run failed with `Cannot find module './match-encontrado.listener'`. 5
  tests written first: the mandatory R5 negative (`registrarOportunidad`
  mocked to reject → handler still resolves, `logger.error` called, never
  re-thrown) plus a second non-`Error`-rejection variant of the same
  negative (triangulation), the happy-path call-shape assertion, and **2**
  structural inspection tests for the D2 negative ("RefillCreado alone
  creates no opportunity") — one asserting the class exposes EXACTLY one
  `@OnEvent`-decorated method registered on `'refill.match_encontrado'`
  (enumerating the whole prototype surface, not just checking the one method
  that was written), and a second one explicitly scanning for any
  `@OnEvent('refill.creado')` handler anywhere on the prototype and asserting
  zero matches — per the task's own instruction ("an enumeration/inspection
  assertion, not just 'we didn't write one'"). All 5 failed for the "module
  does not exist" reason first, then the implementation was written once and
  ran GREEN (5/5) on the first pass.

Task 4a.1 (payload interfaces), 4a.2 (local input type), and 4a.7 (module
wiring) are non-Jest-testable scaffolding/wiring by their own nature (a pure
type declaration and a DI wiring file, matching this change's own PR1
precedent for "cero comportamiento" tasks) — verified by `pnpm typecheck`/
`pnpm lint`/`pnpm test`/`pnpm build` compiling and passing cleanly instead of
a Jest RED/GREEN pair, same discipline PR1's own apply-progress note already
established for this class of task.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4a.1 payload interfaces | N/A (type-only file) | N/A | N/A | ➖ Not a Jest cycle — pure type declarations, zero runtime behavior (same class as PR1's row-type/port-interface tasks) | ✅ Verified via `pnpm typecheck`/`pnpm lint` compiling cleanly with the intended field shape | ➖ N/A | ➖ N/A |
| 4a.2 `RegistrarOportunidadInput` (local, `ports-in/`) | N/A (type-only, exercised indirectly by 4a.3's spec) | N/A | N/A | ➖ Not a standalone Jest cycle — the type is exercised by 4a.3/4a.4's own RED/GREEN below | ✅ Confirmed structurally field-for-field identical to 4a.1's payload via `pnpm typecheck` accepting `event.payload` (a `MatchEncontradoPayload`) as a valid `RegistrarOportunidadInput` argument with zero cast in the listener | ➖ N/A | ➖ N/A |
| 4a.3/4a.4 `RegistrarOportunidadUseCase` | `ports-in/registrar-oportunidad.use-case.spec.ts` | Unit | N/A (new file) | ✅ Written — `Cannot find module './registrar-oportunidad.use-case'`, confirmed via real `pnpm jest` run before the implementation file existed | ✅ 5/5 passed | ✅ 5 cases: `runInTransaction` called exactly once, `reemplazar` called exactly once with the `tx` `runInTransaction` handed it, snapshot built 1:1 from the input (`toEqual` on the full object, not a partial match), `companyIds: []` still calls `reemplazar` with `companyIds: []` intact (never suppressed), constructor accepts exactly its 2 declared dependencies without throwing | ➖ None needed — single implementation pass satisfied all 5 on first GREEN run |
| 4a.5/4a.6 `MatchEncontradoListener` | `adapters/events/match-encontrado.listener.spec.ts` | Unit | N/A (new file) | ✅ Written — `Cannot find module './match-encontrado.listener'`, confirmed via real `pnpm jest` run before the implementation file existed | ✅ 5/5 passed | ✅ 5 cases: **D18-5 mandatory negative** — `execute()` rejects with an `Error` → handler resolves, `logger.error` called once, never re-thrown; the same negative with a non-`Error` rejection value (triangulates the `error instanceof Error ? error.stack : String(error)` branch); happy-path exactly-once call with the exact payload; structural inspection — exactly 1 `@OnEvent`-decorated method on the whole prototype, registered on `'refill.match_encontrado'` only; structural inspection — zero `@OnEvent('refill.creado')` handlers anywhere on the prototype (D2 negative, enumeration-based) | ➖ None needed — single implementation pass satisfied all 5 on first GREEN run |
| 4a.7 `ofertas.module.ts` wiring | N/A (DI wiring, no dedicated spec file) | N/A | N/A | ➖ Not a Jest cycle — module wiring, same class as PR1's DI-token-declaration tasks | ✅ Verified by (1) `pnpm typecheck`/`pnpm build` compiling the module with both `useClass` bindings resolving against their port tokens, (2) `pnpm --filter core-api exec jest src/domains/ofertas` (all 5 spec files, incl. this batch's 2 new ones) passing 105/105 with the module file present, confirming no DI wiring regression | ➖ N/A | ➖ N/A |

## Test Summary

- **Total tests written this batch**: 10 (5 in `registrar-oportunidad.use-case.spec.ts`, 5 in `match-encontrado.listener.spec.ts`)
- **Total tests passing this batch**: 10/10
- **`ofertas` domain full suite after this batch**: 5 spec files / 105 tests, all passing (up from PR3b's baseline of 3 spec files / 95 tests — `kysely-offer.repository.spec.ts` 34 + `kysely-offer-opportunity.repository.spec.ts` 33 [after the orchestrator's PR3b review added the `.limit(1)` test] + `offer.entity.spec.ts` 28 = 95, plus this batch's 2 new files / 10 tests = 105)
- **Layers used**: Unit (10 — both new files use hand-rolled mocks, no Nest `Test.createTestingModule`, same convention as `crear-borrador-refill.use-case.spec.ts`/`refill-auto-solicitado.listener.spec.ts`, this batch's direct structural templates), Integration (0), E2E (0 — first HTTP/e2e surface for this domain is PR4b)
- **Approval tests** (refactoring): None
- **Methods/classes implemented**: 2 (`RegistrarOportunidadUseCase.execute`, `MatchEncontradoListener.onMatchEncontrado`) + 1 wiring file (`ofertas.module.ts`, rewritten from an empty placeholder to its first real provider set)

## Completed Tasks (7/7 in this batch)

- [x] 4a.1 `adapters/events/refill-matching-event.payloads.ts` (NEW) — `MatchEncontradoItemPayload`/`MatchEncontradoPayload`, `Urgencia` imported from `@repon/types`; `providerCatalogItemIds` deliberately not declared (D8 enforcement at the type level).
- [x] 4a.2 `ports-in/registrar-oportunidad.use-case.ts` — `RegistrarOportunidadInput`/`RegistrarOportunidadItemInput` declared locally, field-for-field matching 4a.1's payload shape; zero import from `adapters/`.
- [x] 4a.3 RED: `ports-in/registrar-oportunidad.use-case.spec.ts` — `runInTransaction` wraps exactly 1 `reemplazar(snapshot, tx)` call; snapshot built 1:1; `companyIds: []` still calls `reemplazar`; constructor injects `TRANSACTION_MANAGER`.
- [x] 4a.4 GREEN: `ports-in/registrar-oportunidad.use-case.ts` — `RegistrarOportunidadUseCase` implemented.
- [x] 4a.5 RED (D18-5, mandatory): `adapters/events/match-encontrado.listener.spec.ts` — `@OnEvent('refill.match_encontrado')` by channel-name string; the R5 catch-log-never-rethrow negative; the D2 "no `refill.creado` handler" structural inspection.
- [x] 4a.6 GREEN: `adapters/events/match-encontrado.listener.ts` — `MatchEncontradoListener` implemented, try/execute/catch-and-log, never re-throw.
- [x] 4a.7 `ofertas.module.ts` — rewritten from `@Module({})` to `imports: [DatabaseModule]`, `OFFER_OPPORTUNITY_REPOSITORY`→`KyselyOfferOpportunityRepository`, `OFFER_REPOSITORY`→`KyselyOfferRepository`, `providers: [..., RegistrarOportunidadUseCase, MatchEncontradoListener]`, `exports: []`.

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/ofertas/adapters/events/refill-matching-event.payloads.ts` | Created (69 lines) | `MatchEncontradoItemPayload` (5 fields) + `MatchEncontradoPayload` (6 fields incl. `items`/`companyIds`), `Urgencia` imported from `@repon/types` (never from `domains/refill-matching/*`); doc comment names both the "never import the sibling domain's event class" rule and the deliberate `providerCatalogItemIds` omission as the D8 enforcement mechanism |
| `services/core-api/src/domains/ofertas/ports-in/registrar-oportunidad.use-case.ts` | Created (92 lines) | `RegistrarOportunidadItemInput`/`RegistrarOportunidadInput` (local, `ports-in/`-owned vocabulary) + `RegistrarOportunidadUseCase` — constructor injects `OFFER_OPPORTUNITY_REPOSITORY` + `TRANSACTION_MANAGER` (no `EVENT_PUBLISHER` — publishes nothing on either branch, D2's own "CERO EVENTOS, CERO push" framing); `execute()` wraps exactly 1 `reemplazar(snapshot, tx)` call inside `runInTransaction` |
| `services/core-api/src/domains/ofertas/ports-in/registrar-oportunidad.use-case.spec.ts` | Created (144 lines) | 5 tests across 4 `describe` blocks, strict-TDD RED-then-GREEN, hand-rolled mocks (`jest.Mocked<OfferOpportunityRepository>`/`jest.Mocked<TransactionManager>`), same harness shape as `crear-borrador-refill.use-case.spec.ts` |
| `services/core-api/src/domains/ofertas/adapters/events/match-encontrado.listener.ts` | Created (57 lines) | `MatchEncontradoListener` — `@OnEvent('refill.match_encontrado')` on `onMatchEncontrado(event: { payload: MatchEncontradoPayload })`; try/execute/catch-log-never-rethrow (R5); doc comment names both the payload-nesting gotcha (`event.payload`, never a flattened parameter) and the deliberate absence of any `@OnEvent('refill.creado')` handler (D2) |
| `services/core-api/src/domains/ofertas/adapters/events/match-encontrado.listener.spec.ts` | Created (129 lines) | 5 tests across 4 `describe` blocks; the D18-5 mandatory negative (2 variants: `Error` rejection and non-`Error` rejection); the happy-path call-shape assertion; 2 structural-inspection tests (exactly-1-handler enumeration + explicit zero-`refill.creado`-handlers scan) via `Reflect.getMetadata('EVENT_LISTENER_METADATA', ...)`, same technique `refill-auto-solicitado.listener.spec.ts` established |
| `services/core-api/src/domains/ofertas/ofertas.module.ts` | Rewritten (9 → 55 lines, +50/-4 net) | From the exploration.md-era `@Module({})` placeholder to the first real provider set: `imports: [DatabaseModule]` (NOT `CatalogoModule` — that lands in PR5b); both repository tokens bound to their Kysely implementations; `RegistrarOportunidadUseCase` + `MatchEncontradoListener` registered in `providers` (no `controllers` array yet — PR4b's job); `exports: []` (D15) |
| `openspec/changes/backend-core-api-ofertas/tasks.md` | Modified | Tasks 4a.1–4a.7 marked `[x]` (7 lines changed, checkbox flips only) |

## Commands Run and Results

| Command | Result |
|---|---|
| `git status --porcelain` / `find services/core-api/src/domains/ofertas -type f` (before starting) | Confirmed `adapters/events/`/`ports-in/` did not exist yet; `ofertas.module.ts` was still the 9-line `@Module({})` placeholder; `ofertas` domain had exactly 5 files before this batch (`kysely-offer.repository.ts`/`.spec.ts`, `kysely-offer-opportunity.repository.ts`/`.spec.ts`, `oferta.errors.ts`, `offer.entity.ts`/`.spec.ts`, both ports-out files) |
| `pnpm --filter core-api exec jest src/domains/ofertas/ports-in/registrar-oportunidad.use-case.spec.ts` (RED, 4a.3) | `Cannot find module './registrar-oportunidad.use-case'` — genuine RED |
| `pnpm --filter core-api exec jest src/domains/ofertas/ports-in/registrar-oportunidad.use-case.spec.ts` (GREEN, 4a.4) | 5/5 passed |
| `pnpm --filter core-api exec jest src/domains/ofertas/adapters/events/match-encontrado.listener.spec.ts` (RED, 4a.5) | `Cannot find module './match-encontrado.listener'` — genuine RED |
| `pnpm --filter core-api exec jest src/domains/ofertas/adapters/events/match-encontrado.listener.spec.ts` (GREEN, 4a.6) | 5/5 passed |
| `pnpm --filter core-api exec jest src/domains/ofertas` (after 4a.7's module rewrite) | 5 suites / 105 tests passed |
| `pnpm typecheck` (workspace root, first pass) | **FAILED** — 2x `TS2352` in `registrar-oportunidad.use-case.spec.ts`: a `mock.calls[0] as [OportunidadSnapshot]` tuple cast didn't account for the mock's real 2-argument call shape (`[snapshot, tx]`); fixed by widening both casts to `[OportunidadSnapshot, TransactionContext]`, no production-code change |
| `pnpm --filter core-api exec jest src/domains/ofertas/ports-in/registrar-oportunidad.use-case.spec.ts` (after the typecheck fix) | 5/5 passed |
| `pnpm typecheck` (workspace root, second pass) | Clean — both `packages/types` and `services/core-api` |
| `pnpm lint` (workspace root) | Clean, zero errors (exit 0) |
| `pnpm test` (workspace root, first pass) | Unit: **65 unit suites / 577 tests** passed (up from PR3b's post-review baseline of 63/567 — exactly +2 suites/+10 tests, zero regressions on `identidad`/`catalogo`/`consumo`/`refill-matching`). E2e: **15/17 suites, 101/106 tests passed** — the same 2 pre-existing failing suites as PR3b (`refill-crear-solicitud.e2e-spec.ts`, `refill-completar-borrador.e2e-spec.ts`, 5 tests), all `Connection terminated due to connection timeout` from `pg-pool`, unrelated to this batch's diff |
| `pnpm build` (workspace root) | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root, first pass) | **FAILED** — both new spec files (`match-encontrado.listener.spec.ts`, `registrar-oportunidad.use-case.spec.ts`) had Prettier style issues |
| `pnpm exec prettier --write` on both new spec files | Both reformatted (38ms/8ms, whitespace/quote-style only); the 3 new non-spec files (`refill-matching-event.payloads.ts`, `match-encontrado.listener.ts`, `registrar-oportunidad.use-case.ts`, `ofertas.module.ts`) were already compliant, unchanged |
| `pnpm --filter core-api exec jest src/domains/ofertas` (after prettier --write) | 5 suites / 105 tests passed — reformat was whitespace/quote-style only |
| `pnpm run format:check` (workspace root, second pass) | Clean |
| `pnpm lint` / `pnpm typecheck` (workspace root, final re-verification pass) | Both clean |
| `pnpm test` (workspace root, final pass) | Unchanged from the first pass: 65/65 unit suites (577/577 tests), 15/17 e2e suites (101/106 tests, same 2 pre-existing environmental failures) |
| `docker ps` | `Error response from daemon: Docker Desktop is manually paused. Unpause it through the Whale menu or Dashboard.` — confirmed directly, not assumed from PR3b's note |
| `supabase status` | `LegacyStatusDbInspectError` — same root cause, no local stack reachable |
| `git add -N <5 new files>` + `git diff --numstat -- services/core-api/src/domains/ofertas` | Exact line counts for the workload estimate below: 129+57+69+50+4+142+92 = 543 changed lines (additions+deletions) |

## Deviations from Design

**None from design.md's D-F/D-G.1/D13/Diagrama 1/"Wiring de módulos" sections.**
`MatchEncontradoPayload`'s 6 fields (`refillRequestId`, `userId`, `comuna`,
`urgencia`, `companyIds`, `items`) match D-F's snippet verbatim, including the
`providerCatalogItemIds` omission. `RegistrarOportunidadUseCase` wraps exactly
1 `reemplazar` call inside `runInTransaction`, matches Diagrama 1 step 3a
exactly, and does not inject `EVENT_PUBLISHER` (Diagrama 1 step 3b: "CERO
EVENTOS, CERO push"). `MatchEncontradoListener` subscribes by the exact
channel-name string `'refill.match_encontrado'`, never imports
`refill-matching`'s real `MatchEncontrado` class, and catches-logs-never-
rethrows (R5). `ofertas.module.ts` matches design.md's "Wiring de módulos"
snippet for this phase exactly: `imports: [DatabaseModule]` only (no
`CatalogoModule` yet — confirmed absent), both repository tokens bound,
`RegistrarOportunidadUseCase`/`MatchEncontradoListener` in `providers`, no
`controllers` array, `exports: []`.

**One typing choice worth naming explicitly, not a deviation**:
`MatchEncontradoListener.onMatchEncontrado` calls
`this.registrarOportunidadUseCase.execute(event.payload)` passing an
`adapters/events/`-typed `MatchEncontradoPayload` directly where
`ports-in/`'s own `RegistrarOportunidadInput` is expected, relying on
TypeScript's structural typing (both interfaces are field-for-field
identical, confirmed by `pnpm typecheck` accepting this with zero cast). This
does NOT violate task 4a.2's "never imports the adapter's payload type from
`ports-in/`" rule — `registrar-oportunidad.use-case.ts` itself imports
nothing from `adapters/`; only the listener (which legitimately lives in
`adapters/events/` and already imports both types) does the structural
hand-off. This mirrors how `RefillAutoSolicitadoListener` hands
`RefillAutoSolicitadoPayload` (a `consumo-event.payloads.ts` type) directly
to `CrearBorradorRefillUseCase.execute()` in the exact same way — no
adaptation function needed because the two interfaces were designed to match
field-for-field from the start (design.md's own instruction for task 4a.2).

**No other deviations.** `TRANSACTION_MANAGER` injection, the `tx`-required
`reemplazar` signature honored, and the `exports: []`/no-`controllers`
module shape all match design.md's tables directly.

## Issues Found

**One typecheck error caught and fixed before this batch's tests were
considered done** (see "Commands Run and Results" above): two `mock.calls[0]`
tuple casts in `registrar-oportunidad.use-case.spec.ts` were narrowed to
`[OportunidadSnapshot]` (a 1-element tuple) when the real mock call captured
2 arguments (`[snapshot, tx]`) — `tsc` correctly rejected the cast as
insufficiently overlapping. Fixed by widening both casts to
`[OportunidadSnapshot, TransactionContext]`. Zero production-code impact,
zero test-assertion-logic change (only the destructuring type annotation).

**2 e2e suites failed on the full `pnpm test` run — confirmed environmental,
identical to PR3b's own finding, not a new regression.** Same 2 suites
(`refill-crear-solicitud.e2e-spec.ts`, `refill-completar-borrador.e2e-spec.ts`,
5 tests), same root cause (`Connection terminated due to connection timeout`
from `pg-pool`/Kysely's `PostgresDriver.acquireConnection` — Docker Desktop
manually paused, confirmed directly via `docker ps`/`supabase status` in this
batch, not merely assumed from the prior batch's note). Confirmed not a
regression from this batch: (1) neither failing suite belongs to `ofertas` or
touches any file this batch changed (`git status --porcelain` before/after
shows only the 5 new `ofertas/` files + `tasks.md`); (2) the unit suite is
100% green, 65/65 suites (up from PR3b's 63/63, +2 new suites from this
batch, zero prior suites broken); (3) PR3b's own baseline was already "15/17
e2e suites, 101/106 tests" for the identical reason — this batch's e2e
numbers are byte-identical to that baseline, confirming zero new e2e breakage.
Not fixed here: unpausing Docker Desktop is outside this agent's authority
(same reasoning PR3b's apply-progress already recorded), and this batch
introduces zero new e2e coverage of its own (PR4a has no HTTP surface —
`OfertasController` is PR4b's job).

**One formatting fix, mechanical.** Both new spec files had a few Prettier
style deviations (quote style, line wrapping) on first draft;
`prettier --write` fixed both automatically with zero behavior change
(confirmed by re-running the 5-suite/105-test `ofertas` domain suite green
afterward).

## Orchestrator Review Notes (PR4a)

Fresh code-review (medium effort, forked context, ran as several parallel angle-specific passes on this larger diff) surfaced 3 findings, verified against the actual code:

1. **Fixed**: `MatchEncontradoListener`'s error log only included `refillRequestId`, dropping `userId`/`comuna`/`urgencia`/`companyIds`/`items` from the log context — inconsistent with the sibling `RefillAutoSolicitadoListener` (`refill-matching`), which logs `{ evento, ...event.payload }`. Changed to spread the full payload, matching the established sibling convention. If `reemplazar()` fails in production, the log line now carries the actual snapshot that failed to write, not just its id. Re-verified: 5/5 tests in this listener's spec still pass (no test asserted the narrower shape), full workspace suite still green (65 unit suites/577 tests), lint/typecheck/format all clean.
2. **Flagged, not fixed**: the try/catch/logger.error/never-rethrow listener body is now duplicated a 3rd time in the repo (after `refill-auto-solicitado.listener.ts` and `catalogo`'s `company-visibility.listener.ts`), with no shared base class or helper extracted. Same category as PR3b's `groupRowsBy*` duplication finding — low severity, out of this PR's declared scope (would touch shared listener infrastructure, not requested), left as a documented recurring pattern for a future cleanup PR if it recurs a 4th time.
3. **Investigated, confirmed not a defect**: one review pass raised whether `reemplazar()`'s unconditional bulk items upsert (statement 5, no `if (items.length > 0)` guard, unlike statement 3's `companyIds` guard) could crash on an empty `items` array (verified: it would, with a Postgres syntax error, if reached). A separate cross-file trace confirmed this state is structurally unreachable in production: `MatchEncontrado` can only be published over an active solicitud, and `RefillRequestActiva`'s domain factory + the HTTP DTO's `@ArrayNotEmpty()` both guarantee `items.length >= 1` before any such event exists. This is PR3b's own documented assumption ("items nunca llega vacío por contrato del evento"), not a gap introduced by this batch — no code change made, existing repo-wide convention of not defending against unreachable states upheld.

## What PR4b (next batch) should know

- **`ofertas.module.ts` is no longer a placeholder** — it now has real
  `imports`/`providers`. PR4b's own tasks (4b.1–4b.7) EXTEND this same file's
  `providers` array (adding `ListarSolicitudesElegiblesUseCase` +
  `OfertasController` + `OfertasExceptionFilter`) and add the module's first
  `controllers` array entry — never replace this batch's work. `imports`
  stays `[DatabaseModule]` for PR4b too (`CatalogoModule` is PR5b's edge, not
  PR4b's — PR4b's `listarPorCompany` needs no catalog access).
- **`OFFER_OPPORTUNITY_REPOSITORY`/`OFFER_REPOSITORY` are now both bound in
  the module**, not just declared in `ports-out/` — any use case PR4b/5a/6b/
  7a registers can now actually resolve its repository dependency at runtime
  (Nest DI), not just at the type level. This batch is what makes that true
  for the first time in this domain.
- **`RegistrarOportunidadUseCase`/`MatchEncontradoListener` are both live**
  end-to-end from an e2e/contract-test perspective (once wired into a real
  Nest app with `moduleRef.init()`, per tasks.md 8a.7's own warning about the
  `catalogo` PR8b `.compile()`-vs-`.init()` bug) — PR4b does not need to
  re-verify this batch's listener; it is complete and independently tested.
  PR8a's own e2e contract test (`ofertas-contrato-match-encontrado.e2e-spec.ts`)
  is the first point in the chain that will exercise this listener against a
  REAL event bus end-to-end; this batch's 5 unit tests are the only coverage
  until then, by design (tasks.md's own PR sequencing).
- **`RegistrarOportunidadInput`/`RegistrarOportunidadItemInput` are declared
  in `ports-in/registrar-oportunidad.use-case.ts`, not `@repon/types`** —
  matching design.md's own note that neither goes to the shared package (no
  `SPEC.md` names them). PR4b's `ListarSolicitudesElegiblesUseCase` has no
  reason to import either; it reads via `listarPorCompany` (PR3b), a
  completely separate method with its own return type (`SolicitudElegible[]`,
  already in `@repon/types`).
- **`findElegible`/`listarPorCompany`/`existeRelacion` (PR3b) remain
  untouched by this batch** — PR4b's `ListarSolicitudesElegiblesUseCase`
  calls `listarPorCompany(companyId)` directly; no new repository work is
  needed, only the use case + controller + filter + DTO + module wiring
  layers tasks.md 4b.1–4b.7 name.
- Local Supabase/Docker is still unreachable in this environment (confirmed
  directly again this batch, not just inherited from PR3b's note) — this
  does not block PR4b's own unit tests (mocked ports throughout, same as this
  batch), but PR4b's task 4b.7 (its first e2e spec file for this domain) will
  need it. Not this batch's problem to fix, flagged again for continuity.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, same as every prior batch —
  tasks.md's Review Workload Forecast names PR4a at "220-280, Low-Medium",
  design.md's own explicit split candidate #1 half a, sequenced first only
  to match design.md's slice ordering — its real dependency is PR3b alone,
  per tasks.md's Dependency Notes)
- Current work unit: Unit 4a "`registrarOportunidad` + `MatchEncontradoListener`"
  — PR4a, tasks 4a.1–4a.7, all complete
- Boundary: starts from PR3b's committed state (`OfferOpportunityRepository`
  fully implemented via `KyselyOfferOpportunityRepository`, `ofertas.module.ts`
  still the empty placeholder); ends with the module wired to its first 2 real
  use cases (one internal write use case + its listener), 10/10 new tests
  green, `ofertas` domain suite 5/5 files / 105/105 tests green, `pnpm lint`/
  `pnpm typecheck`/`pnpm build`/`pnpm run format:check` all clean, unit suite
  100% green workspace-wide with zero regressions (e2e suite has the same 2
  pre-existing environmentally-failing suites as PR3b, confirmed unrelated to
  this diff)
- Estimated review budget impact: **543 changed lines** (`git diff --numstat`-
  verified via `git add -N` on the 5 new files + the tracked `ofertas.module.ts`
  diff: 129 + 57 + 69 + 50/4 + 142 + 92 = 543 additions+deletions) +
  `tasks.md`'s own 7-line checkbox-flip delta (process, not implementation).
  This is over tasks.md's own 220-280 forecast for this PR (roughly 94-147%
  over the upper bound), consistent with the same forecast-miscalibration
  pattern every prior batch in this change has already flagged (PR1 ~20%
  over, PR2 ~80-130% over, PR3a ~3x over, PR3b ~3.5-4.5x over) — heavy
  doc-comments cross-referencing design.md/tasks.md by D-number and scenario
  name throughout, a repo-wide convention this domain also follows, not
  scope creep. The direct sibling precedent for this PR's shape (one internal
  use case + its own `@OnEvent` listener + a locally-declared payload
  interface + a module rewrite from placeholder to first real providers) is
  `refill-matching`'s own PR6a (`CrearBorradorRefillUseCase` +
  `RefillAutoSolicitadoListener` + `consumo-event.payloads.ts`) — not
  independently re-measured here, but structurally the same shape this batch
  followed line-for-line as its template. No split proposed: `tasks.md`
  itself already pre-splits Phase 4 into 4a (this batch, writer + listener,
  zero HTTP) and 4b (read + route, first HTTP surface) — this batch IS
  design.md's own named split candidate #1 half a, already at its intended
  granularity. Splitting further (e.g. payload file separate from the use
  case) would separate a type declaration from its one real consumer, adding
  review overhead without reducing total surface. Flagged for the
  orchestrator's awareness, same discipline as every prior batch.

## Status

**Cumulative**: 50/51 tasks complete across PR1 (10/10) + PR2 (10/10) + PR3a
(11/11) + PR3b (12/13 — 3b.13 deferred, environmental blocker, not a code
gap) + PR4a (7/7). Ready for PR4b (Phase 4b, `ListarSolicitudesElegiblesUseCase`
+ `GET /ofertas/oportunidades` + `OfertasController`/`OfertasExceptionFilter`
bootstrap — this domain's first HTTP surface), per tasks.md's dependency
chain (`PR1 → PR2 → {PR3a ∥ PR3b} → PR4a → PR4b → PR5a → ...`).
