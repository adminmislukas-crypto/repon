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

---

# Batch: PR2b "Lectura" (Phase 2b, tasks 2b.1–2b.9)

**Mode**: Strict TDD (project-wide `strict_tdd: true`).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 2b.1/2b.2 `kysely-consumption.repository.ts` (`findById`) | `kysely-consumption.repository.spec.ts` written first; ran `jest kysely-consumption.repository.spec.ts` → `Cannot find module './kysely-consumption.repository'` (suite failed to run) | Implemented `KyselyConsumptionRepository implements ConsumptionRepository` — `findById` real, the other 5 interface methods throw named "not yet available, lands in PR X" errors (mirrors `catalogo`'s `KyselyCatalogRepository` PR-1 convention, verified against `git show` of that file's first commit); re-ran → 4/4 passed | None needed |
| 2b.3/2b.4 `calcular-dias-restantes.use-case.ts` | `calcular-dias-restantes.use-case.spec.ts` written first (cross-tenant 404 case FIRST, per D16 convention); ran → `Cannot find module './calcular-dias-restantes.use-case'` | Implemented `CalcularDiasRestantesUseCase` — constructor takes only `CONSUMPTION_REPOSITORY`; `findById` miss or foreign `userId` both throw the same `ConsumptionNotFoundError`; re-ran → 6/6 passed | None needed |
| 2b.6/2b.7 `consumo-exception.filter.ts` | `consumo-exception.filter.spec.ts` written first; ran → `Cannot find module './consumo-exception.filter'` | Implemented `ConsumoExceptionFilter` mirroring `CatalogoExceptionFilter`'s constructor-keyed map shape, `@Catch(ConsumptionNotFoundError)` only (this PR's sole mapped class); re-ran → 1/1 passed | None needed |

11/11 new unit tests passed (4 + 6 + 1). 2b.5 (DTO/mapper/controller) and 2b.8 (module wiring) are not RED/GREEN tasks per tasks.md (no test file named) — built directly, then proven end-to-end by 2b.9's e2e suite (5/5 passed on first run, no fix-up needed).

## Completed Tasks (9/9 in this batch)

- [x] 2b.1 RED `adapters/persistence/kysely-consumption.repository.spec.ts`
- [x] 2b.2 GREEN `adapters/persistence/kysely-consumption.repository.ts`
- [x] 2b.3 RED `ports-in/calcular-dias-restantes.use-case.spec.ts`
- [x] 2b.4 GREEN `ports-in/calcular-dias-restantes.use-case.ts`
- [x] 2b.5 `adapters/http/dto/dias-restantes-response.dto.ts` + `consumo.mapper.ts` + `adapters/http/consumo.controller.ts`
- [x] 2b.6 RED `adapters/http/consumo-exception.filter.spec.ts`
- [x] 2b.7 GREEN `adapters/http/consumo-exception.filter.ts`
- [x] 2b.8 `consumo.module.ts` real wiring
- [x] 2b.9 E2e `test/consumo-dias-restantes.e2e-spec.ts`

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.spec.ts` | Created | 4 tests: numeric mapper (`dosis_por_toma`/`stock_actual` string→number), `petId` pass-through on `ownerType: 'pet'`, `WHERE id = $1` query shape, `null` on no match |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.ts` | Created | `KyselyConsumptionRepository implements ConsumptionRepository` — `findById` real (with the numeric mapper); `save`/`findDueForCheck`/`intentarMarcarStockBajo`/`limpiarMarcaStockBajo`/`descontarStock` throw named "not yet implemented, lands in PR N" errors, mirroring `catalogo`'s PR-1 `KyselyCatalogRepository` convention (verified against that file's first git commit, not guessed) |
| `services/core-api/src/domains/consumo/ports-in/calcular-dias-restantes.use-case.spec.ts` | Created | 6 tests: cross-tenant 404 (written first), genuinely-missing 404, byte-identical-error assertion (constructor + message), happy path, `Math.floor` edge (partial day), constructor-arity inspection (`.length === 1`) |
| `services/core-api/src/domains/consumo/ports-in/calcular-dias-restantes.use-case.ts` | Created | `CalcularDiasRestantesUseCase` — constructor injects ONLY `CONSUMPTION_REPOSITORY` (D2/R4 structural CQS guarantee); `findById` miss or `userId` mismatch → `ConsumptionNotFoundError`; delegates to PR2a's `consumoDiario`/`diasRestantes` pure functions |
| `services/core-api/src/domains/consumo/adapters/http/dto/dias-restantes-response.dto.ts` | Created | `DiasRestantesResponseDto { diasRestantes: number }` |
| `services/core-api/src/domains/consumo/adapters/http/consumo.mapper.ts` | Created | `toDiasRestantesResponseDto(diasRestantes: number)` — thin scalar→DTO conversion |
| `services/core-api/src/domains/consumo/adapters/http/consumo.controller.ts` | Created | `ConsumoController` — `GET mis-consumos/:consumptionId/dias-restantes`, authenticated (no `@Roles`, mirrors `GET /catalogo/productos`'s reasoning), `mis-` URL prefix encodes D8 (`actor.profileId` only, never a path param), `@UseFilters(ConsumoExceptionFilter)` |
| `services/core-api/src/domains/consumo/adapters/http/consumo-exception.filter.spec.ts` | Created | 1 test (table-driven, extensible): `ConsumptionNotFoundError` → 404 `CONSUMPTION_NOT_FOUND` |
| `services/core-api/src/domains/consumo/adapters/http/consumo-exception.filter.ts` | Created | `ConsumoExceptionFilter` mirroring `CatalogoExceptionFilter`'s constructor-keyed-map shape exactly; `@Catch(ConsumptionNotFoundError)` only (this PR's scope) |
| `services/core-api/src/domains/consumo/consumo.module.ts` | Modified | From `@Module({})` placeholder to real wiring: `CONSUMPTION_REPOSITORY`→`KyselyConsumptionRepository`, `CalcularDiasRestantesUseCase` provider, `ConsumoController`, `exports: []` (D9/D14) |
| `services/core-api/test/consumo-dias-restantes.e2e-spec.ts` | Created | 5 tests: happy path (200 + body shape), 404 cross-tenant, 404 genuinely-missing (byte-identical), 401 no token, 400 non-UUID `consumptionId` (`ParseUUIDPipe`) — real `AuthGuard`/`ValidationPipe`/`ConsumoExceptionFilter`, only `ACTOR_PORT`/`CONSUMPTION_REPOSITORY` overridden, no local Supabase required |
| `openspec/changes/backend-core-api-consumo/tasks.md` | Modified | Tasks 2b.1–2b.9 marked `[x]` |

## Commands Run and Results

| Command | Result |
|---|---|
| `pnpm exec jest <each new .spec.ts>` (RED, before its implementation existed) | 3× `Cannot find module` — suite failed to run, confirming RED, for the repository, use-case, and filter specs |
| `pnpm exec jest <each new .spec.ts>` (GREEN, after implementation) | 4/4, 6/6, 1/1 — all passed on first run |
| `pnpm exec jest --config ./test/jest-e2e.json test/consumo-dias-restantes.e2e-spec.ts` | 5/5 passed on first run — no fix-up needed |
| `pnpm lint` (workspace root) | `eslint .` — clean |
| `pnpm typecheck` (`services/core-api`) | `tsc -p tsconfig.json --noEmit` — clean |
| `pnpm test` (`services/core-api`) | 42 unit suites / 270 tests passed (was 39/259 after PR2a — +3 suites/+11 tests, all new); 9 e2e suites / 59 tests passed (was 8/54 — +1 suite/+5 tests). Zero regressions |
| `pnpm build` (`services/core-api`) | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root) | First run: 5 files flagged (line-wrap issues across the new repository/use-case/filter/DTO/e2e files) → fixed via `npx prettier --write` on those 5 files only → re-ran `format:check`, `lint`, `typecheck`, `pnpm test`, `pnpm build` again — all green (same recurring formatting-only gap as PR1/PR2a's batches) |

## Deviations from Design

**One structural decision NOT explicit in design.md, resolved by direct precedent**: design.md's own PR table describes `KyselyConsumptionRepository`'s `findById` landing in "PR 2" without specifying whether the class declares the full `ConsumptionRepository` interface (with throwing stubs for not-yet-built methods) or only a partial `Pick<...>`. Resolved by inspecting `catalogo`'s actual first commit (`git show 24fe29a:.../kysely-catalog.repository.ts`) rather than guessing: `KyselyCatalogRepository` declared `implements CatalogRepository` (the full interface) from its very first PR, with `save`/`saveMany` throwing named, loud "implemented in PR N" errors. Followed that exact precedent here — `KyselyConsumptionRepository implements ConsumptionRepository` with 5 of 6 methods throwing named errors naming their landing PR (3/4/6a). This is not a deviation from design.md so much as design.md leaving a mechanical detail to "mirror catalogo," which this batch verified against the actual git history instead of assuming.

Everything else matches design.md verbatim: the `numeric`-as-`string` mapper gotcha (flagged explicitly as "el detalle mecánico de mayor riesgo del cambio"), the byte-identical 404 rule for cross-tenant vs. missing (Diagram 3), the CQS structural guarantee (constructor injects only `CONSUMPTION_REPOSITORY`), the `mis-` URL prefix encoding D8, the no-`@Roles` decision (mirrors `GET /catalogo/productos`'s stated reasoning), and `consumo.module.ts`'s `exports: []`.

## Issues Found

None. All 3 RED tests failed for the expected reason (module not found), all 3 GREEN implementations passed on first run, the e2e suite passed 5/5 on first run with zero fix-up, and the only follow-up needed was the same formatting-only `prettier --write` pattern every prior batch has hit.

**Line-count risk flagged for the orchestrator/reviewer**: this batch's actual diff is 798 insertions / 14 deletions = 812 changed lines (`git diff --cached --stat` across the 12 files this batch touches), well above both tasks.md's own PR2b estimate (350-470 lines) and the general 400-line review-budget default. The overage is driven by comprehensive RED-test coverage under strict TDD (11 new unit tests + 5 e2e tests, each asserting the byte-identical-404 property from multiple angles per design.md's explicit emphasis on R1) plus 3 full doc-commented new adapter/port-in files — no scope crept beyond tasks.md's exact 2b.1–2b.9 list, and no file outside this PR's assigned scope was touched. Flagging per the review-workload-guard rule rather than silently exceeding it; the maintainer's `stacked-to-main` chain strategy (already resolved in tasks.md, "Decision needed before apply: No") means this PR is still merged as its own independent, reviewable unit regardless of the overage — no re-split action taken without an explicit maintainer call, since PR2b's task list was fixed by the orchestrator's instructions and further splitting it was out of this batch's authority.

## What PR3 (next batch) should know

- `ConsumptionRepository`'s Kysely adapter now has ONE real method (`findById`)
  and 5 throwing stubs — PR3 implements `save` (extends this SAME file,
  `kysely-consumption.repository.ts`, per its own throwing-stub message)
  and creates the sibling `kysely-pet.repository.ts` (first caller of
  `PetRepository`).
- `CalcularDiasRestantesUseCase` is the reference shape for `MarcarDosisTomadaUseCase`'s
  (PR4) and `ConfigurarConsumoUseCase`'s (PR3) own D7 ownership checks —
  same `findById` → compare `userId` → throw pattern, different error class
  for `configurarConsumo`'s `petId` branch (`PetNotFoundError`, D-H.3).
- `ConsumoExceptionFilter`'s `@Catch()`/`ERROR_STATUS_MAP` is designed to be
  extended in place (append, not replace) — PR3 adds `PetNotFoundError`→404
  and `MascotaInvalidaError`/`ConsumoInvalidoError`→400 to the SAME file's
  spec and implementation, exactly as `catalogo`'s filter grew across its
  own PRs.
- `ConsumoController` currently has ONE route — PR3 adds `POST
  /consumo/mis-mascotas` and `POST /consumo/mis-consumos` to the SAME
  controller file/class (not a new controller), continuing to inject new
  use cases via the constructor.
- `consumo.module.ts`'s `providers` array grows incrementally — PR3 adds
  `PET_REPOSITORY`→`KyselyPetRepository`, `RegistrarMascotaUseCase`,
  `ConfigurarConsumoUseCase`. `exports: []` still holds and should keep
  holding through PR7's final audit.
- Per tasks.md's 10-PR chain, PR3's scope is `registrarMascota` +
  `configurarConsumo` (+ D-H.3 `petId` ownership check) + 2 `POST` routes +
  e2e. Estimated 350-450 lines, Medium risk — given this batch's actual
  overage vs. its own estimate, PR3 should budget review time
  generously rather than assume the tasks.md estimate is a hard ceiling.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — resolved by the maintainer to sub-split PR2/PR6, "Decision
  needed before apply: No")
- Current work unit: Unit 2b "Lectura: persistencia parcial + `calcularDiasRestantes`
  + HTTP + e2e" — PR2b
- Boundary: starts from PR2a's domain layer (`main` @ `2cabbdc`/`10201d0`);
  ends with a fully compiling, fully tested read-path commit — `findById`
  read adapter + the query use case + controller/mapper/filter/DTO + module
  wiring + e2e proof of R1 (cross-tenant 404), all gates green
- Estimated review budget impact: 812 changed lines (798 insertions / 14
  deletions) — ABOVE tasks.md's own 350-470 estimate and above the 400-line
  default budget; flagged above under "Issues Found" for reviewer awareness,
  no further split taken (scope was fixed by the orchestrator's explicit
  task assignment)

## Status (cumulative)

25/25 tasks complete across PR1 (10/10) + PR2a (6/6) + PR2b (9/9). Ready for
next batch: PR3, Phase 3 — escritura (`registrarMascota` + `configurarConsumo`).

---

# Batch: PR3 "Escritura" (Phase 3, tasks 3.1–3.16)

**Mode**: Strict TDD (project-wide `strict_tdd: true`).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 3.1/3.2 `registrar-mascota.use-case.ts` | `registrar-mascota.use-case.spec.ts` written first; ran `jest registrar-mascota.use-case.spec.ts` → `Cannot find module './registrar-mascota.use-case'` (suite failed to run) | Implemented `RegistrarMascotaUseCase` — `userId` an explicit param, `id` via `randomUUID()`, delegates to Phase 2a's `Pet.crear()`; re-ran → 4/4 passed | None needed |
| 3.3/3.4 + 3.5/3.6 `kysely-pet.repository.ts` (`save`+`findById`) | `kysely-pet.repository.spec.ts` written first (both methods in one file, per task assignment); ran → `Cannot find module './kysely-pet.repository'` | Implemented `KyselyPetRepository implements PetRepository` — `save()` upserts on `id` (mirrors `KyselyCompanyRepository`'s single-column-conflict shape, `peso_kg` numeric mapper), `findById()` mirrors `KyselyConsumptionRepository.findById`'s null-on-miss contract; re-ran → 8/8 passed | None needed |
| 3.7/3.8 `kysely-consumption.repository.ts` (`save`, extends PR2b's file) | Extended `kysely-consumption.repository.spec.ts` with a `save` describe block first; ran → 6 new tests failed against the existing "implemented in PR 3 ... not yet available" throwing stub (confirms RED against real code, not a missing module) | Implemented `save()` — upsert on `id`, `DO UPDATE SET` excludes `user_id` (D7) and `stock_bajo_notificado_at` (D-A: only the CAS methods write that column); re-ran → 10/10 passed | None needed |
| 3.9/3.10 `configurar-consumo.use-case.ts` | `configurar-consumo.use-case.spec.ts` written first, negative case (foreign `petId`) written BEFORE the happy path (D16 convention, same order as PR2b's R1 test); ran → `Cannot find module './configurar-consumo.use-case'` | Implemented `ConfigurarConsumoUseCase` — `petRepository.findById` checked BEFORE `crear()`/`save()` when `petId` is present, `PetNotFoundError` byte-identical for "missing" and "foreign", delegates to Phase 2a's `UserConsumption.crear()`; re-ran → 8/8 passed | None needed |
| 3.13/3.14 `consumo-exception.filter.ts` (extends PR2b's file) | Extended `consumo-exception.filter.spec.ts`'s `describe.each` table with 3 new rows (`PetNotFoundError`/`MascotaInvalidaError`/`ConsumoInvalidoError`) first; ran → 3 new cases failed (`500` instead of the expected `404`/`400`, confirming the map had no entry yet) | Added the 3 classes to `@Catch()` and `ERROR_STATUS_MAP`; re-ran → 4/4 passed | None needed |

30 new/changed unit tests passed (4 + 8 + 6 + 8 + 4, net of the pre-existing 4 `findById`/1 filter tests already counted in PR2b's batch). 3.11/3.12/3.15 (DTOs, controller routes, module wiring) are not RED/GREEN tasks per tasks.md (no test file named for them individually) — built directly, then proven end-to-end by 3.16's 2 new e2e suites (11/11 passed on first run, no fix-up needed).

## Completed Tasks (16/16 in this batch)

- [x] 3.1 RED `ports-in/registrar-mascota.use-case.spec.ts`
- [x] 3.2 GREEN `ports-in/registrar-mascota.use-case.ts`
- [x] 3.3 RED `adapters/persistence/kysely-pet.repository.spec.ts` (`save`)
- [x] 3.4 GREEN `adapters/persistence/kysely-pet.repository.ts` (`save`)
- [x] 3.5 RED (same file) `findById()`
- [x] 3.6 GREEN (same file) `findById()`
- [x] 3.7 RED (extend `kysely-consumption.repository.spec.ts`) `save()`
- [x] 3.8 GREEN (extend `kysely-consumption.repository.ts`) `save()`
- [x] 3.9 RED `ports-in/configurar-consumo.use-case.spec.ts`
- [x] 3.10 GREEN `ports-in/configurar-consumo.use-case.ts`
- [x] 3.11 DTOs (`nueva-mascota.dto.ts`, `nuevo-consumo.dto.ts`, `pet-response.dto.ts`, `user-consumption-response.dto.ts`) + `consumo.mapper.ts` additions
- [x] 3.12 `adapters/http/consumo.controller.ts`: `POST /consumo/mis-mascotas` + `POST /consumo/mis-consumos`
- [x] 3.13 RED (extend `consumo-exception.filter.spec.ts`)
- [x] 3.14 GREEN (extend `consumo-exception.filter.ts`)
- [x] 3.15 `consumo.module.ts`: `PET_REPOSITORY` binding + 2 new use-case providers
- [x] 3.16 E2e `test/consumo-mis-mascotas.e2e-spec.ts` + `test/consumo-mis-consumos.e2e-spec.ts`

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/domains/consumo/ports-in/registrar-mascota.use-case.spec.ts` | Created | 4 tests: happy path, `userId` derives from the explicit param (D8), fresh `randomUUID()` id per call, minimal-payload happy path |
| `services/core-api/src/domains/consumo/ports-in/registrar-mascota.use-case.ts` | Created | `RegistrarMascotaUseCase` — `NuevaMascotaInput` (no `userId` field), `id` via `randomUUID()`, delegates invariant checks to `domain/pet.entity.ts`'s `crear()` |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-pet.repository.spec.ts` | Created | 8 tests: `save()` conflict-target/numeric-mapper/null-handling/`DO UPDATE SET` exclusions, `findById()` numeric mapper/null-mapping/query-shape/miss-returns-null |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-pet.repository.ts` | Created | `KyselyPetRepository implements PetRepository` (D-H.1, first implementer) — `save()` upserts on `id` (mirrors `KyselyCompanyRepository`'s single-column-conflict shape), `findById()` mirrors `KyselyConsumptionRepository`'s null-on-miss-never-throw contract |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.spec.ts` | Modified | Added a `save` describe block: 6 new tests (conflict target, numeric-column formatting, null-handling, `tx` propagation via a swapped mock-db handle, `DO UPDATE SET` excludes `user_id` and `stock_bajo_notificado_at`) |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.ts` | Modified | Implemented `save()` (`toUserConsumptionValues` reverse-mapper added), replacing the PR2b "not yet available" throwing stub; updated the class doc comment |
| `services/core-api/src/domains/consumo/ports-in/configurar-consumo.use-case.spec.ts` | Created | 8 tests: negative case FIRST (foreign `petId` → `PetNotFoundError`, no `save()` call), genuinely-missing `petId` (byte-identical), byte-identical-error assertion, happy path (own pet), no pet lookup when `ownerType: 'self'`, `userId` from actor only, fresh `randomUUID()` id, entity invariants still enforced |
| `services/core-api/src/domains/consumo/ports-in/configurar-consumo.use-case.ts` | Created | `ConfigurarConsumoUseCase` — `petRepository.findById` gated BEFORE `crear()`/`save()` whenever `config.petId` is present (D-H.3), delegates invariant checks to `domain/user-consumption.entity.ts`'s `crear()` |
| `services/core-api/src/domains/consumo/adapters/http/dto/nueva-mascota.dto.ts` | Created | `NuevaMascotaDto` — no `userId` field (D8); `class-validator` decorators mirroring `pet.entity.ts`'s invariants |
| `services/core-api/src/domains/consumo/adapters/http/dto/nuevo-consumo.dto.ts` | Created | `NuevoConsumoDto` — no `userId` field (D8); `petId` validated for shape only (`@IsUUID()`), ownership is a use-case concern |
| `services/core-api/src/domains/consumo/adapters/http/dto/pet-response.dto.ts` | Created | `PetResponseDto` |
| `services/core-api/src/domains/consumo/adapters/http/dto/user-consumption-response.dto.ts` | Created | `UserConsumptionResponseDto` |
| `services/core-api/src/domains/consumo/adapters/http/consumo.mapper.ts` | Modified | Added `toNuevaMascotaInput`, `toPetResponseDto`, `toNuevoConsumoInput`, `toUserConsumptionResponseDto` |
| `services/core-api/src/domains/consumo/adapters/http/consumo.controller.ts` | Modified | Added `POST /consumo/mis-mascotas` (201) and `POST /consumo/mis-consumos` (201), both authenticated, no `@Roles` (mirrors the GET route's D8/auth reasoning); constructor now injects the 2 new use cases |
| `services/core-api/src/domains/consumo/adapters/http/consumo-exception.filter.spec.ts` | Modified | Extended the `describe.each` table with `PetNotFoundError`→404, `MascotaInvalidaError`→400, `ConsumoInvalidoError`→400 |
| `services/core-api/src/domains/consumo/adapters/http/consumo-exception.filter.ts` | Modified | Added the 3 classes to `@Catch()` and `ERROR_STATUS_MAP` |
| `services/core-api/src/domains/consumo/consumo.module.ts` | Modified | Bound `PET_REPOSITORY`→`KyselyPetRepository`; registered `RegistrarMascotaUseCase`/`ConfigurarConsumoUseCase`; `exports: []` still holds |
| `services/core-api/test/consumo-mis-mascotas.e2e-spec.ts` | Created | 4 tests: happy path (201), 400 on a client-supplied `userId` field (real global `ValidationPipe({whitelist:true, forbidNonWhitelisted:true})`), 400 on empty `nombre`, 401 unauthenticated |
| `services/core-api/test/consumo-mis-consumos.e2e-spec.ts` | Created | 7 tests: happy path `ownerType: 'self'`, happy path `ownerType: 'pet'` (own pet), 404 `PET_NOT_FOUND` on a foreign `petId` (no `save()` call), 404 on a genuinely missing `petId` (byte-identical), 400 on a client-supplied `userId` field, 400 on empty `horarios`, 401 unauthenticated |
| `openspec/changes/backend-core-api-consumo/tasks.md` | Modified | Tasks 3.1–3.16 marked `[x]` |

## Commands Run and Results

| Command | Result |
|---|---|
| `pnpm exec jest <each new .spec.ts>` (RED, before its implementation existed or against the still-throwing PR2b stub) | `registrar-mascota`/`kysely-pet.repository`/`configurar-consumo`: `Cannot find module` — suite failed to run. `kysely-consumption.repository.spec.ts`'s new `save` block: 6/6 new tests failed against the real "not yet available" throwing stub. `consumo-exception.filter.spec.ts`'s 3 new table rows: failed with `500` instead of the expected `404`/`400` |
| `pnpm exec jest <each new/extended .spec.ts>` (GREEN, after implementation) | 4/4, 8/8, 10/10 (6 new + 4 pre-existing), 8/8, 4/4 (3 new + 1 pre-existing) — all passed on first run after implementation |
| `pnpm exec jest src/domains/consumo` (full domain) | 9 suites / 64 tests passed |
| `pnpm exec jest --config ./test/jest-e2e.json test/consumo-mis-mascotas.e2e-spec.ts test/consumo-mis-consumos.e2e-spec.ts` | 2 suites / 11 tests passed on first run — no fix-up needed |
| `pnpm lint` (workspace root) | `eslint .` — clean |
| `pnpm typecheck` (`services/core-api`) | `tsc -p tsconfig.json --noEmit` — clean |
| `pnpm test` (`services/core-api`) | 45 unit suites / 299 tests passed (was 42/270 after PR2b — +3 suites/+29 tests, all new); 11 e2e suites / 70 tests passed (was 9/59 — +2 suites/+11 tests). Zero regressions on `identidad`/`catalogo` |
| `pnpm build` (`services/core-api`) | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root) | First run: 5 files flagged (line-wrap issues across the new `kysely-consumption.repository.spec.ts`/`kysely-pet.repository.spec.ts`/`configurar-consumo.use-case.spec.ts`/2 e2e files) → fixed via `npx prettier --write` on those 5 files only → re-ran `format:check`/`lint`/`typecheck`/`pnpm test`/`pnpm build` again — all green (same recurring formatting-only gap as every prior batch) |

## Deviations from Design

**One structural gap, deliberately deferred, not fixed in this PR**: design.md D-A states `configurarConsumo` clears the debounce marker (`stock_bajo_notificado_at`) on a full reconfiguration ("Reescribe la configuración completa... Un ítem reconfigurado es un contexto de alerta nuevo"), via `limpiarMarcaStockBajo`. That method still throws "not yet available" (its real implementation lands in PR 6a per design.md's own PR table and tasks.md's Phase 6a scope) — calling it from `ConfigurarConsumoUseCase` in this PR would break every write with a runtime throw. tasks.md's own task 3.10 description does not mention calling `limpiarMarcaStockBajo` either ("`findById` on `PET_REPOSITORY` before `save`, `randomUUID()` for the new id" — no debounce-clear step named). This is consistent with design.md's own dependency ordering (D-A's debounce machinery genuinely cannot exist before PR6a's CAS methods land), and is a no-op gap today regardless: no cron exists yet, so `stock_bajo_notificado_at` can never be non-null on any row `configurarConsumo` might reconfigure. Flagging here so PR6a's implementer wires the call into `ConfigurarConsumoUseCase` (not just the cron) when `limpiarMarcaStockBajo` lands for real — otherwise this D-A requirement stays silently unmet past PR6a.

Everything else matches design.md verbatim: the D-H.3 ownership check order (pet lookup BEFORE `crear()`/`save()`, zero partial writes on the reject path), the byte-identical 404 rule for "missing" vs. "foreign" `petId` (Diagrama 3), the D8 "no DTO exposes `userId`" structural guarantee (enforced by both the DTOs' field absence AND `main.ts`'s global `ValidationPipe({whitelist:true, forbidNonWhitelisted:true})`, proven at the e2e layer), `randomUUID()` id generation in the use case (D-H.1), and `KyselyPetRepository`/`KyselyConsumptionRepository.save()`'s upsert-on-`id` shape (mirroring `KyselyCompanyRepository`'s simplest-case precedent, since neither `Pet` nor `UserConsumption` has `ProviderCatalogItem`'s bifurcated conflict target).

## Issues Found

**Line-count risk flagged for the orchestrator/reviewer, same pattern as PR2b's batch**: this batch's actual diff is ~380 changed lines across 8 modified files plus ~1200 lines across 12 new files (≈1580 total), well above tasks.md's own PR3 estimate (350-450 lines) and the general 400-line review-budget default. The overage is driven by comprehensive RED-test coverage under strict TDD (30 new/changed unit tests across 5 RED/GREEN cycles, plus 11 new e2e tests across 2 new suites) — no scope crept beyond tasks.md's exact 3.1–3.16 list, and no file outside this PR's assigned scope was touched. Flagging per the review-workload-guard rule rather than silently exceeding it; the maintainer's `stacked-to-main` chain strategy (already resolved in tasks.md, "Decision needed before apply: No") means this PR is still merged as its own independent, reviewable unit regardless of the overage — no re-split action taken without an explicit maintainer call, consistent with how PR2b's own overage was handled.

Otherwise none: all RED tests failed for the expected reason (module-not-found, or a real throwing stub / missing map entry), all GREEN implementations passed on first run after being written, and both e2e suites passed on first run with zero fix-up.

## What PR4 (next batch) should know

- `ConsumptionRepository`'s Kysely adapter now has 2 real methods
  (`findById`, `save`) and 4 throwing stubs — PR4 extends the SAME file
  (`kysely-consumption.repository.ts`) to implement `descontarStock`
  (D-H.2, atomic clamp-at-0 decrement).
- `ConsumptionLogRepository` has ZERO implementers still — PR4 creates
  `kysely-consumption-log.repository.ts` (first caller), per tasks.md 4.3/4.4.
- `ConfigurarConsumoUseCase` is the reference shape for
  `MarcarDosisTomadaUseCase`'s D6 transactional write (same `findById` →
  compare `userId` → 404-before-any-write pattern, but PR4 additionally
  needs `TRANSACTION_MANAGER.runInTransaction` wrapping `append`+
  `descontarStock`, which this PR's use cases do NOT inject — `Mapa de
  transacciones` table: `configurarConsumo` needs no transaction, only
  `marcarDosisTomada` does).
- `ConsumoExceptionFilter`'s `@Catch()`/`ERROR_STATUS_MAP` is designed to be
  extended in place (append, not replace) — PR4 adds
  `DosisInvalidaError`→400 to the SAME file's spec and implementation.
- `ConsumoController` currently has 3 routes (`POST mis-mascotas`,
  `POST mis-consumos`, `GET .../dias-restantes`) — PR4 adds
  `POST /consumo/mis-consumos/:consumptionId/dosis` (204) to the SAME
  controller file/class.
- `consumo.module.ts`'s `providers` array grows incrementally — PR4 adds
  `CONSUMPTION_LOG_REPOSITORY`→`KyselyConsumptionLogRepository` and
  `MarcarDosisTomadaUseCase`. `exports: []` still holds and should keep
  holding through PR7's final audit.
- **The D-A debounce-clear gap named above under "Deviations from Design"**:
  PR6a's `limpiarMarcaStockBajo` implementer should also wire a call into
  `ConfigurarConsumoUseCase` (not just the cron), or explicitly re-confirm
  in that batch's own report why deferring it further is still safe.
- Per tasks.md's 10-PR chain, PR4's scope is `descontarStock` (atomic,
  D-H.2) + `MarcarDosisTomadaUseCase` (transactional, D6) + `DosisRegistrada`
  event + `POST .../dosis` route + e2e. Estimated 350-450 lines, Medium
  risk — given this batch's (and PR2b's) actual overage vs. their own
  estimates, PR4 should budget review time generously rather than assume
  the tasks.md estimate is a hard ceiling.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — resolved by the maintainer to sub-split PR2/PR6, "Decision
  needed before apply: No")
- Current work unit: Unit 3 "Escritura: `registrarMascota` + `configurarConsumo`" — PR3
- Boundary: starts from PR2b's read path (`main` @ `7ff9875`); ends with a
  fully compiling, fully tested write-path commit — `PetRepository`'s first
  implementer, `ConsumptionRepository.save()`, both mutating use cases, 2
  new `POST` routes, extended DTOs/mapper/exception-filter/module wiring,
  plus e2e proof of D-H.3 (404 on a foreign `petId`) and D8 (DTO rejects a
  client-supplied `userId`), all gates green
- Estimated review budget impact: ≈1580 changed lines — ABOVE tasks.md's own
  350-450 estimate and above the 400-line default budget; flagged above
  under "Issues Found" for reviewer awareness, no further split taken
  (scope was fixed by the orchestrator's explicit task assignment, same
  precedent as PR2b)

## Status (cumulative)

41/41 tasks complete across PR1 (10/10) + PR2a (6/6) + PR2b (9/9) + PR3
(16/16). Ready for next batch: PR4, Phase 4 — dosis (`descontarStock`
atómico + `marcarDosisTomada` transaccional + evento `DosisRegistrada`).

---

# Batch: PR4 "Dosis" (Phase 4, tasks 4.1–4.14)

**Mode**: Strict TDD (project-wide `strict_tdd: true`).

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 4.1/4.2 `kysely-consumption.repository.ts` (`descontarStock`) | Extended `kysely-consumption.repository.spec.ts` with a `descontarStock` describe block first; ran `jest kysely-consumption.repository.spec.ts` → 5/5 new tests failed against the existing real "not yet available" throwing stub (confirms RED against real code, not a missing module) | Implemented `descontarStock` — single `UPDATE ... SET stock_actual = greatest(stock_actual - $2, 0) ... RETURNING stock_actual` via Kysely's `sql` tag, never a prior read; re-ran → 15/15 passed (10 pre-existing + 5 new) | None needed |
| 4.3/4.4 `kysely-consumption-log.repository.ts` (NEW, first implementer) | `kysely-consumption-log.repository.spec.ts` written first; ran → `Cannot find module './kysely-consumption-log.repository'` | Implemented `KyselyConsumptionLogRepository.append()` (pure insert, `id` always caller-supplied per D-H.1) + `adherenciaUltimos7Dias()` minimally (no caller in this change's scope, doc-commented as such, deliberately NOT a throwing stub — see "Deviations" below); re-ran → 5/5 passed | None needed |
| 4.5/4.6 `marcar-dosis-tomada.use-case.ts` (NEW) | `marcar-dosis-tomada.use-case.spec.ts` written first — cross-tenant 404 case FIRST (D16 convention, same discipline as PR2b/PR3); ran → `Cannot find module './marcar-dosis-tomada.use-case'` | Implemented `MarcarDosisTomadaUseCase` — ownership read (`findById`) runs INSIDE `runInTransaction` on the same `tx` as both writes (design.md Diagram 2 + "Mapa de transacciones", see "Deviations" below), `cantidad` always `consumption.dosisPorToma`, `publish(DosisRegistrada)` only after the transaction resolves, `tomadoAt` resolved/validated here (`DosisInvalidaError` on a future timestamp beyond a 1-minute clock-skew tolerance); re-ran → 12/12 passed | None needed |
| 4.10/4.11 `consumo-exception.filter.ts` (extends PR2b/PR3's file) | Extended `consumo-exception.filter.spec.ts`'s `describe.each` table with a `DosisInvalidaError` row first; ran → new case failed (`500` instead of the expected `400`, confirming the map had no entry yet) | Added `DosisInvalidaError` to `@Catch()` and `ERROR_STATUS_MAP`; re-ran → 5/5 passed | None needed |

37 new/changed unit tests passed (5 + 5 + 12 + 1 net-new, plus the 10
pre-existing `kysely-consumption.repository.spec.ts` tests and 4
pre-existing filter tests already counted in prior batches' totals). 4.7
(`dosis-registrada.event.ts`), 4.8 (DTO), 4.9 (controller route), 4.12
(module wiring) are not RED/GREEN tasks per tasks.md (no test file named
individually) — built directly, then proven end-to-end by 4.13's e2e suite
(8/8 passed on first run, no fix-up needed) and 4.14's opt-in integration
suite (3/3 passed against a REAL local Postgres — this sandbox had a live
`supabase start` stack running, so this suite was actually executed, not
just written; see "Genuine Discovery" below).

## Completed Tasks (14/14 in this batch)

- [x] 4.1 RED (extend `kysely-consumption.repository.spec.ts`): `descontarStock`
- [x] 4.2 GREEN (extend the file): implements `descontarStock` (D-H.2)
- [x] 4.3 RED `adapters/persistence/kysely-consumption-log.repository.spec.ts` (NEW)
- [x] 4.4 GREEN `adapters/persistence/kysely-consumption-log.repository.ts` (NEW)
- [x] 4.5 RED `ports-in/marcar-dosis-tomada.use-case.spec.ts` (NEW)
- [x] 4.6 GREEN `ports-in/marcar-dosis-tomada.use-case.ts` (NEW)
- [x] 4.7 `events/dosis-registrada.event.ts` (NEW)
- [x] 4.8 `adapters/http/dto/marcar-dosis.dto.ts` (NEW)
- [x] 4.9 `adapters/http/consumo.controller.ts`: `POST .../dosis` route
- [x] 4.10 RED (extend the exception filter spec): `DosisInvalidaError`→400
- [x] 4.11 GREEN (extend the filter)
- [x] 4.12 `consumo.module.ts`: register `CONSUMPTION_LOG_REPOSITORY`/`MarcarDosisTomadaUseCase`
- [x] 4.13 E2e `test/consumo-marcar-dosis.e2e-spec.ts`
- [x] 4.14 Opt-in integration test `test/consumo-descontar-stock.integration-spec.ts`

## Files Changed

| File | Action | What Was Done | Lines |
|------|--------|----------------|-------|
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.spec.ts` | Modified | Added a `descontarStock` describe block: 5 tests — single `UPDATE`/never a prior `SELECT` (atomicity), the `SET` value is a raw SQL expression inspected via `RawBuilder.toOperationNode()` (public kysely API, not internals) to assert the exact `greatest(stock_actual - $1, 0)` shape and its one parameter, numeric-string formatting, `RETURNING` string→number conversion, `tx` propagation | +110 |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.ts` | Modified | Implemented `descontarStock()` — replaces the PR2b/PR3 "not yet available" throwing stub with a single `updateTable().set({ stock_actual: sql\`greatest(stock_actual - ${cantidad.toFixed(2)}, 0)\` }).where('id','=',id).returning('stock_actual').executeTakeFirstOrThrow()`; updated the class doc comment | +35/-16 |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption-log.repository.spec.ts` | Created | 5 tests: insert with caller-supplied `id`, numeric-column string formatting for `cantidad`, `null` on absent `cantidad`, `tomado_at` passthrough, `tx` propagation | +96 |
| `services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption-log.repository.ts` | Created | `KyselyConsumptionLogRepository implements ConsumptionLogRepository` (D-H.2, first implementer) — `append()` is a pure insert (never upsert: append-only health record); `adherenciaUltimos7Dias()` implemented minimally (real `count(*)` query over the existing `consumption_logs_consumption_id_tomado_at_idx` index) rather than a throwing stub, doc-commented as intentionally unused-so-far | +74 |
| `services/core-api/src/domains/consumo/ports-in/marcar-dosis-tomada.use-case.spec.ts` | Created | 12 tests across 6 describe blocks: cross-tenant/not-found (3, byte-identical rejection + zero mutation), transactional wiring (2, same `tx` across `findById`/`append`/`descontarStock` + failure-in-second-write), publish-after-commit (2), `cantidad` always configured-dose (1), clamp-at-zero flow-through (1), `tomadoAt` resolution (3: absent→now(), future→`DosisInvalidaError` before transaction opens, past→verbatim) | +311 |
| `services/core-api/src/domains/consumo/ports-in/marcar-dosis-tomada.use-case.ts` | Created | `MarcarDosisTomadaUseCase` — ownership read INSIDE `runInTransaction` (see "Deviations"), `cantidad` always `consumption.dosisPorToma`, `resolveTomadoAt()` helper (1-minute clock-skew tolerance, doc-commented as a reasonable default, not a measured product decision), `publish(DosisRegistrada)` after the transaction resolves | +115 |
| `services/core-api/src/domains/consumo/events/dosis-registrada.event.ts` | Created | `DosisRegistrada implements DomainEvent` — exact D-D payload: `consumptionId, userId, tomadoAt, cantidad, stockRestante`; `type = 'consumo.dosis_registrada'` | +32 |
| `services/core-api/src/domains/consumo/adapters/http/dto/marcar-dosis.dto.ts` | Created | `MarcarDosisDto { tomadoAt?: string }` — `@IsOptional() @IsISO8601()`; deliberately no `cantidad` field (D-H.2) | +25 |
| `services/core-api/src/domains/consumo/adapters/http/consumo.controller.ts` | Modified | Added `POST /consumo/mis-consumos/:consumptionId/dosis` (204, authenticated, no `@Roles`); constructor now injects `MarcarDosisTomadaUseCase` | +31 |
| `services/core-api/src/domains/consumo/adapters/http/consumo-exception.filter.spec.ts` | Modified | Extended the `describe.each` table with `DosisInvalidaError`→400 | +9 |
| `services/core-api/src/domains/consumo/adapters/http/consumo-exception.filter.ts` | Modified | Added `DosisInvalidaError` to `@Catch()` and `ERROR_STATUS_MAP` | +18 |
| `services/core-api/src/domains/consumo/consumo.module.ts` | Modified | Bound `CONSUMPTION_LOG_REPOSITORY`→`KyselyConsumptionLogRepository`; registered `MarcarDosisTomadaUseCase` | +20 |
| `services/core-api/test/consumo-marcar-dosis.e2e-spec.ts` | Created | 8 tests: happy path (204, decrements by `dosisPorToma`, log appended, `DosisRegistrada` published), 404 cross-tenant (zero mutation), 404 genuinely-missing, 400 future `tomadoAt` (transaction never opens), clamp-at-zero (still 204, `stockRestante: 0`), 400 on a client-supplied `cantidad` field, 401 unauthenticated, 400 non-UUID `consumptionId` — real `AuthGuard`/`ValidationPipe`/`ConsumoExceptionFilter`, `ACTOR_PORT`/`CONSUMPTION_REPOSITORY`/`CONSUMPTION_LOG_REPOSITORY`/`EVENT_PUBLISHER`/`TRANSACTION_MANAGER` overridden with fakes (mirrors `catalogo-ajustes-precio.e2e-spec.ts`'s override shape — the closest catalogo analog: a transactional, event-publishing mutation) | +302 |
| `services/core-api/test/consumo-descontar-stock.integration-spec.ts` | Created | Opt-in, 3 tests against a REAL local Postgres: normal decrement, clamp-to-0 (`stockActual < dosisPorToma`), two sequential calls both clamp. Follows the REPO's OWN pre-existing convention (`*.integration-spec.ts` + `test/jest-integration.json` + `pnpm --filter core-api test:integration`) — see "4.14 Gating Pattern" below | +105 |
| `openspec/changes/backend-core-api-consumo/tasks.md` | Modified | Tasks 4.1–4.14 marked `[x]` | +28/-28 (checkbox flips) |

**Total this batch**: 15 files, 1271 insertions / 40 deletions (`git diff --cached --stat`) — ABOVE tasks.md's own PR4 estimate (350-450 lines) and the 400-line default review budget. Same pattern as PR2b's (812 lines vs. 350-470 estimate) and PR3's (~1580 lines vs. 350-450 estimate) overages — driven by comprehensive RED-test coverage under strict TDD (37 new/changed unit tests + 8 e2e tests + 3 integration tests). No scope crept beyond tasks.md's exact 4.1–4.14 list; no file outside this PR's assigned scope was touched. Flagged per the review-workload-guard rule; the maintainer's `stacked-to-main` chain strategy (already resolved, "Decision needed before apply: No") means this PR still merges as its own independent, reviewable unit — no further split taken without an explicit maintainer call, consistent with PR2b/PR3's precedent.

## Commands Run and Results

| Command | Result |
|---|---|
| `pnpm exec jest src/domains/consumo/adapters/persistence/kysely-consumption.repository.spec.ts` (RED, before `descontarStock` was implemented) | 5/5 new tests failed against the real "not yet available" throwing stub |
| `pnpm exec jest src/domains/consumo/adapters/persistence/kysely-consumption.repository.spec.ts` (GREEN) | 15/15 passed (10 pre-existing + 5 new) |
| `pnpm exec jest src/domains/consumo/adapters/persistence/kysely-consumption-log.repository.spec.ts` (RED) | `Cannot find module` — suite failed to run |
| `pnpm exec jest src/domains/consumo/adapters/persistence/kysely-consumption-log.repository.spec.ts` (GREEN) | 5/5 passed |
| `pnpm exec jest src/domains/consumo/ports-in/marcar-dosis-tomada.use-case.spec.ts` (RED) | `Cannot find module` — suite failed to run |
| `pnpm exec jest src/domains/consumo/ports-in/marcar-dosis-tomada.use-case.spec.ts` (GREEN) | 12/12 passed |
| `pnpm exec jest src/domains/consumo/adapters/http/consumo-exception.filter.spec.ts` (RED) | New `DosisInvalidaError` case failed with `500` instead of `400` |
| `pnpm exec jest src/domains/consumo/adapters/http/consumo-exception.filter.spec.ts` (GREEN) | 5/5 passed |
| `pnpm exec jest --config ./test/jest-e2e.json test/consumo-marcar-dosis.e2e-spec.ts` | 8/8 passed on first run — no fix-up needed |
| `DATABASE_URL=... pnpm exec jest --config ./test/jest-integration.json test/consumo-descontar-stock.integration-spec.ts` | Ran against a REAL local Supabase Postgres stack (already running in this sandbox, `supabase_db_repon-monorepo` container healthy). First run: 1/3 failed on a formatting assumption (see "Genuine Discovery" below) → fixed the assertion, not the implementation → re-ran → 3/3 passed |
| `pnpm lint` (workspace root) | `eslint .` — clean |
| `cd services/core-api && pnpm typecheck` | `tsc -p tsconfig.json --noEmit` — clean |
| `cd services/core-api && pnpm test` | 47 unit suites / 322 tests passed (was 45/299 after PR3 — +2 suites/+23 tests, all new); 12 e2e suites / 78 tests passed (was 11/70 — +1 suite/+8 tests). Zero regressions on `identidad`/`catalogo`/prior `consumo` PRs |
| `cd services/core-api && pnpm build` | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root) | First run: 2 files flagged (line-wrap on the new `kysely-consumption-log.repository.spec.ts` / `marcar-dosis-tomada.use-case.spec.ts`) → fixed via `npx prettier --write` on those 2 files only → re-ran `format:check`/`lint`/`typecheck`/`pnpm test`/`pnpm build`/the integration suite again — all green (same recurring formatting-only gap as every prior batch) |

## Genuine Discovery (from the opt-in integration test actually running against real Postgres)

Real Postgres's `greatest(numeric, 0)` returns a **scale-0** numeric
(`'0'`) when the literal `0` branch wins, NOT `'0.00'` — the scale of the
*losing* operand does not carry over to the result. Discovered because this
sandbox happened to have a live local Supabase Postgres stack running, so
task 4.14's opt-in test was actually executed, not just written blind. The
first run failed on `expect(row.stock_actual).toBe('0.00')`; the real
column value was `'0'`. This is NOT a bug in `descontarStock` — `Number('0')
=== Number('0.00') === 0`, so the repository's own return value (already
asserted as `toBe(0)` in the same test) was correct either way — only the
raw-column assertion's format expectation was wrong. Fixed the test
assertion (`'0'` instead of `'0.00'`), documented the discovery inline in
the test file. This is precisely the class of thing D-H.2's opt-in
integration test exists to catch, and precisely why it should be re-run
whenever a local Supabase stack is available rather than treated as
permanently un-runnable.

## 4.14 Gating Pattern — Correction to the Launch Prompt's Assumption

The launch prompt anticipated "there may be no existing repo precedent" for
gating an opt-in integration test and asked me to invent one if needed
(e.g. `describe.skip` behind an env var). **That assumption was wrong — a
precedent already exists and is well-established**: `database
.integration-spec.ts`, `identidad-actor.integration-spec.ts`, and (this
change's own PR1) `catalogo-provider-catalog-upsert.integration-spec.ts`
all use the `*.integration-spec.ts` filename convention, picked up
EXCLUSIVELY by `test/jest-integration.json`
(`testRegex: "\\.integration-spec\\.ts$"`), run explicitly via
`pnpm --filter core-api test:integration`. This is safely excluded from
both `pnpm test` (`jest && jest --config ./test/jest-e2e.json` — the root
unit config's `rootDir` is `src/`, so `test/` isn't even scanned, and
`jest-e2e.json`'s `testRegex` requires the literal `e2e-spec.ts` suffix,
which `.integration-spec.ts` doesn't have) and from CI by construction, with
zero extra gating code needed (no `describe.skip`, no ad hoc env-var check).
`consumo-descontar-stock.integration-spec.ts` follows this exact,
already-proven convention. Flagging this correction explicitly since the
launch prompt asked me to "clearly flag this as a new pattern" if I
couldn't find precedent — I found one, so no new pattern was invented.

## Deviations from Design

**One deliberate deviation from the launch prompt's instruction, in favor
of design.md (the authoritative artifact) — flagged explicitly per the
"note it, don't silently deviate" rule**: the launch prompt instructed
"Ownership check (cross-tenant 404) BEFORE entering the transaction (mirror
`ajustar-precios-por-categoria.use-case.ts`'s 'checked BEFORE
runInTransaction' pattern)". Verified this against design.md directly and
found it contradicts two independent, explicit statements in design.md
itself:

1. **Diagram 2** (`marcarDosisTomada`: la transacción) shows `findById
   (consumptionId, tx)` as step **4a**, nested INSIDE `runInTransaction
   (D6) ============`, with the explicit note on the rejection branch (4b):
   *"Se lanza DENTRO de la transaccion: rollback sin escrituras"* (thrown
   INSIDE the transaction: rollback without writes).
2. **"Mapa de transacciones"** table lists `marcarDosisTomada`'s statement
   count as **"1 select + 1 insert + 1 update"** — the SELECT (the
   ownership read) is counted as one of the three statements INSIDE the
   transaction, not a separate pre-transaction read.

`ajustar-precios-por-categoria.use-case.ts`'s "checked before
`runInTransaction`" gates (`EmpresaNoActivaError`/`PorcentajeInvalidoError`)
validate **actor-supplied scalars already in hand** (`companyStatus`,
`porcentaje`) — no repository read is needed to evaluate them, so there is
nothing to gain from opening the transaction first. `actualizarPrecio`
(catalogo's closer analog — a mutating use case whose 404 check IS a
repository read) does its `findById` outside any transaction too, but for a
different, inapplicable reason: it has only ONE write (`save()`), so there
is no cross-write atomicity to protect and no `TRANSACTION_MANAGER`
injected at all. `marcarDosisTomada` has TWO coupled writes needing atomic
all-or-nothing semantics (D6), and design.md is explicit that the ownership
read participates in that same atomic unit. Implemented per design.md:
`findById` runs inside the `runInTransaction` callback, receives the same
`tx` as `append`/`descontarStock`, and a rejection there throws inside the
callback (rolling back with zero writes — verified by the unit test
`transactionManager.runInTransaction` mock actually invoking the callback
and the cross-tenant case still asserting zero `append`/`descontarStock`/
`publish` calls). This does not weaken the "zero mutation on reject"
guarantee the spec requires — it is the SAME guarantee, achieved via
transaction rollback semantics instead of via ordering relative to
`runInTransaction`.

**Second, smaller, resolved ambiguity**: `domain/consumo.errors.ts`'s
`DosisInvalidaError` doc comment (written in PR1) says *"Thrown by
`MarcarDosisTomadaUseCase`"*, while design.md's Diagram 2 step (2) lists
`tomadoAt` futuro → 400 as a controller-column item, informally. Resolved
in favor of the errors.ts doc comment (the more specific, code-level
commitment) — `tomadoAt` resolution/validation lives in the use case
(`resolveTomadoAt()`), not the controller, consistent with every other
domain error in this file being use-case/domain-thrown, never
controller-thrown, and keeping the controller a thin DTO-mapping layer per
`core-api-hexagonal-layout`. The controller passes the DTO's raw
`tomadoAt?: string` straight through unparsed.

Everything else matches design.md verbatim: the exact `descontarStock` SQL
shape (D-H.2), the exact `DosisRegistrada` payload (D-D), `cantidad` always
`= consumption.dosisPorToma` (never client-supplied — no such DTO field
exists), the clamp-at-0 living in the SQL/adapter layer rather than the
entity (D-H.2's own declared exception to the "entity validates" pattern),
and `publish(DosisRegistrada)` happening only after the transaction
resolves (D6).

## Issues Found

None beyond the two deviations documented above (both resolved by
consulting the authoritative design.md/errors.ts sources, not silently) and
the recurring formatting-only `prettier --write` step every prior batch has
also hit. The opt-in integration test's one real finding (Postgres
`greatest()`'s scale-0 result) is documented above as a genuine discovery,
not a defect.

## What PR5 (next batch) should know

- `consumo`'s 4 public use cases (`registrarMascota`, `configurarConsumo`,
  `marcarDosisTomada`, `calcularDiasRestantes`) are ALL implemented now —
  PR5 is `shared/notifications/` (the kernel), independent of `consumo`'s
  own module beyond the shared `NOTIFICATION_PORT` token it will bind.
- `consumo.module.ts`'s `providers` array now has: both repositories bound,
  `PET_REPOSITORY` bound, and all 4 use cases registered. `exports: []`
  still holds — PR7's final audit should re-confirm this after PR5/PR6a/
  PR6b/PR6c land (none of them touch `consumo.module.ts`'s `exports`).
- `MarcarDosisTomadaUseCase` is the reference shape for the future
  `ProcesarConsumosVencidosUseCase` (PR6b) on ONE point only —
  `publish(...)` after the write commits — but NOT on the transaction
  question: PR6b's use case must NOT inject `TRANSACTION_MANAGER` at all
  (D4), the opposite of this PR's use case, because the cron has no
  cross-item invariant to protect.
- The **D-A debounce-clear gap** named in PR3's own batch (`configurarConsumo`
  not yet calling `limpiarMarcaStockBajo`) is UNCHANGED by this PR —
  `marcarDosisTomada` deliberately never calls it either (design.md D-A:
  "No — Solo puede bajar el stock: jamás puede resolver la condición").
  Still PR6a's responsibility.
- Per tasks.md's 10-PR chain, PR5's scope is `shared/notifications/`:
  `PushTokenResolver`/`NullPushTokenResolver`/`ExpoPushNotificationAdapter`,
  `NotificationsModule` (`@Global()`, mirrors `AuditModule`'s shape),
  wiring into `SharedKernelModule`, and a full `identidad`+`catalogo`
  regression run (R5 — the only PR in this chain with kernel-wide blast
  radius). Estimated 180-260 lines, Low-Medium risk per tasks.md's own
  forecast — smaller than every consumo PR so far.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — resolved by the maintainer, "Decision needed before apply: No")
- Current work unit: Unit 4 "Dosis: `descontarStock` + `marcarDosisTomada`" — PR4
- Boundary: starts from PR3's write path (`main` @ `bcefbed`); ends with a
  fully compiling, fully tested dose-tracking commit — atomic SQL-level
  stock decrement, transactional log+decrement write, `DosisRegistrada`
  event, `POST .../dosis` route, extended exception filter, module wiring,
  e2e proof of the transaction/cross-tenant/clamp/future-timestamp
  scenarios, plus an opt-in integration proof against real Postgres, all
  gates green
- Estimated review budget impact: 1271 changed lines (1271 insertions / 40
  deletions) — ABOVE tasks.md's own 350-450 estimate and above the 400-line
  default budget; flagged above under "Files Changed"/"Issues Found" for
  reviewer awareness, no further split taken (scope was fixed by the
  orchestrator's explicit task assignment, same precedent as PR2b/PR3)

## Status (cumulative)

55/55 tasks complete across PR1 (10/10) + PR2a (6/6) + PR2b (9/9) + PR3
(16/16) + PR4 (14/14). Ready for next batch: PR5, Phase 5 — kernel de
notificaciones (`shared/notifications/`).

---

# Batch: PR5 "Kernel de notificaciones" (Phase 5, tasks 5.1–5.8)

**Mode**: Strict TDD (project-wide `strict_tdd: true`).

**Blast-radius note (R5)**: this is the first PR in the chain that touches
`shared/` — imported by the already-archived `identidad` and `catalogo`
domains, not just `consumo`. Per the launch instructions, task 5.8's
regression check ran against `identidad`/`catalogo` in isolation (not just
the full `pnpm test` roll-up) — see "Isolated Regression Proof (task 5.8)"
below.

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|---|---|---|---|
| 5.3/5.4 `expo-push-notification.adapter.ts` (NEW) | `expo-push-notification.adapter.spec.ts` written first — 4 cases (no token, mensaje-never-logged, resolver throws, token present/unreachable-today); ran `jest expo-push-notification.adapter.spec.ts` → `Cannot find module './expo-push-notification.adapter'` (suite failed to run) | Implemented `ExpoPushNotificationAdapter implements NotificationPort` per design.md D-G's exact code shape (`Logger.log` for `push.omitida`/`sin_token`, `Logger.warn` for `push.no_entregada`/`token_presente_sin_cliente_expo`, `Logger.error` for `push.error`; `mensaje` never passed to any logger call); re-ran → 4/4 passed | None needed |

4/4 new tests passed. 5.1/5.2 (`push-token-resolver.port.ts`,
`null-push-token.resolver.ts`) and 5.5/5.6 (`notifications.module.ts`,
`shared-kernel.module.ts` edit) are not RED/GREEN tasks per tasks.md (no
test file named for either — pure interface/token declarations and NestJS
module wiring, same class of task as PR1's ports/PR2b's module wiring) —
built directly, then proven by the full-suite regression run (task 5.8)
exercising real DI resolution through `SharedKernelModule`.

## Completed Tasks (8/8 in this batch)

- [x] 5.1 `shared/notifications/push-token-resolver.port.ts` (NEW): `PushTokenResolver` + `PUSH_TOKEN_RESOLVER`
- [x] 5.2 `shared/notifications/null-push-token.resolver.ts` (NEW): `NullPushTokenResolver`
- [x] 5.3 RED `shared/notifications/expo-push-notification.adapter.spec.ts` (NEW)
- [x] 5.4 GREEN `shared/notifications/expo-push-notification.adapter.ts` (NEW)
- [x] 5.5 `shared/notifications/notifications.module.ts` (NEW, `@Global()`)
- [x] 5.6 `shared/shared-kernel.module.ts` — add `NotificationsModule` to `imports`/`exports`; doc comment corrected
- [x] 5.7 Verification-only: confirmed `consumo.module.ts` has zero `NOTIFICATION_PORT` references
- [x] 5.8 Full `identidad`/`catalogo` regression run — zero regressions (isolated + full-suite proof below)

## Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `services/core-api/src/shared/notifications/push-token-resolver.port.ts` | Created | `PushTokenResolver { resolve(profileId): Promise<string \| null> }` interface + `PUSH_TOKEN_RESOLVER` token (D-G), doc-commented as the seam between today's no-op and a future real resolver |
| `services/core-api/src/shared/notifications/null-push-token.resolver.ts` | Created | `NullPushTokenResolver implements PushTokenResolver` — `resolve()` always returns `null`; doc comment explicitly names the missing capability (no push-token table exists anywhere in the schema, D10) as a deliberate stub, not an oversight |
| `services/core-api/src/shared/notifications/expo-push-notification.adapter.spec.ts` | Created | 4 tests: no-token → `push.omitida`/`sin_token` + resolves without throwing; `mensaje` content never appears in any logger call (health-data constraint, D-G); resolver rejects → `push.error`, still no throw; token present (unreachable today) → `push.no_entregada`/`token_presente_sin_cliente_expo` |
| `services/core-api/src/shared/notifications/expo-push-notification.adapter.ts` | Created | `ExpoPushNotificationAdapter implements NotificationPort` — `sendPush` never throws (D10 hard rule), `mensaje` never logged (only metadata: `recipientProfileId`, `evento`, `motivo`), exact insertion-point comment for a future `expo-server-sdk` client (D-G) |
| `services/core-api/src/shared/notifications/notifications.module.ts` | Created | `NotificationsModule`, `@Global()`, mirrors `AuditModule`'s shape exactly: `{ provide: PUSH_TOKEN_RESOLVER, useClass: NullPushTokenResolver }` + `{ provide: NOTIFICATION_PORT, useClass: ExpoPushNotificationAdapter }`; `exports: [NOTIFICATION_PORT]` only — `PUSH_TOKEN_RESOLVER` deliberately NOT exported (internal wiring detail, single consumer inside this module, per shared-notifications spec's own scenario) |
| `services/core-api/src/shared/shared-kernel.module.ts` | Modified | Added `NotificationsModule` to both `imports` and `exports`; rewrote the doc comment — `shared/notifications` no longer "declares tokens but binds no provider," only `shared/payments` still does |
| `openspec/changes/backend-core-api-consumo/tasks.md` | Modified | Tasks 5.1–5.8 marked `[x]` |

**Total this batch**: 6 files in `services/core-api/` (5 created, 1 modified), 242 insertions / 6 deletions = 248 changed lines (`git diff --cached --stat`); 264 changed lines including the `tasks.md` checkbox diff (16 lines) — within tasks.md's own 180-260 estimate for PR5 (code-only), the smallest `consumo` PR in the chain so far and the first to land inside its own forecast without overage.

## Commands Run and Results

| Command | Result |
|---|---|
| `pnpm exec jest src/shared/notifications/expo-push-notification.adapter.spec.ts` (RED, before the adapter existed) | `Cannot find module './expo-push-notification.adapter'` — suite failed to run, confirming RED |
| `pnpm exec jest src/shared/notifications/expo-push-notification.adapter.spec.ts` (GREEN, after implementation) | 4/4 passed |
| `pnpm eslint services/core-api/src/shared/notifications/expo-push-notification.adapter.ts` (mid-implementation check on the unused `mensaje` parameter) | 1 error (`@typescript-eslint/no-unused-vars`) on first pass without a `void mensaje;` guard → added the guard with an explanatory comment → re-ran → clean |
| `pnpm lint` (workspace root) | `eslint .` — clean |
| `cd services/core-api && pnpm typecheck` | `tsc -p tsconfig.json --noEmit` — clean |
| `cd services/core-api && pnpm test` | 48 unit suites / 326 tests passed (was 47/322 after PR4 — +1 suite/+4 tests, all new); 12 e2e suites / 78 tests passed (unchanged from PR4 — this batch added zero e2e tests, matching tasks.md's scope). Zero regressions |
| `cd services/core-api && pnpm build` | `tsc -p tsconfig.build.json` — clean |
| `pnpm run format:check` (workspace root) | First run: 1 file flagged (line-wrap on `expo-push-notification.adapter.ts`) → fixed via `npx prettier --write` on that file only → re-ran `format:check`/`lint`/`typecheck`/`pnpm test`/`pnpm build` again — all green (same recurring formatting-only gap as every prior batch) |

## Isolated Regression Proof (task 5.8)

Per R5's blast-radius warning, ran `identidad`'s and `catalogo`'s own test
suites in isolation, both BEFORE (via `git stash` of this batch's 6 files)
and AFTER this batch's `SharedKernelModule` edit, using the same targeted
Jest invocation both times:

| Suite | Before (`git stash`, PR4 HEAD `903d472`) | After (this batch) | Delta |
|---|---|---|---|
| `identidad` + shared-kernel modules (`src/domains/identidad src/shared/audit src/shared/auth src/shared/database src/shared/event-bus src/shared/supabase`) | 20 suites / 111 tests passed | 20 suites / 111 tests passed | **Zero** — identical suite/test counts |
| `catalogo` (`src/domains/catalogo`) | 15 suites / 115 tests passed | 15 suites / 115 tests passed | **Zero** — identical suite/test counts |

Since neither domain's own test files were touched by this batch (only
`shared/shared-kernel.module.ts` and net-new `shared/notifications/` files),
identical counts also mean identical assertions — no test was added,
removed, or modified in either domain. This closes R5 for PR5: the
`SharedKernelModule` edit adds a new `@Global()` import/export pair without
altering any existing module's shape.

## Deviations from Design

None — implementation matches design.md's D-G section verbatim, down to
the exact adapter code block (`Logger.log`/`warn`/`error` calls, the exact
`evento`/`motivo` string literals, the "insertion point" comment for a
future Expo client) and the shared-notifications spec.md's three named
scenarios ("NotificationsModule mirrors AuditModule's shape", "No-op-safe
on a missing token", "consumo.module.ts does not bind or export
NOTIFICATION_PORT"). One implementation-level addition not dictated by
either artifact: a `void mensaje;` guard line was needed to satisfy
`@typescript-eslint/no-unused-vars` (the `mensaje` parameter is genuinely
unused today — logging it is explicitly forbidden by D-G, and no Expo
client exists yet to consume it). This is a lint-compliance mechanic, not a
behavioral deviation; the design.md code sample simply doesn't show this
because design docs aren't lint-checked.

## Issues Found

None. The RED test failed for the expected reason (module not found), the
GREEN implementation passed on first run after being written, and the only
follow-up needed was the same recurring formatting-only `prettier --write`
step every prior batch has hit, plus the one-line `void mensaje;` lint fix
noted above.

## What PR6a (next batch) should know

- `NOTIFICATION_PORT` now resolves to a REAL adapter
  (`ExpoPushNotificationAdapter`) everywhere in the app via
  `SharedKernelModule`'s global export — PR6b's
  `ProcesarConsumosVencidosUseCase` (which depends on this PR per tasks.md's
  dependency table) can inject `NOTIFICATION_PORT` directly with zero
  additional wiring; it must NOT import `NotificationsModule` itself
  (already global) and must NOT bind/export `NOTIFICATION_PORT` from
  `consumo.module.ts` (verified clean in this batch's task 5.7, and that
  invariant must still hold after PR6b/PR6c land).
- `consumo.module.ts`'s `exports: []` is UNCHANGED by this batch (PR5 never
  touched `domains/consumo/` at all) — PR7's final audit should still
  re-confirm this after PR6a/PR6b/PR6c land, none of which are expected to
  touch `consumo.module.ts`'s `exports` either.
- PR6a's scope (repo CAS methods + event payloads) is entirely independent
  of this batch — it depends on PR1 (debounce column) and PR2a (pure
  calculation functions), not PR5. The two PRs can be reviewed/merged in
  either practical order relative to each other in principle, but tasks.md's
  stated chain keeps PR5 before PR6a because PR6b (which depends on BOTH)
  is next after PR6a in the sequence.
- This was the first `consumo` PR to land within its own tasks.md line
  estimate without overage (236 actual vs. 180-260 estimated) — every prior
  PR (2b/3/4) exceeded its estimate, driven by comprehensive RED-test
  coverage under strict TDD. PR6b is flagged in tasks.md's own forecast as
  "Medium-High" risk and "the caso de uso con más escenarios de todo el
  cambio" — budget review time generously there, consistent with the
  overage pattern in PR2b-PR4 rather than this batch's on-estimate outcome.

## Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md's Review Workload
  Forecast — resolved by the maintainer, "Decision needed before apply: No")
- Current work unit: Unit 5 "Kernel de notificaciones" — PR5
- Boundary: starts from PR4's dose-tracking commit (`main` @ `903d472`);
  ends with a fully compiling, fully tested shared-kernel commit — the
  `PushTokenResolver` seam, `NullPushTokenResolver` stub,
  `ExpoPushNotificationAdapter` (D-G's exact shape), `NotificationsModule`
  mirroring `AuditModule`, `SharedKernelModule` wiring, plus an isolated
  `identidad`/`catalogo` regression proof (R5), all gates green
- Estimated review budget impact: 248 changed lines (code-only, 242
  insertions / 6 deletions across 6 files) — WITHIN tasks.md's own 180-260
  estimate and well under the 400-line default budget; Low-Medium
  risk realized as Low in practice (the "Medium" half of the forecast's
  rating was about blast radius, not size, and the isolated regression
  proof above closes that concern)

## Status (cumulative)

63/63 tasks complete across PR1 (10/10) + PR2a (6/6) + PR2b (9/9) + PR3
(16/16) + PR4 (14/14) + PR5 (8/8). Ready for next batch: PR6a, Phase 6a —
repo CAS methods + payloads de eventos (`findDueForCheck`,
`intentarMarcarStockBajo`, `limpiarMarcaStockBajo`, `StockBajoDetectado`).
