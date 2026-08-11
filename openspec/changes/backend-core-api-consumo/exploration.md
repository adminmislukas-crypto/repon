# Exploration: `backend-core-api-consumo` — third domain vertical (`consumo`)

**Status**: partial (ready for proposal)
**Date**: 2026-08-10

## Executive Summary

Explored `consumo`'s build-out against `identidad`/`catalogo` precedent — placeholder ports already match product SPEC.md (no gaps to close), `@repon/types` is fully promoted already, no `contracts/`/`adapters/events/` needed; the two genuinely novel decisions are cron placement (recommend `@nestjs/schedule` + new `adapters/scheduling/` driving adapter, a declared hexagonal-layout spec delta) and the Expo Push adapter's binding location (recommend a real `shared/notifications/notifications.module.ts` mirroring `AuditModule`, not a `ConsumoModule`-private binding) — plus an unflagged repeat-day notification/refill idempotency risk surfaced for the first time here.

## Current State

**Placeholder scaffold** (`services/core-api/src/domains/consumo/`) — confirmed minimal, exactly 3 files, matching the `catalogo`-precedent placeholder shape exactly:
- `ports-out/consumption-repository.port.ts` — `ConsumptionRepository` (`save`, `findDueForCheck`, both with trailing `tx?: TransactionContext`) + `CONSUMPTION_REPOSITORY` token. Doc comment already correctly defers `adapters/persistence/` and explicitly ties `findDueForCheck` to "the domain's own cron job."
- `ports-out/consumption-log-repository.port.ts` — `ConsumptionLogRepository` (`append`, `adherenciaUltimos7Dias`) + `CONSUMPTION_LOG_REPOSITORY` token. Doc comment already correctly excludes `NotificationPort`/`EventPublisher` as kernel-owned infra, not per-domain ports.
- `consumo.module.ts` — empty `@Module({})`, no providers bound.

Both placeholder port signatures **already match** `consumo/SPEC.md`'s ports-out block exactly (method names, parameter shapes) — no signature revision needed here, unlike `identidad`'s foundation change, which had to close 4 real gaps. No `domain/`, `ports-in/`, `contracts/`, or `adapters/` exist yet.

**`@repon/types`** (`packages/types/src/consumo.ts`) — confirmed, all 5 types already promoted to real code exactly as `packages/types/SPEC.md`'s file-organization table claims: `OwnerType`, `ConsumptionKind`, `Pet`, `UserConsumption`, `ConsumptionLog`. `UserConsumption.horarios` is already a non-empty tuple (`[string, ...string[]]`); `petId` is documented as enforced in `core-api`, not a DB `CHECK`. **No `@repon/types` promotion debt exists for this domain** — unlike `catalogo`, which had to add 3 new types from scratch, `consumo` needs zero new shared-type work.

**Database**: fully migrated (`supabase/migrations/20260803120200_02_consumo.sql`) — `pets`, `user_consumption`, `consumption_logs`, RLS SELECT-only-own policies on all three, the `(consumption_id, tomado_at DESC)` index explicitly built for the daily cron's `adherenciaUltimos7Dias`/`calcularDiasRestantes` queries. `consumption_logs` has no owner column by design (Q8 owner-less child pattern, identical shape to `catalog_hidden_companies`'s "no redundant FK" reasoning). Kysely row types for these 3 tables are **not yet in `shared/database/schema.ts`** — same class of required groundwork `catalogo` needed for its 2 tables, confirmed absent.

**Shared kernel — the pieces already built and waiting**: `NOTIFICATION_PORT`/`NotificationPort` (`sendPush(recipientProfileId, mensaje)`) and `EVENT_PUBLISHER`/`EventPublisher` already exist as interface+token in `shared/notifications/notification.port.ts` and `shared/event-bus/event-publisher.port.ts`. Neither has a bound provider — `SharedKernelModule`'s own doc comment explicitly says `shared/notifications` "declares tokens but binds no provider yet... intentionally not wired here." `AuditLogPort` exists and is bound (`AuditModule`, `@Global()`) but **no `consumo` use case is admin-mutating** (all 4 use cases are self-service, user-scoped) — same "no audit" conclusion `catalogo` reached for its provider-self-service actions, for the identical reason.

**Dependency check — confirmed absent from the entire monorepo** (not just `core-api`): `@nestjs/schedule` is not in `services/core-api/package.json` and no `expo-server-sdk`/`expo-notifications`/`ExponentPushToken` reference exists anywhere in the repo. `apps/usuario-mobile/` and `apps/proveedor-mobile/` are still HTML mockups + a `SPEC.md` — **no existing push-token handling code exists anywhere to integrate with.** Both the cron mechanism and the push adapter are genuinely greenfield.

## Architectural document conflict found — must be flagged, not silently resolved

| Source | Says |
|---|---|
| `docs/ARCHITECTURE.md` ("Backend — Supabase" table, "Automatización de consumo") | The daily stock-remaining calculation "vive en una Edge Function programada (`pg_cron`)" — i.e., a Supabase Edge Function, not `core-api`. Push notifications are "disparadas desde Edge Functions." This doc predates `backend-core-api-foundation`'s decision to route all business logic through `core-api`. |
| `services/core-api/domains/consumo/SPEC.md` | The cron is explicitly "dentro del mismo dominio" (within `consumo` itself) — `ConsumoInboundPort.calcularDiasRestantes` and `ConsumptionRepository.findDueForCheck` are both framed as `core-api`-native. |
| `services/core-api/SPEC.md` ("Infraestructura compartida") | Push notifications are "usado como puerto de salida desde `consumo`" — i.e., `core-api` calls `NotificationPort` directly, not an Edge Function. |
| `backend-core-api-foundation`'s own proposal | Explicitly deferred "Edge Functions y jobs — cron de `consumo`" as out of scope for foundation, without committing to *where* it eventually lives. |

**Read as**: `docs/ARCHITECTURE.md` is stale — written when the pre-`core-api` Supabase-direct architecture was still current, and never updated after the foundation change moved all business logic behind `core-api`. The two `core-api`-scoped SPEC.md files are more specific to this exact domain and were written *after* the architectural pivot; they're the sources that should govern. This is exactly the kind of documentation drift `sdd-propose` should name explicitly as a declared correction to `docs/ARCHITECTURE.md` (or at minimum flag as a known gap), not something this exploration silently picks a side on and moves past.

## Affected Areas

- `services/core-api/src/domains/consumo/` — full vertical build: `domain/` (entities: `Pet`/`UserConsumption` factories, dose-math), `ports-in/` (4 public use cases + likely 1 internal cron-orchestration use case, see below), `adapters/http|persistence|scheduling` (new subpath, see Cron section), `consumo.module.ts` providers.
- `services/core-api/src/shared/database/schema.ts` — add `PetsTable`, `UserConsumptionTable`, `ConsumptionLogsTable`, extend `DB`.
- `services/core-api/src/shared/notifications/` — new: `expo-push.adapter.ts` + a real `NotificationsModule` (see NotificationPort section) — this is shared-kernel work, not `consumo`-domain work, even though `consumo`'s own change delivers it.
- `services/core-api/src/domains/refill-matching/` — currently a pure placeholder, so `RefillAutoSolicitado`'s exact payload shape becomes this change's responsibility to design well, since `refill-matching`'s own SDD change (not yet run) will consume it as its first cross-domain event.
- `openspec/specs/core-api-hexagonal-layout/spec.md` — likely needs a delta: the "Fixed per-domain folder shape" requirement's `adapters/http|persistence|events` enumeration doesn't currently include a scheduling/jobs adapter subfolder.
- `services/core-api/domains/consumo/SPEC.md` — likely needs 1-2 declared deltas (event payload shapes, and possibly the `calcularDiasRestantes`/cron side-effect separation — see below), same treatment `catalogo/SPEC.md` got.

## Cross-domain contract check (per `core-api-hexagonal-layout`'s two precedents)

**No `contracts/` folder needed.** Confirmed by grep across all 5 other domain `SPEC.md` files: none references `consumo` at all — no domain needs a synchronous read into `consumo`'s data. `consumo` is a pure event *producer* toward `refill-matching`, nothing more.

**No `adapters/events/` folder needed.** `consumo/SPEC.md`'s own "Eventos que consume" section is explicit: "Ninguno." — `consumo` is the second domain (after `identidad`) to have zero event consumption, matching `identidad`'s "publish-only, no `adapters/events/`" scenario in the hexagonal-layout spec, not `catalogo`'s "consumes events" scenario.

**New territory `consumo` *does* introduce**: a driving adapter that isn't HTTP or an event listener — a scheduled job.

## Recommendation: where the cron job lives architecturally

No `@nestjs/schedule` precedent exists in this repo. The standard, idiomatic NestJS approach is `@nestjs/schedule`'s `@Cron()` decorator on a thin driving-adapter class that delegates immediately to a `ports-in` use case, exactly mirroring how `adapters/http/*.controller.ts` and `adapters/events/*.listener.ts` are both thin dispatchers that never contain business logic themselves.

**Recommended shape**, extending the two existing "driving adapter" precedents (HTTP, events) with a third:

```
domains/consumo/
├── adapters/
│   ├── http/            (existing pattern: controller + DTOs + mapper)
│   ├── persistence/      (existing pattern: Kysely repositories)
│   └── scheduling/        ← NEW subfolder, this domain's addition
│       └── consumption-check.job.ts   — @Cron() class, ONE method,
│                                          calls a ports-in use case, nothing else
├── ports-in/
│   ├── registrar-mascota.use-case.ts
│   ├── configurar-consumo.use-case.ts
│   ├── marcar-dosis-tomada.use-case.ts
│   ├── calcular-dias-restantes.use-case.ts        (HTTP-reachable, pure query)
│   └── procesar-consumos-vencidos.use-case.ts      (internal-only, cron-only)
```

This requires a **declared spec delta** to `core-api-hexagonal-layout`'s "Fixed per-domain folder shape" requirement, which today enumerates `adapters/http|persistence|events` with no scheduling/jobs entry — the same class of formal correction that change already made once for `adapters/events/`'s conditional presence.

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. `@nestjs/schedule` + thin `adapters/scheduling/` job class** (recommended) | New dependency, `@Cron()` on a class that only calls into `ports-in` | Idiomatic Nest; zero test overhead (job class itself needs no test — logic is in the tested use case); extends the established driving-adapter pattern instead of inventing a new one; trivially becomes a container-level cron or external scheduler trigger at microservice-extraction time (swap the adapter, not the use case) | New dependency to justify in the proposal; needs the `adapters/scheduling/` spec delta above | Low |
| **B. External trigger via a protected HTTP endpoint** | No new npm dependency; reuses the existing HTTP adapter pattern verbatim, no spec delta needed | Needs a new authentication mechanism (machine-to-machine, not user JWT); an extra network hop and external scheduler to operate/monitor; failure mode split across two systems | Medium |
| **C. `pg_cron` calling back into `core-api` via HTTP** (docs/ARCHITECTURE.md's literal historical intent) | Matches the stale doc's original design most closely | Requires Postgres to make an outbound HTTP call, a second moving part; re-introduces "business logic partly in Postgres," contradicts `consumo/SPEC.md`'s "dentro del mismo dominio" framing | Medium-High |

**Recommendation: A.** It is the only option that keeps 100% of the business logic inside `core-api`'s hexagonal boundary, needs no new authentication surface, and is directly supported by `consumo/SPEC.md`'s own literal wording.

## Recommendation: `NotificationPort` / Expo Push adapter scope

**Finding: this is NOT `consumo`-exclusive infrastructure**, even though `consumo` is its first caller. `services/core-api/SPEC.md`'s "Infraestructura compartida" section is explicit: `NotificationPort`'s Expo Push adapter is "usado como puerto de salida desde `consumo`, `ofertas` y `pedidos-pagos`" — three unrelated domains. This is structurally identical to `AuditLogPort`'s already-resolved precedent — and `AuditModule`'s actual wiring is the concrete pattern to copy verbatim:

```ts
// shared/audit/audit.module.ts — the exact pattern to mirror
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: AUDIT_LOG_PORT, useClass: KyselyAuditLogAdapter }],
  exports: [AUDIT_LOG_PORT],
})
export class AuditModule {}
```

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. Bind the concrete adapter inside `ConsumoModule`, export the token** | `ConsumoModule.providers` binds `NOTIFICATION_PORT` → `ExpoPushNotificationAdapter`; `ofertas`/`pedidos-pagos` later import `ConsumoModule` to get it | No new shared module to create right now | Forces two unrelated business domains to import a domain module just to reach cross-cutting infrastructure — inverts the dependency direction | Low now, high cost later |
| **B. Create a real `shared/notifications/notifications.module.ts`, mirroring `AuditModule` exactly** (recommended) | New `@Global()` module: binds `NOTIFICATION_PORT` → `ExpoPushNotificationAdapter`, imported into `SharedKernelModule` alongside `AuditModule`. `consumo`'s own change delivers the adapter class and this module (per foundation's "the body ships with the consuming domain" rule) but the module lives in `shared/`, not in `domains/consumo/` | Directly mirrors the already-proven `AuditLogPort` pattern; zero coupling for `ofertas`/`pedidos-pagos` later; keeps `consumo.module.ts`'s own `exports` empty | The adapter class technically lives in `shared/`, a small departure from "the file lives where the change owns it" — mitigated by a doc comment | Low |

**Recommendation: B.**

**Scope is genuinely greenfield.** No existing push-token registration/storage exists anywhere. `NotificationPort.sendPush(recipientProfileId, mensaje)` takes a `profileId`, not a device push token — meaning something must resolve `profileId → Expo push token(s)` before calling the real Expo API. **No table for storing push tokens exists in any migration**. Genuine scope gap: either (a) this change adds a `push_token` column/table (a `db-schema-consumo`-adjacent or possibly `db-schema-identidad`-adjacent delta), or (b) the Expo adapter is built now with an explicit "no-op if no token registered" fallback and the token-registration endpoint is deferred to whichever app-side SDD change wires up the mobile apps for real. **Flag for `sdd-propose` — do not silently assume either answer.**

## Approaches: `calcularDiasRestantes`'s interaction with the cron and event fan-out (the domain's one genuinely non-trivial design question)

`consumo/SPEC.md`'s literal wording makes the **same** `ConsumoInboundPort.calcularDiasRestantes(consumptionId)` method — which is also the obvious backing for a user-facing "how many days of stock do I have left" read endpoint — responsible for firing events and (transitively) creating refill requests as a side effect.

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. `calcularDiasRestantes` stays a pure query; a separate internal cron-orchestration use case owns the threshold check + events** (recommended) | New `ports-in/procesar-consumos-vencidos.use-case.ts` (never exposed via HTTP, no `@Roles`, same shape as `catalogo`'s `OcultarCatalogoEmpresaUseCase`). Internally calls `findDueForCheck()`, reuses the same pure calculation, then does the threshold check + `publish`/`sendPush` per item | Respects CQS: a user hitting a "days remaining" screen never silently triggers a push notification or an auto-refill; independently unit-testable with mocked ports; directly mirrors the `OcultarCatalogoEmpresaUseCase` precedent | Diverges from `consumo/SPEC.md`'s literal prose — **must be a declared spec delta** | Low-Medium |
| **B. `calcularDiasRestantes` literally carries the side effects** | Zero new ports-in class; matches SPEC.md's prose verbatim | Severe CQS violation: any future HTTP route (or an admin/support tool) calling "days remaining" would silently fire events/pushes/refills as a side effect of what reads like a harmless GET; structurally invisible danger; harder to unit-test in isolation | Low now, high blast-radius risk later |

**Recommendation: A.** Not a stylistic preference — the same category of side-effect discipline this codebase already enforces elsewhere (e.g., `cargarCatalogoMasivo`'s "no `TRANSACTION_MANAGER` injected, structurally" guarantee).

**On per-row vs. summary events — the opposite conclusion from `catalogo`'s batch operations, and correctly so.** `catalogo`'s batch use cases deliberately fire exactly one summary event per invocation because their consumers only care about "did the batch complete." `consumo`'s cron is the opposite case: `refill-matching` consumes `RefillAutoSolicitado` to "crear la solicitud sin intervención del usuario" — it needs **one event per affected `UserConsumption`**, carrying that specific consumption's product/owner identity, because it must create one `RefillRequest` per pet/product that actually ran low. **One `StockBajoDetectado`/`RefillAutoSolicitado` per due `UserConsumption` that crosses the threshold is correct here**, and should be stated as the explicit rule in `sdd-spec`.

**No wrapping transaction around the cron loop**, for the same reasoning `cargarCatalogoMasivo` already established: a failure computing/publishing for one `UserConsumption` must not block the daily check for every other active row. The cron use case should catch per-item and continue, logging failures the same way `CompanyVisibilityListener` does.

## Open risk not named anywhere in the source SPEC.md — repeat-day idempotency

The cron runs **daily**. `consumo/SPEC.md` says nothing about what happens if a `UserConsumption`'s stock stays below the threshold across multiple consecutive days without the user taking action. Read literally, the cron would fire a fresh `StockBajoDetectado` (and, if `autoCrearRefill` is on, a fresh `RefillAutoSolicitado`) **every single day** the condition holds — a user could get a push notification every day indefinitely, and worse, `refill-matching` could create a **new** `RefillRequest` every day for the same unresolved low-stock item, since nothing in `consumo`'s ports-out tracks "already notified" or "already auto-requested" state.

No clean existing mechanism to reuse — this is a *temporal* repeat-trigger problem, not a duplicate-row problem (`catalogo`'s D15 unique-index idempotency doesn't apply). Genuinely open:

- **Debounce in `consumo`**: add a "last notified at" / "has open auto-refill" marker to `UserConsumption` (a `db-schema-consumo` schema delta), skip firing again until the condition clears or a cooldown passes. Cleanest ownership boundary, but a DB schema change beyond what `consumo/SPEC.md` currently declares.
- **Debounce in `refill-matching`**: its consumer checks whether an open `RefillRequest` already exists for that `consumptionId` before creating a new one. Avoids touching `consumo`'s schema, but pushes a `consumo`-specific dedup key into an unrelated domain, and does nothing about the repeated push notification.
- **Accept the repeat-fire as intended product behavior** ("gentle daily reminder until you act") and document it as such — legitimate if product genuinely wants this, but a product decision, not an implementation default.

## Other use-case notes (lower novelty, worth naming briefly)

- **`marcarDosisTomada(consumptionId, timestamp)`**: two writes (`ConsumptionLogRepository.append` + `ConsumptionRepository.save` decrementing stock) plus `publish(DosisRegistrada)`. `Promise<void>` with no partial-failure channel — recommend `TRANSACTION_MANAGER.runInTransaction` wrapping both writes, publish after commit.
- **Ownership/cross-tenant protection (mandatory, same class as `catalogo`'s R1)**: `marcarDosisTomada(consumptionId, timestamp)` and `calcularDiasRestantes(consumptionId)` take **no owner parameter at all** — must look up the `UserConsumption`, verify `item.userId === actor.profileId`, and return 404 (never 403) on mismatch. `registrarMascota(userId, ...)`'s `userId` must be forced to `actor.profileId`, never trusted from the request body. **Must be closed explicitly in `sdd-spec`.**
- **`registrarMascota`/`configurarConsumo`**: standard single-write creates, no transaction/event-fan-out novelty.

## Open Questions for `sdd-propose`/`sdd-design`

1. `docs/ARCHITECTURE.md` vs. `consumo/SPEC.md`/`core-api/SPEC.md` conflict on cron/push ownership — recommend declaring `docs/ARCHITECTURE.md`'s Edge-Function framing superseded.
2. `adapters/scheduling/` as a new enumerated subfolder in `core-api-hexagonal-layout`'s fixed-shape requirement — needs a formal spec delta.
3. `calcularDiasRestantes`'s side-effect separation from the cron's orchestration use case — Approach A recommended, needs explicit sign-off since it diverges from SPEC.md's literal prose.
4. Push-token storage — in-scope-with-a-schema-delta vs. explicitly-deferred-with-a-no-op-fallback.
5. Repeat-day idempotency for `StockBajoDetectado`/`RefillAutoSolicitado` — needs a product-level decision.
6. Exact low-stock threshold and days-remaining formula, and where the threshold is configured/stored.
7. `NotificationPort` shared-module wiring (Approach B) — needs explicit confirmation since it touches the shared kernel, wider blast radius than a typical domain-scoped change.

## Risks

- **R-con-1 — Silent-side-effect landmine (High impact if Approach B is chosen for `calcularDiasRestantes`)**: shipping the SPEC.md-literal version creates a structurally invisible danger — nothing in the type system stops a future route from wiring into the "unsafe" method.
- **R-con-2 — Undocumented repeat-notification/repeat-refill risk (Medium-High prob., Medium-High impact)**: with no debounce mechanism named anywhere, the first real daily cron run against unresolved low-stock items could spam users and flood `refill-matching` with duplicate `RefillRequest`s.
- **R-con-3 — Shared-kernel blast radius for the Expo Push adapter**: Approach B (recommended) means this change also modifies `shared/notifications/` and `SharedKernelModule` — technically outside `domains/consumo/`. Needs explicit scoping in the proposal.
- **R-con-4 — Missing Kysely row types**: `PetsTable`/`UserConsumptionTable`/`ConsumptionLogsTable` absent from `shared/database/schema.ts` — required groundwork, early task.
- **R-con-5 — Cross-tenant enumeration gap in the raw SPEC.md signatures**: must be closed in `sdd-spec` with an actor-derived ownership check + 404-on-mismatch, same treatment as `catalogo`'s R1.
- **R-con-6 — `@nestjs/schedule` is a genuinely new architectural pattern for this repo**: `sdd-tasks` needs to define testable increments (pure calculation math → threshold logic with mocked ports → the thin `@Cron()` adapter) rather than one large PR.
- **R-con-7 — Push-token storage gap**: if deferred, `sendPush` has no token to send to — needs an explicit no-op-safe fallback (log + no-throw) since most users will have no registered device until the mobile apps exist.

## Ready for Proposal

**Yes.** The placeholder scaffold requires no signature revision. `@repon/types` needs zero new promotion work. The two genuinely novel architectural questions — cron placement and the shared `NotificationPort` adapter's binding location — both have a clear recommended approach grounded in existing repo precedent. The one design decision with no existing precedent to lean on — repeat-day idempotency for the cron's event fan-out — is flagged explicitly rather than defaulted.
