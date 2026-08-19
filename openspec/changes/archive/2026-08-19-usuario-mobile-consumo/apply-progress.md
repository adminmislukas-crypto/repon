# Apply Progress: usuario-mobile-consumo

## PR1 (Phase 1) — `@repon/types` consumo view types — DONE

Applied directly by the orchestrator inline (established pattern this session — `sdd-apply` sub-agent launches have repeatedly hit tool-access gaps for `mem_save`, and inline execution has proven reliable across the whole `mobile-auth-login` chain).

### What was built (tasks 1.1–1.2, all complete)

- `packages/types/src/consumo.ts` — added 5 new exported types, exact shapes from `design.md` D-2/D-5:
  - `UserConsumptionListItem` — `UserConsumption & { diasRestantes: number }`, the `GET /consumo/mis-consumos` row shape.
  - `AdherenciaEstado` — `'cumplido' | 'parcial' | 'incumplido' | 'sin_datos'`.
  - `AdherenciaDia`, `AdherenciaItem`, `AdherenciaSemanal` — the 7-day adherence response shape, with the same rationale comments `design.md` D-2 states inline (fractional `esperadas` when `frecuenciaDias > 1`, `rachaDias` counts backwards from yesterday not today, a user with no activity gets a well-formed skeleton not `null`).
- No barrel change needed — `packages/types/src/index.ts` re-exports `consumo.ts` via `export *`, already covers the new types.

### Deviation from the literal task text, and why

Task 1.1 says "RED->GREEN". No RED step was possible: `packages/types` has no Jest runner at all (confirmed directly — no `jest` devDependency, no `"test"` script, matching `sdd-tasks`' own Key Learning #1 from this change's tasks phase, and matching every prior type-only addition in this workspace, e.g. `mobile-auth-login`'s `AuthConfig`/`Sesion` types in `packages/auth`, which also shipped with `tsc --noEmit` as the only gate). `tsc --noEmit` is this package's actual verification mechanism per its own `package.json` `"typecheck"` script — treated as the equivalent of GREEN, since there's no test framework to be RED in the first place.

### PR1 acceptance gate (task 1.2) — all passed, verified directly

1. `pnpm --filter @repon/types exec tsc --noEmit` → clean, zero errors.
2. Full workspace `pnpm typecheck` → clean across all 5 packages (`types`, `auth`, `core-api`, `usuario-mobile`, `proveedor-mobile`) — confirms the new types don't break anything, and (expected) nothing consumes them yet.
3. `pnpm lint` → clean, zero findings.

### Not yet done

Nothing consumes these types yet — `PetRepository.findByUserId`/`ConsumptionRepository.findByUserId` (PR2) and the two list use cases (PR3) are their first intended consumers.

## PR2 (Phase 2) — Backend ports-out + Kysely adapters + domain pure functions — DONE

Applied directly by the orchestrator inline. This PR built every backend primitive PR3/PR4 need — no HTTP route, no use case yet.

### What was built (tasks 2.1–2.10, all complete)

- `ports-out/pet-repository.port.ts` — `findByUserId(userId, tx?): Promise<Pet[]>`.
- `ports-out/consumption-repository.port.ts` — `findByUserId(userId, tx?): Promise<UserConsumption[]>`.
- `ports-out/consumption-log-repository.port.ts` — `ConteoDiarioLog` + `contarTomasPorDia(consumptionIds, desde, hasta, zonaHoraria, tx?)`; `adherenciaUltimos7Dias` left in place with a "superseded by" docblock note (D-3: it still has no caller anywhere in this codebase).
- `adapters/persistence/kysely-pet.repository.ts` / `kysely-consumption.repository.ts` — `findByUserId` on both, reusing the existing exported row mappers (`mapPetRow`/`mapUserConsumptionRow`), `user_id = $1` inside the SQL (structural cross-tenant safety, D-4), `orderBy('created_at', 'asc')`.
- `adapters/persistence/kysely-consumption-log.repository.ts` — `contarTomasPorDia`: empty-array short-circuit (never emits `in ()`), one grouped `to_char((tomado_at at time zone $tz)::date, ...)` query for every id, `at time zone` only in `SELECT`/`GROUP BY` per design.md D-3 (never in `WHERE`, or the `consumption_logs_consumption_id_tomado_at_idx` index gets disabled).
- `domain/consumo.calculos.ts` — `dosisEsperadasPorDia`, `estadoAdherenciaDia`, `rachaDias`, `ventanaAdherencia` (+ `VentanaAdherencia`), all pure. The timezone-boundary math (`ventanaAdherencia`'s local-midnight→UTC conversion) is hand-implemented via `Intl.DateTimeFormat` (no date library exists in this workspace) using the standard 2-pass convergence technique — format a guess instant in the target zone, measure the offset it implies, correct, repeat once. Two passes is the same precision date-fns-tz/similar libraries use and is enough for any real DST transition.
- `domain/consumo.constants.ts` — `ZONA_HORARIA_ADHERENCIA = 'America/Santiago'`.
- Tests: 3 new tests each on `kysely-pet.repository.spec.ts`/`kysely-consumption.repository.spec.ts` (SQL scoping+ordering assertion, row-mapping, empty array), 6 new on `kysely-consumption-log.repository.spec.ts` (short-circuit, WHERE scoping, no-timezone-in-WHERE, groupBy shape, row mapping, tx propagation), 14 new on `consumo.calculos.spec.ts` (table-driven, all 4 new functions).

### A real DST-boundary test, grounded in Node's actual tzdata, not assumed

Rather than guessing a DST transition date, queried Node's own `Intl.DateTimeFormat` to find `America/Santiago`'s real 2026 transitions: GMT-3→GMT-4 on 2026-04-05, GMT-4→GMT-3 on 2026-09-06 at exactly `04:00:00Z` — meaning local midnight of Sept 6, 2026 does not exist in this zone (clocks jump from 23:59:59 Sept 5 straight to 01:00:00 Sept 6). Ran the actual `ventanaAdherencia` implementation against `ahora = 2026-09-08T15:00:00Z` before writing the test's expected values, confirming: 7 consecutive calendar dates (`2026-09-02`…`2026-09-08`, no gap or duplicate around the transition) and a total window span of exactly 167 hours (6 full 24h days + 1 day shortened by the spring-forward gap) — not the naive 168 hours a fixed-UTC-offset implementation would silently produce. This is the specific bug class design.md's own D-2 timezone note warned about ("day bucketing without a fixed zone silently shifts every boundary dose").

### A Kysely-specific test gotcha found and fixed while verifying

`String(kyselyRawBuilderObject)` is `"[object Object]"`, not the compiled SQL text — `sql\`...\`` template results have no `toString()` override. Discovered via a failing assertion, not anticipated. Fixed by asserting through Kysely's own introspection API instead: `rawBuilder.toOperationNode().sqlFragments.join('')`, which does expose the literal SQL text pieces. Documented in the test's own comment for the next person who reaches for `String(...)` on a Kysely raw fragment.

### Regression-prevention step not in the task list, done anyway (same discipline as `mobile-auth-login`'s PR4/PR5)

Widening 3 port interfaces (`PetRepository`, `ConsumptionRepository`, `ConsumptionLogRepository`) broke every existing `jest.Mocked<...>` object literal that doesn't implement the new methods — a TypeScript compile error, not a runtime one, invisible to the scoped `domains/consumo` test run. Found via the full workspace `pnpm typecheck`, not the scoped command. Fixed 9 pre-existing files: `calcular-dias-restantes.use-case.spec.ts`, `configurar-consumo.use-case.spec.ts`, `marcar-dosis-tomada.use-case.spec.ts`, `procesar-consumos-vencidos.use-case.spec.ts`, `registrar-mascota.use-case.spec.ts`, and 4 e2e specs (`consumo-dias-restantes`, `consumo-marcar-dosis`, `consumo-mis-consumos`, `consumo-mis-mascotas`) — each needed `findByUserId: jest.fn()` and/or `contarTomasPorDia: jest.fn()` added to its mock object literal.

### PR2 acceptance gate (task 2.10) — all passed, verified directly, with full-suite regression checks

1. `pnpm --filter core-api exec jest domains/consumo` → **142/142 passed**.
2. Full unit suite → **89/89 suites, 881/881 tests passed**.
3. Full e2e suite → **27/27 suites, 168/168 tests passed** (one transient failure on the first full run, `identidad-sesion.e2e-spec.ts` — unrelated domain, 15/15 in isolation, full suite re-ran clean; matches the pre-existing non-deterministic e2e flake already documented during `mobile-auth-login`'s verify phase, not a regression from this PR).
4. `pnpm lint` (workspace) → clean, zero findings.
5. `pnpm typecheck` (workspace, all 5 packages) → clean, zero errors (after the 9-file mock-interface fix above).

### Not yet done

Nothing calls any of these new port methods or pure functions yet — `ListarMascotasUseCase`/`ListarConsumosUseCase` (PR3) and `CalcularAdherenciaSemanalUseCase` (PR4) are their first intended consumers.

## PR3 (Phase 3) — List endpoints: `mis-mascotas` + `mis-consumos` — DONE

Applied directly by the orchestrator inline. First HTTP-reachable output of this change — a client can now list what `registrarMascota`/`configurarConsumo` let it create, for the first time since those two routes shipped in the original `backend-core-api-consumo` change.

### What was built (tasks 3.1–3.9, all complete)

- `ports-in/listar-mascotas.use-case.ts` — `ListarMascotasUseCase`, a thin pass-through over `PetRepository.findByUserId`.
- `ports-in/listar-consumos.use-case.ts` — `ListarConsumosUseCase`, attaches `diasRestantes` to every row in-process (D7 — one repository call, full stop). Deliberately leaves a degenerate row's non-finite result un-sanitized — that guard belongs at the DTO boundary (D-5), not duplicated in the use case.
- `adapters/http/dto/consumo-list-item-response.dto.ts` — `ConsumoListItemResponseDto extends UserConsumptionResponseDto`.
- `adapters/http/consumo.mapper.ts` — `toConsumoListItemResponseDto`, with the `Number.isFinite` guard.
- `adapters/http/consumo.controller.ts` — `GET /consumo/mis-mascotas`, `GET /consumo/mis-consumos`, both actor-scoped only.
- `consumo.module.ts` — both new use cases registered.
- Tests: `listar-mascotas.use-case.spec.ts` (3), `listar-consumos.use-case.spec.ts` (4), `test/consumo-listar.e2e-spec.ts` (9, new file, 2 describe blocks) — cross-tenant isolation (mocked repos keyed by `userId`, not just asserted-and-hoped), query-param-can't-widen-scope, `200 []` never `404`, and an exact end-to-end `diasRestantes` value (10 stock / 4 daily = 2.5 → floors to 2).

### A real test broken by this PR, found via the full e2e suite (not the scoped command) — fixed correctly, not just patched

`test/consumo-cron-no-http-surface.e2e-spec.ts` reflects over `ConsumoController`'s decorator metadata to enumerate its *entire* route table, proving structurally that the cron job has zero HTTP surface. It hard-coded an exact count (4) and path list — both correct assumptions until this PR legitimately added 2 routes. Both new `GET` routes share a URL with an existing `POST` at the identical path (`mis-mascotas`, `mis-consumos`), differing only by HTTP method — so the fix wasn't just "bump the count to 6," it required upgrading the assertion from path-only to `${method} ${path}` pairs, since a path-only check would have silently passed even if (hypothetically) two routes at the same path with the same method collided. Treated as a real regression-prevention discovery, not a nuisance to patch around.

### PR3 acceptance gate (task 3.9) — all passed, verified directly, with full-suite regression checks

1. `pnpm --filter core-api exec jest domains/consumo/ports-in/listar` → **7/7 passed**.
2. `pnpm --filter core-api exec jest --config ./test/jest-e2e.json consumo-listar` → **9/9 passed**.
3. Full unit suite → **91/91 suites, 888/888 tests passed**.
4. Full e2e suite → **28/28 suites, 177/177 tests passed** (after the route-table test fix above; re-confirmed clean on a second full run).
5. `pnpm lint` (workspace) → clean, zero findings.
6. `pnpm typecheck` (workspace, all 5 packages) → clean, zero errors.

### Not yet done

The adherence endpoint (`GET /consumo/mi-adherencia`, PR4) — `ventanaAdherencia`/`estadoAdherenciaDia`/`rachaDias`/`contarTomasPorDia` from PR2 have no caller yet.

## PR4 (Phase 4) — Adherence endpoint: `GET /consumo/mi-adherencia` — DONE

Applied directly by the orchestrator inline. This is the most computationally involved PR in the chain — the only one that aggregates across both items AND days, using every pure function PR2 built.

### What was built (tasks 4.1–4.8, all complete)

- `ports-in/calcular-adherencia-semanal.use-case.ts` — `CalcularAdherenciaSemanalUseCase`. Full aggregation pipeline: `ventanaAdherencia` for the 7-day window → `ConsumptionRepository.findByUserId` for the actor-scoped id set (D-4: the adherence read never accepts a `consumptionId` from the client at all) → `ConsumptionLogRepository.contarTomasPorDia` (one grouped query) → per-item, per-day `estado` via `estadoAdherenciaDia` → per-item totals (`esperadas`/`tomadas`/`porcentaje`) → aggregate-across-items `dias`/`porcentaje` → `rachaDias` over the aggregate day sequence. `porcentaje` is clamped 0-100 and defaults to `0` when the denominator (`esperadas`) is `0` (only possible in the zero-consumptions case, since a real item's `horarios` is a non-empty tuple and `frecuenciaDias >= 1`, so `esperadas` is always positive for any actual created item).
- `adapters/http/dto/adherencia-response.dto.ts` — `AdherenciaDiaDto`/`AdherenciaItemDto`/`AdherenciaResponseDto`.
- `adapters/http/consumo.mapper.ts` — `toAdherenciaResponseDto`, a thin field-for-field pass-through (no aggregation logic duplicated here).
- `adapters/http/consumo.controller.ts` — `GET /consumo/mi-adherencia`, deliberately a 2-segment top-level path per D-1 (never nested under `mis-consumos/`, so no future `:consumptionId` route can shadow it).
- `consumo.module.ts` — registered.
- Tests: `calcular-adherencia-semanal.use-case.spec.ts` (8), `test/consumo-adherencia.e2e-spec.ts` (6, new file).

### A genuine inconsistency in the task's own wording, found and resolved while writing the e2e spec (task 4.7)

The task text asked for "a user with consumptions but no logs gets `items: []`" — self-contradictory: a user *with* consumptions necessarily gets a populated `items` array back (each entry `incumplido`, since `tomadas=0` while `esperadas>0` for any real item). `items: []` is specifically what the *zero-consumptions* case produces. Split into two distinct, correctly-labeled e2e tests instead of writing one test that would have had to silently pick a wrong interpretation of the task text. Flagged here per this project's established convention of surfacing task-text corrections rather than quietly reinterpreting them.

### PR4 acceptance gate (task 4.8) — all passed, verified directly, with full-suite regression checks

1. `pnpm --filter core-api exec jest domains/consumo/ports-in/calcular-adherencia` → **8/8 passed**.
2. `pnpm --filter core-api exec jest --config ./test/jest-e2e.json consumo-adherencia` → **6/6 passed**.
3. Full unit suite → **92/92 suites, 896/896 tests passed**.
4. Full e2e suite → **29/29 suites, 183/183 tests passed** — two transient failures across two separate full-suite attempts before this (`catalogo-ajustes-precio.e2e-spec.ts`, then `ofertas-obtener-bandeja.e2e-spec.ts` — both unrelated domains, both clean in isolation, both absent on the third full run). Same pre-existing non-deterministic e2e-runner flake class already documented multiple times this session (mobile-auth-login's verify phase; PR2's `identidad-sesion` flake) — not a regression from this PR.
5. `pnpm lint` (workspace) → clean, zero findings.
6. `pnpm typecheck` (workspace, all 5 packages) → clean — required updating `consumo-cron-no-http-surface.e2e-spec.ts`'s route-table expectation to 7 routes (same class of fix as PR3, applied proactively this time since the pattern was already known).

### Not yet done

**Backend is now fully complete for this change** — all 3 new list/adherence endpoints, all pure functions, all ports/adapters. Nothing in `packages/auth`, `apps/usuario-mobile`, or the 5 screens exists yet. PR5 (`@repon/auth`'s JSON/error helper) is the first frontend-facing PR and the last piece the screens need before they can be built.

## Backend half of usuario-mobile-consumo is now COMPLETE (PR1–PR4)

Every backend piece — shared types, ports/adapters, domain pure functions (including hand-rolled DST-safe timezone math), all 3 new read endpoints, and the adherence aggregation — is built, wired, and green. What remains is entirely client-side: PR5 (`@repon/auth`'s shared JSON/error helper), PR6a/PR6b (shared UI components + the main tab), PR7a/PR7b (the two create forms), PR8/PR9 (config + historial screens), PR10 (doc deltas).

## PR5 (Phase 5) — `@repon/auth` JSON/error helper + Spanish mapping — DONE

Applied directly by the orchestrator inline. First frontend-facing PR of this change, and the last shared dependency every screen (PR6b onward) needs before it can be built.

### What was built (tasks 5.1–5.6, all complete)

- `packages/auth/src/api-json.ts` — `ApiError` (sibling of `session-client.ts`'s `SesionApiError`, identical envelope), `NetworkError` (fixed `code: 'RED_NO_DISPONIBLE'`), `getJson`/`postJson`/`postNoContent`, all routed through a shared `callAuthFetch` wrapper.
- `packages/auth/src/index.ts` — barrel-exports the 5 new names.
- `apps/usuario-mobile/lib/mensajes-error.ts` — `mensajeDeError()`, the Spanish copy layer, deliberately app-level (not `@repon/auth`) per D-10's protocol-vs-words split.
- Tests: `api-json.spec.ts` (14), `lib/__tests__/mensajes-error.test.ts` (6).

### The one design gap this PR had to fill itself

`design.md` D-10 pins two behaviors as facts — `authFetch`'s own `'authFetch called with no active session'` error propagates untouched, while every other `authFetch` rejection becomes `NetworkError` — but doesn't specify the mechanism for telling the two apart, since both arrive identically as a rejected `authFetch(...)` promise with no typed distinction in `AuthClient`'s public interface. Implemented via a message-string check in `callAuthFetch` (the one place this comparison happens, not duplicated across `getJson`/`postJson`/`postNoContent`) — documented inline as a deliberate coupling to `api-client.ts:56`'s exact string, acceptable since both files live in the same package and the string is itself a stated, pinned design fact, not an implementation detail likely to drift silently.

### PR5 acceptance gate (task 5.6) — all passed, verified directly, with cross-app regression checks

1. `pnpm --filter @repon/auth test` → **49/49 passed** (35 pre-existing + 14 new).
2. `pnpm --filter usuario-mobile test` → **17/17 passed** (11 pre-existing + 6 new).
3. `pnpm --filter proveedor-mobile test` re-run → **13/13 unaffected**.
4. core-api full unit suite re-run → **92/92 suites, 896/896 tests unaffected**.
5. Workspace `pnpm typecheck` → clean, all 5 packages.
6. `pnpm lint` (workspace) → clean — one unused import (`ApiError`, imported but only ever referenced by string in a `toMatchObject`) caught and removed during this pass.

### Not yet done

No screen imports `getJson`/`postJson`/`postNoContent`/`mensajeDeError` yet — PR6a's shared components and PR6b's `s-consumo` tab are the first real consumers.

## PR6a (Phase 6) — Shared consumo UI components — DONE

Applied directly by the orchestrator inline. All 6 components are pure/presentational — no `authFetch`, no `useEffect`, no fetching — props in, JSX out, exactly as design.md's File Changes table scoped this PR.

### What was built (tasks 6.1–6.8, all complete)

- `components/consumo/owner-tabs.tsx` — `OwnerTab`, `ownerTabKey`, `<OwnerTabs>` (D-9: `null` at 0 pets, strip at 1+, selection/filtering stay the caller's job).
- `components/consumo/today-card.tsx` — per-item card embedding `<StockBar>`, a mark-dose button. `marcado` documented as session-local (no such field exists in `@repon/types` at all — only `ConsumptionLog.tomadoAt` rows do, and those never reach the list response).
- `components/consumo/stock-bar.tsx` — the D-6 kg-display-only conversion (`>= 1000` inclusive).
- `components/consumo/streak-bar.tsx` — `rachaDias` + a 7-cell `estado`-coloured strip, zero adherence math.
- `components/consumo/empty-state.tsx` / `error-retry.tsx` — the two non-populated-list states, visually distinct from each other.
- Tests: `owner-tabs.test.tsx` (4), `stock-bar.test.tsx` (6), `streak-bar.test.tsx` (4).

### A real bug found in the test itself, not the component under test

`streak-bar.test.tsx`'s colour-mapping assertion originally did a shallow `.find()` for a `backgroundColor` key across `node.props.style`. `Themed.View` (this app's shared themed wrapper, used by every component in this PR) wraps whatever `style` it's given inside its own `[{backgroundColor: themeBackground}, givenStyle]` array — so the shallow find matched the THEME's own background color on every cell, not the per-`estado` colour the component actually set, and the test would have passed even if `StreakBar` rendered every day the same colour. Fixed by fully flattening the style array and merging every object in array order (later keys override earlier ones), mirroring how React Native itself resolves a style array — the corrected assertion genuinely proves 4 distinct colours for the 4 `estado` values.

### PR6a acceptance gate (task 6.8) — all passed, verified directly

1. `pnpm --filter usuario-mobile test` → **31/31 passed** (17 pre-existing + 14 new).
2. Real Metro bundle (`expo export --platform web`) → succeeded, 23 static routes, unchanged from PR9/PR10 — proves the new components compile and bundle cleanly through Metro, not just through `tsc`/Jest.
3. `pnpm lint` (workspace) → clean.
4. `pnpm typecheck` (workspace, all 5 packages) → clean.

### Not yet done

None of these 6 components are mounted anywhere yet — `app/(tabs)/consumos.tsx` (PR6b) is still `ScreenStub`. PR6b is their first real consumer.

## PR6b (Phase 7) — `s-consumo` tab: fetch, dose marking, empty/error states — DONE

Applied directly by the orchestrator inline. `app/(tabs)/consumos.tsx`'s `ScreenStub` body is gone — this is the first screen in this change (and the first in this app since `mobile-auth-login`'s `login.tsx`) with real data end to end.

### What was built (tasks 7.1–7.6, all complete)

- The `version`-counter fetch effect and `marcar()` function, verbatim from design.md D-7's own code block, typed against `@repon/types` (the design snippet's `PetResponseDto` name was pseudocode for the identical wire shape, not a literal `core-api` import — corrected during implementation, noted here for the record).
- `marcadosHoy: Set<string>`, session-local, added to only after `postNoContent` resolves — the honest solution to a real gap: no field anywhere in `@repon/types` records "was this marked today", so the checkmark state is necessarily client-local bookkeeping, never server-derived, and is documented as such inline.
- All 5 states from D-8's table (loading, load-failed, global first-run, 0-pets-with-self-items, ≥1-pet owner tabs), composing every PR6a component. Nav links to `s-consumo-config`/`s-consumo-historial` render above every branch, unconditionally.
- Local owner-tab filtering over the single `mis-consumos` response, no per-owner request.
- `app/(tabs)/__tests__/consumos.test.tsx` — 9 tests, all passed on the first run.

### Two small task-text/design-doc discrepancies flagged, not silently resolved

1. Design.md's own code snippet types the pets fetch as `getJson<PetResponseDto[]>` — `PetResponseDto` is a `core-api`-internal NestJS class (`adapters/http/dto/`), never importable from a mobile app. Used `@repon/types.Pet` instead, which is structurally identical (confirmed against `toPetResponseDto`'s own 1:1 field mapping in PR3) — the design snippet's name was clearly pseudocode shorthand, not a literal instruction.
2. Task 7.3 says "D-8's four states"; D-8's own table lists 5 distinct rows. Implemented all 5 (same class of minor count/wording mismatch already flagged in PR4's task 4.7).

### PR6b acceptance gate (task 7.6) — all passed, verified directly, with full cross-app regression checks

1. `pnpm --filter usuario-mobile test` → **40/40 passed** (31 pre-existing + 9 new).
2. Real Metro bundle (`expo export --platform web`) → succeeded, 23 static routes, unchanged.
3. `pnpm --filter proveedor-mobile test` re-run → **13/13 unaffected**.
4. core-api full unit suite re-run → **92/92 suites, 896/896 tests unaffected**.
5. Workspace `pnpm typecheck` → clean.
6. Workspace `pnpm lint` → clean — removed one invalid `eslint-disable-next-line react-hooks/exhaustive-deps` comment (this project's ESLint config doesn't register that rule; the effect didn't need suppressing at all — copied the habit from a mental default, not from anything this codebase actually does elsewhere).

### Not yet done

The two create forms (PR7a self, PR7b pet) — every "Agregar" CTA on this screen already routes to `/consumo-nuevo`/`/consumo-nuevo-pet`, but both are still `ScreenStub`. `s-consumo-config`/`s-consumo-historial` (PR8/PR9) are linked but also still stubs.

## PR7a (Phase 8) — `s-consumo-nuevo` self create form — DONE

Applied directly by the orchestrator inline.

### A scope correction against the task text, resolved and documented rather than over-built

Task 8.1's wording implies this screen needs full per-`kind` branching including `alimento`/`vacuna`. Checked the mockup first: `s-consumo-nuevo` (`mockups/usuario.html:597-680`) is a single flat form with no kind picker at all — that 4-way picker only exists on `s-consumo-nuevo-pet`. `alimento`/`vacuna` are pet-only concepts here (a human doesn't log pet food or a pet vaccine against their own profile). Built a 2-way `medicamento`/`suplemento` chip selector instead, matching D5's "share one block" rule and the mockup's actual structure — building unreachable `alimento`/`vacuna` UI on this screen would have been dead code.

### What was built (tasks 8.1–8.5, all complete)

- `app/consumo-nuevo.tsx` — kind chip (medicamento/suplemento), nombre, presentación chips, dosis, frecuencia chips, veces-al-día chips (dynamically resizing the `horarios` text-input array), stock, auto-crear-refill switch. Submit via `postJson`, `201` → `router.back()`, failure → inline `mensajeDeError`.
- `app/__tests__/consumo-nuevo.test.tsx` — 6 tests, all passed first run.

### PR7a acceptance gate (task 8.5) — all passed, verified directly

1. `pnpm --filter usuario-mobile test` → **46/46 passed** (40 pre-existing + 6 new).
2. Real Metro bundle → succeeded, 23 routes unchanged.
3. Workspace `pnpm typecheck` → clean.
4. Workspace `pnpm lint` → clean.

## PR7b (Phase 9) — `s-consumo-nuevo-pet` two-step create flow — DONE

Applied directly by the orchestrator inline. The most complex screen in this change — full D-6 4-kind field branching, a real 2-step state machine, and the pinned partial-failure hazard.

### What was built (tasks 9.1–9.5, all complete)

- `app/consumo-nuevo-pet.tsx` — step 1 resolves a pet (0-pets: direct creation form; ≥1-pet: selector + inline "+ nueva mascota"); step 2 is a full 4-kind (`medicamento`/`suplemento`/`alimento`/`vacuna`) consumo form, each branch collecting exactly its own D-6 field set (`alimento`'s porción-in-grams/stock-in-kg with the ×1000 wire conversion; `vacuna`'s periodicidad select + single horario). `mascotaId` is the sole gate between the two steps — structurally, not conventionally, preventing a duplicate pet POST on any step-2 retry.
- `app/__tests__/consumo-nuevo-pet.test.tsx` — 9 tests, all passed first run, including the partial-failure sequence (step 1 succeeds once, step 2 fails then succeeds on retry, pet-creation POST count asserted at exactly 1 across the whole sequence).

### PR7b acceptance gate (task 9.5) — all passed, verified directly

1. `pnpm --filter usuario-mobile test` → **55/55 passed** (46 pre-existing + 9 new).
2. Real Metro bundle → succeeded, 23 routes unchanged.
3. Workspace `pnpm typecheck` → clean.
4. Workspace `pnpm lint` → clean.

## Both create forms are now COMPLETE (PR1–PR7b)

Every write path this change adds is done: list/adherence reads (backend), the shared `@repon/auth` helper, the main tab with dose marking, and both create forms. What remains is entirely read-only screens (`s-consumo-config`, `s-consumo-historial`) plus doc deltas.

## PR8 (Phase 10) — `s-consumo-config` read-only actives list — DONE

Applied directly by the orchestrator inline. Simplest screen in the chain — reuses `OwnerTabs`/`StockBar`/`EmptyState`/`ErrorRetry` from PR6a wholesale, no new shared components needed.

### What was built (tasks 10.1–10.4, all complete)

- `app/consumo-config.tsx` — same fetch shape as the tab, filtered by `OwnerTabs`. "Editar" is a `disabled` `Pressable` with visible copy — no `onPress` handler exists on it, so D4's "must not be capable of producing a second `POST`" is true because there's no code path there, not because of a guard.
- `app/__tests__/consumo-config.test.tsx` — 5 tests, all passed first run.

### PR8 acceptance gate (task 10.4) — all passed, verified directly

1. `pnpm --filter usuario-mobile test` → **60/60 passed** (55 pre-existing + 5 new).
2. Workspace `pnpm typecheck` → clean.
3. Workspace `pnpm lint` → clean.

(Task 10.4's own wording names no Metro-bundle gate, unlike most other PRs in this chain — followed as written, not added unprompted.)

## PR9 (Phase 11) — `s-consumo-historial` 7-day adherence view — DONE

Applied directly by the orchestrator inline.

### What was built (tasks 11.1–11.4, all complete)

- `app/consumo-historial.tsx` — own `version` counter, independent of the tab's (D-1). Fetches `GET /consumo/mi-adherencia` **and** `GET /consumo/mis-mascotas` on mount.
  - **Resolved gap, documented in the file's own comment, not silently applied**: task 11.1's literal wording names only `mi-adherencia`, and design.md's flow diagram (§"READ — s-consumo-historial mount") shows only that one call. But `AdherenciaItem.nombre` is the *consumption's* name ("Losartan"), not the pet's — and D-9 (line 356) explicitly pins owner-tab labels to `pet.nombre` sourced from `GET /consumo/mis-mascotas`, for **all three** owner-tabbed screens, `s-consumo-historial` included. Without the second fetch, `<OwnerTabs>` has no pet names to label its tabs with. Read the flow diagram's single-call listing as scoped to documenting the adherence-compute path, not as a literal complete network-call inventory — consistent with D-9's own stated scope.
  - Aggregate header (`porcentaje`+`rachaDias`+7-day strip via `<StreakBar>`) always reflects the **full, unfiltered** server response — switching owner tabs re-filters only the per-item list below it, never recomputes the aggregate (D6: zero client-side adherence math, including aggregation).
  - "Desde–hasta" window label formatted as `DD/MM – DD/MM` by string-splitting the already-local `YYYY-MM-DD` fields — no `Date` object, no timezone math, on the client (D-2's "no month view" rule satisfied with the simplest possible renderer).
  - Per-item 7-day grid duplicates the `estado`→colour map from `streak-bar.tsx` locally (not exported there) — kept in the same file per task 11.2's own "same file" instruction rather than extracting a second shared component for a 4-entry map.
- `app/__tests__/consumo-historial.test.tsx` — 4 tests: exact-figures-from-server (incl. day-cell presence, window label, per-item and aggregate percentages, racha text), `sin_datos`/zero-activity skeleton renders without crashing, loading/empty/error mutual exclusivity, error-retry distinctness. All 4 passed after two trivial test-side fixes (`toHaveTextContent` needed `{ exact: false }` — the component's copy is longer than the bare figure, same class of issue as PR6a/PR6b's `stock-bar.test.tsx`; not a component bug).

### PR9 acceptance gate (task 11.4) — all passed, verified directly

1. `pnpm --filter usuario-mobile test` → **64/64 passed** (60 pre-existing + 4 new).
2. Real Metro bundle (`expo export --platform web`) → succeeded, `/consumo-historial` present, 23 static routes.
3. Workspace `pnpm typecheck` → clean ("Scope: 5 of 6 workspace projects").
4. Workspace `pnpm lint` → clean.

## PR10 (Phase 12) — declared `SPEC.md` deltas — DONE

Applied directly by the orchestrator inline. Doc-only, no code.

### What was built (tasks 12.1–12.3, all complete)

- `apps/usuario-mobile/SPEC.md`, "Estado que maneja el cliente": added a bullet declaring Consumos' 5 screens use `authFetch` + local `useState`/`StyleSheet`, no store/cache — scoped to the consumo domain, the 3 pre-existing bullets (refill/Zustand, tab-selection, catálogo-ofertas-historial/TanStack) untouched (D2).
- `apps/usuario-mobile/SPEC.md`, "Pendiente al migrar": corrected the stale "mutaciones reales contra Supabase" line — `marcarDosis` and the rest of the consumo domain now hit `core-api`'s `/consumo/...` routes via `authFetch`, never Supabase directly; `aceptarOferta` stays listed as still-pending (unrelated, unresolved domain). Added a note recording D4: `s-consumo-config` is read-only in v1, "Editar" is disabled with honest copy rather than hidden or routed into the create form.

### PR10 acceptance gate (task 12.3) — proofread, verified directly

Cross-checked both edits against `consumo.controller.ts`'s live `@Get`/`@Post` decorators: `mis-mascotas` (GET+POST), `mis-consumos` (GET+POST), `mi-adherencia` (GET), `mis-consumos/:id/dias-restantes` (GET), `mis-consumos/:id/dosis` (POST) — no reconfigure/edit route exists anywhere, confirming the "solo lectura" claim added for `s-consumo-config`. No code touched, no test command applicable.

## Chain complete — PR1 through PR10 all done

Every task in `tasks.md` (Phases 1–12) is now `[x]`. The `usuario-mobile-consumo` change is fully implemented and gate-verified PR-by-PR. Nothing has been committed to git yet.

## Post-verify fix (task 9.6) — real CRITICAL defect found by `sdd-verify`, fixed

`sdd-verify` re-ran the full gate independently (not trusting this log's narrative) and found one genuine, previously-undocumented defect, distinct from the three already-known deliberate deviations (PR9's extra fetch, PR7a's 2-kind scope, PR4/PR6b's resolved ambiguities):

**`apps/usuario-mobile/app/consumo-nuevo-pet.tsx`'s step-1 `GET /consumo/mis-mascotas` fetch mapped ANY failure to `setMascotas([])`** — silently treating a backend outage identically to a legitimate first-time user with 0 pets. Because `mascotas.length === 0` is the exact trigger for showing the pet-creation form directly, a failed load produced no `ErrorRetry`, no Spanish error message, and no way to retry — just a form that looked like a normal first run. This violated the change's own spec (Requirement 7: "a failed read renders a distinct error state, not... an empty-state message") and was inconsistent with `consumos.tsx`/`consumo-config.tsx`/`consumo-historial.tsx`, all three of which correctly propagate this same class of failure into a distinct `errorCarga` state. Zero test coverage previously exercised the failure path.

**Fix**: added `errorCargaMascotas`/`versionMascotas` state, matching the exact pattern already used correctly in the other 3 read screens — on fetch failure, render `<ErrorRetry>` (shared component) instead of falling through to the ambiguous 0-pets branch; retry bumps `versionMascotas` to re-run the effect. `mascotaId`-gated step-2 behaviour (D-8's pinned partial-failure rule) is untouched — this only affects the step-1 initial-load path.

**Tests**: 2 new in `app/__tests__/consumo-nuevo-pet.test.tsx` (RED confirmed before the fix — both failed against the un-fixed component; GREEN after): a load failure renders `error-retry`, never the 0-pets form; pressing retry re-fetches and recovers into the normal form. 9 pre-existing tests in that file all still pass unchanged.

**Full gate, re-run after the fix**: `pnpm --filter usuario-mobile test` → 66/66 (64 prior + 2 new). Workspace `pnpm typecheck` → clean. Workspace `pnpm lint` → clean. Real Metro bundle (`expo export --platform web`) → succeeded, 23 static routes unchanged, `/consumo-nuevo-pet` present.

## Next

Re-running `sdd-verify` against this fix. `sdd-archive` follows once verify reports a clean pass with no unresolved CRITICAL findings.
