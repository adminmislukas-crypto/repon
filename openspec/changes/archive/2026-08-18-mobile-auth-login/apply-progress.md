# Apply Progress: mobile-auth-login

## PR1 (Phase 1) — `packages/auth` wiring probe + test-runner scaffolding — DONE

Applied directly by the orchestrator (not a sub-agent) after the `sdd-apply` sub-agent launch failed early — Claude Code account hit its monthly spend limit mid-exploration, before any code was written. All work below was implemented and verified inline, in strict TDD mode (`pnpm test` as the runner, per `sdd-init/repon`'s confirmed `strict_tdd: true`).

### What was built (tasks 1.1–1.8, all complete)

- `packages/auth/package.json` + `tsconfig.json` — new workspace package `@repon/auth`, source-only (mirrors `@repon/types`'s `main`+`types`+`exports` all pointing at `./src/index.ts`), `jsx: react-jsx`. Declares `react`/`react-native` as both `peerDependencies` and `devDependencies` (pinned to the same versions both apps use) since `@repon/types` had no precedent for a package with real JSX/runtime code.
- `packages/auth/src/wiring-probe.tsx` — `AuthWiringProbe`, a trivial `<Text testID="auth-wiring-probe">` component.
- `packages/auth/src/index.ts` — `REPON_AUTH_PACKAGE_ID`, `reponAuthReady()`, re-exports `AuthWiringProbe`.
- Both apps' `package.json`: added `"@repon/auth": "workspace:*"`, a `"test": "jest"` script, and devDependencies `jest-expo`, `jest`, `@testing-library/react-native`, `babel-preset-expo`, `react-test-renderer`, `@types/jest`.
- Both apps: new `babel.config.js` (`babel-preset-expo`, neither app had one before) and `jest.config.js` (`preset: 'jest-expo'`).
- `apps/usuario-mobile/app/(tabs)/perfil.tsx` — renders `<AuthWiringProbe />` + `REPON_AUTH_PACKAGE_ID` alongside the existing `ScreenStub`.
- `apps/proveedor-mobile/app/(tabs)/index.tsx` — same, on the Dashboard screen (see deviation below — this app has no `perfil.tsx`).
- One RNTL test per app under `app/(tabs)/__tests__/`, asserting the probe renders and its testID/text are present.

### Deviations from `tasks.md`/`design.md`, and why

1. **`proveedor-mobile` probe landed on `index.tsx` (Dashboard), not `perfil.tsx`.** Verified: `proveedor-mobile/app/(tabs)/` only has `_layout.tsx`, `catalogo.tsx`, `index.tsx`, `pedidos.tsx`, `solicitudes.tsx` — no `perfil` tab exists in this app (matches its `SPEC.md`, which lists Dashboard/Solicitudes/Catálogo/Pedidos, no profile tab). `tasks.md`/`design.md` assumed a `perfil.tsx` in both apps; that assumption was wrong for `proveedor-mobile`. This is cosmetic — any screen works for a throwaway wiring probe that later PRs will replace with real content — but flagged since it's a deviation from the written plan.
2. **`packages/auth/src/index.ts`'s re-export dropped the `.js` extension** design.md's D-7 snippet wrote `export { AuthWiringProbe } from './wiring-probe.js';`. Under this repo's `moduleResolution: "Bundler"` (not `"NodeNext"`), Metro resolved the `.js`-suffixed specifier fine, but Jest's resolver (via `jest-expo`'s babel-based transform, not Metro) could not — `Cannot find module './wiring-probe.js'`. Since `"Bundler"` resolution doesn't require the NodeNext extension convention here, dropping the extension (`from './wiring-probe'`) fixed Jest without affecting Metro. Confirmed both still resolve correctly after the change.
3. **`jest` had to be pinned to `^29.7.0`, not the latest `30.x`.** `pnpm add -D jest-expo` initially pulled in `jest@^30.4.2` (npm's default "latest") alongside `jest-expo@57.0.4`, which itself depends on `jest`-family packages pinned at `^29.2.1` (`@jest/globals`, `jest-environment-jsdom`, `jest-snapshot`, `babel-jest`). Running `jest` under this mismatch failed immediately with `TypeError: this._moduleMocker.clearMocksOnScope is not a function` — a real jest 29-vs-30 internal API incompatibility, not a config error. Downgrading the app-level `jest` dependency to `^29.7.0` (matching jest-expo's own expected major) fixed it. **Lesson for later PRs**: don't blindly `pnpm add` the newest `jest`; the version must track whatever `jest-expo` for this Expo SDK (57) actually expects.
4. **`render()` from `@testing-library/react-native@14.0.1` is `async`.** The initial tests called `render(<Screen />)` synchronously and then used the global `screen` query export; this failed with `` `render` function has not been called `` because `render()` hadn't resolved yet. Fixed by `await render(...)` (test itself made `async`) and destructuring the returned `RenderResult` (`getByTestId`/`getByText`) directly, rather than relying on the mutable global `screen` binding. This is a real v13+ API change in `@testing-library/react-native` (aligned with React 19's `act()` semantics), not a fluke — later PRs' component tests (PR9/PR10/PR8b) must all `await render(...)`.
5. **Neither app's `tsconfig.json` auto-included `@types/jest` despite it being installed.** `pnpm add -D @types/jest` hoisted the package to the workspace-root `node_modules/@types/jest` only (no per-app `node_modules/@types/` exists under `nodeLinker: hoisted`). TypeScript's automatic `@types` inclusion should walk up to the root and find it, but did not in practice here. Fixed by explicitly adding `"types": ["jest"]` to both apps' `compilerOptions` — mirroring the exact convention `services/core-api/tsconfig.json` already uses for its own `"types": ["node", "jest", "multer"]` (with a code comment there explaining the same class of problem for `multer`). This is the established repo pattern, not a new one.

None of these deviations touch `design.md`'s architecture decisions (D-1 through D-7) — they're implementation-level fixes discovered only by actually running the commands, exactly the kind of thing `design.md`'s own "escalate, don't improvise" instruction anticipated for the *Metro* fallback ladder specifically. Metro itself needed zero fallback steps; all four issues above were Jest/TypeScript tooling, not Metro/pnpm resolution.

### PR1 acceptance gates — all 4 passed, verified directly (real command output)

1. **`pnpm typecheck`** (workspace-wide): `packages/auth typecheck: Done`, `packages/types typecheck: Done`, `apps/usuario-mobile typecheck: Done`, `apps/proveedor-mobile typecheck: Done`, `services/core-api typecheck: Done` — zero errors, core-api unaffected.
2. **`pnpm --filter usuario-mobile exec expo export --platform web`**: bundled clean (1222 modules, `_expo/static/js/web/entry-0afd67b8e9b4b028b96c8ad7270b70d4.js`, 2.4MB); `grep -o "@repon/auth wiring OK" <bundle>.js` → **found**.
3. Same for **`proveedor-mobile`**: bundled clean (1218 modules); probe string **found** in the exported bundle.
4. **`pnpm --filter usuario-mobile test && pnpm --filter proveedor-mobile test`**: both `PASS`, 1/1 test suite, 1/1 test each.

Also ran **`pnpm lint`** (not one of the 4 named gates, but part of this project's standard verify step): clean, zero findings.

### Known pre-existing issue (NOT touched, NOT caused by this PR)

`pnpm test` at the workspace root fans out to all packages including `services/core-api`, which has **2 pre-existing failing e2e specs** unrelated to this change (`refill-crear-solicitud.e2e-spec.ts`, `refill-completar-borrador.e2e-spec.ts`, failing with `500` where `2xx/4xx` was expected) — this was already documented as a known gap in the `sdd-init/repon` Engram record from 2026-08-15, before this change existed. Not touched here.

### Not yet done

Everything in Phase 2 onward (rate limiter, GoTrue client, `AuthProvider`, session use cases, HTTP routes, e2e spec, `@repon/auth`'s real session logic, both apps' login screens, doc deltas) — per `design.md`'s hard ordering, PR1 was deliberately probe-only.

## PR2a (Phase 2) — Rate-limit store, decorator, error class — DONE

Applied directly by the orchestrator inline, same as PR1. Strict TDD followed literally this time: wrote the spec file first, ran it and confirmed RED (`Cannot find module './in-memory-rate-limit.store'`), then implemented.

### What was built (tasks 2.1–2.6, all complete)

- `services/core-api/src/shared/rate-limit/rate-limit-store.port.ts` — `RATE_LIMIT_STORE` DI token, `RateLimitWindow`, `RateLimitPeekResult`, `RateLimitStore` port (`peek`/`record`/`reset`), matching `design.md` D-3's exact shape.
- `services/core-api/src/shared/rate-limit/in-memory-rate-limit.store.ts` — `InMemoryRateLimitStore implements RateLimitStore`. `Map<string, number[]>` of failure timestamps, pruned on every `peek`/`record` (drops entries older than `now - windowMs`, deletes the key entirely once empty), `record` trims to the newest `limit` timestamps, a bounded `sweep()` runs only once the map crosses a 10,000-key size cap — no `setInterval` anywhere. Added one test-only `size()` accessor (not part of the `RateLimitStore` port) purely to make eviction verifiable from a spec.
- `services/core-api/src/shared/rate-limit/in-memory-rate-limit.store.spec.ts` — 9 tests, all from tasks.md 2.3's list: count-within-window, no fixed-bucket rollover at a boundary, ageing-out, `retryAfterMs` computed from the limit-th most recent failure, `retryAfterMs=0` under the limit, the `limit`-entry cap, `reset` key isolation, and eviction of an expired/never-seen key from the underlying map.
- `services/core-api/src/shared/rate-limit/rate-limit.decorator.ts` — `RateLimitKeySpec`, `RateLimitOptions`, `@RateLimit(...)` (`SetMetadata`-based, same pattern as the existing `@Public()` decorator — confirmed by reading it first).
- `services/core-api/src/shared/rate-limit/demasiados-intentos.error.ts` — `DemasiadosIntentosError extends HttpException`, `{ statusCode: 429, code: 'DEMASIADOS_INTENTOS', message }`. Confirmed against the real `GlobalExceptionFilter`/`AuthError` source before writing it: `GlobalExceptionFilter.isErrorBody` passes any `HttpException` payload shaped `{ statusCode, code, message }` through verbatim, and `AuthErrorCode` is a closed union scoped to `AuthGuard`/`RolesGuard` rejections — so this is deliberately its own class, not a widened `AuthError`, exactly as `design.md`'s D-3 correction specified.

No deviations from `design.md`/`tasks.md` this time — the port/store/decorator/error shapes were specified precisely enough to implement directly.

### PR2a acceptance gate (task 2.6) — all passed, verified directly

1. `pnpm --filter core-api exec jest shared/rate-limit/in-memory-rate-limit` → **9/9 passed**.
2. `pnpm lint` scoped to `services/core-api/src/shared/rate-limit/` → clean, zero findings.
3. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

`shared/rate-limit/rate-limit.interceptor.ts` + `rate-limit.module.ts` (PR2b/Phase 3) — the store/decorator/error built here are not wired into any route yet; nothing rate-limited in production until PR2b lands.

## PR2b (Phase 3) — Rate-limit interceptor + module — DONE

Applied directly by the orchestrator inline. Strict TDD followed literally: wrote the interceptor spec first (11 cases), confirmed RED (`Cannot find module './rate-limit.interceptor'`), then implemented.

### What was built (tasks 3.1–3.4, all complete)

- `services/core-api/src/shared/rate-limit/rate-limit.interceptor.ts` — `RateLimitInterceptor implements NestInterceptor`. PRE phase: `from(this.precheck(keys)).pipe(switchMap(...))` — awaits `store.peek()` for every derived key, picks the worst (highest `retryAfterMs`) blocking key if any is at/over its limit, sets the `Retry-After` header (`Math.ceil(retryAfterMs / 1000)`), and throws `DemasiadosIntentosError` *before* `next.handle()` is ever called. POST phase: `next.handle().pipe(tap({ next, error }))` — on success, fire-and-forget `store.reset()` for each dimension listed in `resetOnSuccess`; on error, fire-and-forget `store.record()` for every key iff `options.countsAsFailure(error)` is true. Both POST-phase writes are deliberately `.catch()`'d and not awaited, so a store outage can never block or corrupt the actual response — matches `design.md` D-3's "POST-phase writes are not awaited before the response is written."
- Key derivation (`deriveKeys`/`deriveValue`): IP dimension reads `request.ip` directly; email dimension reads `request.body.email`, and — matching this codebase's established convention of avoiding `@types/express` in favor of minimal structural request/response interfaces (confirmed by reading `AuthenticatedRequest` in `shared/auth/authenticated-request.ts` first) — uses a local `RateLimitAwareRequest`/`RateLimitAwareResponse` structural type instead of importing `Request`/`Response` from `'express'`. A missing or non-string email is skipped (returns `null`, not thrown), so only the IP key applies — key derivation never throws, per task 3.2's requirement.
- `services/core-api/src/shared/rate-limit/rate-limit.interceptor.spec.ts` — 11 tests: pass-through with no `@RateLimit` metadata; 429 + handler never invoked when a key is at its limit; `Retry-After` header set correctly; a 429 records nothing; records only on a `countsAsFailure`-qualifying error (tested via two small local error classes and a predicate, not the real domain errors — `CredencialesInvalidasError` etc. don't exist yet, they land in PR5); success resets only the email key, IP key left untouched; a `peek()` rejection fails open (handler still runs, no false 429); the original thrown error propagates completely unchanged even when the POST-phase `record()` call also rejects; missing email and non-string email both derive only the IP key without throwing (2 separate tests).
- `services/core-api/src/shared/rate-limit/rate-limit.module.ts` — binds `RATE_LIMIT_STORE` → `InMemoryRateLimitStore`, exports `RateLimitInterceptor`.

### One implementation snag hit and fixed

The first draft of the interceptor spec typed its `createHandler` test helper as `ReturnType<typeof of> | ReturnType<typeof throwError>`, which TS resolved to `Observable<never>` for the `throwError` branch (the general overload's return type, not the call-site's actual type) — this made every `of('ok')`-returning call a type error against `Observable<never>`. Fixed by typing the helper directly as `Observable<unknown>`. A related, separate error: destructuring `store.peek.mock.calls[0] as [string]` didn't typecheck because `peek(key, window)` takes 2 arguments, not 1 — `mock.calls[0]` is genuinely a 2-tuple. Fixed by reading `store.peek.mock.calls[0]?.[0]` directly instead of an incorrectly-shaped array cast. Neither touches `design.md`'s architecture — both are test-file-only TypeScript strictness fixes.

### PR2b acceptance gate (task 3.4) — all passed, verified directly

1. `pnpm --filter core-api exec jest shared/rate-limit` → **20/20 passed** (9 store + 11 interceptor).
2. `pnpm lint` scoped to `services/core-api/src/shared/rate-limit/` → clean, zero findings.
3. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

The interceptor/module aren't mounted on any real route yet — that happens in PR7a (Phase 9, HTTP layer), once the actual `POST /identidad/sesion`/`.../refresco` routes exist to decorate with `@UseInterceptors(RateLimitInterceptor)` + `@RateLimit(...)`.

## PR3 (Phase 4) — `GoTrueAuthClient` + env + trust-proxy — DONE

Applied directly by the orchestrator inline. Strict TDD followed literally for the client: wrote the spec first, confirmed RED, implemented, GREEN.

### What was built (tasks 4.1–4.6, all complete)

- `services/core-api/src/config/env.schema.ts` — `SUPABASE_ANON_KEY` (unconditional fail-fast, same class as `SUPABASE_SERVICE_ROLE_KEY`) and `TRUST_PROXY_HOPS` (`z.coerce.number().int().min(0).default(0)`) added to `baseEnvSchema`.
- `services/core-api/.env.example` — both documented, in the existing Supabase and Process sections respectively.
- `services/core-api/src/shared/supabase/gotrue-auth.client.ts` — `GoTrueAuthClient`, plain constructor args (`supabaseUrl`, `anonKey`, `SupabaseClient`) rather than NestJS constructor DI. `passwordGrant`/`refreshGrant` both go through a shared private `tokenRequest()` using global `fetch` + `AbortSignal.timeout(5000)`, resolving `{ ok, status, body }` for any HTTP response and letting network/timeout failures reject naturally. `revoke()` delegates to the injected `SupabaseClient`'s `auth.admin.signOut(token, 'local')` — confirms design.md's D-1 asymmetry (direct HTTP for grants, reused `supabase-js` admin call for revocation) exactly as specified.
- `services/core-api/src/shared/supabase/gotrue-auth.client.spec.ts` — 11 tests: `describe.each` table over HTTP 400/401/429/500 (all resolve normally, never throw) plus an explicit 200 case; `fetch` network rejection propagates; `AbortError` propagates; the raw password never leaks into a thrown error's message or `cause` (explicit assertion); exact request shape (URL, method, headers, JSON body) for both grants; `revoke` delegation with the correct `'local'` scope.
- `services/core-api/src/shared/supabase/supabase.module.ts` — new `GOTRUE_AUTH_CLIENT` Symbol token, provided via a `useFactory` (`inject: [ConfigService, SUPABASE_CLIENT]`) mirroring the existing `SUPABASE_CLIENT` provider exactly, exported alongside it.
- `services/core-api/src/main.ts` — `NestFactory.create<NestExpressApplication>(AppModule)` (was the platform-agnostic default) + `app.set('trust proxy', config.get('TRUST_PROXY_HOPS', 0))`, reusing the single `ConfigService` instance the function already needed for `NODE_ENV`/`PORT` later (no duplicate `app.get()` call).
- `services/core-api/src/config/env.schema.spec.ts` — added `SUPABASE_ANON_KEY` to the valid-env fixture, plus 3 new tests (missing-key rejection, `TRUST_PROXY_HOPS` default, explicit `TRUST_PROXY_HOPS`).
- `services/core-api/test/env.e2e-setup.ts` — added `process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';`.

### One regression-prevention step not in the task list, done anyway

Tasks 4.1–4.6 as written only mention adding the schema fields and testing the new client in isolation. Making `SUPABASE_ANON_KEY` a new *unconditionally required* env var is a breaking change for anything that boots the app or calls `validateEnv` directly — so before declaring this PR done, I grepped for every existing reference to `SUPABASE_SERVICE_ROLE_KEY` (the same fail-fast class) to find every fixture that would now be missing a required var, and updated both `env.schema.spec.ts` and `test/env.e2e-setup.ts` accordingly. Verified by running the **full** unit and e2e suites, not just the scoped new test — see gate results below.

### PR3 acceptance gate (task 4.6) — all passed, verified directly, with full-suite regression checks

1. `pnpm --filter core-api exec jest shared/supabase/gotrue-auth` → **11/11 passed**.
2. **Full unit suite** (`pnpm exec jest`, unscoped): **85/85 suites, 783/783 tests passed** — confirms the new required env var broke nothing elsewhere.
3. **Full e2e suite** (`pnpm exec jest --config ./test/jest-e2e.json`): **26/26 suites, 153/153 tests passed** — confirms the app still boots end-to-end with the new fail-fast var wired correctly into the test setup. Notably, the two `refill-matching` e2e specs recorded as failing in the `sdd-init/repon` Engram memory (2026-08-15, `refill-crear-solicitud`/`refill-completar-borrador`, 500 instead of 2xx/4xx) **did not fail this run** — that pre-existing issue appears to have been resolved by unrelated work since then (not touched by this change).
4. `pnpm lint` scoped to all PR3-touched files → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

`AuthProvider.signIn`/`refreshSession`/`revokeSession` (PR4/Phase 5) — nothing in `identidad` calls `GoTrueAuthClient` yet; it's provided but unconsumed until the next PR.

## PR4 (Phase 5) — `AuthProvider` port + `SupabaseAuthProvider` classification — DONE

Applied directly by the orchestrator inline. Strict TDD followed literally: extended the existing `supabase-auth.provider.spec.ts` with 13 new tests first, confirmed RED, then implemented.

### What was built (tasks 5.1–5.5, all complete)

- `ports-out/auth-provider.port.ts` — new `AuthSession` interface, and `signIn`/`refreshSession`/`revokeSession` added to `AuthProvider`, none with `tx?` (matching the existing 3 methods' rule).
- `domain/identidad.errors.ts` — `CredencialesInvalidasError`, `SesionExpiradaError`, `AuthProviderNoDisponibleError`, same plain-`Error`/JSDoc-HTTP-mapping convention as the file's existing classes.
- `adapters/persistence/supabase-auth.provider.ts` — constructor now also injects `GOTRUE_AUTH_CLIENT`. Two new module-level helpers: `classifyGrantResult(result: GoTrueResult)` (the classification table: ok→`toAuthSession`, 4xx-not-429 with `error`/`error_code` ∈ {`invalid_grant`,`invalid_credentials`}→deterministic `invalid_credentials`, other 4xx→deterministic `other`, else→ambiguous) and `toAuthSession(body)` (validates all 4 required fields are present with the right type before constructing an `AuthSession`, else throws ambiguous — same "GoTrue contract violation" pattern as the existing `createAccount`'s "no user and no error" branch). `signIn`/`refreshSession` both route through a small private `grantOrAmbiguous()` helper that wraps a rejected `GoTrueAuthClient` call (network failure/timeout) into `AuthProviderAmbiguousError`, since `GoTrueAuthClient` itself never classifies — it just rejects. `revokeSession` is a direct passthrough to `gotrueAuthClient.revoke()`, deliberately NOT swallowing a failure itself (that's the calling use case's job per design.md D-4a/D-5, tested explicitly).
- `adapters/persistence/supabase-auth.provider.spec.ts` — added a `buildGoTrueClient()` factory (mirrors the existing `buildSupabase()`) plus `grantOk`/`grantError` result-shape helpers, and 13 new tests across 3 new `describe` blocks (`signIn`, `refreshSession`, `revokeSession`) covering every row of design.md's D-4 classification table, both GoTrue error-field spellings (`error` vs `error_code`), the malformed-success-body edge case, and the password-never-leaks contract (same style of test as PR3's `gotrue-auth.client.spec.ts`).

### Regression-prevention step not in the task list, done anyway (same discipline as PR3)

Widening the `AuthProvider` interface with 3 new required methods breaks every existing `jest.Mocked<AuthProvider>` object literal that doesn't implement them — a TypeScript compile error, not a runtime one, so it wouldn't have shown up just running the new/scoped tests. Grepped for every `AuthProvider`/`AUTH_PROVIDER` reference in the codebase and found two more call sites needing the same fix as the 11 pre-existing tests I updated directly in `supabase-auth.provider.spec.ts`: `test/identidad.e2e-spec.ts` and `ports-in/registrar-usuario.use-case.spec.ts` each construct a full mock `AuthProvider` and were both missing the 3 new methods. Added `signIn`/`refreshSession`/`revokeSession: jest.fn()` to both. Caught by running the full `tsc --noEmit`, not the scoped test command.

### PR4 acceptance gate (task 5.5) — all passed, verified directly, with full-suite regression checks

1. `pnpm --filter core-api exec jest domains/identidad/adapters/persistence/supabase-auth.provider` → **24/24 passed** (11 pre-existing + 13 new).
2. **Full unit suite**: **85/85 suites, 797/797 tests passed**.
3. **Full e2e suite**: **26/26 suites, 153/153 tests passed** — the `identidad.e2e-spec.ts` mock-object fix confirmed working end-to-end, not just at the type level.
4. `pnpm lint` scoped to all PR4-touched files → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors (this is what caught the 2 other broken mock sites above).

### Not yet done

`domain/sesion-elegibilidad.ts` (`assertSesionPermitida`, PR5/Phase 6) — the suspended-profile/company and role-mismatch checks (D-4a/D-5) aren't wired anywhere yet; nothing calls `signIn`/`refreshSession` in production code until the use cases land in PR6a/PR6b.

## PR5 (Phase 6) — `assertSesionPermitida` + eligibility errors — DONE

Applied directly by the orchestrator inline. Strict TDD followed literally: wrote the full truth-table spec first, confirmed RED, then implemented.

### What was built (tasks 6.1–6.4, all complete)

- `domain/identidad.errors.ts` — `PerfilSuspendidoError`, `EmpresaSuspendidaError`, `RolNoPermitidoError`, same plain-`Error`/JSDoc-HTTP-mapping convention as every other class in the file. Doc comments explicitly note `PerfilSuspendidoError` shares only the wire `code` with `AuthGuard`'s existing `PROFILE_SUSPENDED` rejection, never the `AuthError` class (`shared/auth/` stays untouched — reconfirms design.md D-4a's explicit layering decision).
- `domain/sesion-elegibilidad.ts` — pure `assertSesionPermitida({ role, status, companyStatus, expectedRole? })`, zero framework imports, same shape/pattern as the existing `assertProviderHasCompany` (read first for the convention). Three sequential checks in the load-bearing order design.md specifies: `status === 'suspendido'` → `PerfilSuspendidoError`; `role === 'provider' && companyStatus === 'suspendido'` → `EmpresaSuspendidaError`; `expectedRole !== undefined && role !== expectedRole` → `RolNoPermitidoError`. `companyStatus: 'pendiente'` deliberately passes through both remaining checks untouched — it's a success case, not refused.
- `domain/sesion-elegibilidad.spec.ts` — 15 tests: the full happy-path matrix (user/provider/admin × active/pending-company), every suspension trigger (profile, company, and the "company check never applies to a non-provider role" defensive case), the two orderings that prove suspension is checked before role-mismatch, every role-mismatch case including admin-against-both-apps, and both "role matches" and "expectedRole omitted" pass-through cases.

Zero deviations from `design.md`/`tasks.md` — the pure-function shape was specified precisely enough to implement directly, and no other file needed a matching update this time (unlike PR3/PR4, this doesn't widen any existing interface or add a new unconditionally-required config value).

### PR5 acceptance gate (task 6.4) — all passed, verified directly

1. `pnpm --filter core-api exec jest domains/identidad/domain/sesion-elegibilidad` → **15/15 passed**.
2. Full unit suite → **86/86 suites, 812/812 tests passed**.
3. Full e2e suite → **26/26 suites, 153/153 tests passed** (run anyway per the PR3/PR4 discipline, even though this PR touches no interface/env surface).
4. `pnpm lint` scoped to `domains/identidad/domain/` → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

`assertSesionPermitida` isn't called from anywhere yet — `IniciarSesionUseCase`/`RefrescarSesionUseCase` (PR6a/PR6b) are its first and only intended callers.

## PR6a (Phase 7) — `IniciarSesionUseCase` + `CerrarSesionUseCase` — DONE

Applied directly by the orchestrator inline. Strict TDD followed literally: wrote both spec files first, confirmed RED, then implemented.

### A real spec-vs-diagram inconsistency found and resolved (documented in-code, not silently picked)

`tasks.md` task 7.1 and `design.md`'s Data Flow diagram disagree with each other on where the `expectedRole` check happens: task 7.1's prose lists it as a step separate from `assertSesionPermitida` ("`assertSesionPermitida` ... -> `ProfileRepository.findById` -> optional `expectedRole` comparison"), and the Data Flow diagram shows the identical separation (step 3 = `assertSesionPermitida(actor)` covering only `status`/`companyStatus`, step 5 = a distinct `expectedRole mismatch?` check *after* step 4's `ProfileRepository.findById`). But `design.md` D-4a's own prose AND `tasks.md` task 6.2 (already implemented in PR5) both define `assertSesionPermitida`'s signature as `{ role, status, companyStatus, expectedRole? }` — bundling all three checks into one pure function call, with `expectedRole` explicitly documented as the third, lowest-precedence check inside that same function.

Resolution: called `assertSesionPermitida` **once**, with `expectedRole` included, positioned before `ProfileRepository.findById` — matching the function's actual built signature from PR5 rather than re-deriving a second, duplicate inline role check just to match the diagram's literal step count. The observable behavior is identical (refused, revoked, no session data) either way; the only difference is this ordering skips a wasted profile-repository read on the mismatch path, which the diagram's ordering would have performed for no benefit. Documented directly in `iniciar-sesion.use-case.ts`'s class-level comment so a future reader hits the explanation immediately, not just here.

### Another judgment call, also documented: revoke-on-refusal for the orphan-profile case

`design.md`'s D-4a classification table doesn't list a revoke step for "grant OK but no `profiles` row" (the `v_auth_orphans` case) — its "Adapter throws" column is literally `—` for that row, only naming `CredencialesInvalidasError` + a server-side warning. I revoked the just-minted GoTrue grant there too, on the reasoning that "no partial session left behind" is stated as a general principle applied to every other refusal path (suspended profile, suspended company, role mismatch) and there's no reason this one refusal should be the exception — a valid-but-orphaned grant is still a live token an attacker (or confused client) could otherwise hold. Flagging this as a judgment call, not a re-derivation of an explicit design decision.

### What was built (tasks 7.1–7.5, all complete)

- `ports-in/iniciar-sesion.use-case.ts` — `IniciarSesionUseCase`, constructor injects `AUTH_PROVIDER`, `ACTOR_PORT`, `PROFILE_REPOSITORY` (same DI-token pattern as `RegistrarUsuarioUseCase`, read first for convention). `execute()`: `signIn` (wrapped by a private `grantSession` that maps `AuthProviderDeterministicError`→`CredencialesInvalidasError` and `AuthProviderAmbiguousError`→`AuthProviderNoDisponibleError`, collapsing both deterministic reasons — `'invalid_credentials'` and `'other'` — into the same domain error, exactly as design.md's D-4 table states "collapsed on purpose") → `ActorPort.findActorById` (null → orphan-profile path above) → `assertSesionPermitida` (any throw → `revokeQuietly` then rethrow) → `ProfileRepository.findById` (a `null` here is a defensive `throw new Error(...)` — a data-consistency bug, not a request path, same style as `AuthGuard`'s own "invoked without ACTOR_PORT" defensive throw) → `SesionResult`. `console.warn`, not `@nestjs/common`'s `Logger` — matches `RegistrarUsuarioUseCase`'s established precedent for `ports-in/` (framework-decorator-only, no HTTP-framework logging dependency).
- `ports-in/cerrar-sesion.use-case.ts` — `CerrarSesionUseCase`, one dependency (`AUTH_PROVIDER`). `execute()` always resolves.
- `ports-in/iniciar-sesion.use-case.spec.ts` — 11 tests covering every row of task 7.3's list plus the two collapsed-reason cases and the admin-against-either-app case.
- `ports-in/cerrar-sesion.use-case.spec.ts` — 2 tests.

Zero other files needed updating this time — `IniciarSesionCommand`/`SesionResult` are new exported types with no existing consumer to break.

### PR6a acceptance gate (task 7.5) — all passed, verified directly

1. `pnpm --filter core-api exec jest domains/identidad/ports-in/iniciar-sesion domains/identidad/ports-in/cerrar-sesion` → **13/13 passed** (11 + 2).
2. Full unit suite → **88/88 suites, 825/825 tests passed**.
3. Full e2e suite → **26/26 suites, 153/153 tests passed**.
4. `pnpm lint` scoped to `domains/identidad/ports-in/` → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

Neither use case is registered in `identidad.module.ts` or reachable from any HTTP route yet — that's PR7a. `RefrescarSesionUseCase` (PR6b) hasn't been built; it will call the same `assertSesionPermitida` (proving design.md's "a suspension lands at the next refresh" claim) but against `AuthProvider.refreshSession` instead of `signIn`.

## PR6b (Phase 8) — `RefrescarSesionUseCase` — DONE

Applied directly by the orchestrator inline. Strict TDD followed literally: wrote the spec first, confirmed RED, then implemented.

### What was built (tasks 8.1–8.3, all complete)

- `ports-in/refrescar-sesion.use-case.ts` — `RefrescarSesionUseCase`, same 3-dependency constructor shape as `IniciarSesionUseCase` (`AUTH_PROVIDER`/`ACTOR_PORT`/`PROFILE_REPOSITORY`). `execute(refreshToken)`: `refreshSession` (deterministic → `SesionExpiradaError`, ambiguous → `AuthProviderNoDisponibleError` — note the different domain error than login's `CredencialesInvalidasError` for the same adapter-level `AuthProviderDeterministicError`, since this is a refresh not a fresh credential check) → `ActorPort.findActorById` (null → orphan case, same revoke+warn+refuse pattern as PR6a, but `SesionExpiradaError` not `CredencialesInvalidasError`) → `assertSesionPermitida` called **without** `expectedRole` (refresh re-validates `status`/`companyStatus` only — the role/app pairing was already proven at the original login and isn't re-litigated here) → `ProfileRepository.findById` → reuses `IniciarSesionUseCase`'s exported `SesionResult` type directly (same response shape both endpoints will return, per design.md D-2's "the client has exactly one response parser").
- `ports-in/refrescar-sesion.use-case.spec.ts` — 8 tests, including the specific scenario task 8.2 called out by name: a profile suspended **after** the original login (which would have seen `status:'activo'`) is refused and revoked at refresh time — this is the concrete proof of design.md D-2's "a suspension lands at the next refresh" claim, not just an assertion of it. Also covers the mirror case for a company suspended after login, and an explicit test confirming `expectedRole` is genuinely never re-checked (a provider that would still be allowed on its original app refreshes cleanly with no revoke).

Deliberately did NOT extract a shared base class/helper between `IniciarSesionUseCase` and `RefrescarSesionUseCase` despite their structural similarity (both: grant → resolve actor → `assertSesionPermitida` → fetch profile → revoke-on-refusal) — the duplication is modest, the two use cases differ in exactly the ways that matter (different domain error mapping, `expectedRole` present vs. absent), and neither `design.md` nor `tasks.md` asked for shared infrastructure. Two small, independently readable classes over one abstraction, per this project's stated preference against premature abstraction.

### PR6b acceptance gate (task 8.3) — all passed, verified directly

1. `pnpm --filter core-api exec jest domains/identidad/ports-in/refrescar-sesion` → **8/8 passed**.
2. Full unit suite → **89/89 suites, 833/833 tests passed**.
3. Full e2e suite → **26/26 suites, 153/153 tests passed**.
4. `pnpm lint` scoped to `domains/identidad/ports-in/` → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

None of the three session use cases (`IniciarSesionUseCase`/`CerrarSesionUseCase`/`RefrescarSesionUseCase`) are registered in `identidad.module.ts` or reachable from any HTTP route — that's PR7a, which is also where `RateLimitInterceptor` (PR2b) finally gets mounted on real routes for the first time.

## PR7a (Phase 9) — HTTP layer — routes, DTOs, mapper, filter, module wiring — DONE

Applied directly by the orchestrator inline. This is the PR that finally exposes everything from PR2a-PR6b over HTTP.

### A real production bug found and fixed — not caught by the task's own scoped test command

After wiring `@UseInterceptors(RateLimitInterceptor)` onto the two public session routes and running the **full e2e suite** (not just `jest domains/identidad/adapters/http`, which task 9.7 names), **21 of 26 e2e suites (134 of 153 tests) failed** with:

```
Nest can't resolve dependencies of the RateLimitInterceptor (Reflector, ?).
Please make sure that the argument Symbol(RATE_LIMIT_STORE) at index [1] is
available in the IdentidadModule module.
```

Root cause: `@UseInterceptors(SomeClass)` — a class reference, not a pre-built instance — makes Nest resolve that class's constructor dependencies through the *consuming* module's own injector (`IdentidadModule`), not the module that originally provided it. `shared/rate-limit/rate-limit.module.ts` (built in PR2b) only exported `RateLimitInterceptor` itself, not `RATE_LIMIT_STORE` — so as long as nothing actually applied the decorator, the missing export was invisible; the instant a real route used it, resolution failed. Fixed with a one-line change: also export `RATE_LIMIT_STORE` from `RateLimitModule`, with a comment explaining why both must be exported together.

This is exactly the class of bug a scoped unit test structurally cannot catch — PR2b's own 20 tests construct `RateLimitInterceptor` and `InMemoryRateLimitStore` directly with `new`, never through Nest's real DI container, so the missing export was invisible until a real module tried to wire the decorator through Nest's actual bootstrap path. Confirms the value of this chain's running discipline: full unit + full e2e suites after every PR, not just each phase's own named verify command. One transient flake (a single test, `identidad.e2e-spec.ts`'s "no Authorization header" case, got 404 instead of 401 on the first post-fix full run) did not reproduce on an isolated-file re-run or a second full-suite re-run — not a regression, logged for awareness only.

### What was built (tasks 9.1–9.7, all complete)

- `dto/iniciar-sesion.dto.ts`, `dto/refrescar-sesion.dto.ts`, `dto/sesion-response.dto.ts` — exactly per spec. `expectedRole` reuses `SELF_SERVICE_ROLES`/`SelfServiceRole` from the existing `registrar-usuario.dto.ts` (exported that const — it was module-private before) instead of a second, duplicate `'user'|'provider'` array.
- `shared/auth/decorators/bearer-token.decorator.ts` — `@BearerToken()`, mirrors the existing `@Actor()` decorator's `createParamDecorator` shape exactly (read first for convention).
- `identidad.controller.ts` — 3 new routes (`POST /identidad/sesion`, `POST /identidad/sesion/refresco`, `DELETE /identidad/sesion`), rate-limit configs matching the task's exact numbers verbatim, `DELETE` relies on the already-globally-registered `AuthGuard`/`RolesGuard` (no `@Public()`, no explicit role check needed — any authenticated actor can log out of their own session).
- `identidad.mapper.ts` — `toSesionResponseDto`, reusing `toProfileResponseDto`; `companyStatus: null` → `undefined` in the DTO (this file's established "omit absent optionals" convention, confirmed by reading the existing mapper functions first).
- `identidad-exception.filter.ts` — 6 new `@Catch()` entries + `ERROR_STATUS_MAP` rows, exact status/code pairs from the task list. `shared/auth/auth.errors.ts` confirmed untouched.
- `identidad.module.ts` — registered all 3 session use cases, imported `RateLimitModule`.
- Extended (not new files) `identidad-exception.filter.spec.ts` (+6 `describe.each` rows), `identidad.mapper.spec.ts` (+2 tests for `toSesionResponseDto`), `identidad-dto.spec.ts` (+13 tests across `IniciarSesionDto`/`RefrescarSesionDto`, including one explicitly asserting the deliberate absence of `@MinLength` doesn't reject a 1-character password) — matching this directory's existing per-concern spec-file convention rather than adding a parallel set of new spec files.

### PR7a acceptance gate (task 9.7) — all passed, verified directly, including the fix above

1. `pnpm --filter core-api exec jest domains/identidad/adapters/http` → **45/45 passed** (3 suites).
2. Full unit suite → **89/89 suites, 852/852 tests passed**.
3. Full e2e suite → **26/26 suites, 153/153 tests passed** (after the `RATE_LIMIT_STORE` export fix; re-confirmed on a second full run).
4. `pnpm lint` scoped to all PR7a-touched files → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.

### Not yet done

`test/identidad-sesion.e2e-spec.ts` (PR7b) — the dedicated e2e spec for the full login/refresh/logout/rate-limit/suspension flow through real HTTP (byte-identical wrong-password-vs-unknown-email bodies, the 429 scenarios, the 403-with-no-token-leaked assertion) hasn't been written yet; today's e2e coverage for these 3 routes is indirect (via the existing `identidad.e2e-spec.ts`'s other route tests continuing to pass, proving the module still boots correctly) — no test yet actually calls `POST /identidad/sesion` itself. A manual `curl` smoke test against a running dev server (this PR's Suggested Work Unit runtime harness) was not performed — it requires the local Supabase stack running, which wasn't started this session; the e2e suite's real-HTTP-pipeline coverage (guards, interceptors, filters all exercised through supertest) is the verification performed instead.

## PR7b (Phase 10) — `identidad-sesion.e2e-spec.ts` — DONE

Applied directly by the orchestrator inline. This is the spec that finally *proves* the login/refresh/logout/rate-limit/suspension flows work through real HTTP, not just that the module boots.

### Design choice: 4 isolated `INestApplication` instances, not 1 shared one

`identidad.e2e-spec.ts` uses one shared app across its whole file. This spec deliberately does **not** — `InMemoryRateLimitStore`'s per-IP counter is shared across every request against the same app instance, and several of this spec's scenarios necessarily drive many failed attempts (the 21-attempts-across-20-emails test alone needs 21 requests). Running everything against one shared app risks earlier tests' failed attempts silently eating into later tests' rate-limit budget — a real, not hypothetical, risk (confirmed below). Structured as 4 top-level `describe` blocks, each with its own `beforeAll`-created app and `afterAll`-closed one, via a shared `createTestApp()` helper (same override set as `identidad.e2e-spec.ts`: `ACTOR_PORT`/`COMPANY_REPOSITORY`/`PROFILE_REPOSITORY`/`ADMIN_ROLE_REPOSITORY`/`AUTH_PROVIDER`/`AUDIT_LOG_PORT`/`EVENT_PUBLISHER`/`TRANSACTION_MANAGER`, real `AppModule`/`AuthGuard`/`RolesGuard`/`RateLimitInterceptor`, no local Supabase required):

1. **Shapes, classification, refresh, logout** — 12 tests, low/zero rate-limit-budget impact (2 IP-counted failures total across the whole group).
2. **Per-email lockout** — 2 tests (known email, unknown email), ~10 IP-counted failures, isolated from group 1.
3. **Reset on success** — 1 test, ~11 IP-counted failures, isolated (needs a clean start to prove reset precisely).
4. **Per-IP lockout across 20 emails** — 1 test, needs a genuinely clean IP counter (exactly 20 then 21), isolated by necessity — this one could not safely share an app with *any* other group.

### A real test-logic bug in my own first draft — found and fixed by running it, not by re-reading the spec

The "reset on success" test originally drove **5** failures before the success attempt, mirroring task 10.1's literal parenthetical wording "(5 failures, success, then 5 more needed to re-lock)". Running it failed: `expected 200, got 429` on the success attempt itself. Root cause, once traced: at exactly 5 prior recorded failures, the email is *already* at the interceptor's block threshold (`count >= limit`) — the PRE phase unconditionally blocks the very next request, success or not, before it ever reaches `IniciarSesionUseCase`. This is the identical mechanism the sibling "per-email lockout" test proves on purpose ("a correct password during an active lockout MUST still be rejected") — I'd just walked into it by accident in a different test. Fixed by driving 4 failures (one under the limit) before the success; reset is only ever observable when it lands *before* the block threshold, never as an escape hatch after. The task's "5 more needed to re-lock" half was already correct — that part re-starts the count from 0 after the reset, so it genuinely takes 5 fresh failures to re-trigger, exactly as written.

### What was built (tasks 10.1–10.2, all complete)

- `test/identidad-sesion.e2e-spec.ts` — 15 tests: `200` shape on success (exact body match, not just `toMatchObject`); wrong-password vs unknown-email produce byte-identical bodies (asserted both via `toEqual` against each other AND against the exact literal expected shape); ambiguous failure → 503; suspended profile → 403 with `PROFILE_SUSPENDED` and no `accessToken`/`refreshToken` substring anywhere in the JSON body, revoke called with the exact access token; suspended-company provider → the mirror case with `COMPANY_SUSPENDED`; the login-issued `accessToken` accepted by `DELETE /identidad/sesion` (204, not 401) as the "existing protected route" proof — reusing `AuthGuard`'s real verification path, not a special case; a 10-request outage burst causing zero lockout; 5-then-6th-blocked per-email lockout (with an explicit `Retry-After` header presence check and confirming the "correct" password on the 6th attempt was never actually forwarded to `signIn`); an unknown email locking out identically; the corrected reset-on-success scenario; the 21-across-20-emails IP lockout; refresh 200 shape + `SESION_EXPIRADA` on a stale token; logout 204-even-on-revoke-failure + 401-with-no-header.
- Self-contained JWT signing (`signToken`, matching `identidad.e2e-spec.ts`'s exact `JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` constants and `jose` `SignJWT` call shape) — each e2e spec file signs its own tokens rather than importing test internals from a sibling spec file, matching this directory's established per-file self-containment convention.

### PR7b acceptance gate (task 10.2) — all passed, verified directly

1. `pnpm --filter core-api exec jest --config ./test/jest-e2e.json identidad-sesion` → **15/15 passed**.
2. Full unit suite (`pnpm test` equivalent, unit half) → **89/89 suites, 852/852 tests passed** — zero regression.
3. Full e2e suite → **27/27 suites (up from 26), 168/168 tests (up from 153) passed** — zero regression on `identidad.e2e-spec.ts` or any other domain.
4. `pnpm lint` on the new spec file → clean, zero findings.
5. `pnpm --filter core-api exec tsc --noEmit -p tsconfig.json` → clean, zero errors.
6. `pnpm run build` (`tsc -p tsconfig.build.json`) → clean — explicitly re-run per this task's own gate, not just the typecheck already covered elsewhere.

### Not yet done

A manual `curl` smoke test against a running dev server with real local Supabase was still not performed this chain (needs the local stack started, out of scope for an inline apply session) — the e2e suite's real-HTTP-pipeline coverage (every guard/interceptor/filter exercised through supertest against the real `AppModule`) is the verification actually performed, and is now comprehensive for all 3 session routes specifically, not just indirect.

## Backend half of mobile-auth-login is now COMPLETE (PR1–PR7b)

Every backend piece from the design — rate limiting, the GoTrue HTTP client, `AuthProvider`, eligibility checks, all 3 session use cases, the full HTTP surface, and now the dedicated e2e proof — is built, wired, and green. What remains is entirely mobile-side: PR8a/PR8b (`@repon/auth`'s real session client) and PR9/PR10 (the two apps' login screens), plus PR11 (doc deltas).

## PR8a (Phase 11) — `@repon/auth` config, types, storage — DONE

Applied directly by the orchestrator inline. First mobile-side PR since PR1 — `packages/auth` had zero real dependencies (only `react`/`react-native` peer/dev deps for the wiring probe) and zero test infrastructure before this PR.

### Three setup fixes needed before any of this typechecked or ran

1. **No `@repon/types` dependency at all.** `session.types.ts` (task 11.2) needs `Role`/`ProfileStatus`/`CompanyStatus` from it — typecheck failed with "Cannot find module '@repon/types'" until I added `"@repon/types": "workspace:*"` as a real dependency.
2. **The jest-version-hoisting collision from PR1 recurred, in a new shape.** `pnpm add -D jest ts-jest @types/jest expo-secure-store` resolved plain `jest@^30.4.2` for this package (unlike the apps, nothing here pulls in `jest-expo`, and `ts-jest@29.4.12` peers on both 29 *and* 30, so pnpm picked the newer one by default). But the two apps' own `jest@^29.7.0` pin (needed for their `jest-expo` compatibility, established in PR1) is hoisted into the *same* shared root `node_modules` under this workspace's `nodeLinker: hoisted`. Result: `jest-mock` landed at 29.7.0 (from the apps) while `jest`/`jest-runtime` landed at 30.4.2 (from this package) — the identical `TypeError: this._moduleMocker.clearMocksOnScope is not a function` crash as PR1, but from a genuinely different cause this time: a *cross-package* version collision under hoisted linking, not one package's own internal mismatch. Fixed by pinning `packages/auth`'s `jest` to `^29.7.0` too. **Lesson for PR8b/PR9/PR10 and any future package**: under `nodeLinker: hoisted`, every package in this workspace that uses `jest` at all needs to stay on the same major version, or this exact class of bug recurs — it's a workspace-wide constraint now, not a one-off fix.
3. **The `"types": ["jest"]` tsconfig gap from PR1 recurred too, same fix.** Also added `"DOM"` to `packages/auth/tsconfig.json`'s `lib` array — new this time, needed for `session-storage.web.ts`'s `localStorage` global (the root `tsconfig.base.json` this package extends only has `"ES2022"`; the apps get `"DOM"` for free from `expo/tsconfig.base`, which this package doesn't extend).

One more, smaller snag: `packages/auth/jest.config.js` had to be renamed to `jest.config.cjs` — the package's `"type": "module"` (set in PR1) makes a plain `.js` file using `module.exports` (CommonJS) fail Node's ESM/CJS interop at load time.

### What was built (tasks 11.1–11.5, all complete)

- `packages/auth/src/config.ts` — `AuthConfig { apiBaseUrl, expectedRole }`, exactly per spec; doc comment states explicitly why the package never reads `process.env` itself (each app supplies config as a prop, keeping the package testable/app-agnostic).
- `packages/auth/src/session.types.ts` — `PerfilSesion` (mirrors core-api's `ProfileResponseDto`) and `Sesion` (mirrors `SesionResponseDto` minus `tokenType`, which the client hardcodes as `'Bearer'` when attaching the header rather than persisting — a PR8a-scoped design call, since `tokenType` adds no value to stored state).
- `packages/auth/src/session-storage.ts` — `expo-secure-store`-backed, one key (`'repon.session'`), one atomic JSON-blob write. `loadSession()` returns `null` (never throws) on missing *or corrupted* stored data — a deliberate robustness choice: a corrupted store degrades to "no session" rather than crashing app boot.
- `packages/auth/src/session-storage.web.ts` — identical exported function signatures, `localStorage`-backed. Metro resolves the platform extension automatically at bundle time; `tsc` typechecks both files independently regardless (verified: TypeScript's own module resolution just picks the non-suffixed `session-storage.ts` for any `import ... from './session-storage'`, and typechecks `session-storage.web.ts` as its own standalone file via the `include: ["src"]` glob — no actual conflict between the two same-named-export files).
- `packages/auth/src/session-storage.spec.ts` + `session-storage.web.spec.ts` — 13 tests total: exact atomic-write assertion (single call, exact JSON payload — not just "was called"), save-then-load round-trip, a second save fully replacing the first with **no merge** (the literal "no half-updated pair" requirement from task 11.4, tested explicitly by asserting the *final* loaded value equals only the rotated session, plus an exact call-count assertion), null-not-throw on missing data, null-not-throw on corrupted JSON, clear-then-load returns null.
- `packages/auth/src/index.ts` — barrel extended to re-export `AuthConfig`/`PerfilSesion`/`Sesion` types (not the storage module itself — storage stays an internal implementation detail for `api-client.ts`/`session-context.tsx`, PR8b, to import directly; the public surface is types + the eventual `SessionProvider`/`useSession`/`RequireSession`).

### PR8a acceptance gate (task 11.5) — all passed, verified directly, plus workspace-wide regression checks

1. `pnpm --filter @repon/auth test` → **13/13 passed**.
2. Full workspace `pnpm typecheck` → clean across all 5 packages (`types`, `auth`, `core-api`, `usuario-mobile`, `proveedor-mobile`) — this is what caught issues 1 and 3 above.
3. `pnpm lint` scoped to `packages/auth/` → clean, zero findings.
4. Both apps' own test suites (`pnpm --filter usuario-mobile test`, `pnpm --filter proveedor-mobile test`) re-run → still 1/1 each, unaffected by the shared-package dependency changes.
5. `core-api`'s full unit suite re-run → still 89/89 suites, 852/852 tests, unaffected.

### Not yet done

`session-client.ts`, `api-client.ts`, `session-context.tsx`, `role-gate.tsx` (PR8b) — nothing calls `saveSession`/`loadSession`/`clearSession` yet; the storage layer is built and tested in isolation but not wired to any actual login flow.

## PR8b (Phase 12) — `@repon/auth` session client, api client, context, gate — DONE

Applied directly by the orchestrator inline. This is the PR that turns PR8a's storage layer into an actual working session client — `@repon/auth`'s full non-UI surface is now complete.

### What was built (tasks 12.1–12.6, all complete)

- `session-client.ts` — `iniciarSesion`/`refrescarSesion`/`cerrarSesion`, thin `fetch` wrappers around core-api's 3 session routes. New `SesionApiError` class carries the exact `{statusCode, code, message}` envelope every core-api error response has, so PR9/PR10's login screens can branch on `.code` (e.g. `'CREDENCIALES_INVALIDAS'` vs `'PROFILE_SUSPENDED'` vs `'DEMASIADOS_INTENTOS'`) without re-parsing anything. `cerrarSesion` deliberately does NOT swallow a failure itself — that's `session-context.tsx`'s job, keeping this layer a pure, honest API client.
- `api-client.ts` — `createAuthClient(config, callbacks?)`, the general-purpose authenticated-fetch utility (`path`-based signature, not full-URL — designed for both apps' future non-auth API calls too, not just an internal auth detail). Implements every mechanic design.md D-6 specifies: bearer injection, proactive refresh under a 60s-to-expiry threshold, single-flight refresh via one closure-scoped `inFlight` variable, exactly one retry after a 401-triggered refresh, sign-out on either a second 401 or a failed refresh, and a 403 that never even attempts a refresh.
- `session-context.tsx` — `SessionProvider`/`useSession`, the `'loading'|'authenticated'|'unauthenticated'` state machine, one-time rehydration via a cancelable `useEffect`. `signIn` also enforces the client-side role check the `mobile-session-client` spec requires as its own testable requirement (defense-in-depth alongside core-api's identical server-side check) — a role-mismatched login response is discarded before ever reaching `saveSession`.
- `role-gate.tsx` — `RequireSession`, reads `expectedRole` from `useSession()` rather than taking it as a second, duplicate prop; discards a mismatched session via `signOut()` in an effect (defense-in-depth against a hypothetical future bug that wrote a mismatched session directly to storage, bypassing `signIn`'s own check); renders nothing during `'loading'` or an active mismatch, `fallback` while unauthenticated, `children` once cleanly authenticated.
- `index.ts` barrel — now exports the real public API surface: `SessionProvider`, `useSession`, `RequireSession`, `SesionApiError`, and every associated type. Deliberately does NOT export `createAuthClient` or the storage module — both stay internal, consumed only by `session-context.tsx` itself.

### Scope decision: no dedicated tests for the two `.tsx` files in this package

`session-context.tsx`/`role-gate.tsx` have no spec files here. `packages/auth`'s `jest.config.cjs` is plain `ts-jest` + `testEnvironment: 'node'` (matching design.md D-6's own stated split: "storage/client/refresh logic unit-tests under plain Jest `testEnvironment: node`" — `.tsx` files are explicitly the exception design already carved out), with no RNTL/jsdom rendering setup — unlike the two apps, which already have `jest-expo` + `@testing-library/react-native` from PR1. Task 12.5's own test list only names `session-client.ts`/`api-client.ts` behaviors, confirming this split was intended, not improvised. Real rendering coverage for `SessionProvider`/`RequireSession` lands in PR9/PR10, mounted inside a real Expo Router app.

### One TDD-order deviation, self-corrected

`session-client.ts` was written before its spec (the only file in this PR, and in the whole chain so far, done implementation-first) — confirmed GREEN immediately once the test was written, no implementation changes needed. Every other file in this PR (and every prior PR) followed RED-then-GREEN. Flagging the deviation for transparency rather than silently letting the pattern blur.

### PR8b acceptance gate (task 12.6) — all passed, verified directly

1. `pnpm --filter @repon/auth test` → **35/35 passed** (13 carried over from PR8a + 22 new: 10 for `session-client.ts`, 12 for `api-client.ts`, including the concurrency-sensitive single-flight test using a controlled-resolution `Promise`).
2. Full workspace `pnpm typecheck` → clean across all 5 packages.
3. `pnpm lint` scoped to `packages/auth/` → clean, zero findings.
4. Both apps' own test suites re-run → still 1/1 each, unaffected.

### Not yet done

Nothing in either app actually imports `SessionProvider`/`RequireSession`/`useSession` yet — PR9/PR10 are what wire this into a real screen and, for the first time, exercise these `.tsx` files through Metro/an actual RNTL render. `@repon/auth`'s non-UI surface (config, types, storage, session client, api client, context, gate) is now 100% built and behavior-tested; only the two apps' own login screens remain.

## PR9 (Phase 13) — `usuario-mobile` login screen + guard — DONE

Applied directly by the orchestrator inline. This is `@repon/auth`'s first real exercise anywhere in this chain — the first time `SessionProvider`/`useSession`/`RequireSession` (React context/hooks) are actually mounted and bundled through Metro, not just unit-tested with mocks.

### Two real bugs found and fixed — neither in `login.tsx`/`_layout.tsx` itself

**1. A pre-existing, latent `expo` version mismatch between the two apps broke every existing test.** `usuario-mobile` was pinned to `expo@~57.0.13`, `proveedor-mobile` to `~57.0.14` — a divergence present since each app's own PR1 scaffolding (created at slightly different times, picking up slightly different latest patches), invisible until now because nothing had forced a fresh dependency-resolution pass that needed to reconcile it. Adding `expo-secure-store` did exactly that: since `jest-expo` is a shared devDependency of both apps under this workspace's `nodeLinker: hoisted`, pnpm couldn't hoist one `expo` version to satisfy both apps' peer expectations, and created a **nested** `node_modules/jest-expo/node_modules/expo` copy — a real, physical, non-symlinked directory sitting entirely outside the flat-hoisted structure this project's tooling assumes everywhere else. That nested copy's own setup file (`expo/src/winter/index.ts`) failed to transform (`SyntaxError: Cannot use import statement outside a module`), and since jest-expo's setup runs for every test in the project, it broke **all** of them — including the previously-passing `perfil.test.tsx` from PR1, a genuine regression, not just a new-test problem. Diagnosed by comparing the nested copy's version (`57.0.14`) against root's hoisted version (`57.0.13`) and each app's own declared range. Fixed by aligning `usuario-mobile`'s full `expo`-family version set (`expo`, `expo-constants`, `expo-router`, `expo-splash-screen`) to match `proveedor-mobile`'s — confirmed via `pnpm install` that the nested copy disappeared entirely. **This is not fully closed**: other expo-family packages could still drift between the two apps and reproduce this exact failure mode later; a full cross-app version audit is worth doing at some point, out of scope for this PR specifically.

**2. `@testing-library/react-native@14`'s `fireEvent.*` methods are `Promise`-returning**, exactly like `render()` (the same class of gotcha discovered for `render` itself back in PR1). Calling `fireEvent.changeText`/`fireEvent.press` without `await` let each call fire before the previous one's React state update had actually committed — so by the time `press` ran, the submit button was still reading stale, empty `email`/`password` state and staying `disabled`; `onPress` never fired at all. Every test failed with a `findByTestId('login-error')` timeout, which *looked* exactly like "the error message never renders" — a plausible app-logic bug — but was actually "the button was never pressed." Root-caused by writing a minimal standalone reproduction outside the full test file and explicitly logging the mocked `fetch`'s call count immediately after `fireEvent.press`: **zero** calls, which ruled out every hypothesis about the network/error-mapping logic and pointed straight at the event layer. Fixed by awaiting every `fireEvent.*` call.

### What was built (tasks 13.1–13.6, all complete)

- `apps/usuario-mobile/package.json` + new `.env.example` — `expo-secure-store` added; `EXPO_PUBLIC_API_URL` documented (no prior env-doc convention existed for the apps; mirrors `services/core-api/.env.example`'s style).
- `app/_layout.tsx` — `SessionProvider` mounted with `expectedRole: 'user'`; splash now held on both font-loading AND `useSession().state !== 'loading'`, which required splitting the root into `RootLayout` (fonts + provider mount) and an inner `RootLayoutNav` (the only place that can call `useSession()`, since the hook only works inside the provider's own subtree).
- `app/login.tsx` — email/password form; `ERROR_MESSAGES` record maps every `SesionApiError.code` to a distinct Spanish message; redirects to `/(tabs)` purely reactively once `state === 'authenticated'` (`SessionProvider`'s own state update drives the next render — no imperative `router.replace` needed).
- `app/(tabs)/_layout.tsx` — wrapped in `RequireSession` (extracted the actual `<Tabs>` tree into a `TabsNavigator` sub-component so the guard sits cleanly outside it), `fallback={<Redirect href="/login" />}`.
- `app/__tests__/login.test.tsx` — 7 tests, exercising the REAL `@repon/auth` package (not mocked away) with only `fetch`/`expo-secure-store` mocked underneath, matching the depth of testing already established in PR8a/PR8b.

### Deliberate scope deviation: no "pending-company" routing in this app

Task 13.4's wording (near-identical to PR10's task 14.4) calls for a `companyStatus: 'pendiente'` → pending-approval-screen branch. `usuario-mobile`'s `expectedRole` is `'user'`, and `AuthenticatedActor`/`Sesion.companyStatus` is structurally `null`/`undefined` for every non-`'provider'` role (confirmed directly in `shared/auth/ports/actor.port.ts`'s own doc comment). That branch could never execute in this app — the task text is shared/templated between the two PRs, genuinely applicable only to PR10. Writing an unreachable branch here would be dead code. Excluded here; will be real in PR10.

### PR9 acceptance gate (task 13.6) — all passed, verified directly, including the real Metro proof

1. `pnpm --filter usuario-mobile test` → **8/8 passed** (7 new + 1 from PR1).
2. Full workspace `pnpm typecheck` → clean across all 5 packages.
3. `pnpm lint` → clean, zero findings (one `@typescript-eslint/no-require-imports` violation in the test file's `jest.mock('expo-router', ...)` factory — a real Jest constraint, not a style issue: mock factories run hoisted above the file's own imports, so a top-level `import` for `Text` isn't reachable there; fixed with a documented `eslint-disable-next-line`, the same pattern `_layout.tsx` already uses for Metro's font `require()`).
4. `pnpm --filter proveedor-mobile test` and `core-api`'s full unit suite, re-run → both unaffected.
5. **Real Metro bundle** (`expo export --platform web`) → succeeded, 23 static routes including the new `/login` (up from 22 in PR1) — this is what actually proves `@repon/auth`'s context/hooks bundle correctly through Metro, something no unit test alone could confirm.

Manual check against a live backend was not performed (no local Supabase/core-api dev server running this session).

## PR10 (Phase 14) — `proveedor-mobile` login screen + guard — DONE

Applied directly by the orchestrator inline. Same pattern as PR9, plus the pending-company routing that genuinely applies to this app. Both bug classes found while verifying PR9 were watched for proactively here — neither recurred, confirmed directly rather than assumed.

### What was built (tasks 14.1–14.6, all complete)

- `apps/proveedor-mobile/package.json` + new `.env.example` — same shape as usuario-mobile's. Explicitly checked for the nested `node_modules/jest-expo/node_modules/expo` copy both before and after adding `expo-secure-store` — absent both times, confirming PR9's version-alignment fix holds and this app's own `expo`-family versions (already at the target `~57.0.14` set) didn't need any adjustment.
- `app/_layout.tsx` — same `SessionProvider`/splash-hold pattern as PR9, `expectedRole: 'provider'`; `<Stack>` now registers 3 screens (`(tabs)`, `login`, `pending-approval`).
- `app/login.tsx` — mirrors PR9's exactly, with provider-specific copy. `COMPANY_SUSPENDED` is genuinely reachable here (unlike usuario-mobile, where it was dead code). Always redirects to `/(tabs)` on success, regardless of `companyStatus` — the pending-vs-full-app decision is centralized in one place (`(tabs)/_layout.tsx`), not duplicated between the login screen and the tabs layout.
- `app/pending-approval.tsx` — new screen: explanatory copy for a provider whose company is still awaiting admin approval, plus a sign-out action. Directly implements the `core-api-sesion` spec's requirement that a pending company is a *successful* login (the provider needs to be able to check their own status), never a refusal.
- `app/(tabs)/_layout.tsx` — `RequireSession` (unauthenticated guard, identical to PR9) wraps a new `PendingApprovalGate` component, which reads `sesion?.companyStatus` from `useSession()` and redirects to `/pending-approval` when `'pendiente'`, otherwise renders the ordinary `TabsNavigator`.
- `app/__tests__/login.test.tsx` — 8 tests, mirroring PR9's 7 plus the new `COMPANY_SUSPENDED` case.
- `app/(tabs)/__tests__/_layout.test.tsx` — 4 new tests exercising the real `SessionProvider` + `TabLayout` together (only `expo-secure-store`/`expo-router` mocked): unauthenticated → `/login`; pending company → `/pending-approval`, tab tree never rendered; active company → ordinary tabs render; a rehydration-completion check.

### Both of PR9's lessons applied proactively — neither bug recurred

Went in already knowing: (1) `fireEvent.*`/`render` in this RNTL version are `Promise`-returning and must always be awaited, and (2) a component that calls `useSession()` needs the initial rehydration effect to settle before interacting with it, or events race the provider's own async mount effect. Applied both from the first draft of every new test file here. Result: **all 13 tests passed on the first run** — no debugging round-trip like PR9 needed. Worth recording as confirmation that PR9's root-causing effort actually paid off, not just as a one-off fix.

### PR10 acceptance gate (task 14.6) — all passed, verified directly, including the real Metro proof

1. `pnpm --filter proveedor-mobile test` → **13/13 passed**.
2. Full workspace `pnpm typecheck` → clean across all 5 packages.
3. `pnpm lint` → clean, zero findings.
4. `pnpm --filter usuario-mobile test` and `core-api`'s full unit suite, re-run → both unaffected.
5. **Real Metro bundle** (`expo export --platform web`) → succeeded, 19 static routes including the new `/login` and `/pending-approval` (up from 17 in PR1).

Manual check against a live backend not performed (no local Supabase/core-api dev server running this session).

## Backend + both mobile apps' login flows are now COMPLETE (PR1–PR10)

Every piece from the design is built, wired, and verified: rate limiting, GoTrue client, `AuthProvider`, eligibility checks, all 3 session use cases, the full HTTP surface, a dedicated e2e proof, `@repon/auth`'s entire client-side surface, and both apps' login screens + guards — including the pending-approval flow that only `proveedor-mobile` needed. What remains is exclusively documentation: PR11's declared deltas to `apps/admin-web/SPEC.md`, `docs/ARCHITECTURE.md`, both apps' own `SPEC.md`, and `identidad/SPEC.md`.

## PR11 (Phase 15) — Declared doc deltas — DONE

Applied directly by the orchestrator inline. Pure documentation, zero code touched, zero test command applicable — matches this PR's own `N/A` runtime harness in the Suggested Work Units table.

### One path correction against the task text

Task 15.4 named `services/core-api/src/domains/identidad/SPEC.md`. That `src/` segment doesn't exist in this repo's actual layout — the real path is `services/core-api/domains/identidad/SPEC.md` (confirmed via `find` before editing). Edited the real file; flagging the task-text typo here rather than silently editing around it.

### What was built (tasks 15.1–15.5, all complete)

- `apps/admin-web/SPEC.md` — replaced the "apps access Supabase directly with the `anon key`" claim (line 9) with a **Corrección declarada** paragraph (matching this repo's existing convention for superseded prose, e.g. `docs/ARCHITECTURE.md`'s D9/D11 corrections) stating both apps authenticate exclusively via `core-api`'s 3 session routes and hold no Supabase key.
- `docs/ARCHITECTURE.md` — two targeted edits, not a rewrite: line 13 now explicitly excludes auth from the "simple reads touch Postgres directly" exception; the Auth row in the Supabase services table states mobile clients never call Supabase Auth directly, always through `identidad`'s 3 session routes. Lines 5 and 15 were re-read and found already accurate (client diagram; "Auth as an adapter from `identidad`") — left untouched, since the actual D2 conflict lived only in the table row and line 13's phrasing, not everywhere task 15.2's line range suggested.
- `apps/usuario-mobile/SPEC.md` / `apps/proveedor-mobile/SPEC.md` — new "Autenticación (login)" section each: screens, `RequireSession` guard, session persistence mechanism, error-code-to-message mapping (usuario-mobile also notes `companyStatus` is structurally inapplicable to it, per PR9's own deviation note). proveedor-mobile's section additionally documents the `pendiente`-vs-`suspendido` company distinction (successful-login-but-gated vs. outright refused) and points to `admin-web/SPEC.md`'s approval flow.
- `services/core-api/domains/identidad/SPEC.md` — added the 3 new `AuthProvider` methods to the interface block plus an `AuthSession` shape comment, and a new "Delta `AuthProvider.signIn`/`refreshSession`/`revokeSession` (`mobile-auth-login`)" section naming the 3 new use cases, the 3 new HTTP routes, and the `assertSesionPermitida` revoke-on-refusal behavior, with a pointer to `design.md` D-1–D-7/D-4a for full detail.

### PR11 acceptance gate (task 15.5) — passed

Manual proofread of all 4 edited files against the shipped behavior of PR7a (exact route paths: `POST /identidad/sesion`, `POST /identidad/sesion/refresco`, `DELETE /identidad/sesion`) and PR9/PR10 (exact screen names, guard names, error codes, the `pending-approval.tsx`/`PendingApprovalGate` naming) — every claim in the new prose matches the actually-built code, not the original design intent where the two diverged. No code touched; no test command applicable, per this PR's own runtime harness (`N/A`).

## The full 15-PR mobile-auth-login chain is COMPLETE (PR1–PR11)

Backend session routes, rate limiting, GoTrue client, eligibility checks, `@repon/auth`'s entire client-side surface, both apps' login screens + guards (including proveedor-mobile's pending-approval flow), and now the reconciled documentation — all built, verified (scoped tests + full unit/e2e suites + typecheck + lint after every single PR, catching 2 real production bugs — the `RATE_LIMIT_STORE` DI export gap in PR7a and the cross-app `expo` version mismatch in PR9 — that a narrower per-PR verify step would have missed), and now documented. Ready for `sdd-verify`.

## Post-PR11 fix — `sdd-verify` CRITICAL closed

`sdd-verify` (run via a fresh-context sub-agent, full report in `verify-report.md`) returned `FAIL`: 24/25 spec scenarios COMPLIANT, 1 CRITICAL — the `mobile-session-client` spec's "a session survives an app restart" scenario had zero covering test for `usuario-mobile` (no `(tabs)/__tests__/_layout.test.tsx` existed for that app, unlike `proveedor-mobile`, which got one in PR10 covering the identical `RequireSession` guard). Everything else — all 9 locked design decisions (D-1–D-7, D-4a), all 5 doc deltas, the full test/typecheck/lint/build suite re-run fresh — was confirmed COMPLIANT/green by the verify pass itself, independent of `apply-progress.md`'s own claims.

Fixed with exactly the recommended scope, no production code touched: added `apps/usuario-mobile/app/(tabs)/__tests__/_layout.test.tsx` (3 cases, mirroring `proveedor-mobile`'s 4 minus the pending-company case that doesn't apply to this app — `usuario-mobile` has no `PendingApprovalGate`): unauthenticated → `/login` redirect; authenticated → ordinary tab flow renders; rehydration-wait (never flashes `/login` for a session that's about to load). All 3 passed on the first run.

**Re-verification after the fix**:
1. `pnpm --filter usuario-mobile test` → **11/11 passed** (was 8/8; +3 new).
2. Full workspace `pnpm typecheck` → clean (5 packages).
3. `pnpm lint` → clean, zero findings.
4. `pnpm --filter core-api exec jest` (full unit suite) → **89/89 suites, 852/852 tests** — unchanged, zero regression.
5. `pnpm --filter core-api exec jest --config ./test/jest-e2e.json identidad-sesion` → **15/15 passed**; `... identidad.e2e-spec` → **19/19 passed** — the two e2e specs this change actually touches, both clean in isolation.

**A pre-existing, unrelated flake observed, not a regression from this fix**: running the *full* 27-suite e2e config in one parallel pass produced a different random set of failures on each of 3 consecutive attempts (`refill-crear-solicitud`, `refill-buscar-proveedores`, `consumo-mis-consumos`, and once even `identidad.e2e-spec.ts`'s admin-role tests) — `socket hang up`/`ECONNRESET`/unexpected 500s/503s, never the same suites twice, including with `--runInBand` to rule out worker-parallelism. None of the failing suites belong to `identidad`/`mobile-auth-login`'s own domain when isolated (confirmed clean above), and this exact class of gap was already flagged as pre-existing in the `sdd-init/repon` Engram record from 2026-08-15 (2 refill e2e specs failing with 500s at that time, before this change existed) — it has apparently grown non-deterministic since, but that's an environmental/e2e-infra issue orthogonal to this change's scope, not something to fix here.

`verify-report.md` and the Engram `sdd/mobile-auth-login/verify-report` record updated to reflect the closed CRITICAL — re-verified PASS.

## Next

This change's implementation and verification are both done — CRITICAL closed, 25/25 spec scenarios now COMPLIANT. Ready for `sdd-archive`.
