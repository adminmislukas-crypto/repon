# Exploration: mobile-auth-login — login flow for usuario-mobile and proveedor-mobile

## Current State

**Backend auth verifies tokens; it does not issue login sessions.**
- `AuthGuard` (`services/core-api/src/shared/auth/guards/auth.guard.ts:38-117`) is a fail-closed `CanActivate`: extracts the Bearer token, verifies it via the injected `JwtVerifier`, resolves `ActorPort.findActorById(sub)`, and rejects on a missing/suspended profile. Not yet registered as `APP_GUARD` globally (comment at lines 24-36) — pending `IdentidadModule` wiring `ACTOR_PORT`.
- `JwtVerifier` mode is chosen once at boot via `selectJwtVerifier()` (`jwt-verifier.factory.ts:22-34`), driven by `AUTH_JWT_MODE`: `hs256` (local dev default, `.env.example:47`) or `jwks` (documented as "the production target, once the real Supabase project exists", `jwks-jwt.verifier.ts:11-12`). Both implementations only **verify** tokens issued elsewhere; neither mints tokens.
- `AuthenticatedActor` (`ports/actor.port.ts:11-26`) exposes `profileId`, `role: Role` (`'user'|'provider'|'admin'`), `status`, `companyId` (non-null iff provider), `companyStatus`, `adminRole`. No raw JWT claims cross the boundary.
- Core-api HAS a public self-registration endpoint, `POST /identidad/usuarios` (`identidad.controller.ts:71-81`, `@Public()`), which calls `SupabaseAuthProvider.createAccount()` — Supabase **Auth Admin API** (`supabase.auth.admin.createUser`, `supabase-auth.provider.ts:58-71`) via a **service-role** key (`supabase.module.ts:21-33`) — then inserts `profiles` transactionally with documented compensation logic (`identidad/SPEC.md:59-70`). This is the *only* way a `profiles` row can be created: migration `01a` grants `profiles` only a SELECT RLS policy (`profiles_authenticated_select_own`, lines 162-166) — **no INSERT policy exists for clients at all**. A client-side `supabase.auth.signUp()` would strand an `auth.users` row with no way to create its `profiles` counterpart.
- Core-api has **no login/sign-in endpoint anywhere** (grepped `login|signup|signIn|register` across `services/core-api/src` — only hits are the registration DTO/controller above). `AuthProvider` port (`ports-out/auth-provider.port.ts:26-31`) exposes only `createAccount`/`deleteAccount`/`findAccountByEmail` — no `signIn` method.
- Core-api's `SUPABASE_CLIENT` (`shared/supabase/supabase.module.ts:21-33`) is explicitly scoped to Auth Admin API + Storage, service-role key, `persistSession: false` — not shaped for a password-grant/session flow, and that key must never reach a mobile client.

**Identity/role model** (`supabase/migrations/20260803120100_01a_identidad_core.sql`):
- A single `auth.users` (Supabase GoTrue) is the identity source — confirmed by `profiles.id references auth.users(id)` (line 47) and by env var naming (`SUPABASE_JWT_SECRET`/`SUPABASE_JWKS_URL`/`AUTH_JWT_AUDIENCE=authenticated`, the standard GoTrue claim shape).
- `profiles` carries one `role` enum: `'user' | 'provider' | 'admin'` (lines 18, 48) — **not** separate tables per app. `company_id` is non-null iff `role='provider'` (enforced in core-api's use case, not a DB CHECK — comment at lines 60-61).
- Consequence: usuario-mobile and proveedor-mobile authenticate against the **same** identity system with **identical** login call shape. The distinction is purely **post-login routing** based on `profiles.role` — there is no separate provider-auth endpoint/scope, and nothing today stops a `role='user'` credential from being entered into proveedor-mobile (or vice versa); that check would be new app-level logic.

**Documented target architecture** (already written, not assumed):
- `apps/admin-web/SPEC.md:9`: "Las apps de usuario y proveedor acceden a Supabase directo desde el cliente con la clave pública (`anon key`), limitadas por RLS... Esa clave [service role] nunca se expone al navegador ni se usa desde el cliente."
- `docs/ARCHITECTURE.md:21`: Supabase `Auth` is documented for "Registro y sesión de usuarios y proveedores" — both registration and session for both app types.
- `docs/ARCHITECTURE.md:5,13` + `usuario-mobile/SPEC.md:43` ("Catálogo, ofertas, historial — TanStack Query contra Supabase"): mobile apps already plan direct-to-Supabase reads for data with no business logic, alongside core-api calls for mutations.

**Mobile scaffolding is genuinely empty:**
- `apps/usuario-mobile/app/` and `apps/proveedor-mobile/app/` contain only the default Expo Router `(tabs)` + mockup-derived screens — no auth file anywhere.
- Neither `package.json` has `@supabase/supabase-js`, `expo-secure-store`, or AsyncStorage (repo-wide grep confirms all hits are inside `services/core-api`/`pnpm-lock.yaml`'s core-api entry).
- `usuario.html` mockup has exactly one auth-adjacent string, "cerrar sesión" (logout, perfil screen, line 1444) — no login screen. `proveedor.html` has zero matches.
- `metro.config.js` in both apps is generic pnpm-hoisting/symlink config (`unstable_enableSymlinks`, `disableHierarchicalLookup`) — commit `9342f82` was not Supabase-specific. `@supabase/supabase-js` is pure JS (no native module needed); `expo-secure-store` is a first-party Expo module that works under Expo Go/dev-client without extra native config.
- `packages/` has exactly one real workspace package: `packages/types` (pure types, no runtime code — confirmed via `packages/*/package.json` glob). `packages/ui` is a `SPEC.md` placeholder only, no code yet. **There is no existing precedent for a shared runtime package in this repo** — a `packages/auth` would be the first.

## Affected Areas
- `apps/usuario-mobile/app/` — new login screen(s) + unauthenticated-route guard/redirect
- `apps/proveedor-mobile/app/` — same, for the provider app
- `apps/usuario-mobile/package.json`, `apps/proveedor-mobile/package.json` — new deps (`@supabase/supabase-js`, `expo-secure-store`)
- `packages/` — potential new `packages/auth` (or duplicated per-app `lib/auth/` if scope splits) — new pattern for this repo
- `services/core-api/src/domains/identidad/` — unaffected under the recommended option; only touched if the maintainer picks a backend-proxy option
- `apps/usuario-mobile/SPEC.md`, `apps/proveedor-mobile/SPEC.md` — need a documented login screen/flow (absent today)
- `supabase/` — no changes identified (no missing table/RLS policy found for login itself)

## Approaches

### 1. Supabase client SDK direct (matches documented architecture)
Mobile apps hold a `@supabase/supabase-js` client (anon key), call `supabase.auth.signInWithPassword()` directly, persist the session via `expo-secure-store` as a custom `Storage` adapter, and rely on `autoRefreshToken`. The resulting `access_token` is sent as a Bearer token to core-api, verified transparently by the existing `AuthGuard`/`JwtVerifier` — zero backend changes. Signup still goes through the existing `POST /identidad/usuarios` (required, since RLS blocks client-side `profiles` INSERT).

- Pros: matches explicit documented architecture (`admin-web/SPEC.md:9`, `docs/ARCHITECTURE.md:21`); zero backend work; reuses `AuthGuard`/JWKS verification unchanged; standard Supabase+Expo pattern; smallest surface area.
- Cons: anon key ships in the mobile bundle (already an accepted pattern elsewhere per SPEC, but worth review); refresh/expiry/deep-link logic must be handled client-side, twice, unless shared.
- Effort: Low–Medium.

### 2. Custom core-api login endpoint (proxy)
E.g. `POST /identidad/sesion` — credentials go to core-api, which calls Supabase Auth server-side and returns a token; mobile never talks to Supabase directly for auth.

- Pros: centralizes identity ops in core-api (symmetric with existing `/identidad/usuarios`); room for custom rate-limiting/audit.
- Cons: contradicts both documented architecture statements found above; `AuthProvider` port has no `signIn` method today — genuinely new backend surface, not something already stubbed; core-api's existing `SUPABASE_CLIENT` is deliberately Admin-API-scoped with `persistSession:false` — not built for this, likely needs a second, anon-scoped Supabase client inside core-api; reinvents refresh/rotation that GoTrue's SDK already does; adds a new backend PR.
- Effort: Medium–High.

### 3. Hybrid: direct login (Option 1) + thin core-api profile-bootstrap self-heal
Defensive endpoint for the edge case where a valid Supabase session exists with no matching `profiles` row.

- Pros: resilience against out-of-band account creation.
- Cons: speculative — no evidence this gap is real; `AuthGuard` already fails closed correctly today (`PROFILE_NOT_PROVISIONED`, 401, `auth.guard.ts:97-104`), which may be intended behavior, not a bug to fix.
- Effort: Medium (likely unnecessary without a concrete trigger).

## Recommendation

**Option 1** is recommended: the only approach matching architecture already committed to writing in this repo, requiring zero backend changes, reusing the built-and-tested `AuthGuard`/verifier path unchanged. Option 2 invents backend surface that contradicts documented intent. Option 3 should wait for a concrete gap to surface.

**Scope-split recommendation**: one SDD change covering both apps is reasonable and matches the request ("a single SDD cycle covering login for both apps") **if** the design lands on a shared module (`packages/auth` or equivalent) — both apps have byte-identical login mechanics (same `signInWithPassword` call, same session shape), so per-app duplication would be wasteful for this low-risk, mechanical surface. This does introduce a **new repo pattern** (first shared runtime package) that `sdd-design` should decide explicitly, not assume. Recommend `sdd-tasks` still slices delivery into separate PRs to respect the 400-line budget: PR1 shared auth module + session persistence, PR2 usuario-mobile login screen/guard, PR3 proveedor-mobile login screen/guard. **No backend PR is needed** in this chain under Option 1; if the maintainer instead picks Option 2/3, that becomes its own separate backend chain link (same pattern as the paused `backend-core-api-pedidos-pagos` chain).

## Risks
- The two "direct Supabase access" statements are strong but informal evidence (not a formal ADR) — confirm with the maintainer before locking in Option 1.
- No password-reset/email-verification/session-expiry UX exists in any mockup or SPEC — out of scope unless explicitly added.
- Nothing today stops a `role='user'` credential from logging into proveedor-mobile or vice versa — needs an explicit client-side post-login role check, not an afterthought.
- `AUTH_JWT_MODE=hs256` locally vs `jwks` as documented production target — irrelevant to the mobile login flow itself (mobile never sees this var) but worth the maintainer's awareness.
- `packages/auth` (if chosen) is a structural precedent (first shared runtime package) deserving explicit `sdd-design` sign-off, not an implementation detail.

## Ready for Proposal
Yes, pending three maintainer confirmations before `sdd-propose`:
1. Confirm Option 1 (direct Supabase login, no backend changes) vs override to Option 2/3.
2. Confirm scope: shared-package PR + two per-app login PRs (recommended) vs fully separate per-app changes.
3. Confirm whether password-reset/email-verification is in scope now or deferred.

---
*Persisted by the orchestrator on behalf of `sdd-explore` — the sub-agent's execution context had no reachable `Write`/`mem_save` tool despite its type definition listing them (see engram memory `feedback-sdd-subagent-mem-gap`). Content is verbatim from the sub-agent's final report.*
