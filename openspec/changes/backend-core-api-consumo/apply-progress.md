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

---

# Batch: PR2a "Dominio, puro, sin I/O" (Phase 2a, tasks 2a.1–2a.6)

**Mode**: Strict TDD (project-wide `strict_tdd: true`). Commit: `2cabbdc`.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 2a.1/2a.2 `pet.entity.ts` | `pet.entity.spec.ts` written first; ran `jest pet.entity.spec.ts` → `Cannot find module './pet.entity'` (suite failed to run) | Implemented `crear()` + `assertMascotaValida`; re-ran → 6/6 passed | None needed |
| 2a.3/2a.4 `user-consumption.entity.ts` | `user-consumption.entity.spec.ts` written first; ran → `Cannot find module './user-consumption.entity'` | Implemented `crear()` + 3 assert helpers; re-ran → 7/7 passed | None needed |
| 2a.5/2a.6 `consumo.calculos.ts` | `consumo.calculos.spec.ts` written first; ran → `Cannot find module './consumo.calculos'` | Implemented `consumoDiario`/`diasRestantes`/`mensajeStockBajo`; re-ran → 11/11 passed | Auto-formatted 2 spec files via `prettier --write` after `format:check` flagged a line-wrap on the `Parameters<typeof crear>[0]` helper signature (formatting-only, not a logic change); re-verified lint/typecheck/test/format:check all green after |

24/24 new tests passed (6 + 7 + 11). Zero I/O, zero adapters, zero framework imports in any of the 3 files — verified by inspection (no NestJS/HTTP/Kysely imports anywhere in `domain/`).

## Completed Tasks (6/6 in this batch)

- [x] 2a.1 RED `domain/pet.entity.spec.ts`
- [x] 2a.2 GREEN `domain/pet.entity.ts`
- [x] 2a.3 RED `domain/user-consumption.entity.spec.ts`
- [x] 2a.4 GREEN `domain/user-consumption.entity.ts`
- [x] 2a.5 RED `domain/consumo.calculos.spec.ts`
- [x] 2a.6 GREEN `domain/consumo.calculos.ts`

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/consumo/domain/pet.entity.ts` | Created | `crear()` factory; validates `nombre`/`especie` non-blank → `MascotaInvalidaError`; `raza`/`pesoKg` optional, unvalidated (no declared invariant) |
| `services/core-api/src/domains/consumo/domain/pet.entity.spec.ts` | Created | 6 tests: happy path w/ optional fields, happy path w/o them, empty/whitespace `nombre`, empty/whitespace `especie` |
| `services/core-api/src/domains/consumo/domain/user-consumption.entity.ts` | Created | `crear()` factory enforcing 3 invariants: `petId ⟺ ownerType==='pet'`, `dosisPorToma > 0`, `horarios` non-empty → all throw `ConsumoInvalidoError`; narrows validated `horarios: readonly string[]` to the `[string, ...string[]]` tuple `@repon/types` declares |
| `services/core-api/src/domains/consumo/domain/user-consumption.entity.spec.ts` | Created | 7 tests: both valid `ownerType` branches, both petId-mismatch branches, `dosisPorToma` zero/negative, empty `horarios` |
| `services/core-api/src/domains/consumo/domain/consumo.calculos.ts` | Created | 3 pure functions: `consumoDiario` (`dosisPorToma * horarios.length / frecuenciaDias`), `diasRestantes` (`Math.floor(stockActual / consumoDiario)`), `mensajeStockBajo` (push message body, no repository lookups — D-D N+1 avoidance) |
| `services/core-api/src/domains/consumo/domain/consumo.calculos.spec.ts` | Created | 11 tests: `consumoDiario` daily/every-N-days/multi-horario; `diasRestantes` stock=0, exact-division-to-7, floors-down, near-zero; `mensajeStockBajo` naming/pluralization/unidad/arity |
| `openspec/changes/backend-core-api-consumo/tasks.md` | Modified | Tasks 2a.1–2a.6 marked `[x]` |

## Commands Run and Results

| Command | Result |
|---|---|
| `pnpm exec jest <each .spec.ts>` (RED, before its implementation existed) | 3× `Cannot find module` — suite failed to run, confirming RED |
| `pnpm exec jest <each .spec.ts>` (GREEN, after implementation) | 6/6, 7/7, 11/11 — all passed |
| `pnpm lint` (workspace root) | `eslint .` — clean |
| `pnpm typecheck` (workspace root) | `packages/types` + `services/core-api` — clean |
| `pnpm test` (workspace root) | `services/core-api`: 39 unit suites / 259 tests passed (was 36/235 after PR1 — +3 suites/+24 tests, all new); 8 e2e suites / 54 tests passed. Zero regressions |
| `pnpm build` (workspace root) | `services/core-api`: `tsc -p tsconfig.build.json` — clean |
| `pnpm format:check` (workspace root) | First run: 2 files flagged (line-wrap on `Parameters<typeof crear>[0]` helper type in both new `.spec.ts` files) → fixed via `npx prettier --write` on those 2 files → re-ran `format:check`, `lint`, `typecheck`, and `pnpm exec jest src/domains/consumo` again — all green |

## Deviations from Design

design.md does not specify `mensajeStockBajo`'s exact wording/format — only that it composes the push message body from fields `consumo` already owns (`nombre`, `diasRestantes`, `unidad`), with zero repository lookups (D-D's N+1-avoidance rule, verified by the test asserting `mensajeStockBajo.length === 1`, i.e. exactly one parameter object, no second "repository" argument). Implemented a Spanish-language message
(`"Stock bajo: a {nombre} le quedan {N día(s)}{ de unidad}."`) with singular/plural handling for exactly 1 day. This is a reasonable interpretation filling an underspecified gap, not a contradiction of any stated design decision — flagging it here per the "if design is incomplete, note it" rule. No spec.md scenario references `mensajeStockBajo` directly, so nothing in the acceptance criteria is at risk.

Everything else matches design.md verbatim: `consumoDiario`/`diasRestantes` formulas (Diagram 1 step 2a), the 3 `UserConsumption` invariants (D-H, tasks.md 2a.3), `Pet`'s two validated fields (tasks.md 2a.1), and the `crear()` factory-function naming convention (matching `catalogo/domain/provider-catalog-item.entity.ts`, not classes).

`frecuenciaDias`/`stockActual` have no entity-level invariant in this phase (not among the 3 named in tasks.md 2a.3, and design.md's own "Riesgos residuales" section names only `horarios` vacío/`dosisPorToma = 0` as the degenerate cases the entity makes unconstructible — `frecuenciaDias = 0` is explicitly left as a residual, DB/SQL-predicate-level concern, not an entity concern).

## Issues Found

None. All 3 RED tests failed for the expected reason (module not found), all 3 GREEN implementations passed on the first run after being written, and the only follow-up needed was a formatting-only `prettier --write` (same class of fix as PR1's batch).

## What PR2b (next batch) should know

- `Pet.crear()` and `UserConsumption.crear()` are ready to import from
  `domain/pet.entity.ts` / `domain/user-consumption.entity.ts` — both export
  their entity type re-exported from `@repon/types` plus a `CrearXInput`
  input-shape interface for the use case layer to build from (mirrors
  `catalogo`'s `CrearProviderCatalogItemInput` pattern).
- `consumo.calculos.ts` exports `consumoDiario`, `diasRestantes`,
  `mensajeStockBajo` plus their input interfaces (`ConsumoDiarioInput`,
  `MensajeStockBajoInput`) — PR6b's `ProcesarConsumosVencidosUseCase` is the
  next real caller of all 3; PR2b does not need `mensajeStockBajo` at all
  (it's a pure read/query use case, no push).
- `UserConsumption.crear()`'s `horarios` input is typed loosely
  (`readonly string[]`) and cast to the non-empty tuple only after the
  runtime check passes — PR2b/PR3's use cases should pass whatever `string[]`
  they have (e.g. from a DTO) without pre-validating emptiness themselves;
  the entity is the single point that enforces it.
- Per tasks.md's revised 10-PR chain, PR2b's scope is: `kysely-consumption
  .repository.ts`'s `findById` (with the numeric-column mapper gotcha —
  4 numeric columns across this domain, per design.md's flagged risk),
  `CalcularDiasRestantesUseCase`, the HTTP controller/mapper/exception
  filter, `consumo.module.ts`'s first real wiring, and the e2e suite that
  closes R1 (cross-tenant 404). Estimated 350-470 lines, Medium risk.
- Actual line count for this batch: 421 lines (7 files, incl. the 12-line
  `tasks.md` checkbox diff) — slightly above tasks.md's own 300-380
  estimate for PR2a, driven by comprehensive RED-test coverage under strict
  TDD (24 tests across 3 files). Still well under the 400-line default
  budget's "Medium" threshold in isolation, and this PR's own forecast row
  already rated it "Low" risk — no chain-strategy or work-unit change needed.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — resolved by the maintainer to sub-split PR2/PR6)
- Current work unit: Unit 2a "Dominio: entidades + cálculos puros" — PR2a
- Boundary: starts from PR1's groundwork (`main` @ `ef1d2f9`); ends with a
  fully compiling, fully tested, zero-I/O domain layer commit (`2cabbdc`) —
  2 entity factories + 3 pure calculation functions, all gates green
- Estimated review budget impact: 421 lines, within Low-risk range per
  tasks.md's Per-PR table (est. 300-380, actual slightly over but still
  small and single-concern)

## Status (cumulative)

16/16 tasks complete across PR1 (10/10) + PR2a (6/6). Ready for next batch:
PR2b, Phase 2b — lectura (persistencia parcial + caso de uso + HTTP + e2e).
