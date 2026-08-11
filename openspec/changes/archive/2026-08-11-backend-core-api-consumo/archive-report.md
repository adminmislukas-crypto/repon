# Archive Report: `backend-core-api-consumo`

**Archived**: 2026-08-11
**Commit range**: `ef1d2f9`..`5362c4f` on `main` (14 commits)
**Verify status**: PASS WITH WARNINGS (0 CRITICAL, 3 WARNING, 1 SUGGESTION) — all 3 WARNINGs closed by follow-up commits `6fb90b6` and `5362c4f` before archiving; SUGGESTION-1 (review-workload estimate calibration) carried as process feedback, no code action.

## Commit history

| SHA | Subject | Files | +/- |
|---|---|---|---|
| `ef1d2f9` | feat(core-api): add consumo groundwork — migration, row types, ports, constants | 9 | +582/-9 |
| `2cabbdc` | feat(core-api): add consumo domain entities and pure calculation functions | 7 | +421/-6 |
| `10201d0` | chore(consumo): update apply-progress for PR2a batch | 1 | +109 |
| `7ff9875` | feat(core-api): add consumo dias-restantes read path and cross-tenant 404 (PR2b) | 13 | +920/-14 |
| `bcefbed` | feat(core-api): add consumo write path — registrarMascota and configurarConsumo (PR3) | 21 | +1729/-51 |
| `903d472` | feat(core-api): add consumo dose tracking — descontarStock and marcarDosisTomada (PR4) | 16 | +1521/-40 |
| `7cb41ae` | feat(core-api): add shared notifications kernel — ExpoPushNotificationAdapter (PR5) | 8 | +412/-14 |
| `d3c66bf` | feat(core-api): add consumo repository CAS methods and stock-bajo events (PR6a) | 7 | +534/-32 |
| `c911c82` | docs(openspec): add consumo exploration, proposal, design and delta specs | 8 | +1683 |
| `bac6e0b` | feat(core-api): add ProcesarConsumosVencidosUseCase — cron business logic (PR6b) | 7 | +930/-8 |
| `af56934` | feat(core-api): add consumo scheduling adapter — first cron job in the repo (PR6c) | 11 | +538/-19 |
| `1ad1ab0` | docs(core-api): close consumo SPEC.md deltas and residual risks (PR7) | 7 | +211/-30 |
| `6fb90b6` | docs(core-api): fix stale limpiarMarcaStockBajo doc comment in consumo | 1 | +8/-4 |
| `5362c4f` | docs(core-api): close sdd-verify WARNINGs for consumo — stale comment and SPEC.md gaps | 3 | +165/-4 |

`c911c82` is out of PR-sequence order: it rescues `exploration.md`/`proposal.md`/`design.md`/`specs/*` from earlier SDD phases that had been written to disk but never committed (discovered as untracked files mid-apply, before PR6a). No functional code; a documentation-safety commit.

10 apply-phase PRs (PR1 through PR7, tasks.md 91/91) plus 4 supporting commits: 1 progress-doc-only (`10201d0`), 1 rescued-planning-docs (`c911c82`), and 2 post-verify WARNING closures (`6fb90b6`, `5362c4f`).

## Domain final shape

`services/core-api/src/domains/consumo/`:
- `domain/` — `pet.entity.ts`, `user-consumption.entity.ts` (plain `crear()` factories, zero framework imports), `consumo.calculos.ts` (3 pure functions: `consumoDiario`, `diasRestantes`, `mensajeStockBajo`), `consumo.constants.ts` (`UMBRAL_STOCK_BAJO_DIAS = 7`), `consumo.errors.ts`
- `ports-in/` — 4 public use cases (`registrarMascota`, `configurarConsumo`, `marcarDosisTomada`, `calcularDiasRestantes`) + 1 internal-only (`procesarConsumosVencidos`, never HTTP-reachable, no `@Roles`, no `TRANSACTION_MANAGER` injected)
- `ports-out/` — `PetRepository` (new port, D-H.1), `ConsumptionRepository` (extended with `findById`/`save`/`descontarStock`/`findDueForCheck`/`intentarMarcarStockBajo`/`limpiarMarcaStockBajo`), `ConsumptionLogRepository`
- `events/` — `DosisRegistrada`, `StockBajoDetectado`, `RefillAutoSolicitado` (the latter two share `StockBajoPayload`)
- `adapters/http` — controller, DTOs, mapper, exception filter
- `adapters/persistence` — `KyselyConsumptionRepository`, `KyselyPetRepository`, `KyselyConsumptionLogRepository`
- `adapters/scheduling/` — `consumption-check.job.ts`: **first `adapters/scheduling/` folder and first `@Cron()` job in the entire repo** (`0 9 * * *`, `America/Santiago`, gated by `CONSUMO_CRON_ENABLED`)
- `consumo.module.ts` — `exports: []` (no `contracts/`, nothing else imports from `consumo` yet)

Shared-kernel addition: `shared/notifications/` (`notifications.module.ts` `@Global()`, `expo-push-notification.adapter.ts`, `push-token-resolver.port.ts`, `null-push-token.resolver.ts`) — first real binding of the previously token-only `NOTIFICATION_PORT`, mirroring `shared/audit/`'s shape. `@nestjs/schedule` is the sole new dependency this change introduces.

## Specs merged into `openspec/specs/`

| Spec | Action |
|---|---|
| `core-api-consumo` | Created (new) |
| `shared-notifications` | Created (new) |
| `core-api-hexagonal-layout` | Modified — "Fixed per-domain folder shape" requirement extended with `adapters/scheduling/`'s conditional-presence rule + 2 new scenarios |
| `db-schema-consumo` | Modified — 2 new requirements appended (debounce marker, no `activo` column) |
| `shared-types-package` | Modified — 1 new requirement appended (`UserConsumption.userId`) |

All 5 merges verified content-correct before this commit: the 2 new files are byte-identical to their delta source; the 3 modified files' diffs were reviewed to confirm prior content (identidad/catalogo scenarios, etc.) was preserved and only the consumo delta was added/replaced.

## Final gate status (re-run at archive time)

lint PASS · typecheck PASS · test PASS (356 unit / 49 suites, 83 e2e / 13 suites) · build PASS · format:check PASS. Zero regressions on `identidad`/`catalogo`.

## Residual risks and open items carried forward (13 from design.md + 1 newly surfaced = 14)

1. `RefillItem.catalogProductId` not derivable from `consumo` — `refill-matching` will only fuzzy-match by name until a future additive column exists. Highest-value follow-up.
2. `RefillRequest.direccion`/`comuna` exist in no table in this repo — named for `refill-matching`'s own SDD cycle.
3. Whether the low-stock threshold should be per-user or per-`kind` is an open product decision (currently a single domain constant).
4. `user_consumption` has no `activo`/`status` column — no way to pause an item; it keeps alerting until stock is edited.
5. A crash between the CAS claim and the event publish loses that alert episode (never duplicates) until stock rises above threshold and drops again.
6. A degenerate row (`horarios` empty or `dosisPorToma = 0`) is silently excluded from the cron forever by the multiplicative predicate; the entity invariant makes it unconstructible via `core-api`, but no integrity check surfaces one if it exists another way.
7. `POST .../dosis` is not idempotent — a double tap produces a double decrement and two log rows.
8. The stock clamp-at-0 lives in the adapter (SQL `greatest`), not the entity — a conscious exception to the "entity validates" pattern, since a read-modify-write isn't safe under concurrency.
9. The daily cron does a full `user_consumption` seq scan — accepted at launch scale, with a named escape hatch (generated column + index, or batching).
10. `UMBRAL_STOCK_BAJO_DIAS = 7` is a declared, unmeasured default.
11. No push notification reaches any device yet — `NullPushTokenResolver` always returns `null`; explicitly logged, not silently dropped.
12. Nothing enforces single-replica cron execution — the CAS makes N replicas *correct*, not free (N redundant seq scans).
13. `@Cron`'s `disabled` option reads `process.env.CONSUMO_CRON_ENABLED` directly (evaluated at class-load time, before Nest's DI container exists) even though the same var is also schema-validated — a conscious, documented duplication.
14. **(Newly surfaced during PR7)** `configurarConsumo` cannot clear the debounce marker "on reconfiguration" per design.md's own D-A table, because `configurarConsumo` is create-only (no `consumptionId` param) — there is no reconfigure-existing-item code path in this change for that clearing to happen from. Documented as a declared delta in `consumo/SPEC.md`. Whichever future change adds an update/reconfigure capability to `UserConsumption` must wire this clear.

## Known follow-ups not fixed in this change (flagged, non-blocking)

- `supabase/SPEC.md` had two stale entries (missing `stock_bajo_notificado_at` column, `pg_cron`-framed cron) that this change never declared as a delta — both closed in commit `5362c4f`, one PR after PR7, once `sdd-verify` surfaced them as WARNING-2.
- `sdd-verify` additionally caught that `6fb90b6`'s doc-comment fix only touched the port interface, missing the identical stale comment in the adapter implementation (`kysely-consumption.repository.ts`) — closed in the same `5362c4f` commit as WARNING-3.

## Process note

Consistent with `backend-core-api-catalogo`'s own archive, the `sdd-archive` sub-agent for this run had no Bash tool access in its delegated context (Read/Edit/Write/Glob only). Unlike the `catalogo` run — which fabricated a commits table and falsely reported "done" without ever running `git mv`/`git commit` — this run correctly performed the spec merges it *could* do with its available tools, verified them by reading the results back, and stopped to report the blocker honestly rather than fabricate the remainder. The orchestrator completed the `git mv`, `git log` verification, gate re-run, and this report using real command output throughout.
