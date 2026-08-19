# Explore: usuario-mobile-consumo

## Backend contract

The `consumo` domain (`services/core-api/src/domains/consumo/`) is fully implemented (from the archived `backend-core-api-consumo` change) and wired into `app.module.ts` (`services/core-api/src/app.module.ts:7,49`). Auth is global — `AuthGuard`/`RolesGuard` run as `APP_GUARD` (`services/core-api/src/app.module.ts:56-57`), so every route below needs only a valid bearer token (same `AuthGuard` `mobile-auth-login` already proved works end-to-end); there is no `@Roles()` anywhere in `ConsumoController`, by design (`services/core-api/src/domains/consumo/adapters/http/consumo.controller.ts:45-51`).

Exactly 4 HTTP routes exist — no more, no fewer (`services/core-api/src/domains/consumo/adapters/http/consumo.controller.ts`):

### `POST /consumo/mis-mascotas` (consumo.controller.ts:64-83)
- Body `NuevaMascotaDto` (`.../dto/nueva-mascota.dto.ts:19-40`): `{ nombre: string (required), especie: string (required), raza?: string, pesoKg?: number (>=0) }`. No `userId` field — global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` 400s a client-supplied `userId`.
- Response `201` `PetResponseDto` (`.../dto/pet-response.dto.ts`): `{ id, userId, nombre, especie, raza?, pesoKg? }` — mirrors `@repon/types.Pet`.
- Errors: `400` (`MASCOTA_INVALIDA`, empty nombre/especie), `401`.

### `POST /consumo/mis-consumos` (consumo.controller.ts:85-107)
- Body `NuevoConsumoDto` (`.../dto/nuevo-consumo.dto.ts:39-87`): `{ ownerType: 'self'|'pet', petId?: uuid (required iff ownerType==='pet'), kind: 'medicamento'|'alimento'|'vacuna'|'suplemento', nombre: string, dosisPorToma: number (>=0.01), unidad?: string, frecuenciaDias: number (int >=1), horarios: string[] (non-empty), stockActual: number (>=0), autoCrearRefill: boolean }`. No `userId` field.
- Response `201` `UserConsumptionResponseDto`: same shape as `@repon/types.UserConsumption` — `{ id, userId, ownerType, petId?, kind, nombre, dosisPorToma, unidad?, frecuenciaDias, horarios, stockActual, autoCrearRefill }`.
- Errors: `400` (`CONSUMO_INVALIDO` — invariant violation), `404` (`PET_NOT_FOUND` — `petId` doesn't exist or belongs to another user; **404, never 403**, deliberately, to avoid cross-tenant enumeration — `consumo.errors.ts:33-46`), `401`.
- Create-only: no update/reconfigure endpoint exists at all (confirmed in domain SPEC.md, "delta declarado, no resuelto").

### `GET /consumo/mis-consumos/:consumptionId/dias-restantes` (consumo.controller.ts:109-132)
- Path param `consumptionId` (uuid, `ParseUUIDPipe`).
- Response `200` `DiasRestantesResponseDto`: `{ diasRestantes: number }` (`Math.floor`, never rounded up — `.../dto/dias-restantes-response.dto.ts:5-8`).
- Errors: `404` (`CONSUMPTION_NOT_FOUND` — not found OR belongs to another user, byte-identical response either way, D7), `401`.
- This is the ONLY per-item read route, and it requires already knowing `consumptionId`.

### `POST /consumo/mis-consumos/:consumptionId/dosis` (consumo.controller.ts:134-159)
- Path param `consumptionId` (uuid).
- Body `MarcarDosisDto` (`.../dto/marcar-dosis.dto.ts:20-25`): `{ tomadoAt?: string (ISO-8601, optional) }`. No `cantidad` field — server always decrements the item's own configured `dosisPorToma`.
- Response: `204 No Content`.
- Errors: `400` (`DOSIS_INVALIDA` — `tomadoAt` is a future instant beyond ~1min clock skew), `404` (`CONSUMPTION_NOT_FOUND`, same D7 rule), `401`.

### Error envelope
`ConsumoExceptionFilter` (`.../consumo-exception.filter.ts:37-43,59-81`) maps 5 domain error classes to `{ statusCode, code, message }`: `CONSUMPTION_NOT_FOUND`(404), `PET_NOT_FOUND`(404), `MASCOTA_INVALIDA`(400), `CONSUMO_INVALIDO`(400), `DOSIS_INVALIDA`(400). Anything else falls through to `main.ts`'s `GlobalExceptionFilter`.

### The critical structural gap: no list/read-many capability exists anywhere
Checked at every layer — controller, use cases, AND the output ports themselves (`ports-out/pet-repository.port.ts:19-22`, `ports-out/consumption-repository.port.ts:35-109`, `ports-out/consumption-log-repository.port.ts:13-16`):
- `PetRepository` has only `save(pet)` and `findById(petId)` — **no `findByUserId`**.
- `ConsumptionRepository` has only `save(item)`, `findById(consumptionId)`, `findDueForCheck(umbralDias)` (cron-only, all-users, internal, never HTTP-reachable), plus 3 stock-mutation methods — **no `findByUserId`/`listByOwner`**.
- `ConsumptionLogRepository` has only `append(log)` and `adherenciaUltimos7Dias(consumptionId)` (requires an already-known `consumptionId`) — **no way to enumerate a user's logs or consumptions at all**.

This is not merely a missing HTTP route — the persistence-layer ports have no query method that could back one. A client can create a pet/consumption and read one known-ID's `diasRestantes`, but has **no way to discover what pets or consumptions a user already has** (no "list my pets", no "list my consumptions", no "get consumption by id with full detail", no adherence/history read endpoint). `domain/consumo.calculos.ts` (pure `consumoDiario`/`diasRestantes`/`mensajeStockBajo` functions) is also `core-api`-internal only — not exported to `@repon/types` or anywhere a frontend could import it.

## Frontend gap

All 5 relevant screens are `ScreenStub` placeholders today — confirmed by reading each file in full:
- `apps/usuario-mobile/app/(tabs)/consumos.tsx:1-12` — main tab `s-consumo`.
- `apps/usuario-mobile/app/consumo-config.tsx:1-6` — `s-consumo-config`.
- `apps/usuario-mobile/app/consumo-nuevo.tsx:1-12` — `s-consumo-nuevo`.
- `apps/usuario-mobile/app/consumo-nuevo-pet.tsx:1-12` — `s-consumo-nuevo-pet`.
- `apps/usuario-mobile/app/consumo-historial.tsx:1-6` — `s-consumo-historial`.

All 5 already have route files registered (the secondary screens exist as top-level files under `app/`, outside `(tabs)/`, matching Expo Router's "no nav, back-button only" convention) and the main tab is already wired into `app/(tabs)/_layout.tsx:67-75` with icon/title. Nothing needs to be scaffolded structurally — only the stub bodies need real content.

Per `apps/usuario-mobile/SPEC.md:12,19,25-29`, scope is: main tab `s-consumo` (today's doses, person/pet tabs) + 4 secondary screens (`s-consumo-config`, `s-consumo-nuevo`, `s-consumo-nuevo-pet`, `s-consumo-historial`).

The mockup (`apps/usuario-mobile/mockups/usuario.html`) shows the real interaction shape per screen:
- `s-consumo` (lines 339-517): owner-tabs (`switchConsumo('yo'|'pet')`) toggling between the person's and one pet's view; per-item "today card" showing name/dose/schedule, a checkmark button (`marcarDosis`) that flips pending→done and shows a 7-day streak bar; for pet items, a stock-remaining progress bar (`~12 días · 3,6 kg`); nav icons to historial (chart) and config (gear); "agregar" CTA to `s-consumo-nuevo`/`s-consumo-nuevo-pet`.
- `s-consumo-config` (522-592): owner-tabs again; lists "activos" items with a stock progress bar and "editar" button (routes back to `s-consumo-nuevo(-pet)` — the mockup has no distinct edit-vs-create flow, and per the backend's `configurarConsumo` being create-only, there genuinely is no update capability yet).
- `s-consumo-nuevo` (597-680): flat form for a **self**-owned item — free-text nombre, presentación `<select>`, dosis/stock two-column, frecuencia `<select>` (daily/2x-day/specific days, `showFreqDays()` toggles a day-picker), horario time+context `<select>`, and 3 toggle rows (notify-before, low-stock-alert, auto-crear-refill).
- `s-consumo-nuevo-pet` (685-767): a 4-way type picker (`selectPetType('ali'|'med'|'vac'|'spl')`) that swaps entirely different field sets per `kind` — alimento (producto/porción-g/veces-al-día/2 horarios/stock-kg), medicamento (nombre/presentación/dosis/frecuencia/duración/horario), vacuna (producto/periodicidad/última-aplicación) — note: `suplemento` has a type-card but **no distinct field block** in the mockup (`petfields-spl` doesn't exist — likely reuses `petfields-med`'s shape, an open question).
- `s-consumo-historial` (772-838+): owner-tabs; month adherence % + streak-days ring, a 7-day heatmap grid, per-item adherence bars ("por medicamento").

`marcarDosis(btn, cardId, badgeId, doneLabel)` (mockup JS, line 1643) is pure client-side DOM simulation today — this is exactly what `POST .../dosis` replaces per SPEC.md's own "Pendiente al migrar" note (line 55).

**No frontend file currently imports `authFetch`/`useSession` outside `login.tsx`/`_layout.tsx`** (grep confirmed) — this consumo screen would be the first real (non-auth) consumer.

## Reusable pieces

Directly reusable, as-is, no changes needed:
- `useSession()` from `@repon/auth` (`packages/auth/src/session-context.tsx:104-110`) exposes `authFetch` on the context value directly (`session-context.tsx:96`) — a screen just calls `const { authFetch } = useSession()`.
- `authFetch(path, init?)` (`packages/auth/src/api-client.ts:53-97`) — signature: `path` joined onto `config.apiBaseUrl` (never build the full URL yourself), returns a raw `Promise<Response>`. Behavior a caller must know: proactively refreshes the token if <60s from expiry; on a `401` it does exactly one silent refresh-and-retry, then returns whatever the retry produced (a second 401 triggers `signOut()`); a `403` is passed through untouched (not treated as an auth failure). **The caller is responsible for**: setting `Content-Type: application/json` and JSON-stringifying the body for POST requests (the helper does not do this), checking `response.ok`/`status`, calling `.json()`, and mapping the `{statusCode, code, message}` error envelope to UI text (no existing precedent for this outside `login.tsx`'s different, unauthenticated `SesionApiError` path).
- `RequireSession` already guards the entire `(tabs)` tree (`app/(tabs)/_layout.tsx:32`), so any screen under it can assume an authenticated session exists — no need to re-check.
- `@repon/types` already exports `Pet`, `UserConsumption`, `ConsumptionLog`, `OwnerType`, `ConsumptionKind` (`packages/types/src/consumo.ts`, re-exported via `packages/types/src/index.ts:10`) — these match the backend response shapes field-for-field (confirmed against `consumo.mapper.ts`). **Do not redefine these types in the app** — import from `@repon/types`. Note: `UserConsumption.horarios` is typed as a non-empty tuple `[string, ...string[]]`, not a plain `string[]`. The `DiasRestantesResponseDto`'s `{ diasRestantes: number }` shape and the domain's pure calc functions (`consumoDiario`/`diasRestantes` formulas) are NOT exported to `@repon/types` — a frontend needing "days remaining" for an item must call the HTTP endpoint per item, it cannot compute it locally from `UserConsumption` alone without re-deriving the formula (which would duplicate `services/core-api/src/domains/consumo/domain/consumo.calculos.ts`).

Genuinely new for this change:
- Any list/read-many capability (see "critical structural gap" above) — does not exist on the backend today at all, at any layer.
- All screen UI/state/forms — nothing built yet beyond stub shells.
- Any JSON-body-building/error-mapping convention for `authFetch` POST calls — `login.tsx` doesn't set this precedent (it goes through `session-client.ts`'s `iniciarSesion`, not `authFetch`, and is unauthenticated).

## Open questions for the proposal phase

1. **Blocking**: the backend has no way to list a user's pets or consumptions, or read consumption/log detail beyond one already-known `consumptionId`'s `diasRestantes`. The `s-consumo` tab, `s-consumo-config`, and `s-consumo-historial` mockup screens all fundamentally require "show me everything I've configured" — impossible to build against the 4 existing routes alone. The proposal must decide: (a) this change's scope includes adding backend list/read endpoints (likely `GET /consumo/mis-mascotas`, `GET /consumo/mis-consumos`, and something for history/adherence), which is a real backend PR against an already-archived domain, not just a frontend task, or (b) scope narrows to only what's buildable today (e.g., only the create-and-mark-dose flows, deferring the read-heavy screens), or (c) local-only client state is accepted as a stopgap (loses cross-device/cross-session truth, likely undesirable for health data).
2. Is Zustand/TanStack Query actually needed for this one feature, or is local `useState`/plain `authFetch` calls (the `mobile-auth-login` precedent) sufficient? Neither package is installed in `apps/usuario-mobile/package.json` today. `docs/ARCHITECTURE.md:58-59` and `SPEC.md:41-43` both prescribe them, but SPEC.md's own state-management line ("Catálogo, ofertas, historial — TanStack Query contra Supabase") is stale relative to the now-established core-api-only access pattern (`docs/ARCHITECTURE.md:21`, D11 correction) and predates any real screen ever being built — worth confirming this convention still holds before adding two new dependencies for one screen.
3. Scope boundary: just the main `s-consumo` tab, or also the 4 secondary screens in the same change? Given open question 1's backend gap, the secondary screens (`config`, `historial`) are more exposed to the missing-list-endpoint problem than `s-consumo-nuevo(-pet)` (pure create forms, no read dependency beyond the pet picker, which itself needs a pet list too).
4. Pet-vs-self `owner_type` UI: the mockup models this as two full parallel screen states behind one tab toggle (`switchConsumo`/`switchConsumoConfig`/`switchConsumoHist`), with the "pet" side needing to know which pets exist (another consumer of the missing pet-list endpoint) — is a single generic "owner" concept viable, or does each screen need bespoke self/pet branching per the mockup's structure?
5. `s-consumo-nuevo-pet`'s `suplemento` type card has no distinct field block in the mockup (only `ali`/`med`/`vac` have `petfields-*` divs) — needs a product decision on which field set `suplemento` reuses.
6. `configurarConsumo` is create-only server-side (no reconfigure/update endpoint) — the mockup's "editar" buttons all route back into the same "nuevo" create form. Confirm whether v1 of this frontend change accepts create-only (no real edit) or whether an update endpoint also needs to be added to backend scope.

## Key Learnings

1. The `consumo` backend domain exposes exactly 4 HTTP routes and none of them list or enumerate a user's pets or consumptions.
2. The missing list capability is structural, not just a missing controller route — `PetRepository` and `ConsumptionRepository` output ports have no `findByUserId` method at any layer.
3. All 5 target screens already have registered Expo Router route files; only their stub bodies need replacing, no routing scaffolding is needed.
4. `useSession().authFetch` from `@repon/auth` is unused by any screen besides login today, making this the first real non-auth consumer.
5. Neither Zustand nor TanStack Query is installed in `apps/usuario-mobile/package.json` despite being prescribed in `docs/ARCHITECTURE.md` and `SPEC.md`.
