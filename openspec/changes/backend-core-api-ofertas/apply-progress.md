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
