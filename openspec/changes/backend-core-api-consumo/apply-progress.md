# Apply Progress: `backend-core-api-consumo`

**Mode**: Strict TDD (project-wide `strict_tdd: true`, `openspec/config.yaml`)
**Batch**: PR1 "Groundwork" (Phase 1, tasks 1.1–1.10) — FIRST apply batch, no prior progress existed.

## TDD Note for This Batch

Phase 1 is pure scaffolding by design (design.md's own PR table: "Cero comportamiento,
puras costuras"; tasks.md: "strict_tdd: true is active for every task introducing real
logic — RED items are failing tests written first"). None of tasks 1.1–1.10 introduce
real logic — no RED/GREEN test cycle applies to this batch. The first RED/GREEN tasks
are 2a.1/2a.2 onward (Phase 2a, next batch). This is not a deviation from strict TDD; it
mirrors `catalogo` tasks.md's own PR 1 precedent (interfaces/row-types/constants land
without tests, verified instead by `pnpm lint`/`pnpm typecheck` compiling cleanly with
zero implementers).

## Completed Tasks (10/10 in this batch)

- [x] 1.1 Migration `supabase/migrations/20260806120000_13_consumo_stock_bajo_debounce.sql`
- [x] 1.2 Applied locally via `supabase db reset`; verified no already-applied migration edited
- [x] 1.3 `shared/database/schema.ts`: `PetsTable`, `UserConsumptionTable`, `ConsumptionLogsTable` + `DB` registration
- [x] 1.4 `packages/types/src/consumo.ts`: `UserConsumption.userId: string` added
- [x] 1.5 `domains/consumo/ports-out/pet-repository.port.ts` (NEW): `PetRepository` + `PET_REPOSITORY`
- [x] 1.6 `domains/consumo/ports-out/consumption-repository.port.ts` extended: `findById`, `findDueForCheck(umbralDias, tx?)`, `intentarMarcarStockBajo`, `limpiarMarcaStockBajo`, `descontarStock`
- [x] 1.7 Confirmed `consumption-log-repository.port.ts` needs no edit (no file change)
- [x] 1.8 `domains/consumo/domain/consumo.constants.ts` (NEW): `UMBRAL_STOCK_BAJO_DIAS = 7`
- [x] 1.9 `domains/consumo/domain/consumo.errors.ts` (NEW): 5 error classes
- [x] 1.10 `pnpm lint && pnpm typecheck` green with zero implementers of the new/extended ports

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `supabase/migrations/20260806120000_13_consumo_stock_bajo_debounce.sql` | Created | `alter table user_consumption add column stock_bajo_notificado_at timestamptz` + full rationale `comment on column` (D-A) |
| `services/core-api/src/shared/database/schema.ts` | Modified | Added `OwnerTypeRow`, `ConsumptionKindRow`, `PetsTable`, `UserConsumptionTable`, `ConsumptionLogsTable`; registered all 3 on `DB`; updated file header comment |
| `packages/types/src/consumo.ts` | Modified | Added `userId: string` to `UserConsumption` (D15), doc-commented |
| `services/core-api/src/domains/consumo/ports-out/pet-repository.port.ts` | Created | New `PetRepository` port (`save`, `findById`) + `PET_REPOSITORY` token (D-H.1) |
| `services/core-api/src/domains/consumo/ports-out/consumption-repository.port.ts` | Modified | Extended `ConsumptionRepository` with `findById`, `findDueForCheck(umbralDias, tx?)`, `intentarMarcarStockBajo`, `limpiarMarcaStockBajo`, `descontarStock`, each doc-commented with the CAS/clamp/superset contract from D-A/D-C/D-H.2 |
| `services/core-api/src/domains/consumo/ports-out/consumption-log-repository.port.ts` | Confirmed, not edited | Signatures already match every later-PR use in design.md/tasks.md |
| `services/core-api/src/domains/consumo/domain/consumo.constants.ts` | Created | `UMBRAL_STOCK_BAJO_DIAS = 7` + lead-time rationale (D-B) |
| `services/core-api/src/domains/consumo/domain/consumo.errors.ts` | Created | `ConsumptionNotFoundError`, `PetNotFoundError`, `ConsumoInvalidoError`, `MascotaInvalidaError`, `DosisInvalidaError` |
| `openspec/changes/backend-core-api-consumo/tasks.md` | Modified | Tasks 1.1–1.10 marked `[x]` |

## Commands Run and Results

| Command | Result |
|---|---|
| `git status --porcelain supabase/migrations/` (before reset) | Only the new migration file untracked — confirms no pre-existing migration touched |
| `supabase db reset` | Applied all 14 migrations incl. the new one cleanly; seed ran; containers restarted |
| `psql \d public.user_consumption` | Confirms `stock_bajo_notificado_at \| timestamp with time zone` column present |
| `git status --porcelain` / `git diff --stat supabase/migrations/` (after reset) | Still only the new file untracked; zero diff on any already-applied migration |
| `cd packages/types && pnpm typecheck` | `tsc --noEmit` — clean |
| `pnpm lint` (workspace root) | `eslint .` — clean, 0 errors/warnings |
| `pnpm typecheck` (workspace root) | Both `packages/types` and `services/core-api` — clean |
| `pnpm test` (workspace root) | `services/core-api`: 36 unit suites / 235 tests passed; 8 e2e suites / 54 tests passed. Zero regressions on `identidad`/`catalogo` |
| `pnpm build` (workspace root) | `services/core-api`: `tsc -p tsconfig.build.json` — clean |
| `pnpm format:check` (workspace root) | First run: 1 file flagged (`consumption-repository.port.ts`, line-wrap on a long JSDoc/signature line) → fixed via `npx prettier --write` on that file only → re-ran `format:check`, `lint`, `typecheck`, and `pnpm test` (core-api) again, all green |

## Deviations from Design

None — implementation matches design.md's D-A / D-B / D-H.1 / D-H.2 / D12 / D15 sections
and the exact DDL/row-type/port shapes it specifies, verbatim. The one operational
deviation was a formatting-only auto-fix (`prettier --write` on one file after
`format:check` flagged a line-wrap issue) — not a design deviation, and re-verified
green across lint/typecheck/test afterward.

## Issues Found

None. `pnpm lint`/`pnpm typecheck` compiled cleanly with zero implementers of
`PetRepository` or the extended `ConsumptionRepository` methods, exactly as task 1.10
anticipated (TypeScript structural typing requires no implementer to exist for an
interface declaration to typecheck; a class only needs to satisfy the shape once one is
written, in Phase 2b/3/4/6a).

## What PR2a (next batch) should know

- Groundwork is fully in place: row types, `@repon/types.UserConsumption.userId`, both
  finalized ports-out (`PetRepository` new, `ConsumptionRepository` extended), the
  `UMBRAL_STOCK_BAJO_DIAS` constant, and all 5 domain error classes.
- Local Supabase already has the `stock_bajo_notificado_at` column live (via
  `supabase db reset`) — no migration work needed for Phase 2a/2b.
- Phase 2a (tasks 2a.1–2a.6) is genuinely strict-TDD from the first task: RED
  (`pet.entity.spec.ts`) before GREEN (`pet.entity.ts`), and so on for
  `user-consumption.entity.ts` and `consumo.calculos.ts`. Zero I/O, zero adapters —
  fully isolated unit tests.
- `domain/consumo.errors.ts` already exports `MascotaInvalidaError` (for
  `pet.entity.ts`) and `ConsumoInvalidoError` (for `user-consumption.entity.ts`) — PR2a
  should import, not redeclare.
- `domain/consumo.constants.ts` is not yet consumed by PR2a's pure calculation
  functions (`consumoDiario`/`diasRestantes`/`mensajeStockBajo` take `umbralDias` as a
  parameter per design.md's Diagram 1 step 2a) — it becomes load-bearing starting PR6a
  (`findDueForCheck(UMBRAL_STOCK_BAJO_DIAS)`) and inside the future
  `ProcesarConsumosVencidosUseCase` (PR6b).
- `ConsumptionRepository`/`PetRepository` still have **zero implementers** — that lands
  incrementally: `findById` (PR2a's `kysely-consumption.repository.ts`, task 2b.1/2b.2),
  `save` extended (PR3), `descontarStock` (PR4), the CAS methods (PR6a).
- Per tasks.md's revised 10-PR chain (maintainer-resolved `ask-on-risk` split), PR2a's
  scope is strictly domain-only: `pet.entity.ts`, `user-consumption.entity.ts`,
  `consumo.calculos.ts` — no adapters, no HTTP, no e2e. Estimated 300-380 lines, Low
  risk.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload Forecast — resolved)
- Current work unit: Unit 1 "Groundwork" — PR1
- Boundary: starts from `main` (no prior consumo groundwork existed); ends with a fully
  compiling, zero-behavior scaffolding commit — migration + row types + finalized
  ports-out + domain constants/errors, all gates green
- Estimated review budget impact: within the 200-270 line estimate from tasks.md's
  Per-PR table (Low risk)

## Status

10/10 tasks in this batch complete. Ready for next batch (PR2a, Phase 2a — dominio puro).
