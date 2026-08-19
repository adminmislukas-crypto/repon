# Proposal: usuario-mobile-consumo — consumption tracking screens + the `core-api` read surface they require

## Intent

Consumption tracking is `usuario-mobile`'s core recurring feature — the one a user opens daily — and all 5 of its screens are `ScreenStub` placeholders today (`explore.md`, "Frontend gap"). The backend `consumo` domain is fully implemented and reachable, but exposes **only 4 write/point-read routes and zero list capability at any layer**: `PetRepository` has `save`/`findById` only, `ConsumptionRepository` has no `findByUserId`, `ConsumptionLogRepository` can only `append` and compute `adherenciaUltimos7Dias(consumptionId)` (`ports-out/*.port.ts`). A user can create a pet and a consumption and then **has no way to see what they created** — the same shape of dead end `mobile-auth-login` just fixed for login.

Success: a signed-in user opens the Consumos tab, sees today's doses for themselves and each pet with real stock/days-remaining, marks a dose and sees it persist across restart and devices, adds new items for self or pet, and reviews real adherence history.

## Decisions already made (do not re-open)

| # | Decision | Consequence |
|---|---|---|
| **D1** | **Backend work is in scope.** This change adds list/read-many capability to the already-archived `consumo` domain: new use cases, new output-port methods, new routes. | Not a frontend-only change. Screens `s-consumo`, `s-consumo-config` and `s-consumo-historial` are unbuildable against the 4 existing routes (`explore.md` Q1). Exact route/DTO shapes belong to `sdd-design`. |
| **D2** | **State management reuses the `mobile-auth-login` precedent**: `useSession().authFetch` + local `useState`/React state, RN `StyleSheet`. **No Zustand, no TanStack Query, no NativeWind.** | `usuario-mobile/SPEC.md:41-43` ("Zustand", "TanStack Query contra Supabase") and `docs/ARCHITECTURE.md`/`config.yaml` context predate any real screen and are stale against the core-api-only access pattern. Verified: none of the three is installed (`apps/usuario-mobile/package.json`), and every existing screen uses `StyleSheet`. Corrected as a **declared delta**, not silently ignored. |
| **D3** | **All 5 screens ship**: `s-consumo` (tab) + `s-consumo-config`, `s-consumo-nuevo`, `s-consumo-nuevo-pet`, `s-consumo-historial`. | All 5 route files already exist and the tab is already wired (`app/(tabs)/_layout.tsx:67-75`) — only stub bodies get replaced, no routing scaffolding. |
| **D4** | **v1 is create-only. No update/reconfigure endpoint.** The mockup's "editar" button MUST NOT route into the create form. | `configurarConsumo` is create-only by design and `limpiarMarcaStockBajo`'s own docblock records that no reconfigure path exists (`consumption-repository.port.ts:88-95`). Letting "editar" silently POST a second item is a **health-data correctness hazard** (duplicate active item → double stock decrement, corrupted adherence). Reconfigure needs its own decisions (stock carry-over, debounce marker reset, log continuity) and is a named follow-up change. `s-consumo-config` ships as a read-only actives list (stock bar + days remaining); hidden-vs-disabled-with-copy is a `sdd-design` call. |
| **D5** | **`suplemento` reuses the `medicamento` field block.** | `NuevoConsumoDto` is one flat shape for every `kind` — per-type field swapping is presentation only. `medicamento`'s block (nombre/presentación/dosis/frecuencia/horario/stock) is the only one mapping 1:1 onto the DTO's required fields. Not a design deferral. |
| **D6** | **Adherence math stays server-side, 7-day window** (user-confirmed). The history read returns server-computed values; no client re-derives adherence or streak. | `adherenciaUltimos7Dias` alone is **not sufficient as a per-item scalar** — the new read must return a per-day/per-item breakdown across the same 7-day window, not just a single aggregate number. Client-side derivation would duplicate `domain/consumo.calculos.ts` outside the domain (`explore.md` line 73). No month-% ring, no 30-day aggregate (out of scope). Exact response shape/widget set → `sdd-design`. |
| **D7** | **`GET /consumo/mis-consumos` carries a server-computed `diasRestantes` per item.** | Otherwise the tab issues one `GET .../dias-restantes` per item (N+1 on every open) or duplicates the formula client-side. Both are rejected by D6. |

## Scope

### In Scope

1. **Backend read surface** on `ConsumoController` — approximately `GET /consumo/mis-mascotas`, `GET /consumo/mis-consumos` (D7), and one bounded-window adherence/history read (D6). Exact paths, DTOs and window → `sdd-design`.
2. **Output-port methods**: `PetRepository.findByUserId`, `ConsumptionRepository.findByUserId`, plus a bounded-window read on `ConsumptionLogRepository` — with Supabase adapters and use cases in domain Spanish (`listarMascotas`, `listarConsumos`, …).
3. **All 5 screens** (D3), including real `marcarDosis` against `POST .../dosis`, replacing the mockup's DOM simulation.
4. **A JSON-POST / error-envelope convention for `authFetch`** — this is the first non-auth consumer; `login.tsx` sets no precedent (it goes through `session-client.ts`).
5. **Declared deltas**: `apps/usuario-mobile/SPEC.md` (D2 state management, D4 no-edit, the "Pendiente al migrar" lines that still say "mutaciones reales contra Supabase"), `openspec/specs/core-api-consumo` (collection reads).
6. **Tests** — Jest + `jest-expo` + RNTL are already installed; no scaffolding needed.

### Out of Scope

- **Update/reconfigure/delete of a consumption or pet** (D4).
- **Zustand, TanStack Query, NativeWind** (D2).
- **`proveedor-mobile`, catálogo, refill, ofertas** — separate future changes. `autoCrearRefill` is stored as a flag only; this change does not build the refill path it triggers.
- **Any schema migration.** `pets_user_id_idx` and `user_consumption_user_id_idx` already exist (`supabase/migrations/20260803120200_02_consumo.sql:76-77`), and both tables already carry `user_id NOT NULL`. `db-schema-consumo` is untouched.
- **Any change to `AuthGuard`, `@repon/auth`, or the 4 existing consumo routes' behaviour.**
- **Push notifications / stock-bajo cron surfacing in the UI.**

## Capabilities

### New Capabilities

- `usuario-mobile-consumo`: the app's consumption tracking surface — today's-doses tab with self/pet owner switching, dose marking and its optimistic/persisted behaviour, create flows for self and pet items, read-only config list, adherence history, and the `authFetch` request/error-mapping convention.

### Modified Capabilities

- `core-api-consumo`: gains collection-read requirements — list the caller's pets, list the caller's consumptions with server-computed `diasRestantes`, and a server-computed adherence/history read. The existing D7 cross-tenant rule extends to collections: a collection read MUST return only the actor's own rows and an empty collection MUST be `200 []`, never `404`.
- `shared-types-package`: `@repon/types` gains the enriched consumption-list view type (`UserConsumption` + `diasRestantes`) and the adherence/history response type, so app and API share one definition.

## Approach

Backend first, then screens. Each new use case derives `userId` exclusively from the actor (the rule `core-api-consumo` already states for `registrarMascota`/`configurarConsumo`), queries the matching `findByUserId` port method, and — for the list endpoint — runs the existing pure `consumo.calculos.ts` functions server-side to attach `diasRestantes` (D7). The history read computes adherence in the domain and returns finished values (D6). No new infrastructure, no new dependency, no migration.

On the client each screen is a plain component: `const { authFetch } = useSession()`, fetch in an effect, hold results in `useState`, render loading/empty/error states, mutate via POST and refetch. `RequireSession` already guards the whole `(tabs)` tree, so screens assume a session. `Pet`, `UserConsumption`, `OwnerType`, `ConsumptionKind` are imported from `@repon/types`, never redefined (note `horarios` is `[string, ...string[]]`).

Delivery is a chain, not one PR.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `services/core-api/src/domains/consumo/ports-out/*.port.ts` | Modified | `findByUserId` ×2 + bounded-window log read |
| `services/core-api/src/domains/consumo/ports-in/`, `adapters/persistence/` | New/Modified | List/history use cases + Supabase queries |
| `services/core-api/src/domains/consumo/adapters/http/` | New/Modified | Routes, response DTOs, mapper |
| `packages/types/src/consumo.ts` | Modified | Enriched list + adherence view types |
| `apps/usuario-mobile/app/(tabs)/consumos.tsx`, `consumo-{config,nuevo,nuevo-pet,historial}.tsx` | Modified | Stub bodies replaced |
| `apps/usuario-mobile/components/`, `lib/` | New | Shared consumo UI + `authFetch` JSON/error helper |
| `apps/usuario-mobile/SPEC.md`, `openspec/specs/core-api-consumo/spec.md` | Modified | Declared deltas |
| `supabase/`, `AuthGuard`, `@repon/auth`, existing 4 routes | None | Untouched |

## Risks

| Risk | Likelihood / Impact | Mitigation |
|---|---|---|
| **R1 — The mockup's per-kind pet forms do not map onto `NuevoConsumoDto`.** `vacuna` (producto/periodicidad/última-aplicación) supplies none of the required `dosisPorToma` (≥0.01), `horarios` (non-empty) or `stockActual`; `alimento` collects porción in **grams** but stock in **kg**. Building the forms as drawn produces 400s or silently wrong stock math. | High / **High** | An explicit per-`kind` field→DTO mapping table (including units and defaults) is a spec deliverable of this change, owned by `sdd-design`. Q1. |
| **R2 — `s-consumo-config` ships visibly incomplete** (D4): a list with no working edit. | High / Medium | Stated as a product decision with an honest UI treatment, not a silent stub. Reconfigure is a named follow-up. |
| **R3 — 400-line budget.** 3 endpoints + ports + adapters + 5 screens + tests exceeds it comfortably. | High / Medium | Declared here; `sdd-tasks` owns the chain (`delivery_strategy: ask-on-risk`). Natural slices: ports+list endpoints → history endpoint → tab+dose marking → create forms → config+historial screens. |
| **R4 — First non-auth `authFetch` consumer.** No convention exists for JSON bodies, `response.ok` checks, or mapping `{statusCode, code, message}` to Spanish UI text. Improvised per-screen handling would diverge immediately. | High / Medium | Item 4 of scope: one shared helper, established in the first client PR before any screen. |
| **R5 — Cross-tenant leakage via new collection reads.** The existing surface protects point reads with the 404 rule; collections are a new exposure. | Medium / **High** | Spec requirement: actor-derived `userId` in the query itself, never a client-supplied filter; empty collection is `200 []`; a test per endpoint. |
| **R6 — Declared deltas against pre-existing SPEC.md contracts** (D2), which SDD does not own. | Medium / Medium | Per `rules.specs`, flagged explicitly and scoped to the state-management and migration lines only. |
| **R7 — Optimistic dose marking vs. `204 No Content`.** `POST .../dosis` returns no body, so the client cannot read back the new stock without a refetch. | Medium / Medium | `sdd-design` decides refetch-after-mark vs. optimistic local decrement. Health data: prefer server truth. Q3. |

## Rollback Plan

Greenfield, no production data, no migration, no destructive writes. `git revert` of the chain returns the 5 screens to `ScreenStub` and `consumo` to its 4-route surface. Three items that do not revert cleanly:

1. **`@repon/types` additions** — removing an exported type after both `core-api` and the app import it is a coordinated multi-package revert; cheap while the chain is open.
2. **The SPEC.md deltas (D2)** — reverting them re-establishes statements we have evidence are wrong (Zustand/TanStack Query/Supabase-direct). Prefer keeping the corrections even if code is reverted.
3. **Rows users created** — reverting the read endpoints leaves real `pets`/`user_consumption` rows invisible again, not deleted. Acceptable pre-launch; not after.

## Dependencies

- `backend-core-api-consumo` (archived) — the 4 routes, exception filter, `consumo.calculos.ts`. **Present and verified.**
- `mobile-auth-login` (archived) — `@repon/auth`, `RequireSession`, `authFetch`, Metro workspace resolution. **Present and verified.**
- `pets.user_id` / `user_consumption.user_id` + their indexes. **Present** — no migration.
- No new runtime dependency in either the API or the app.

## Open Questions (for `sdd-design` / `sdd-spec`)

| # | Question | Owner |
|---|---|---|
| Q1 | ~~Per-`kind` field→DTO mapping table (R1)~~ — **RESOLVED**: the form collects real values for every `kind`, including `vacuna` (`horarios` + `stockActual`); no synthesized defaults. Exact unit conversions (`alimento`'s gram-porción vs kg-stock) still need a mapping table. | `sdd-design` |
| Q2 | **Exact read-surface contracts**: route paths, whether pets and consumptions come back in one composite call or two. History window is **RESOLVED: 7 days** (matches `adherenciaUltimos7Dias`, no month/30-day aggregate). | `sdd-design` |
| Q3 | **Dose-marking feedback** (R7): refetch after `204`, optimistic local decrement, or change the endpoint to return the new stock. | `sdd-design` |
| Q4 | **Empty and first-run states**: what `s-consumo` shows a user with zero pets and zero consumptions, and whether `s-consumo-nuevo-pet` is reachable before any pet exists. | `sdd-spec` + product |
| Q5 | **Owner tabs**: one generic owner concept, or per-screen self/pet branching as the mockup draws it — and what happens with many pets (the mockup assumes one). | `sdd-design` |
| Q6 | ~~Offline / failed-request behaviour~~ — **RESOLVED**: fails visibly with manual retry. No background queue, no silent optimistic success. | — |

## Proposal question round — resolved

D1–D7 are all now user-confirmed (D1–D3 before this phase ran, D4–D7 after, via the questions below). None are open.

1. **D4** — confirmed: v1 ships `s-consumo-config` read-only, no reconfigure endpoint. Reconfigure is a named follow-up change (stock carry-over, debounce-marker reset, log continuity are its own decisions).
2. **D6/Q2** — confirmed: **7-day history window**, matching the existing `adherenciaUltimos7Dias`. No month-% ring, no 30-day aggregate endpoint. Smaller backend surface than the mockup implies; `s-consumo-historial`'s design must fit a 7-day view.
3. **Q1/R1** — confirmed: the `vacuna` create form collects a real schedule (`horarios`) and `stockActual` like every other `kind`, diverging from the mockup's producto/periodicidad/última-aplicación-only fields. No synthesized/default values sent for health data.
4. **Q6** — confirmed: offline dose-marking fails visibly with manual retry. No background queue, no optimistic silent success.

## Success Criteria

- [ ] A signed-in user with existing pets/consumptions opens Consumos and sees them — data survives app restart and appears on a second device
- [ ] Every list endpoint returns only the caller's rows; a user with none gets `200 []`, never `404`; a cross-tenant probe leaks nothing — one test per endpoint
- [ ] `s-consumo` renders each item's days-remaining **without** a per-item request and **without** re-deriving the formula client-side (D6/D7)
- [ ] Marking a dose calls `POST .../dosis`, persists, and the stock/streak the UI shows afterwards matches the server
- [ ] Both create forms produce payloads `NuevoConsumoDto` accepts for all four `kind` values, including `vacuna` and `suplemento` (D5, Q1)
- [ ] `s-consumo-config` never creates a duplicate item from an "editar" interaction (D4)
- [ ] `s-consumo-historial` shows server-computed adherence — no adherence math in the app
- [ ] Loading, empty and error states exist on every screen; backend error codes map to distinct Spanish messages
- [ ] No Zustand / TanStack Query / NativeWind dependency added (D2); no migration added
- [ ] `usuario-mobile/SPEC.md` deltas declared (D2, D4)
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; the existing `consumo` suite passes unmodified
