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

---

**Batch**: PR2 "Dominio puro" (Phase 2, tasks 2.1–2.8).

## TDD Note for This Batch

Genuinely strict-TDD from the first task: RED (`domain/refill-request.entity.spec.ts`)
before GREEN (`domain/refill-request.entity.ts`), across 4 RED/GREEN pairs — 26 tests
total. `completar()`'s 3 negative scenarios (missing `direccion`, missing `comuna`, an
item missing `categoria`/`precioReferencia`) were written before its happy path, per
convention. The sub-agent that wrote this batch died mid-flight (spend limit) right
after confirming "All 26 tests GREEN" and before checking off tasks or running the full
gate suite — the orchestrator picked up from there: reviewed both files in full,
re-ran the unit suite in isolation (26/26 green), then all 5 gates workspace-wide.

## What Was Built

- `crearSolicitudActiva(userId, items, direccion, comuna, urgencia)` — manual-path
  factory. Validates the full `SolicitudInvalidaError` surface named in that error
  class's own doc-comment (empty `items`/`direccion`/`comuna`, plus per-item empty
  `nombre`/`categoria` or negative `precioReferencia`) — a superset of tasks.md 2.1's
  minimum, justified as defense-in-depth ahead of Phase 4b's DTO validation, mirroring
  `provider-catalog-item.entity.ts`'s `assertProductoValido` precedent. Returns
  `RefillRequestActiva` with `estado: 'abierta'` by construction; ids via `randomUUID()`
  for the request and every item.
- `crearBorrador(input: CrearBorradorInput)` — automatic-path factory. Signature has no
  `direccion`/`comuna`/`categoria`/`precioReferencia` at all (the listener has none of
  those, D3). Caller supplies `id`/item ids already generated. Returns
  `RefillRequestBorrador` with `estado: 'borrador'` by construction, no completeness
  check (a borrador is defined as incomplete).
- `completar(borrador, input: CompletarInput)` — the `'borrador' → 'abierta'` transition.
  Pure function, never mutates `borrador`/`input` (verified in tests via
  `structuredClone` snapshots compared after a thrown rejection). Items are updated
  in place: output array has the same length/ids/order as `borrador.items`, values come
  from `input.items` when present, else fall back to whatever the borrador item already
  carried (a borrador item legally can carry `categoria`/`precioReferencia` — D-B).
  Unknown `refillItemId` in the input → `RefillItemDesconocidoError`, checked before the
  completeness pass. Missing `direccion`/`comuna`/any item's `categoria`/`precioReferencia`
  → `SolicitudIncompletaError`. Return type is `RefillRequestActiva` with no cast — the
  literal object shape (`estado: 'abierta'`, `items: RefillItem[]`) satisfies the
  discriminated union directly (D-B's compile-time guarantee, exercised for the first
  time here since PR1 only proved it in the type-test fixture).
- `marcarOfertada(activa)` / `marcarConfirmada(ofertada)` — the remaining 2 state-machine
  transitions. Both pure (return a new object via spread, never mutate the input), both
  reject out-of-order calls with `TransicionInvalidaError`. No caller in this change
  (D6) — `KyselyRefillRepository.actualizarEstado` (Phase 7) will persist their output.

## Deviations from Design

None. `CompletarRefillItemInput`/`CompletarInput` were declared in
`refill-request.entity.ts` itself rather than `@repon/types` — consistent with D-B
(cross-domain-shared types only go in `@repon/types`; this shape is internal to
`completar()`'s own caller, Phase 6b's `CompletarBorradorUseCase`, one file away from
where design.md originally placed it).

## Issues Found

None beyond the sub-agent's spend-limit interruption (process issue, not a code issue —
see TDD Note above). All 5 gates green: `pnpm lint`, `pnpm typecheck` (workspace root,
`catalogo`/PR1 unaffected), `pnpm test` (382 unit tests total, up from 356 baseline —
26 new), `pnpm build`, `pnpm format:check` (2 files needed a `prettier --write` pass,
applied and re-verified).

## What PR3 (next batch) should know

- `domain/refill-request.entity.ts` now exports: `crearSolicitudActiva`,
  `crearBorrador` (+ `CrearBorradorInput`), `completar` (+ `CompletarInput`,
  `CompletarRefillItemInput`), `marcarOfertada`, `marcarConfirmada`. `RefillRequest` is
  re-exported from this file too (`export type { RefillRequest }`) — Phase 3's
  `KyselyRefillRepository` should import the entity/type from here, not duplicate a
  type-only import from `@repon/types` for `RefillRequest` specifically.
- `RefillRepository`'s 4 methods (`save`, `findById`, `findBorradorByConsumption`,
  `actualizarEstado`) still have zero implementers — Phase 3 is where that changes.
  `save`/`findById` need to persist/rehydrate the full discriminated union (borrador vs.
  activa) — the mapper must read `estado` to decide which shape to build, matching how
  `completar()`'s return type narrowing works here at the domain layer.
- The `Number(null) === 0` mapper callout design.md flagged as PR3's highest
  mechanical-risk item is still unaddressed — nothing in PR2 touches persistence.
- No adapters, no HTTP, no I/O were added in this batch — `refill-matching.module.ts`
  still only wires PR1's groundwork; Phase 3 is the first batch that touches
  `adapters/`.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload Forecast)
- Current work unit: Unit 2 "Dominio puro" — PR2
- Boundary: starts from PR1's groundwork commit; ends with `domain/refill-request.entity.ts`
  + its spec file, zero adapters/I/O, all gates green
- Actual size: 715 lines added (entity.ts 291 lines, entity.spec.ts 424 lines) —
  meaningfully over tasks.md's 260-340 estimate (roughly 2x). Flagged honestly rather
  than silently absorbed: the overrun is concentrated in the spec file (26 tests,
  several with `structuredClone` snapshot assertions for non-mutation, plus heavy
  doc-comments cross-referencing design.md/tasks.md per this codebase's convention) and
  in doc-comments in the entity file itself (e.g. `assertSolicitudValida`'s comment
  justifying the superset validation). No split is proposed: both files are already the
  minimum structural unit design.md specifies (one entity file across 4 RED/GREEN pairs,
  its one co-located spec) — splitting either would cut across a single cohesive
  RED/GREEN sequence, not along a real seam. Kept as one PR; noting for `sdd-tasks`'
  future estimates that domain files with heavy non-mutation test coverage in this repo
  tend to run larger than the 260-340 baseline.

## Status

18/18 tasks complete across PR1+PR2. Ready for next batch (PR3, Phase 3 — persistencia,
`KyselyRefillRepository`).
