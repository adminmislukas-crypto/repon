# Tasks: `consumo` — tercer vertical, primer job programado, primer binding real del kernel de notificaciones

Expands design.md's finalized **7-PR chained sequence** (§"Secuencia de implementación") into checkable, test-first tasks. Order, PR boundaries, and rationale are design.md's (D1-D16, D-A..D-H) — not re-derived here.

**Restructured post-forecast**: PR2 (dominio+lectura) and PR6 (cron) individually risked exceeding the 400-line review budget. Per the `ask-on-risk` delivery strategy, the maintainer chose to sub-split both using the fallback boundaries already sketched in the original forecast, rather than requesting a `size:exception` — same call made for `catalogo`'s own oversized PRs. **7 PRs become 10** — every dependency edge below is unchanged from design.md; only the granularity of PR2 and PR6 changed.

## Review Workload Forecast (revised)

| Field | Value |
|---|---|
| Estimated changed lines | ~2,700-3,300 total, now across **10** chained PRs; per-PR range 140-470 |
| 400-line budget risk | **Low-Medium overall** — every PR now targets ≤~470 lines; no PR bundles more than one reviewable concern |
| Chained PRs recommended | Yes — 10 sequential PRs, dependency-ordered, cannot parallelize |
| Chain strategy | stacked-to-main (each PR merges to `main` in order) |
| Delivery strategy | ask-on-risk (cached this session) — **resolved**: maintainer chose "sub-divide both large PRs" over `size:exception` |

```text
Decision needed before apply: No (resolved by maintainer — sub-split chosen)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main, 10 PRs
400-line budget risk: Low-Medium (post-split)
```

### Per-PR estimate

| PR | Slice | Est. lines | Risk | Note |
|---|---|---|---|---|
| 1 | 0 · groundwork | 200-270 | Low | Migration + row types + finalized ports-out + constants/errors |
| 2a | 1a · dominio (puro, sin I/O) | 300-380 | Low | 2 entidades + 3 funciones puras de cálculo. Cero I/O, cero adaptadores |
| 2b | 1b · lectura (persistencia parcial + caso de uso + HTTP + e2e) | 350-470 | Medium | R1 (404 cross-tenant) cierra acá. Depende de 2a |
| 3 | 2 · escritura | 350-450 | Medium | `registrarMascota` + `configurarConsumo` (+ D-H.3 petId ownership) + 2 rutas + e2e |
| 4 | 3 · dosis | 350-450 | Medium | `descontarStock` atómico (D-H.2) + `marcarDosisTomada` transaccional (D6) + `DosisRegistrada` + e2e |
| 5 | 4 · kernel de notificaciones | 180-260 | Low-Medium | Riesgo es radio de impacto (R5: toca `SharedKernelModule`), no tamaño — debe re-correr las suites completas de `identidad`+`catalogo` |
| 6a | 5a · repo CAS + payloads de eventos | 220-280 | Low | Métodos de repositorio (`findDueForCheck`, `intentarMarcarStockBajo`, `limpiarMarcaStockBajo`) + los 2 eventos |
| 6b | 5b · `ProcesarConsumosVencidosUseCase` | 350-430 | Medium-High | El caso de uso con más escenarios de todo el cambio, pero un solo par de archivos cohesivo |
| 6c | 5c · adaptador de scheduling + dependencia + env | 140-200 | Low | `@nestjs/schedule` (única dependencia nueva), `CONSUMO_CRON_ENABLED`, la clase `@Cron()` delgada |
| 7 | 6 · cierre | 150-220 | Low | Docs-only: 5 deltas de SPEC.md/capability + auditoría de exports + verificación completa |

### Suggested Work Units

| Unit | Goal | PR | Base | Notes |
|---|---|---|---|---|
| 1 | Groundwork: migración, row types, ports-out finales, constants/errors | PR 1 | `main` | Sin dependencias; bloquea todo lo demás |
| 2a | Dominio: entidades + cálculos puros | PR 2a | `main` | Depende de PR 1's ports/constants. Cero I/O — testeable en aislamiento total |
| 2b | Lectura: persistencia parcial + `calcularDiasRestantes` + HTTP + e2e | PR 2b | `main` | Depende de 2a's entidades. R1 cierra acá |
| 3 | Escritura: `registrarMascota` + `configurarConsumo` | PR 3 | `main` | Depende de 2a's entidades y 2b's patrón `findById` |
| 4 | Dosis: `descontarStock` + `marcarDosisTomada` | PR 4 | `main` | Depende de 2b's `findById`; independiente de PR 3 |
| 5 | Kernel de notificaciones | PR 5 | `main` | Independiente de PRs 3-4; debe preceder PR 6a (el cron inyecta `NOTIFICATION_PORT` real) |
| 6a | Repo CAS + eventos | PR 6a | `main` | Depende de PR 1 (columna de debounce) y 2a (fórmulas) |
| 6b | `ProcesarConsumosVencidosUseCase` | PR 6b | `main` | Depende de 6a (métodos del repo) y PR 5 (`NOTIFICATION_PORT`) |
| 6c | Adaptador de scheduling | PR 6c | `main` | Depende de 6b (el caso de uso que el `@Cron()` invoca) |
| 7 | Cierre | PR 7 | `main` | Depende de 6c; los deltas de SPEC.md describen comportamiento que ya debe existir |

---

## Phase 1: Groundwork — Spec: `db-schema-consumo`, `shared-types-package`, `core-api-consumo` (port deltas)

- [x] 1.1 Write `supabase/migrations/20260806120000_13_consumo_stock_bajo_debounce.sql`: `alter table user_consumption add column stock_bajo_notificado_at timestamptz`, with the full doc-comment rationale (D-A). No grant/RLS/index changes needed (verified in design.md).
- [x] 1.2 Apply locally (`supabase start`/`db reset`); verify no already-applied migration file is edited (db-schema-consumo Scenario "A new migration adds the marker, without touching applied migrations").
- [x] 1.3 `shared/database/schema.ts`: add `PetsTable`, `UserConsumptionTable` (incl. `stock_bajo_notificado_at: string | null`), `ConsumptionLogsTable`; register all 3 on `DB` (D12).
- [x] 1.4 `packages/types/src/consumo.ts`: add `userId: string` to `UserConsumption` (D15); verify `tsc --noEmit` for `packages/types` (shared-types-package Scenario "UserConsumption carries an owner userId like Pet").
- [x] 1.5 Create `domains/consumo/ports-out/pet-repository.port.ts` (NEW, D-H.1): `PetRepository { save, findById }`, `PET_REPOSITORY` token.
- [x] 1.6 Extend `domains/consumo/ports-out/consumption-repository.port.ts`: add `findById`, `findDueForCheck(umbralDias, tx?)`, `intentarMarcarStockBajo(consumptionId, notificadoAt, tx?): Promise<boolean>`, `limpiarMarcaStockBajo(consumptionId, tx?): Promise<void>`, `descontarStock(consumptionId, cantidad, tx?): Promise<number>` — doc comments carry the CAS/clamp/superset contract from D-A/D-C/D-H.2 (methods land incrementally in later PRs).
- [x] 1.7 Confirm `domains/consumo/ports-out/consumption-log-repository.port.ts` needs no edit (verified against real use, per design.md).
- [x] 1.8 Create `domain/consumo.constants.ts`: `UMBRAL_STOCK_BAJO_DIAS = 7` with the lead-time rationale doc comment (D-B).
- [x] 1.9 Create `domain/consumo.errors.ts`: `ConsumptionNotFoundError`, `PetNotFoundError`, `ConsumoInvalidoError`, `MascotaInvalidaError`, `DosisInvalidaError` (used incrementally by later PRs).
- [x] 1.10 Run `pnpm lint`/`pnpm typecheck` — confirm the new interfaces compile with zero implementers yet (expected: nothing implements `PetRepository`/extended `ConsumptionRepository` until Phase 2a+).

## Phase 2a: Dominio (puro, sin I/O) — Spec: `core-api-consumo`

Depends on Phase 1's ports/constants/errors. Zero adapters, zero I/O — testeable en aislamiento total.

- [x] 2a.1 RED: `domain/pet.entity.spec.ts` — `crear()` rejects invalid `nombre`/`especie` (`MascotaInvalidaError`).
- [x] 2a.2 GREEN: `domain/pet.entity.ts` — `crear()` factory + validations.
- [x] 2a.3 RED: `domain/user-consumption.entity.spec.ts` — 3 invariants: `petId ⟺ ownerType==='pet'`, `dosisPorToma > 0`, `horarios` non-empty (`ConsumoInvalidoError`).
- [x] 2a.4 GREEN: `domain/user-consumption.entity.ts` — `crear()` factory enforcing all 3.
- [x] 2a.5 RED: `domain/consumo.calculos.spec.ts` — `consumoDiario`, `diasRestantes` (`Math.floor`, edges: `stock=0`, exactly at threshold, `frecuenciaDias>1`), `mensajeStockBajo` (pure, no lookups — D-D N+1 avoidance).
- [x] 2a.6 GREEN: `domain/consumo.calculos.ts` — the 3 pure functions, sole authority for the formula (D-C's SQL predicate is a superset of this, never the decision).

## Phase 2b: Lectura (persistencia parcial + caso de uso + HTTP + e2e) — Spec: `core-api-consumo`

Depends on Phase 2a's entities.

- [x] 2b.1 RED: `adapters/persistence/kysely-consumption.repository.spec.ts` — `findById` only this PR; numeric mapper for `dosis_por_toma`/`stock_actual`/`stock_bajo_notificado_at` (the "detalle mecánico de mayor riesgo": 4 numeric columns across this domain).
- [x] 2b.2 GREEN: `adapters/persistence/kysely-consumption.repository.ts` — implements `findById` (other methods extend this same file incrementally in PR3/4/6a, mirroring `catalogo`'s `KyselyCatalogRepository` convention).
- [x] 2b.3 RED: `ports-in/calcular-dias-restantes.use-case.spec.ts` — cross-tenant 404 written FIRST (core-api-consumo "Cross-tenant read attempt returns 404, not 403" — R1 closes here); happy path; constructor-injection inspection test (no `EVENT_PUBLISHER`/`NOTIFICATION_PORT` — "The pure-query use case cannot reach events or notifications").
- [x] 2b.4 GREEN: `ports-in/calcular-dias-restantes.use-case.ts` — constructor takes only `CONSUMPTION_REPOSITORY`.
- [x] 2b.5 `adapters/http/dto/dias-restantes-response.dto.ts` + `consumo.mapper.ts` + `adapters/http/consumo.controller.ts`: `GET /consumo/mis-consumos/:consumptionId/dias-restantes` (authenticated, no `@Roles`, `mis-` prefix encodes D8).
- [x] 2b.6 RED: `adapters/http/consumo-exception.filter.spec.ts` — `ConsumptionNotFoundError`→404 (others land as their use cases do).
- [x] 2b.7 GREEN: `adapters/http/consumo-exception.filter.ts` mirroring `CatalogoExceptionFilter`; `@UseFilters` at controller level.
- [x] 2b.8 `consumo.module.ts`: bind `CONSUMPTION_REPOSITORY`→`KyselyConsumptionRepository`; register `CalcularDiasRestantesUseCase` + controller + filter; `exports: []` (D9/D14).
- [x] 2b.9 E2e: `test/consumo-dias-restantes.e2e-spec.ts` — 401 no token, 404 cross-tenant, happy path.

## Phase 3: Escritura — Spec: `core-api-consumo`

Depends on Phase 2a's entities and 2b's `findById` pattern.

- [x] 3.1 RED: `ports-in/registrar-mascota.use-case.spec.ts` — `userId` only from `actor.profileId` (core-api-consumo "A client-supplied userId cannot influence the write"); `id` generated via `randomUUID()` in the use case (D-H.1 repo precedent, never a DB default).
- [x] 3.2 GREEN: `ports-in/registrar-mascota.use-case.ts`.
- [x] 3.3 RED: `adapters/persistence/kysely-pet.repository.spec.ts` (NEW, first caller) — `save()` inserts, numeric mapper for `peso_kg`.
- [x] 3.4 GREEN: `adapters/persistence/kysely-pet.repository.ts` — implements `save()`.
- [x] 3.5 RED (extend 3.3's file): `findById()` for the ownership check below.
- [x] 3.6 GREEN (extend 3.4's file): implements `findById()`.
- [x] 3.7 RED (extend Phase 2b's `kysely-consumption.repository.spec.ts`): `save()` upserts a new `UserConsumption`, propagates `tx?`.
- [x] 3.8 GREEN (extend Phase 2b's file): implements `save()`.
- [x] 3.9 RED: `ports-in/configurar-consumo.use-case.spec.ts` — negative FIRST (D16 convention): foreign `petId` → `PetNotFoundError`/404, no `UserConsumption` created (core-api-consumo "A client-supplied petId belonging to another user is rejected as 404, not 403" — D-H.3); happy path (own pet, core-api-consumo "Configuring a consumption for the caller's own pet succeeds"); `userId` only from actor.
- [x] 3.10 GREEN: `ports-in/configurar-consumo.use-case.ts` — `findById` on `PET_REPOSITORY` before `save`, `randomUUID()` for the new id.
- [x] 3.11 `adapters/http/dto/nueva-mascota.dto.ts`, `adapters/http/dto/nuevo-consumo.dto.ts` (neither exposes `userId`, D8), `adapters/http/dto/pet-response.dto.ts` (`PetResponseDto`), `adapters/http/dto/user-consumption-response.dto.ts` (`UserConsumptionResponseDto`); `consumo.mapper.ts` additions.
- [x] 3.12 `adapters/http/consumo.controller.ts`: `POST /consumo/mis-mascotas` (201), `POST /consumo/mis-consumos` (201), both authenticated, no `@Roles`.
- [x] 3.13 RED (extend `consumo-exception.filter.spec.ts`): `PetNotFoundError`→404, `MascotaInvalidaError`/`ConsumoInvalidoError`→400.
- [x] 3.14 GREEN (extend the filter).
- [x] 3.15 `consumo.module.ts`: bind `PET_REPOSITORY`→`KyselyPetRepository`; register `RegistrarMascotaUseCase`, `ConfigurarConsumoUseCase`.
- [x] 3.16 E2e: `test/consumo-mis-mascotas.e2e-spec.ts` + `test/consumo-mis-consumos.e2e-spec.ts` — happy paths, 404 foreign `petId`, DTO rejects a client-supplied `userId` field (400).

## Phase 4: Dosis — Spec: `core-api-consumo`

Depends on Phase 2b's `findById`.

- [x] 4.1 RED (extend `kysely-consumption.repository.spec.ts`): `descontarStock` — `UPDATE ... SET stock_actual = greatest(stock_actual - $2, 0) ... RETURNING stock_actual`, atomic, clamps at 0, propagates `tx`.
- [x] 4.2 GREEN (extend the file): implements `descontarStock` (D-H.2).
- [x] 4.3 RED: `adapters/persistence/kysely-consumption-log.repository.spec.ts` (NEW, first caller) — `append()` inserts with numeric mapper for `cantidad`.
- [x] 4.4 GREEN: `adapters/persistence/kysely-consumption-log.repository.ts` — `append()`; `adherenciaUltimos7Dias()` implemented minimally for interface completeness (no caller in this change's scope, doc-commented as such).
- [x] 4.5 RED: `ports-in/marcar-dosis-tomada.use-case.spec.ts` — cross-tenant 404 FIRST (core-api-consumo "Cross-tenant attempt returns 404, not 403, and does not mutate"); `runInTransaction` wraps `append`+`descontarStock` with the same `tx` (D6); a failure in the 2nd write leaves neither persisted; `publish(DosisRegistrada)` only after commit; `cantidad` always `= uc.dosisPorToma`, never client-supplied; clamp-at-zero (core-api-consumo "A dose marked when stock is less than one full dose clamps to zero").
- [x] 4.6 GREEN: `ports-in/marcar-dosis-tomada.use-case.ts`.
- [x] 4.7 `events/dosis-registrada.event.ts` — exact D-D payload: `consumptionId, userId, tomadoAt, cantidad, stockRestante`.
- [x] 4.8 `adapters/http/dto/marcar-dosis.dto.ts` (`{ tomadoAt?: string }` ISO-8601; future timestamp → `DosisInvalidaError`).
- [x] 4.9 `adapters/http/consumo.controller.ts`: `POST /consumo/mis-consumos/:consumptionId/dosis` (204, authenticated, no `@Roles`).
- [x] 4.10 RED (extend the exception filter spec): `DosisInvalidaError`→400.
- [x] 4.11 GREEN (extend the filter).
- [x] 4.12 `consumo.module.ts`: register `MarcarDosisTomadaUseCase`.
- [x] 4.13 E2e: `test/consumo-marcar-dosis.e2e-spec.ts` — happy path (stock decrements, log appended), 404 cross-tenant (zero mutation in DB), 400 future `tomadoAt`, clamp-at-zero.
- [x] 4.14 Opt-in integration test (`supabase start` local): `descontarStock` on a row with `stockActual < dosisPorToma` returns 0, never negative (core-api-consumo scenario, verified against real Postgres `greatest()`).

## Phase 5: Kernel de notificaciones — Spec: `shared-notifications`

Independent of Phases 3-4; must land before Phase 6a (el cron inyecta `NOTIFICATION_PORT` real).

- [x] 5.1 `shared/notifications/push-token-resolver.port.ts`: `PushTokenResolver { resolve(profileId): Promise<string | null> }`, `PUSH_TOKEN_RESOLVER` token (D-G).
- [x] 5.2 `shared/notifications/null-push-token.resolver.ts`: `NullPushTokenResolver` — always `null`, doc comment naming the missing capability explicitly.
- [x] 5.3 RED: `shared/notifications/expo-push-notification.adapter.spec.ts` — no token → logs `push.omitida`/`sin_token`, resolves without throwing (shared-notifications "No-op-safe on a missing token"); resolver throws → still no throw, logs `push.error`; token present (unreachable today) → logs `push.no_entregada`/`token_presente_sin_cliente_expo`.
- [x] 5.4 GREEN: `shared/notifications/expo-push-notification.adapter.ts` implementing `NotificationPort.sendPush`; never logs `mensaje` content (health data, D-G).
- [x] 5.5 `shared/notifications/notifications.module.ts` (NEW, `@Global()`): `PUSH_TOKEN_RESOLVER`→`NullPushTokenResolver`, `NOTIFICATION_PORT`→`ExpoPushNotificationAdapter`; `exports: [NOTIFICATION_PORT]` only (shared-notifications "NotificationsModule mirrors AuditModule's shape").
- [x] 5.6 `shared/shared-kernel.module.ts`: add `NotificationsModule` to `imports`/`exports`; rewrite the doc comment (only `shared/payments` still applies to the old "declares tokens but binds no provider" line).
- [x] 5.7 Confirm `consumo.module.ts` binds/exports no `NOTIFICATION_PORT` reference anywhere (shared-notifications "consumo.module.ts does not bind or export NOTIFICATION_PORT").
- [x] 5.8 Run the full existing `identidad` and `catalogo` regression suites — zero regressions from the `SharedKernelModule` edit (R5; mirrors `catalogo` tasks.md 7.10's precedent).

## Phase 6a: Repo CAS + payloads de eventos — Spec: `core-api-consumo`, `db-schema-consumo`

Depende de Phase 1 (columna de debounce) y 2a (fórmulas).

- [x] 6a.1 `domains/consumo/events/stock-bajo.payload.ts`: `StockBajoPayload` — exact D-D shape (`consumptionId, userId, ownerType, petId, kind, nombre, unidad, stockActual, consumoDiario, diasRestantes, umbralDias`).
- [x] 6a.2 `events/stock-bajo-detectado.event.ts` + `events/refill-auto-solicitado.event.ts` — both share `StockBajoPayload`, distinct `type` (`consumo.stock_bajo_detectado` / `consumo.refill_auto_solicitado`).
- [x] 6a.3 RED (extend `kysely-consumption.repository.spec.ts`): `findDueForCheck(umbralDias)` — exact D-C union predicate (`stock_bajo_notificado_at IS NOT NULL OR stock_actual * frecuencia_dias < (umbral+1) * dosis_por_toma * n_horarios`), multiplicative, never division.
- [x] 6a.4 GREEN (extend the file): implements `findDueForCheck`.
- [x] 6a.5 RED (extend the file): `intentarMarcarStockBajo` — CAS `UPDATE ... WHERE stock_bajo_notificado_at IS NULL RETURNING id`; 0 rows→`false`, 1 row→`true`.
- [x] 6a.6 GREEN (extend the file): implements `intentarMarcarStockBajo`.
- [x] 6a.7 RED (extend the file): `limpiarMarcaStockBajo` — idempotent, 0-rows-affected is success.
- [x] 6a.8 GREEN (extend the file): implements `limpiarMarcaStockBajo`.

## Phase 6b: `ProcesarConsumosVencidosUseCase` — Spec: `core-api-consumo`

Depende de 6a (métodos del repo) y Phase 5 (`NOTIFICATION_PORT` real).

- [x] 6b.1 RED: `ports-in/procesar-consumos-vencidos.use-case.spec.ts` — debounce (D5): 2 consecutive runs on the same unresolved condition → exactly one event pair total; debounce clears + re-notifies after replenish-then-redrop; cleanup branch (`diasRestantes >= UMBRAL` + marker open) → `limpiarMarcaStockBajo` called, zero events/push; fan-out (D3): N due items → N separate `StockBajoDetectado`, never a summary; `RefillAutoSolicitado` only if `autoCrearRefill`; failure isolation (D4): one item throws → caught+logged, others still process; constructor never injects `TRANSACTION_MANAGER` (inspection test); missing push token doesn't fail the item; no `@Roles()` anywhere for this use case, never HTTP-reachable.
- [x] 6b.2 GREEN: `ports-in/procesar-consumos-vencidos.use-case.ts` — reclaim-before-emit (D-E), per-item try/catch, calls `mensajeStockBajo` from Phase 2a's `consumo.calculos.ts` (no per-item mascota lookup, N+1 avoidance), summary log `{candidatas, emitidos, limpiados, fallidos, duracionMs}`.

## Phase 6c: Adaptador de scheduling + dependencia + env — Spec: `core-api-consumo`, `core-api-hexagonal-layout`

Depende de 6b (el caso de uso que el `@Cron()` invoca).

- [x] 6c.1 Add `@nestjs/schedule` to `services/core-api/package.json` — the ONE new dependency this change adds (D-G confirms no Expo client).
- [x] 6c.2 `config/env.schema.ts`: add `CONSUMO_CRON_ENABLED: z.enum(['true','false']).default('true')` (D-E; `z.coerce.boolean()` explicitly rejected).
- [x] 6c.3 RED (extend `config/env.schema.spec.ts`): invalid value for `CONSUMO_CRON_ENABLED` fails startup validation.
- [x] 6c.4 GREEN: confirm 6c.2's schema addition satisfies 6c.3.
- [x] 6c.5 `app.module.ts`: add `ScheduleModule.forRoot()` to `imports` (D1).
- [x] 6c.6 `adapters/scheduling/consumption-check.job.ts` (NEW — first scheduled adapter in the repo): `@Cron('0 9 * * *', { name, timeZone: 'America/Santiago', disabled: process.env.CONSUMO_CRON_ENABLED === 'false' })`, exactly one call to `procesarConsumosVencidos.execute()`, zero other logic (D1 — no dedicated unit test by design; verifiable by inspection).
- [x] 6c.7 `consumo.module.ts`: register `ProcesarConsumosVencidosUseCase`, `ConsumptionCheckJob` (in `providers`, not `controllers`); confirm `exports: []` still holds.
- [x] 6c.8 Opt-in integration test (`supabase start` local): two concurrent `intentarMarcarStockBajo` calls on the same row — one `true`, one `false` (the CAS row-lock proof, D-E/R10).
- [x] 6c.9 E2e: confirm no HTTP route reaches `procesarConsumosVencidos` (core-api-consumo "procesarConsumosVencidos has no HTTP surface" — route-enumeration assertion).

## Phase 7: Cierre — Spec: all 5 delta specs

Depends on Phase 6c; SPEC.md deltas describe behavior that must already exist.

- [x] 7.1 `services/core-api/domains/consumo/SPEC.md`: apply all declared deltas from design.md's table (13 total): CQS split (D2), debounce marker ownership (D5), 404 cross-tenant on `marcarDosisTomada`/`calcularDiasRestantes` (D7), `PetRepository` new port (D-H.1), `ConsumptionRepository` additions incl. `findDueForCheck` returning candidates-not-decisions (D-A/D-C/D-H.2), `configurarConsumo` petId 404 (D-H.3), umbral = domain constant (D-B), stock clamp-at-0 (D-H.2), exact 3-event payloads + the "consumo publishes only what it owns" rule (D-D).
- [x] 7.2 `packages/types/SPEC.md`: append `UserConsumption.userId` (D15).
- [x] 7.3 `docs/ARCHITECTURE.md`: correct the Edge Function/`pg_cron` framing to `@nestjs/schedule` in-process (D11).
- [x] 7.4 `core-api-hexagonal-layout` capability doc: `adapters/scheduling/` conditional-presence rule; `consumo`'s deliberate absence of `contracts/`/`adapters/events/` (D14, closes WARNING-2 formally).
- [x] 7.5 `db-schema-consumo` delta doc: `stock_bajo_notificado_at` column + explicit note that `user_consumption` has no `activo` column (no way to pause an item — product decision, not built here).
- [x] 7.6 `shared-notifications` capability doc: cross-check Phase 5's module doc comments match the written spec (D9/D10/D-G).
- [x] 7.7 Audit `consumo.module.ts` `exports:` — confirm exactly `[]`, nothing crosses the module boundary (D9/D14).
- [x] 7.8 Full workspace verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit+e2e, incl. Phase 5's identidad/catalogo regression baseline), `pnpm build`, `pnpm format:check`; opt-in integration suite against local Supabase (Phase 4's clamp proof + Phase 6c's CAS-race proof).
- [x] 7.9 Carry forward the 13 open items from design.md's "Riesgos residuales y preguntas abiertas" as documented follow-ups (mirrors `catalogo` tasks.md 9.6's precedent) — none silently dropped.

---

## Dependency Notes

10 PRs, strictly sequential per design.md's dependency chain plus the maintainer-chosen splits: PR1 → PR2a → PR2b → PR3 → PR4 → PR5 → PR6a → PR6b → PR6c → PR7. Non-adjacent edges: PR4 depends on PR2b's `findById` pattern, not PR3; PR6a depends on PR1 (debounce column) and PR2a (`consumo.calculos.ts`), not PR3/PR4; PR6b depends on PR6a (repo methods) and PR5 (`NOTIFICATION_PORT` bound for real); PR6c depends on PR6b (the use case the job invokes). Per this project's DoD (`openspec/config.yaml`): implementation + its unit/e2e tests + the relevant `SPEC.md` delta land in the same commit/PR — Phase 7 is the exception by design. `strict_tdd: true` is active for every task introducing real logic — RED items are failing tests written first, GREEN items are the minimal implementation that passes them.
