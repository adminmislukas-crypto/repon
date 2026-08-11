# Verify Report: `backend-core-api-consumo`

**Verifier**: sdd-verify (independent pass, fresh context, no involvement in implementation)
**Commit range verified**: `ef1d2f9`..`6fb90b6` on `main` (10 chained PRs — PR1, PR2a, PR2b, PR3, PR4, PR5, PR6a, PR6b, PR6c, PR7 — plus a post-close doc-comment fix `6fb90b6`)
**Working tree**: clean at HEAD (`6fb90b6`), branch `main`
**Verdict: PASS WITH WARNINGS**

## 1. Test/build gates — run for real, this session

| Gate | Result | Evidence |
|---|---|---|
| `pnpm lint` | PASS (exit 0) | `eslint .` — clean, only the pre-existing unrelated Node-engine WARN |
| `pnpm typecheck` | PASS (exit 0) | `packages/types` + `services/core-api` both `Done` |
| `pnpm test` | PASS (exit 0) | `services/core-api`: **356 unit / 49 suites**, **83 e2e / 13 suites** — matches apply-progress.md's claimed final counts exactly |
| `pnpm build` | PASS (exit 0) | `tsc -p tsconfig.build.json: Done` |
| `pnpm format:check` | PASS (exit 0) | "All matched files use Prettier code style!" — first run, zero fix-up needed |
| Isolated regression: `identidad` | PASS | `pnpm exec jest src/domains/identidad` → **13 suites / 66 tests** |
| Isolated regression: `catalogo` | PASS | `pnpm exec jest src/domains/catalogo` → **15 suites / 115 tests** — byte-identical to PR5's own isolated-proof baseline (15/115) |
| Isolated regression: `shared/` (kernel) | PASS | `pnpm exec jest src/shared` → **8 suites / 49 tests** |
| Isolated e2e regression: `identidad`+`catalogo` | PASS | `jest --config jest-e2e.json --testPathIgnorePatterns=consumo` → **8 suites / 54 tests** (83 total − 29 consumo = 54, exact) |
| Opt-in integration suite (local Supabase running, ran it) | PASS | `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm exec jest --config ./test/jest-integration.json` → **5 suites / 15 tests** — matches apply-progress.md's PR7 claim exactly |
| DB schema, live Postgres | PASS | `psql \d public.user_consumption` — `stock_bajo_notificado_at timestamptz` present, no new index (per D-C), RLS policy unchanged/column-agnostic, `updated_at` trigger intact |

No test count or SQL claim was taken on faith — every number above was reproduced independently in this session. Two genuine **mutation tests** were additionally run against the two highest-stakes pieces of logic (see §9) to prove the test suite is load-bearing, not self-reported theater; both mutations were introduced, confirmed to break the correct tests, and cleanly reverted (`git status --porcelain` empty before persisting this report).

## 2. Scrutiny items — explicit judgment on each of the 11

### 1. `ConsumptionCandidata` type (PR6b) — CORRECT, narrowly scoped

`ports-out/consumption-repository.port.ts` defines `ConsumptionCandidata extends UserConsumption { readonly stockBajoNotificadoAt: string | null }`, confined to `services/core-api`, never touching `@repon/types` (verified: `packages/types/src/consumo.ts` unchanged since PR1's D15 delta). `findDueForCheck` returns `ConsumptionCandidata[]`. Read `procesar-consumos-vencidos.use-case.ts` directly: `candidata.stockBajoNotificadoAt !== null` is the exact branch condition separating the cleanup branch (2b, calls `limpiarMarcaStockBajo`) from the no-op branch (2c). This is a reasonable, well-documented gap-fill — design.md's Diagram 1 step 2b requires this branch and PR6a's own `findDueForCheck` shipped without the data needed to take it; PR6b's fix is minimal and self-contained.

### 2. D-C SQL predicate — CORRECT, verified byte-for-byte, and mutation-tested

`kysely-consumption.repository.ts`'s `findDueForCheck`:
```sql
stock_bajo_notificado_at is not null
   or stock_actual * frecuencia_dias
        < (${umbralDias}::numeric + 1) * dosis_por_toma * coalesce(array_length(horarios, 1), 0)
```
Union (`or`), multiplicative (never a division operator anywhere in the fragment), `+1` superset margin — matches design.md D-C verbatim. **Mutation-tested**: changed `or` → `and` and re-ran the spec; the AST-inspection test (`.toOperationNode()` → exact `sqlFragments` string match) failed immediately and correctly. Reverted; 29/29 green again. This is genuinely correctness-critical (a division here would abort the entire daily cron) and the test suite actually catches a regression, not just documents intent.

### 3. Reclaim-before-emit ordering (D-E, PR6b) — CORRECT for every code path, and mutation-tested

Read `procesar-consumos-vencidos.use-case.ts`'s `procesarCandidata` directly: `const gano = await this.consumptionRepository.intentarMarcarStockBajo(...)` is awaited and branched on (`if (!gano) return 'no-op'`) strictly before the payload is built and before either `eventPublisher.publish` call or `notificationPort.sendPush`. The cleanup branch (2b/2c) never reaches any publish/push call at all. **Mutation-tested**: hardcoded `gano = true` (bypassing the CAS result) and re-ran the spec; 4 tests failed correctly (`orden[0]` expected `'intentarMarcarStockBajo'`, got `'publish'`; a "false claim → zero publish/sendPush" test caught a real unwanted `publish` call). Reverted; 14/14 green again.

### 4. No `TRANSACTION_MANAGER` in `ProcesarConsumosVencidosUseCase`'s constructor — CONFIRMED by direct read

```ts
constructor(
  @Inject(CONSUMPTION_REPOSITORY) private readonly consumptionRepository: ConsumptionRepository,
  @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  @Inject(NOTIFICATION_PORT) private readonly notificationPort: NotificationPort,
) {}
```
Exactly 3 tokens, no `TRANSACTION_MANAGER` import anywhere in the file. Structural guarantee holds by inspection, not convention.

### 5. `marcarDosisTomada`'s transaction scope (PR4) — CORRECT, matches design.md's own Diagram 2, self-correction was right

Re-derived from design.md directly (not trusting apply-progress.md's narrative): Diagram 2 step **4a** (`findById(consumptionId, tx)`) is drawn nested inside the `runInTransaction (D6) ====` block, with step 4b's rejection branch explicitly annotated *"Se lanza DENTRO de la transaccion: rollback sin escrituras."* The "Mapa de transacciones" table lists `marcarDosisTomada` as **"1 select + 1 insert + 1 update"** — three statements inside one transaction, not a separate pre-transaction read. Reading the actual code (`marcar-dosis-tomada.use-case.ts`): `findById` is the first call inside the `transactionManager.runInTransaction(async (tx) => {...})` callback, on the same `tx` passed to `append`/`descontarStock`. The apply-progress.md-documented self-correction (against the launch prompt's initial wrong instruction to check ownership *before* opening the transaction) is verified correct against the primary design artifact, not merely re-asserted.

### 6. `configurarConsumo`/debounce-marker declared delta (PR7) — accurately documented; correctly a WARNING, not a bug

(a) Documented clearly: `consumo/SPEC.md` line 79 states the gap explicitly as a "delta declarado, no resuelto en este cambio," names the exact mechanism (create-only `NuevoConsumoInput`, no `consumptionId` param), and names the follow-up owner (a future change that adds reconfigure capability).
(b) Carried in a residual-risks list: **not** in `design.md`'s own frozen 13-item list (design.md predates this discovery and is not edited retroactively, correctly), but carried as item **14** in `apply-progress.md`'s PR7 carry-forward section, following the verified precedent from `catalogo`'s own archive (the carry-forward list lives in `apply-progress.md`, not a product `SPEC.md`).
(c) Confirmed by direct grep: `configurar-consumo.use-case.ts` never calls `limpiarMarcaStockBajo` — `grep -rn limpiarMarcaStockBajo services/core-api/src/domains/consumo/ports-in/configurar-consumo.use-case.ts` returns zero matches; the use case's `execute()` only calls `crear()` + `save()`.
(d) Judgment: this is a reasonable scope boundary, not a corner cut — building an update/reconfigure endpoint was never authorized by proposal.md/tasks.md's 10-PR chain. **However**, it should be tracked as a WARNING (open design-requirement gap), not treated as fully closed: design.md's D-A table still says `configurarConsumo` "Sí" clears the marker, and that requirement remains genuinely unimplemented (inert today only because no reconfigure path exists at all). Filed below as WARNING-1.

### 7. Cross-tenant 404 pattern (R1, D7) — VERIFIED, byte-identical, no 403 anywhere

`calcularDiasRestantes` and `marcarDosisTomada` both throw `new ConsumptionNotFoundError(consumptionId)` — identical constructor, identical arg — for both "missing" and "belongs to another user." `configurarConsumo` throws `new PetNotFoundError(config.petId)` identically for both branches on its one client-supplied FK. `grep -rn "403\|Forbidden" src/domains/consumo/` returns only doc-comment prose explaining *why* 403 is rejected — zero code path maps any error to 403. `ConsumoExceptionFilter`'s `ERROR_STATUS_MAP` has exactly 2×404 + 3×400 entries, no 403 entry exists to be reachable. e2e tests (`consumo-marcar-dosis.e2e-spec.ts`, `consumo-dias-restantes.e2e-spec.ts`, `consumo-mis-consumos.e2e-spec.ts`) each assert the byte-identical `{statusCode:404, code:...}` body for both the cross-tenant and genuinely-missing cases.

### 8. Event payload discipline (D-D) — VERIFIED

`StockBajoPayload` carries only: `consumptionId`, `userId`, `ownerType`, `petId`, `kind`, `nombre`, `unidad`, `stockActual`, `consumoDiario` (formula output), `diasRestantes` (formula output), `umbralDias`. `grep -rn urgencia services/core-api/src/domains/consumo/` returns zero code matches (only doc-comment prose explaining the rule and one unrelated constant-file comment referencing `RefillRequest.urgencia` as *rationale* for the threshold value, not as a payload field). No raw formula inputs (`dosisPorToma`/`frecuenciaDias`/`horarios`) are re-exposed — only the computed `consumoDiario` output travels.

### 9. `@nestjs/schedule` is the only new dependency — VERIFIED

`git diff ef1d2f9^..1ad1ab0 -- services/core-api/package.json` shows exactly one added line: `"@nestjs/schedule": "^6.1.3"`. `git log --oneline -- services/core-api/package.json` across the range shows exactly one touching commit (`af56934`, PR6c). No other `package.json` in the monorepo was touched by this change.

### 10. PR7's two explicitly-not-fixed doc gaps — STILL TRUE, correctly self-flagged, non-blocking

Both re-verified live in this session:
- (a) `supabase/SPEC.md`'s `user_consumption` "Columnas reales" table (lines ~119–135) still does not list `stock_bajo_notificado_at` — `grep -n stock_bajo_notificado_at supabase/SPEC.md` returns zero matches.
- (b) `supabase/SPEC.md` line 424's Edge Functions table still frames `check-consumption-stock` as `Cron diario (pg_cron)` — the same D11 framing already corrected in `docs/ARCHITECTURE.md` for this change, not carried into this second file.

Both are exactly as PR7's apply-progress.md entry described them: found, deliberately left un-edited (out of PR7's declared scope per design.md's delta table), and flagged for the orchestrator to decide. Filed below as WARNING-2.

### 11. Strict TDD compliance — spot-checked, and mutation-tested (stronger than git-blame archaeology)

Each of the 10 PRs is a single squashed commit (confirmed via `git log --diff-filter=A` on `marcar-dosis-tomada.use-case.ts`/`.spec.ts` and `configurar-consumo.use-case.ts`/`.spec.ts` — both pairs added in the same commit), so RED-before-GREEN cannot be re-derived from git history the way it could across separate commits; apply-progress.md's own TDD Cycle Evidence tables are the only record of the RED step (e.g., literal `Cannot find module` / "5/5 new tests failed against the real throwing stub" transcripts). Rather than trust that narrative, this pass instead **proved two of the highest-stakes test files are load-bearing via real mutation testing** (§9, items 2 and 3 above): both mutations were caught immediately and specifically by the existing suite, with assertion messages pointing at the exact wrong behavior. This is stronger evidence of genuine TDD discipline than reading commit timestamps would have been.

## 3. Spec-to-implementation compliance matrix

Every requirement/scenario across the 5 delta specs was checked against a concrete implementation:

| Spec | Requirement | Implementation evidence |
|---|---|---|
| `core-api-consumo` | userId derived from actor only (D8) | `registrar-mascota.use-case.ts`/`configurar-consumo.use-case.ts` — `userId` explicit param, no DTO field; controller passes `actor.profileId` only |
| `core-api-consumo` | `configurarConsumo` petId ownership → 404 (D-H.3) | `configurar-consumo.use-case.ts` — `petRepository.findById` gated before `crear()`/`save()`; e2e `consumo-mis-consumos.e2e-spec.ts` |
| `core-api-consumo` | `marcarDosisTomada`/`calcularDiasRestantes` cross-tenant 404 (D7) | §2.7 above |
| `core-api-consumo` | Transactional log+decrement, publish after commit (D6) | §2.5 above; `marcar-dosis-tomada.use-case.spec.ts` asserts `publish` called after `runInTransaction` resolves |
| `core-api-consumo` | Clamp-at-0 decrement (D-H.2) | `descontarStock`'s `greatest(stock_actual - $2, 0)`; opt-in integration test `consumo-descontar-stock.integration-spec.ts` (3/3 passed against real Postgres this session) |
| `core-api-consumo` | Pure-query CQS guarantee (D2/R4) | `calcular-dias-restantes.use-case.ts` constructor — only `CONSUMPTION_REPOSITORY` |
| `core-api-consumo` | `procesarConsumosVencidos` internal-only, no `@Roles` (D2) | `grep -rn "@Roles" src/domains/consumo/` — zero matches; `consumo-cron-no-http-surface.e2e-spec.ts` route-enumeration proof |
| `core-api-consumo` | Debounce, at most one pair per unresolved condition (D5) | `intentarMarcarStockBajo`'s CAS; `procesar-consumos-vencidos.use-case.spec.ts`'s debounce describe block; mutation-tested §2.3 |
| `core-api-consumo` | One event per item, never a summary (D3) | Loop structure in `procesar-consumos-vencidos.use-case.ts`; fan-out tests in its spec |
| `core-api-consumo` | Per-item failure isolation (D4) | `try/catch` inside the loop, no enclosing transaction; §2.4 above |
| `core-api-consumo` | No-throw on missing push token (D10) | `expo-push-notification.adapter.ts`'s `try/catch` wrapping the entire body |
| `shared-notifications` | `NotificationsModule` mirrors `AuditModule`, `@Global()` | `notifications.module.ts` read directly — confirmed |
| `shared-notifications` | `consumo.module.ts` never binds/exports `NOTIFICATION_PORT` | `grep -rn NOTIFICATION_PORT src/domains/consumo/` — zero matches |
| `shared-notifications` | `sendPush` never throws | try/catch wraps the full method body in `expo-push-notification.adapter.ts` |
| `db-schema-consumo` | Debounce column, fix-forward migration | `20260806120000_13_consumo_stock_bajo_debounce.sql`, verified live via `psql \d` |
| `db-schema-consumo` | No `activo`/`status` column | Confirmed via `psql \d public.user_consumption` — column absent |
| `core-api-hexagonal-layout` | `adapters/scheduling/` conditional presence | `services/core-api/src/domains/consumo/adapters/scheduling/consumption-check.job.ts` exists; `identidad`/`catalogo` correctly lack it |
| `shared-types-package` | `UserConsumption.userId` | `packages/types/src/consumo.ts` — confirmed |

No scenario in any of the 5 delta specs was found without corresponding, passing implementation.

## 4. Hexagonal layout compliance

`services/core-api/src/domains/consumo/` contains exactly: `domain/`, `ports-in/`, `ports-out/`, `events/`, `adapters/{http,persistence,scheduling}/`, `consumo.module.ts`. **Confirmed absent**: `contracts/` and `adapters/events/` — both correctly absent per D14 (verified via `find`, zero matches for either path). Note: the domain-root `events/` folder (holding plain `DomainEvent` classes, distinct from `adapters/events/` which holds `@OnEvent` listeners) is **not new to this change** — `identidad` and `catalogo` (both already-archived reference domains) have the identical pattern, and the merged `core-api-hexagonal-layout` spec's "MUST contain exactly" list has never enumerated it for either of them. This is a pre-existing, harmless spec-wording gap that predates `consumo` and is not introduced or worsened by it — not filed as a new finding.

## 5. Tasks.md completeness

91/91 tasks checked `[x]`, spot-checked across all 10 PRs against actual code (not just checkbox trust): Phase 1 (groundwork/migration — verified live), Phase 2a (domain entities/calculos — read directly), Phase 2b (read path/R1 — e2e-verified), Phase 3 (write path — code + e2e verified), Phase 4 (transaction scope — re-derived from design.md, mutation-adjacent verification via the transaction spec), Phase 5 (notifications kernel — module wiring read directly), Phase 6a (SQL predicate — mutation-tested), Phase 6b (cron use case — mutation-tested), Phase 6c (scheduling adapter, `env.schema.ts`, controller route table read directly), Phase 7 (SPEC.md deltas — read directly, cross-checked against actual code). No task found checked without matching implementation.

## 6. Scope creep check

Grepped for `DELETE`/`deleteFrom` in the domain and the new migration — zero matches (no physical deletes introduced). `AuditLogPort`/`AUDIT_LOG_PORT` — zero matches in `domains/consumo/` (D13 held). `adherenciaUltimos7Dias` is implemented (interface completeness) but has zero callers in `ports-in/`/`adapters/http/` — confirms the proposal's explicit "not exposed as a product surface" scope line was honored, not silently expanded into an endpoint. No admin route, no `@Roles('user')` (both deliberate, both matching design.md's stated reasoning). Nothing beyond the 10-PR chain's declared scope was found built.

## Issues Found

### WARNING-1 — `configurarConsumo`/debounce-marker clearing is a genuinely open design requirement, not fully resolved (tracking, not a bug)

Design.md's D-A table ("Qué limpia el marcador") states `configurarConsumo` clears `stock_bajo_notificado_at` on reconfiguration. The as-built `configurarConsumo` is create-only (`NuevoConsumoInput`, no `consumptionId` param), so this requirement is currently unreachable rather than violated. PR7 correctly documented this as declared delta #14 (`consumo/SPEC.md` line 79, `apply-progress.md`'s carry-forward list) rather than inventing an out-of-scope reconfigure endpoint — the right call given the approved 10-PR chain. Filed as WARNING (not accepted as fully closed) because it is a real, currently-true gap against an explicit design.md clause that the next SDD change touching `UserConsumption` reconfiguration MUST close, not merely remember. **Recommendation**: no code change needed now; keep item 14 alive in whatever tracking mechanism carries forward past archive (mirrors how catalogo's own WARNING-level gaps were tracked, not silently dropped).

### WARNING-2 — `supabase/SPEC.md` has two stale entries this change never declared as a delta, still true

(a) `user_consumption`'s "Columnas reales" table is missing `stock_bajo_notificado_at`. (b) The Edge Functions table (line 424) still frames `check-consumption-stock` as `pg_cron`-triggered — the same D11 correction already applied to `docs/ARCHITECTURE.md` but not to this second file. Both confirmed still present via direct grep in this session. Non-blocking (pure documentation, zero runtime effect), self-acknowledged by PR7's own apply-progress.md entry rather than silently missed, and explicitly deferred to the orchestrator's judgment on timing. **Recommendation**: a small follow-up docs-only commit (either before archive, closing the loop the same way `backend-core-api-catalogo`'s own 413/400 WARNING was closed in a follow-up commit before archive, or named as a tracked follow-up at archive time).

### WARNING-3 — `kysely-consumption.repository.ts`'s `limpiarMarcaStockBajo` doc comment still carries the same stale claim commit `6fb90b6` was supposed to fix (new finding, not previously flagged)

Commit `6fb90b6` ("fix stale limpiarMarcaStockBajo doc comment in consumo") corrected `ports-out/consumption-repository.port.ts`'s doc comment, but the **adapter implementation** (`adapters/persistence/kysely-consumption.repository.ts`, line ~217) still reads: *"called by the cron (stock replenished above threshold) and by `configurarConsumo` (a full reconfiguration is a new alert context) — never by `marcarDosisTomada`..."* — the exact same inaccurate claim, in the exact same class of file, that the fix commit's own message says it was closing. Verified via direct `grep -rn "configurarConsumo" services/core-api/src/domains/consumo/adapters/persistence/kysely-consumption.repository.ts` (line 217 matches) and `git show 6fb90b6 --stat` (touches only the port file, not the adapter). Non-functional (comment-only), but a maintainer reading only the adapter implementation — the file someone is more likely to open when working on the cron — would get the wrong picture about `configurarConsumo`'s actual behavior. **Recommendation**: trivial one-comment follow-up fix, same shape as `6fb90b6` itself, applied to the adapter file this time.

### SUGGESTION-1 — Review-workload estimates were consistently exceeded (2–3x on 4 of 10 PRs)

PR2b (812 vs. 350-470 est.), PR3 (~1580 vs. 350-450 est.), PR4 (1271 vs. 350-450 est.), PR6b (688 vs. 350-430 est.) all landed well over tasks.md's own forecast — every time self-flagged transparently in apply-progress.md's "Issues Found"/"Review Workload Note" sections, attributed to comprehensive strict-TDD RED-test coverage rather than scope creep, consistent with what this pass found on direct code inspection (test files are consistently the majority of each diff). PR1/PR2a/PR5/PR6a/PR6c/PR7 landed within or near estimate. Same pattern already flagged as a SUGGESTION in `backend-core-api-catalogo`'s own verify report — worth feeding back into how `sdd-tasks` calibrates line-count forecasts for strict-TDD domain work a second time, since the pattern repeated across a second full domain change.

---

## Verdict

**PASS WITH WARNINGS** — 0 CRITICAL, 3 WARNING, 1 SUGGESTION.

No CRITICAL issue was found. All 11 scrutiny items requested for this review resolve correctly: the two genuinely correctness-critical pieces (D-C's SQL predicate, D-E's reclaim-before-emit ordering) were not just read but **mutation-tested** in this session — both were broken on purpose and both were caught by the existing test suite, then cleanly reverted (working tree confirmed clean before this report was written). The transaction-scope self-correction in PR4 was independently re-derived from design.md's Diagram 2 rather than trusted from apply-progress.md's narrative, and found correct. All 5 mandatory gates plus the opt-in integration suite plus isolated `identidad`/`catalogo` regression suites were re-run in this session and match the numbers apply-progress.md claims exactly — zero regressions on either archived domain. The 3 WARNINGs are non-blocking: two are pre-existing, self-acknowledged documentation gaps outside this PR's declared scope (one of which was even the target of a fix commit that only partially closed it — WARNING-3 is the one genuinely new finding from this pass), and one is a genuinely open design requirement that is correctly *documented* as open rather than silently dropped. None of the three requires a code change to unblock archive; all three should be logged so they don't silently disappear.

