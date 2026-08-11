# Apply Progress: `backend-core-api-refill-matching`

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR1 "Groundwork" (Phase 1, tasks 1.1–1.10) — FIRST apply batch, no prior progress existed.

## TDD Note for This Batch

Phase 1 is pure scaffolding by design (design.md's own PR table: "Cero comportamiento,
puras costuras"; tasks.md's Dependency Notes: "1.6/1.7 are the one exception (a
type-level check, not a Jest RED/GREEN pair) and are labeled as such explicitly so they
are not skipped"). Task 1.6 IS this batch's RED step — a compile-time `@ts-expect-error`
assertion checked by `tsc`, not Jest — and 1.7 is its GREEN (confirmed by running
`pnpm typecheck` twice: once with the directive present, once with it temporarily
removed, to prove it is genuinely load-bearing and not a stale/unused suppression). No
other task in this batch introduces runtime logic, so no Jest RED/GREEN cycle applies
to 1.1–1.5/1.8–1.10 — this mirrors `catalogo`'s and `consumo`'s own PR1 precedent
(interfaces/row-types/migrations/errors land without Jest tests, verified instead by
`pnpm lint`/`pnpm typecheck`/`pnpm test` compiling and passing cleanly with zero new
implementers).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 1.6/1.7 `refill-item-borrador.type-test.ts` | Wrote the `@ts-expect-error` fixture; temporarily commented out the directive and re-ran `tsc -p tsconfig.json --noEmit` → confirmed the exact underlying error: `Argument of type 'RefillItemBorrador[]' is not assignable to parameter of type 'RefillItem[]'` (TS2345) | Restored the `@ts-expect-error` directive; ran `pnpm --filter @repon/types typecheck` and workspace-root `pnpm typecheck` → both clean, confirming the directive suppresses a real, still-present error (not a stale no-op) | None needed |

All other tasks in this batch (1.1–1.5, 1.8–1.10) are non-TDD scaffolding per the note
above — verified by the full gate suite below, not by a Jest RED/GREEN pair.

## Completed Tasks (10/10 in this batch)

- [x] 1.1 Migration `supabase/migrations/20260807120000_14_refill_matching_estado_borrador.sql`
- [x] 1.2 Migration `supabase/migrations/20260807120100_15_refill_matching_completitud_diferida.sql`
- [x] 1.3 Applied both locally via `supabase db reset`; verified all 8 named scenarios against real Postgres; confirmed no already-applied migration edited
- [x] 1.4 `shared/database/schema.ts`: `RefillUrgenciaRow`, `RefillEstadoRow`, `RefillRequestsTable`, `RefillItemsTable` + `DB` registration
- [x] 1.5 `packages/types/src/refill-matching.ts` rewritten per design.md D-B/D-D.2 verbatim
- [x] 1.6 RED (type-level): `domain/refill-item-borrador.type-test.ts`
- [x] 1.7 GREEN: `pnpm --filter @repon/types typecheck` + workspace-root `pnpm typecheck` — `catalogo` confirmed compiling untouched
- [x] 1.8 `domains/refill-matching/ports-out/refill-repository.port.ts` rewritten to final form (D-G.2): `save`, `findById`, `findBorradorByConsumption` (NEW), `actualizarEstado` (NEW)
- [x] 1.9 `domains/refill-matching/domain/refill.errors.ts` (NEW): 6 error classes
- [x] 1.10 `pnpm lint && pnpm typecheck` green at workspace root, zero implementers of the extended `RefillRepository`

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `supabase/migrations/20260807120000_14_refill_matching_estado_borrador.sql` | Created | Single statement: `alter type public.refill_estado add value 'borrador' before 'abierta'` + full doc-comment rationale (why one statement only — Postgres forbids using a newly-added enum value in the same transaction that added it — why `BEFORE 'abierta'`, why not reversible, D-A/R8) |
| `supabase/migrations/20260807120100_15_refill_matching_completitud_diferida.sql` | Created | `direccion`/`comuna` → nullable, `add column consumption_id uuid` (no FK, D-D.2) on `refill_requests`; `categoria`/`precio_referencia` → nullable on `refill_items`; 5 `comment on column` statements verbatim from design.md (incl. the `Number(null) === 0` warning inline on `precio_referencia`); partial unique index `refill_requests_borrador_por_consumo_uidx` on `(user_id, consumption_id) where estado = 'borrador' and consumption_id is not null` |
| `services/core-api/src/shared/database/schema.ts` | Modified | Added `RefillUrgenciaRow`, `RefillEstadoRow`, `RefillRequestsTable` (incl. `estado: Generated<RefillEstadoRow>`, `consumption_id: string \| null`), `RefillItemsTable` (incl. `categoria: string \| null`, `precio_referencia: string \| null`); registered both on `DB`; updated file header comment |
| `packages/types/src/refill-matching.ts` | Rewritten | `Urgencia`, `RefillEstado` (`'borrador'` first), `RefillEstadoActivo`, `RefillItemCommon`/`RefillItem` (**unchanged shape**), `RefillItemBorrador` (new sibling, no `?: never`), `RefillRequestCommon` (+`consumptionId?`), `RefillRequestBorrador`, `RefillRequestActiva`, `RefillRequest` discriminated union, `NuevoRefillItem` |
| `services/core-api/src/domains/refill-matching/domain/refill-item-borrador.type-test.ts` | Created | Type-only `@ts-expect-error` fixture proving `RefillItemBorrador[]` is not assignable to `CatalogQueryPort['buscarCoincidencias']`'s `RefillItem[]` parameter — compile-time backstop for D3 |
| `services/core-api/src/domains/refill-matching/ports-out/refill-repository.port.ts` | Rewritten | `RefillRepository` final form: `save`, `findById`, `findBorradorByConsumption` (NEW, D-D.3), `actualizarEstado` (NEW, D-G.2/D6) — each doc-commented with its rationale |
| `services/core-api/src/domains/refill-matching/domain/refill.errors.ts` | Created | `RefillRequestNotFoundError`, `SolicitudEnBorradorError`, `TransicionInvalidaError`, `SolicitudIncompletaError`, `RefillItemDesconocidoError`, `SolicitudInvalidaError` |
| `openspec/changes/backend-core-api-refill-matching/tasks.md` | Modified | Tasks 1.1–1.10 marked `[x]` |

## Commands Run and Results

| Command | Result |
|---|---|
| `git status --porcelain supabase/migrations/` (before/after `db reset`) | Only the 2 new migration files untracked, both before and after — confirms no already-applied migration touched |
| `supabase db reset` | Applied all 16 migrations incl. the 2 new ones cleanly; seed ran; containers restarted |
| `psql` verification block (8 scenarios) | Enum order `borrador(0) < abierta(1) < ofertada(2) < confirmada(3)`; borrador insert with `direccion`/`comuna`/`categoria`/`precio_referencia` all `NULL` succeeds; existing `abierta` semantics unaffected; a borrador with one complete + one incomplete item persists with no CHECK violation; a second `(user_id, consumption_id)` insert while `estado='borrador'` raises `duplicate key value violates unique constraint "refill_requests_borrador_por_consumo_uidx"`; after transitioning the first request to `'abierta'`, a new borrador for the same `consumption_id` inserts cleanly; `pg_constraint` shows zero `FOREIGN KEY` on `consumption_id` (only `user_id`'s pre-existing FK); `information_schema.role_table_grants` confirms `service_role` already has `INSERT`/`SELECT`/`UPDATE` on both tables (from batch `10`, unchanged) |
| `cd packages/types && pnpm typecheck` | `tsc --noEmit` — clean |
| `pnpm typecheck` (workspace root) | Both `packages/types` and `services/core-api` — clean; `catalogo`'s `kysely-catalog-query.adapter.ts`/`catalog-query.port.ts` compile with zero diff (`git status --porcelain services/core-api/src/domains/catalogo/` → empty) |
| `pnpm lint` (workspace root) | `eslint .` — clean, 0 errors/warnings |
| `cd services/core-api && pnpm test` | 49 unit suites / 356 tests passed; 13 e2e suites / 83 tests passed — zero regressions on `identidad`/`catalogo`/`consumo` (one transient failure observed when `test`/`build` were launched concurrently with `lint`/`typecheck` in parallel tool calls — resource contention, not a real failure; re-ran standalone twice, both fully green) |
| `cd services/core-api && pnpm build` | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root) | First run: 1 file flagged (`refill-repository.port.ts`, one long doc-comment line) → fixed via `npx prettier --write` on that file only → re-ran `lint`/`typecheck`/`test`/`build`, all green afterward |

## Deviations from Design

None — implementation matches design.md's D-A / D-B / D-D.2 / D-G.2 / D-E (error table)
sections and the exact DDL/type/port shapes it specifies, verbatim. The one operational
deviation was a formatting-only auto-fix (`prettier --write` on one file after
`format:check` flagged a line-wrap issue) and one transient test-suite flake caused by
running two gate commands concurrently in parallel tool calls — neither is a design
deviation; both were re-verified green in isolation afterward.

**Review-budget note**: tasks.md's own forecast for PR1 was 320–400 changed lines and
flagged it as one of 4 borderline PRs to watch. The actual diff came in at 427 changed
lines (399 insertions + 28 deletions across 7 files: 2 new migrations, `schema.ts`,
`@repon/types`'s full rewrite, the type-test fixture, the repository port rewrite, and
the 6 new error classes) — about 7% over the upper estimate, not a "clearly exceeds
budget" case per the orchestrator's stated threshold for invoking the named PR1a/PR1b
fallback split. The diff stayed a single, cohesive, minimal-surface-area review unit
(pure scaffolding, zero behavior, zero implementers) and splitting it after the fact
would have meant re-deriving DB-layer-vs-TS-layer boundaries with no benefit to
reviewability, so it was kept whole. Flagged here for the reviewer's awareness rather
than silently absorbed.

## Issues Found

None. `pnpm lint`/`pnpm typecheck` compiled cleanly with zero implementers of the
extended `RefillRepository` (`findBorradorByConsumption`/`actualizarEstado`), exactly as
task 1.10 anticipated — TypeScript's structural typing requires no implementer to exist
for an interface declaration to typecheck; a class only needs to satisfy the shape once
one is written (Phase 3 for `save`/`findById`/`findBorradorByConsumption`, Phase 7 for
`actualizarEstado`).

## What PR2 (next batch) should know

- Groundwork is fully in place: both migrations applied and verified against real
  Postgres, both row types, the full `@repon/types` rewrite (discriminated union +
  `RefillItemBorrador` sibling type + `NuevoRefillItem`), the finalized `RefillRepository`
  port (4 methods, 2 new), and all 6 domain error classes.
- **D-B's central claim is now compile-time enforced, not just documented**: passing a
  `RefillItemBorrador[]` where `RefillItem[]` is expected fails `tsc`. PR2's
  `completar()` transition (Phase 2, task 2.6) should lean on this — the discriminated
  union narrowing is what should make its return type `RefillRequestActiva` without a
  cast, not a runtime `if` alone.
- `RefillItem`'s shape is untouched — verified twice: once by workspace `pnpm typecheck`
  passing with `catalogo`'s files at zero git diff, and once by intentionally breaking
  the type-test's `@ts-expect-error` to confirm a real error sits underneath it.
- Local Supabase already has both migrations live (via `supabase db reset`) — no
  migration work needed for Phase 2 (pure domain logic, zero I/O per tasks.md).
- Phase 2 (tasks 2.1–2.8) is genuinely strict-TDD from the first task: RED
  (`domain/refill-request.entity.spec.ts`) before GREEN
  (`domain/refill-request.entity.ts`), covering `crearSolicitudActiva()`,
  `crearBorrador()`, `completar()`, and the 2 state-machine transitions
  (`marcarOfertada`/`marcarConfirmada`) — all in one file, extended across 4 RED/GREEN
  pairs per tasks.md.
- `domain/refill.errors.ts` already exports all 6 classes Phase 2 needs
  (`SolicitudInvalidaError` for `crearSolicitudActiva`, `SolicitudIncompletaError` +
  `RefillItemDesconocidoError` for `completar()`, `TransicionInvalidaError` for the
  state machine) — PR2 should import, not redeclare.
- `RefillRepository` still has **zero implementers** — that lands incrementally:
  `save`/`findById` in Phase 3 (`kysely-refill.repository.ts`, the `Number(null) === 0`
  mapper callout), `findBorradorByConsumption` also in Phase 3, `actualizarEstado` used
  first by Phase 7's `marcarComoOfertada`/`marcarComoConfirmada`.
- Per tasks.md's 10-PR chain, PR2's scope is strictly domain-only: extend
  `domain/refill-request.entity.ts` across 4 RED/GREEN pairs (2.1–2.8) — no adapters, no
  HTTP, no I/O. Estimated 260-340 lines, Low risk.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload Forecast — resolved)
- Current work unit: Unit 1 "Groundwork" — PR1
- Boundary: starts from `main` (no prior refill-matching groundwork existed beyond the
  thin placeholder module + 2-method port); ends with a fully compiling, zero-behavior
  scaffolding commit — 2 migrations + row types + `@repon/types` rewrite + finalized
  ports-out + 6 domain error classes, all gates green
- Estimated review budget impact: 427 changed lines, ~7% over tasks.md's 320-400
  estimate for this PR — see "Deviations from Design" note above; kept as one PR per
  the orchestrator's "proceed as-is unless meaningfully over" guidance

## Status

10/10 tasks in this batch complete. Ready for next batch (PR2, Phase 2 — dominio puro).
