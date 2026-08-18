# Proposal: mobile-auth-login — core-api-issued sessions and login for `usuario-mobile` / `proveedor-mobile`

## Intent

Both Expo apps are unauthenticated shells: zero auth files, no `@supabase/supabase-js`, no `expo-secure-store`, no session state (`explore.md`). `core-api` can *verify* a token (`AuthGuard` + `RolesGuard` are already registered as `APP_GUARD`, `app.module.ts:56-57`) but **cannot issue one** — `AuthProvider` exposes only `createAccount`/`deleteAccount`/`findAccountByEmail` (`auth-provider.port.ts:26-31`) and no login route exists anywhere. Result: a person can register via `POST /identidad/usuarios`, and then has no way to get back in. Every authenticated feature already built (`catalogo`, `consumo`, `refill-matching`, `ofertas`) is unreachable from a phone.

Success: a user signs in on `usuario-mobile`, a provider on `proveedor-mobile`, both against **the same** `auth.users`/`profiles` identity, the session survives app restart, the wrong role is rejected with a clear message, and logout clears it.

## Decisions already made (do not re-open)

| # | Decision | Consequence |
|---|---|---|
| **D1** | **Login goes through `core-api`, not the Supabase client SDK** (explore Option 2, overriding its Option 1 recommendation). New `@Public()` route on `IdentidadController`, symmetric with `POST /identidad/usuarios`. | Adds `signIn` to the `AuthProvider` port — genuinely new backend surface. Mobile never holds a Supabase key. |
| **D2** | **The documented-architecture conflict is narrower than `explore.md` claimed, and resolves in D1's favour.** `docs/ARCHITECTURE.md:5` states clients talk to `core-api` "no directo con Supabase"; `:13` repeats it; `:15` scopes Auth to "adaptador desde el dominio `identidad`". `openspec/config.yaml` `rules.design` says the same. Line `:21` ("Registro y sesión de usuarios y proveedores") names *what the Supabase service is used for*, not *who calls it* — the exploration misread it. | Only **one** real contradiction remains: `apps/admin-web/SPEC.md:9` ("Las apps de usuario y proveedor acceden a Supabase directo... con la `anon key`"). It is corrected in this change as a **declared delta**, plus a one-line clarification on the `ARCHITECTURE.md` Auth row. Not silently ignored, not deferred. |
| **D3** | **One SDD change, both apps, delivered as a multi-PR chain.** | 400-line budget; exact slicing belongs to `sdd-tasks`, not here. Expected shape: backend endpoint → shared session module → per-app login screen/guard. |
| **D4** | **The shared boundary is `packages/auth` (`@repon/auth`), source-only, mirroring `@repon/types`.** Holds: core-api session client, `expo-secure-store` token storage, session state/refresh, and a role gate parameterised by `expectedRole`. Apps supply only `expectedRole` + API base URL. | Both apps have byte-identical mechanics; duplicating security-critical token/refresh code in two `lib/auth/` folders is the one place divergence is unacceptable. **New repo pattern**: both apps already depend on `@repon/types` `workspace:*` with `EXPO_USE_METRO_WORKSPACE_ROOT=1`, but types are erased at compile time — this is the **first workspace package Metro must actually resolve and transpile**. PR1 must prove that wiring in both apps before any feature code. |
| **D5** | **Password reset, email verification, and in-app signup screens are OUT.** | Login + logout + session persistence + role-based post-login routing only. Consequence named, not hidden: after this change there is still no in-app way to *create* an account. |

## Scope

### In Scope

1. **`POST /identidad/sesion`** (`@Public()`, login) on `IdentidadController`, with `IdentidadExceptionFilter` mapping — plus session refresh and logout routes (exact shape: Q2).
2. **`AuthProvider.signIn`** on the port + `SupabaseAuthProvider` implementation. The existing `AuthProviderDeterministicError` union already carries `reason: 'invalid_credentials'` (`auth-provider.port.ts:10`) — the error taxonomy needs no new class for the happy failure path.
3. **A server-side password-grant mechanism** — the existing `SUPABASE_CLIENT` is service-role, Admin-API-scoped, `persistSession: false` (`supabase.module.ts:21-33`) and must not be reused. Two candidates in Q1; both need a new env var (`SUPABASE_ANON_KEY` is absent from `.env.example` and all of `src/` — verified).
4. **`@repon/auth`** (D4) — session client, secure storage, refresh-on-401, session context/hooks, role gate.
5. **Login screen + unauthenticated-route guard** in each app, with role-mismatch rejection and post-login routing by `profiles.role`.
6. **Test runner scaffolding for the Expo apps** (Jest + RNTL) — mandated by `openspec/config.yaml` `rules.tasks`; neither app has one today.
7. **Declared deltas** — `apps/admin-web/SPEC.md` (D2), `docs/ARCHITECTURE.md` Auth row (D2), both app `SPEC.md`s (login flow is absent today), `identidad/SPEC.md` (`AuthProvider` gains a method).

### Out of Scope

- **Password reset / email verification / in-app signup** (D5).
- **`admin-web` login** — Next.js, different session model (cookies/server), its own change.
- **Direct Supabase client access from mobile for *data*** — `usuario-mobile/SPEC.md:43` still says "TanStack Query contra Supabase". This change decides **auth only**; that separate question stays open and is not resolved here.
- **Registering `@repon/auth` as a general API client** — session endpoints only; a broader `@repon/api-client` is a later call.
- **Any change to `AuthGuard`/`JwtVerifier`/`ActorPort`** — the new route is `@Public()`; token verification is unchanged and already tested.
- **`backend-core-api-pedidos-pagos` (PR7a, paused)** — untouched.
- **Biometric unlock, "remember me", multi-account, deep-link/magic-link sessions.**

## Capabilities

### New Capabilities

- `core-api-sesion`: the session-issuance surface — login/refresh/logout routes, `AuthProvider.signIn`, server-side password grant, credential-failure taxonomy and HTTP mapping, and the `status`/role rules governing who may obtain a session.
- `mobile-session-client`: `@repon/auth` — secure token persistence, session lifecycle/refresh, the role gate, and auth-aware navigation shared by both Expo apps.

### Modified Capabilities

- `core-api-identidad`: `AuthProvider` gains `signIn` (and possibly refresh/revoke). The existing rule that `AuthProvider` takes no `tx?` is **preserved and reinforced** — Auth stays outside the SQL transaction.
- `core-api-bootstrap`: env schema gains the new Supabase auth-client variable(s), fail-fast at boot like every existing key.
- `repo-toolchain`: first Expo test runner and first *runtime* workspace package consumed by Metro (D4).

## Approach

`core-api` becomes the only party that speaks to Supabase Auth. The apps POST credentials to `POST /identidad/sesion`; `RegistrarSesionUseCase` calls `AuthProvider.signIn`, which performs a password grant against GoTrue server-side, then resolves the caller's `profiles` row (role/status, and `companies.status` for providers) before returning a session plus the minimum identity the client needs to route. The returned `access_token` is the same GoTrue JWT `AuthGuard` already verifies — **no new token format, no locally minted JWT** (that would break the documented `AUTH_JWT_MODE=jwks` production target).

On the client, `@repon/auth` stores tokens in `expo-secure-store`, rehydrates on launch, refreshes on expiry, and exposes a session context. Each app mounts it with its own `expectedRole` (`'user'` / `'provider'`); a successful login whose role does not match is rejected, tokens discarded, explicit error shown — `'admin'` is rejected by both. Post-login routing then differs only in which route group is entered.

Delivery is a chain, not one PR (D3).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `services/core-api/src/domains/identidad/ports-out/auth-provider.port.ts` | Modified | `signIn` + session return type; no `tx?` |
| `services/core-api/src/domains/identidad/adapters/persistence/supabase-auth.provider.ts` | Modified | Password grant + failure classification |
| `services/core-api/src/domains/identidad/ports-in/` | New | Session use case(s) |
| `services/core-api/src/domains/identidad/adapters/http/` | New/Modified | Route(s), DTOs, mapper, filter entries |
| `services/core-api/src/shared/supabase/supabase.module.ts` | Modified | Second, differently-scoped auth client (Q1) |
| `services/core-api/src/config/env.schema.ts`, `.env.example` | Modified | New var(s), fail-fast |
| `packages/auth/` | New | `@repon/auth` (D4) |
| `apps/usuario-mobile/app/`, `apps/proveedor-mobile/app/` | New/Modified | Login screen, route guard, session provider at root layout |
| `apps/*/package.json` | Modified | `@repon/auth`, `expo-secure-store`, test runner deps, `EXPO_PUBLIC_API_URL` |
| `apps/admin-web/SPEC.md`, `docs/ARCHITECTURE.md` | Modified | Declared deltas (D2) |
| `apps/*/SPEC.md`, `services/core-api/domains/identidad/SPEC.md` | Modified | Declared deltas |
| `supabase/`, `AuthGuard`, `JwtVerifier` | None | No migration, no guard change |

## Risks

| Risk | Likelihood / Impact | Mitigation |
|---|---|---|
| **R1 — Credentials now transit `core-api`.** A brute-force / credential-stuffing surface that GoTrue previously absorbed is now ours, with no rate limiting anywhere in `core-api` today. | High / **High** | Q3: rate limiting + lockout is a spec requirement of this change, not a follow-up. Never log the password or echo which factor failed. |
| **R2 — Refresh-token handling is reinvented.** Option 1 got GoTrue's rotation for free; the proxy must decide what the client stores and how rotation works. | High / High | Q2 fixes the contract before PR1. Prefer passing GoTrue's own refresh token through over inventing a scheme. |
| **R3 — First runtime workspace package under Metro (D4).** Symlink/hoisting resolution failures surface at bundle time, not typecheck, and would block both apps. | Medium / High | PR1 proves import + bundle in both apps before feature code. Fallback if it fights us: per-app `lib/auth/` re-export shims — decided in `sdd-design`, not improvised. |
| **R4 — Role gate is UX, not security.** A `'user'` token is a valid `core-api` token regardless of which app holds it. | High / Medium | Real boundary stays `AuthGuard` + per-route `@Roles`. The gate is stated as a product rule; Q4 decides whether the server also rejects. |
| **R5 — Documented-architecture correction (D2).** Editing `admin-web/SPEC.md` touches a pre-existing product contract SDD does not own. | Medium / Medium | Declared delta per `rules.specs`, scoped to the one sentence about mobile auth; admin-web's own service-role rule is untouched. |
| **R6 — Provider whose company is `pendiente`.** `registrarEmpresa` leaves companies `pendiente`; blocking their login leaves them no way to check approval status. | High / Medium | Q5. Proposed default: allow login, gate features. Must be decided, not defaulted silently. |
| **R7 — Extra hop and a new failure mode.** GoTrue outage now surfaces as a `core-api` 5xx; ambiguous failures need the same care `registrarUsuario` already takes. | Medium / Medium | Reuse the existing deterministic/ambiguous error split; map infra failure to 503, never to "wrong password". |
| **R8 — 400-line budget.** Backend + shared package + two apps + test scaffolding exceeds it comfortably. | High / Medium | Declared here; `sdd-tasks` owns the chain decision (`delivery_strategy: ask-on-risk`). |

## Rollback Plan

Greenfield, no production data, no existing sessions to invalidate. `git revert` of the chain returns both apps to their unauthenticated scaffolds and `identidad` to its current surface. Three items that do not revert cleanly:

1. **The env var** — reverting code without reverting deployment env is harmless (unused key), but reverting env without code halts boot by design (fail-fast). Revert code first.
2. **`@repon/auth`** — removing a workspace package after both apps import it is a two-app coordinated change; cheap while the chain is open, not after.
3. **The SPEC/doc deltas (D2)** — reverting them re-establishes a statement we have evidence is wrong. Prefer keeping the doc correction even if the code is reverted.

No migration, no `auth.users` writes, no `profiles` writes: this change only *reads* identity.

## Dependencies

- `backend-core-api-foundation` (archived): `AuthGuard`/`RolesGuard` as `APP_GUARD`, `ActorPort`, `IdentidadExceptionFilter`, `@Public()`, env fail-fast. **Present and verified.**
- Supabase GoTrue reachable from `core-api` with an anon-scoped key — **not currently configured**; provisioning it is part of this change.
- `@repon/types` (`workspace:*`) already consumed by both apps — the dependency edge exists, the runtime edge does not (D4).
- **No new backend runtime dependency** if Q1 picks direct GoTrue HTTP; one new client instance if it picks the SDK.

## Open Questions (for `sdd-design` / `sdd-spec`)

| # | Question | Owner |
|---|---|---|
| Q1 | **How does `core-api` perform the password grant?** (a) a second `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })` provider alongside `SUPABASE_CLIENT`, or (b) a direct `POST /auth/v1/token?grant_type=password` against GoTrue. Locally minting a JWT with `SUPABASE_JWT_SECRET` is **rejected** — it breaks under the documented `AUTH_JWT_MODE=jwks` production target. | `sdd-design` |
| Q2 | **Exact session contract**: does the client receive GoTrue's `refresh_token`? Route shape for refresh/logout (`POST /identidad/sesion/refresco`, `DELETE /identidad/sesion`)? Is logout server-side revocation or client-side discard? What identity fields does the login response carry (`role`, `status`, `companyId`, `companyStatus`)? | `sdd-design` |
| Q3 | **Rate limiting / lockout** (R1): per-IP, per-email, or both; threshold, window, and response shape. Nothing exists in `core-api` today. | `sdd-design` + `sdd-spec` |
| Q4 | **Where is the role gate enforced** — client-only, or does the endpoint accept an app/expected-role hint and reject server-side (R4)? And what does a suspended profile or suspended company get: a session plus a gated UI, or a refused login? | `sdd-spec` |
| Q5 | **Provider with `companies.status = 'pendiente'`** (R6): allowed in with a pending-approval screen, or refused? | `sdd-spec` + product |
| Q6 | **Error taxonomy visible to the app**: which failures are indistinguishable on purpose (wrong password vs. unknown email), and which are explicit (suspended, wrong app, backend down)? | `sdd-spec` |

## Success Criteria

- [ ] A registered `role='user'` signs in on `usuario-mobile`, lands in the user flow, and stays signed in across an app restart
- [ ] A registered `role='provider'` does the same on `proveedor-mobile`
- [ ] A `role='user'` credential entered into `proveedor-mobile` is **rejected with an explicit message**, tokens discarded, no partial session left behind — and the mirror case likewise; `role='admin'` is rejected by both
- [ ] Logout clears secure storage; relaunching lands on the login screen
- [ ] The `access_token` returned by `POST /identidad/sesion` authenticates an existing protected `core-api` route unmodified — no `AuthGuard`/`JwtVerifier` change
- [ ] No Supabase key of any kind ships in either mobile bundle
- [ ] Wrong password and unknown email are indistinguishable to the caller (Q6); a GoTrue outage returns 503, never "invalid credentials"
- [ ] Repeated failed logins are throttled (Q3), with a test proving it
- [ ] `apps/admin-web/SPEC.md:9` and the `docs/ARCHITECTURE.md` Auth row are corrected in-file, with the delta declared (D2)
- [ ] Both Expo apps have a working test runner and at least one real test each
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; the existing `identidad` suite passes unmodified
