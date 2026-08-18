# Design: mobile-auth-login

Builds on `proposal.md` (D1–D5 are locked and not re-opened). Resolves Q1, Q2, and the Q3 *mechanism*; Q4 business rule and Q6 stay with `sdd-spec`. Q3's numbers and Q5 are no longer open — `specs/core-api-sesion` fixed them (5/email, 20/IP, 15-min trailing window on **failed** attempts, reset on success), and D-3 is written against that wording, not around it.

> Size note: this artifact exceeds the usual 800-word design budget because the orchestrator scoped six distinct undesigned surfaces to this phase (Q1, Q2, Q3-mechanism, port taxonomy, `@repon/auth` internals + Metro proof, role-gate boundary). Content is compressed into tables rather than dropped.

## Technical Approach

`core-api` becomes the only party that speaks to Supabase GoTrue. Three new routes on the existing `IdentidadController` (same `@UseFilters(IdentidadExceptionFilter)`, same DTO/`class-validator` conventions as `POST /identidad/usuarios`) sit in front of an extended `AuthProvider` port. GoTrue's own tokens are passed through unchanged — the `access_token` is the same JWT `AuthGuard`/`JwtVerifier` already verify, so no guard, verifier, or `ActorPort` change. `@repon/auth` owns every client-side mechanic once, for both Expo apps.

## Architecture Decisions

### D-1 (Q1): password/refresh grants go over direct HTTP, not a second `supabase-js` client

**Choice** — a new stateless `GoTrueAuthClient` in `services/core-api/src/shared/supabase/gotrue-auth.client.ts` (token `GOTRUE_AUTH_CLIENT`, provided by the existing `@Global() SupabaseModule` next to `SUPABASE_CLIENT`). It uses Node 24's global `fetch` with `AbortSignal.timeout(5_000)` against:

| Operation | Request |
|---|---|
| password grant | `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`, headers `apikey` + `Authorization: Bearer` = `SUPABASE_ANON_KEY`, body `{ email, password }` |
| refresh grant | `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, same headers, body `{ refresh_token }` |
| revoke | `SUPABASE_CLIENT.auth.admin.signOut(accessToken, 'local')` — see rationale |

**Alternatives considered** — (a) a second `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })` provider; (b) local JWT minting with `SUPABASE_JWT_SECRET` (rejected by the proposal, not reconsidered).

**Rationale** — option (a) is disqualified by a verified concurrency defect for *server-side singleton* use. In `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js` (`_callRefreshToken`, ~line 4163):

```js
// refreshing is already in progress
if (this.refreshingDeferred) {
    return this.refreshingDeferred.promise;
}
```

The in-flight refresh is single-flighted **without keying on the refresh token**. On a shared DI-singleton client, two concurrent `refreshSession({ refresh_token })` calls for *different users* can resolve to the same session — a cross-tenant session leak. `GoTrueClient` is also stateful by design (`_saveSession`, `_notifyAllSubscribers`, `lastRefreshFailure` cache), all of which is dead weight or hazard on a server. Direct HTTP is stateless per call, adds **zero** new runtime dependencies, and its failure surface is trivially unit-testable by stubbing `globalThis.fetch` (strictly easier than stubbing `supabase-js`).

Revocation is the one deliberate asymmetry: `GoTrueAdminApi.signOut(jwt, scope)` (verified present in the installed `.d.ts`) is a stateless request wrapper on an *already-wired* credential, unlike the session-bearing `GoTrueClient` methods. Reusing it avoids a third bespoke HTTP path. The line is precise: `admin.*` yes, `auth.*` never.

**Rules this pins** — the raw password is never placed in a log, an `Error` message, or an error `cause`; only the GoTrue response body is chained. `GoTrueAuthClient` returns a normalised `{ ok, status, body }` — it never classifies; classification belongs to the identidad adapter (D-4).

**New env** — `SUPABASE_ANON_KEY` added to `baseEnvSchema` in `services/core-api/src/config/env.schema.ts` as `z.string().min(1, 'SUPABASE_ANON_KEY is required')`, i.e. required unconditionally in the same fail-fast class as `SUPABASE_SERVICE_ROLE_KEY`, plus a documented block in `services/core-api/.env.example`. Also `TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0)` (see D-3).

### D-2 (Q2): GoTrue's own `refresh_token` is passed through; three routes, one response shape

**Choice**

| Route | Auth | Status | Request | Response |
|---|---|---|---|---|
| `POST /identidad/sesion` | `@Public()` | 200 | `IniciarSesionDto` | `SesionResponseDto` |
| `POST /identidad/sesion/refresco` | `@Public()` | 200 | `RefrescarSesionDto` | `SesionResponseDto` |
| `DELETE /identidad/sesion` | authenticated | 204 | — | — |

```ts
class IniciarSesionDto {
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() password!: string;   // deliberately NO @MinLength — see below
  @IsOptional() @IsIn(['user', 'provider']) expectedRole?: SelfServiceRole;  // D-5
}

class SesionResponseDto {
  accessToken!: string;
  refreshToken!: string;      // GoTrue's own, rotated by GoTrue on every refresh
  tokenType!: 'bearer';
  expiresAt!: number;         // unix seconds, straight from GoTrue
  perfil!: ProfileResponseDto;          // reuses the existing DTO + `toProfileResponseDto`
  companyStatus?: CompanyStatus;        // non-null iff perfil.role === 'provider'
}
```

`@MinLength(8)` is deliberately **absent** on login (it is present on `RegistrarUsuarioDto`): a length rule on login turns a short-password guess into a distinguishable 400 while a wrong-but-long one is a 401, which leaks the policy and violates "wrong password and unknown email are indistinguishable".

**Refresh returns the same shape, re-resolving identity.** Cost: two indexed lookups per refresh (roughly hourly per user). Benefit: a suspension or company-status change lands at the next refresh instead of only at re-login, and the client has exactly one response parser.

**Logout is client-authoritative, server best-effort.** `DELETE /identidad/sesion` runs behind the existing `AuthGuard` and reads the raw bearer via a new `@BearerToken()` param decorator in `shared/auth/decorators/` (a decorator, not a change to `AuthGuard`/`JwtVerifier`/`ActorPort` — those three remain out of scope). It calls `AuthProvider.revokeSession(token)` and returns 204 **even if revocation fails**: a GoTrue outage must never trap a user in a signed-in state. Scope is `'local'`, not `'global'` — signing out of one device must not kill the user's other devices.

**Alternatives considered** — minting our own opaque refresh token backed by a new table (rejected: the proposal commits to *no migration*, and it means reimplementing rotation and reuse detection that GoTrue already ships); logout as pure client-side discard with no route (rejected: the proposal's scope explicitly includes a logout route).

**Rationale for pass-through** — GoTrue already rotates refresh tokens and detects reuse. A useful bounded property falls out: on hosted Supabase, GoTrue sits behind Kong, which rejects `/auth/v1/*` without an `apikey` header. Since `SUPABASE_ANON_KEY` never ships in either mobile bundle, an exfiltrated refresh token cannot be redeemed directly against Supabase — only through `core-api`, where D-3's limiter applies.

### D-3 (Q3): failure-only sliding-window limiter, one interceptor spanning both phases

**Verified**: this repo has no Redis, no `@nestjs/throttler`, no rate limiting of any kind (the only `rate_limit` hits are GoTrue's own settings in `supabase/config.toml`). Adding shared-store infrastructure is new infra the proposal did not budget.

**What the spec fixes** (`specs/core-api-sesion`, "Repeated failed logins are throttled per-email and per-IP"): reject when an email has **≥5 failed** attempts in the trailing 15 min, independently when an IP has **≥20 failed** attempts; the check must reject **even a correct password**; an unknown email must count identically to a real one; and **a successful login MUST reset that email's counter**. Three mechanism constraints fall out, and D-3 is shaped by them: only *failures* increment, the check runs *before* the attempt and is unconditional, and success resets.

**Choice — one route-scoped `RateLimitInterceptor` owns check, record, and reset.** Only an interceptor spans both halves of the Nest request lifecycle, which is exactly what a check-then-record policy needs:

| Lifecycle position | What happens |
|---|---|
| global guards (`AuthGuard`, `RolesGuard`) | short-circuit on `@Public()`; unchanged, and still first |
| **`RateLimitInterceptor` · PRE** — synchronous, before `next.handle()`, therefore before `ValidationPipe` and before the handler | derive keys, `peek` each, throw 429 if any key is at/over its limit. **Never increments.** GoTrue is never called for a locked-out attempt |
| pipes → controller → `IniciarSesionUseCase` → GoTrue | unchanged |
| **`RateLimitInterceptor` · POST** — `tap` on the handler's stream | emitted a value ⇒ `reset` the email key; threw ⇒ `record` on every key **iff** `countsAsFailure(error)` |

Because PRE throws *before* `next.handle()`, a 429 rejection never reaches POST: **a lockout can never extend itself.** Without that property, a window anchored on the latest failure would keep a hammered account locked indefinitely under continued hammering.

**Alternatives considered**

| Option | Rejected because |
|---|---|
| `RateLimitGuard` (pre) + separate interceptor (post) — the previous draft's split | two classes must derive *byte-identical* keys; sharing them means stashing on `req` under a symbol. That implicit contract silently breaks the mandated reset if either derivation drifts. One class, one derivation, no coupling |
| record from inside `IniciarSesionUseCase` | `ports-in/` would take a transport dependency (`req.ip`) and re-implement key hashing, and it cannot observe failures thrown outside itself (validation, later filters) |
| record from `IdentidadExceptionFilter` | it `@Catch()`es only named domain classes, so outage/validation paths are invisible to it — and a filter has no success branch, so the reset MUST would have nowhere to live |
| `@nestjs/throttler` | counts requests, not outcomes, and exposes no post-outcome hook; a new dependency for a mechanism we would still have to bend |

**Failure classification is delegated, so `shared/` never imports `domains/`.** The predicate travels in the metadata:

```ts
// shared/rate-limit/rate-limit.decorator.ts
export interface RateLimitKeySpec { scope: string; dimension: 'ip' | 'email'; limit: number; windowMs: number; }
export interface RateLimitOptions {
  keys: readonly RateLimitKeySpec[];
  resetOnSuccess: readonly ('ip' | 'email')[];      // login: ['email']
  countsAsFailure: (error: unknown) => boolean;      // supplied by the route's own domain
}

// identidad.controller.ts — login
@RateLimit({
  keys: [
    { scope: 'sesion', dimension: 'email', limit: 5,  windowMs: 900_000 },
    { scope: 'sesion', dimension: 'ip',    limit: 20, windowMs: 900_000 },
  ],
  resetOnSuccess: ['email'],
  countsAsFailure: (e) => e instanceof CredencialesInvalidasError,
})
```

What that predicate deliberately excludes:

| Outcome | Recorded? | Why |
|---|---|---|
| 401 `CREDENCIALES_INVALIDAS` — wrong password **or unknown email** | **yes** | the attack being throttled. D-4 collapses both to one class, so an unknown email locks out identically and lockout state leaks no account existence (spec scenario) |
| 503 `AUTH_PROVIDER_NO_DISPONIBLE` | no | a GoTrue outage would otherwise lock out every account it touched |
| 403 `PROFILE_SUSPENDED` / `COMPANY_SUSPENDED` / `ROL_NO_PERMITIDO` | no | the password was correct; this is not credential guessing |
| 400 validation | no | not an attempt (`BadRequestException` fails the `instanceof`) |
| 429 itself | no | structurally unreachable — PRE throws before POST exists |

**Reset lives on the interceptor's success branch, not in the use case.** Two reasons, both load-bearing: it reuses the *exact* key the PRE phase computed (a second derivation is the one way this MUST could silently fail), and "the handler emitted a response" is the precise definition of a successful login — a suspended profile or a role mismatch throws, so neither resets. Only the **email** key resets. The IP key keeps accumulating: the spec mandates no IP reset, and letting one valid credential clear an IP budget would hand an attacker holding any account a free reset.

**Store port — a pruned ring of failure timestamps; not a bucket, not a decaying counter.**

```ts
// shared/rate-limit/rate-limit-store.port.ts
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');
export interface RateLimitWindow { readonly windowMs: number; readonly limit: number; }
export interface RateLimitStore {
  peek(key: string, w: RateLimitWindow): Promise<{ count: number; retryAfterMs: number }>;
  record(key: string, w: RateLimitWindow): Promise<void>;
  reset(key: string): Promise<void>;
}
```

| Structure | Verdict |
|---|---|
| fixed window `{ count, resetAt }` (previous draft) | **rejected — spec-violating**: with a bucket boundary at 15:00, 4 failures at 14:59 plus 4 at 15:01 is 8 failures in two minutes and trips nothing, while the bucket reset also discards still-qualifying history. It cannot express "trailing 15 minutes" at all |
| decaying / leaky counter | approximate by construction: it cannot answer "≥5 in the trailing window" exactly, nor produce an exact `Retry-After` |
| **sorted list of failure timestamps, pruned on read** | exact, and bounded *by construction* — only the **most recent `limit`** timestamps are ever retained (5 or 20 numbers per key), because a 6th is irrelevant to a ≥5 predicate |

`InMemoryRateLimitStore` is a `Map<string, number[]>`. `peek` drops entries older than `now - windowMs`, deletes the key when the array empties, and returns `count` plus `retryAfterMs = timestamps[count - limit] + windowMs - now` (`0` while under the limit). `record` appends `now` and trims to the newest `limit`. Eviction is unchanged from the previous draft: **on access, plus a bounded sweep once a size cap is crossed — still no `setInterval`**, because a timer keeps the Jest worker alive and complicates e2e teardown. The port stays `Promise`-returning although the adapter is synchronous, so Redis remains a one-line provider swap — and the timestamp-list shape was chosen partly *because* it maps 1:1 onto a sorted set: `peek` = `ZREMRANGEBYSCORE` + `ZCARD`, `record` = `ZADD` + `ZREMRANGEBYRANK` + `EXPIRE`, `reset` = `DEL`.

**Window semantics, stated once so no test has to guess** — the predicate is the spec's own normative sentence: reject iff `count(failures with ts > now - windowMs) >= limit`. The lockout therefore releases when the `limit`-th most recent failure ages out, which is exactly the `retryAfterMs` above. Since a 429 is never recorded, no attempt made *during* a lockout extends it, so the spec's "sliding window from the most recent qualifying failure" phrasing and this trailing-count phrasing agree on every scenario the spec lists.

**Keys** — per-IP **and** per-email as independent counters; either may reject. Email is `trim().toLowerCase()` then SHA-256 (`node:crypto`), so no plaintext PII sits in memory or in a 429 log line. Per-email stops distributed stuffing against one account; per-IP stops one host enumerating many accounts. Keys are route-scoped (`sesion:email:<hash>`, `sesion:ip:<ip>`, `refresco:ip:<ip>`): the spec's 20/IP is about *login* attempts, and folding refresh failures into it would let one buggy client's refresh loop lock a whole NAT'd office out of login. `POST /identidad/sesion/refresco` therefore carries the IP key only — its body has no email — with `countsAsFailure: (e) => e instanceof SesionExpiradaError` and the same 20 / 15 min budget (design-chosen; the spec is silent on refresh). Mounting stays per-route, never an `APP_GUARD`-style global: global throttling is a larger, separate decision.

**Missing or invalid email in PRE** — the interceptor runs before `ValidationPipe`, so `req.body.email` may be absent or non-string. The email key is then simply skipped (the request is about to 400 anyway) and only the IP key applies. Key derivation never throws.

**Fail-open on store errors** — a `peek` rejection logs and allows; a `record`/`reset` rejection logs and is swallowed. A limiter outage must never deny logins nor turn a 401 into a 500 — the same best-effort discipline as D-4a's revocation. POST-phase writes are not awaited before the response is written.

**429 shape** — `DemasiadosIntentosError extends HttpException` lives in `shared/rate-limit/`, carrying `{ statusCode: 429, code: 'DEMASIADOS_INTENTOS', message }`, which `GlobalExceptionFilter` emits verbatim (its `isErrorBody` guard passes the payload through untouched). `shared/auth/auth.errors.ts` stays untouched — `AuthErrorCode` is documented as the closed set of `AuthGuard`/`RolesGuard` rejections, and this is neither. The interceptor sets `Retry-After: ceil(retryAfterMs / 1000)` before throwing.

**Trust-proxy hazard (must not be skipped)** — Express `req.ip` returns the socket peer unless `trust proxy` is configured. Behind a load balancer with the default, *every* request shares one IP and the per-IP counter degrades into a global lockout. `main.ts` therefore builds the app as `NestFactory.create<NestExpressApplication>(AppModule)` and calls `app.set('trust proxy', config.get('TRUST_PROXY_HOPS'))`; when hops is `0` the per-email counter is the load-bearing one and per-IP is documented as best-effort.

**Accepted limitations, stated loudly** — (a) in-process counters mean N instances multiply the effective threshold by N and a restart clears them; acceptable today (single instance, no shared store in infra), and the port is the reversibility. (b) `peek`-then-`record` is check-then-act, so a simultaneous burst can overshoot the limit by roughly the number of in-flight attempts before the first one records. Bounded, self-correcting on the next attempt, and not worth a lock in-process.

### D-4: `AuthProvider.signIn` and the credential-failure taxonomy

```ts
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;   // unix seconds
  readonly userId: string;      // GoTrue user.id === profiles.id
}

export interface AuthProvider {
  createAccount(email: string, password: string): Promise<string>;
  deleteAccount(id: string): Promise<void>;
  findAccountByEmail(email: string): Promise<{ id: string } | null>;
  signIn(email: string, password: string): Promise<AuthSession>;          // new
  refreshSession(refreshToken: string): Promise<AuthSession>;             // new
  revokeSession(accessToken: string): Promise<void>;                      // new
}
```

No `tx?` on any of the three — Auth stays outside the SQL transaction, preserving and reinforcing the existing rule.

`SupabaseAuthProvider` classifies exactly as `classifyCreateAccountError` already does — **by HTTP status class, never by message text**:

| GoTrue outcome | Adapter throws | Use case maps to | HTTP + code |
|---|---|---|---|
| 400/401, `error_code`/`error` ∈ {`invalid_grant`, `invalid_credentials`} | `AuthProviderDeterministicError('invalid_credentials')` | `CredencialesInvalidasError` | 401 `CREDENCIALES_INVALIDAS` |
| any other 4xx (`email_not_confirmed`, `user_banned`, …) | `AuthProviderDeterministicError('other')` | `CredencialesInvalidasError` | 401 (collapsed on purpose; splitting is Q6/spec) |
| 429 from GoTrue itself | `AuthProviderAmbiguousError` | `AuthProviderNoDisponibleError` | 503 `AUTH_PROVIDER_NO_DISPONIBLE` |
| **5xx, `fetch` rejection, or `AbortSignal.timeout`** | `AuthProviderAmbiguousError` | `AuthProviderNoDisponibleError` | **503** — never "invalid credentials" |
| refresh: 400/401 (expired/reused/rotated-away token) | `AuthProviderDeterministicError('invalid_credentials')` | `SesionExpiradaError` | 401 `SESION_EXPIRADA` |
| grant OK but no `profiles` row (the `v_auth_orphans` case) | — | `CredencialesInvalidasError` + server-side `logger.warn` | 401 (never a 500, never a leaky 404) |
| grant OK, `profiles.status = 'suspendido'` (post-grant, from `ActorPort`) | — | `PerfilSuspendidoError` + revoke (D-4a) | 403 `PROFILE_SUSPENDED` |
| grant OK, `role='provider'` and `companies.status = 'suspendido'` | — | `EmpresaSuspendidaError` + revoke (D-4a) | 403 `COMPANY_SUSPENDED` |

The outage-vs-bad-credentials split is therefore structural, not heuristic: **a response was received with 4xx ⇒ deterministic; no response, or 5xx/429 ⇒ ambiguous ⇒ 503.** This is the same predicate the existing `createAccount` path uses, so one reviewer reads one rule.

Five new plain-`Error` classes land in `domain/identidad.errors.ts` — the three above plus D-4a's `PerfilSuspendidoError` / `EmpresaSuspendidaError` (zero framework imports, per the hexagonal rule) — and get one `@Catch()` entry plus one `ERROR_STATUS_MAP` row each in `IdentidadExceptionFilter`; the filter's own comment sanctions this ("a 7th error class is a one-line append"). Existing `AuthProviderError` (502) and `RegistroFallidoError` (503) are **not** reused: 502 contradicts the proposal's explicit 503 criterion, and `RegistroFallidoError`'s message is registration-specific.

**Naming note, flagged not silent**: the proposal's prose says `RegistrarSesionUseCase`; this design uses `IniciarSesionUseCase` / `RefrescarSesionUseCase` / `CerrarSesionUseCase`. `Registrar*` already means account creation in this domain (`RegistrarUsuarioUseCase`, `RegistrarEmpresaUseCase`); reusing it for login would collide semantically. Spanish domain language is preserved either way.

### D-4a: suspension is refused at session issuance, and the refusal revokes the just-minted grant

Closes spec `core-api-sesion` outcome class (3) — "Suspended profile is refused, not gated" and "Suspended company is refused, not gated", both with *no session material issued*.

**Choice** — two new plain-`Error` domain classes, thrown by the use case, mapped by `IdentidadExceptionFilter`:

| Condition (post-grant, read from `ActorPort`) | Use case throws | HTTP + code |
|---|---|---|
| `status === 'suspendido'` (any role) | `PerfilSuspendidoError` | 403 `PROFILE_SUSPENDED` |
| `role === 'provider'` **and** `companyStatus === 'suspendido'` | `EmpresaSuspendidaError` | 403 `COMPANY_SUSPENDED` |

**Alternatives considered** — throwing the shared kernel's `AuthError(403, 'PROFILE_SUSPENDED', …)` directly from the use case, i.e. the exact call `AuthGuard` already makes (`shared/auth/guards/auth.guard.ts:106-110`), with a parallel `COMPANY_SUSPENDED` added to `AuthErrorCode`.

**Rationale — rejected on layering, reused on the wire.**

- `AuthError extends HttpException` (`shared/auth/auth.errors.ts:1,20`). Throwing it from `ports-in/` would import a framework type into the one layer `core-api-hexagonal-layout` forbids it in — the same rule that already forces *every* identidad error to be a plain `Error` (`identidad-exception.filter.ts:43-47`). `AuthErrorCode` is also documented as the closed set of "`AuthGuard`/`RolesGuard` rejections"; a use case is neither, so widening that union would blur the boundary the guard spec draws. **`shared/auth/auth.errors.ts` is therefore not modified.**
- The company half has no `AuthError` to reuse at all, and that is deliberate, not an omission: `shared/auth/ports/actor.port.ts:18-23` and `auth.guard.ts:112-113` both state that `companyStatus` is loaded but never enforced by the guard because "blocking on it is a business rule owned by each use case". D-4a is that owned rule being exercised at the one use case that owns session issuance — it does not move the authorization boundary (R4).
- What *is* reused is the only part clients depend on: the `code`. `PROFILE_SUSPENDED` is emitted verbatim, so one 403 code means one thing whether it comes from login or from `AuthGuard` on a later request, and `@repon/auth` keeps a single branch. `COMPANY_SUSPENDED` is its symmetric sibling and matches the existing `COMPANY_NOT_SUSPENDED` map row. Class names stay Spanish alongside D-4's siblings while the wire codes stay English; this is the one place that divergence is intentional, because the code is a client contract and the class name is domain vocabulary.

**Where it runs** — a pure `assertSesionPermitida({ role, status, companyStatus })` in `domain/sesion-elegibilidad.ts`, zero framework imports, shared by `IniciarSesionUseCase` **and** `RefrescarSesionUseCase`. Same pattern and same reason as `assertProviderHasCompany` (`domain/profile.entity.ts:24`): the assertion is exported separately so each caller can run it at the exact moment that is correct for it. Running it on refresh is what makes D-2's "a suspension lands at the next refresh" true rather than aspirational.

**Ordering, and why it is load-bearing** — the check runs immediately after `ActorPort.findActorById` resolves, i.e. **before** the `ProfileRepository` read and **before** D-5's `expectedRole` comparison:

1. `status` first — an account-level state and the most actionable message; the optional, client-supplied `expectedRole` must never be able to mask it.
2. `companyStatus` second, and only for `role === 'provider'` (it is `null` for every other role).
3. `expectedRole` last (D-5) — the weakest of the three, since the client may simply omit the field.

Precedence only decides *which* message a refused caller sees; all three refuse. No enumeration leak, because all three are reachable only with the correct password.

**No session material leaves the use case, and none is left behind at GoTrue.** By the time this check runs, step 1 has already minted a grant. Both refusals therefore take D-5's exact exit: best-effort `AuthProvider.revokeSession(accessToken)` with scope `'local'`, then throw. Skipping that would satisfy "no session in the response" while a live refresh token survived at GoTrue — precisely the partial-session hazard D-5 exists to prevent. Revocation failure is logged and swallowed; the 403 is unconditional.

**Consequences this pins** — a 200 response can never carry `perfil.status: 'suspendido'` nor `companyStatus: 'suspendido'`; on success `companyStatus ∈ {'activo', 'pendiente'}` only. `'pendiente'` is explicitly a **success** (spec: "A pending company is allowed to log in"), since a provider must be able to sign in to see its own approval state. Client side: a 403 returned by `POST /identidad/sesion/refresco` is terminal → `signOut()`, never a retry — consistent with D-6's existing "403 never triggers refresh" and "failed refresh → signOut" rules.

### D-5: the role gate is UX; the server hook exists and is still not a security boundary

| Layer | What it enforces | Is it a security boundary? |
|---|---|---|
| `AuthGuard` (`APP_GUARD`) + `RolesGuard` + `@Roles`/`@AdminRoles` | token validity, actor resolution, per-route authority | **Yes — unchanged, and the only one** |
| `expectedRole` on `IniciarSesionDto` | server compares against resolved `profiles.role`; on mismatch calls `revokeSession` on the just-issued session, then throws `RolNoPermitidoError` (403) | **No** — the client supplies the field and can simply omit it |
| `@repon/auth` role gate | discards tokens, shows an explicit message, blocks navigation | **No** — pure UX |

Making this explicit is the point: a `role='user'` token is a fully valid `core-api` token no matter which app holds it. The server-side hook exists for two concrete reasons — a clean, specific error message instead of a generic post-login dead-end, and **no partial session left behind** (a literal success criterion): without server-side revocation, a rejected cross-app login has still minted a live refresh token. Whether the field is *required* and what a mismatch returns is Q4, owned by `sdd-spec`; this design only guarantees the field, the comparison point, and the revoke-on-mismatch mechanism exist.

### D-6: `@repon/auth` internal architecture

```
packages/auth/
├── package.json         # @repon/auth, private, type: module,
│                        # main + types + exports all -> ./src/index.ts (source-only, mirrors @repon/types)
├── tsconfig.json        # extends ../../tsconfig.base.json, jsx: react-jsx
└── src/
    ├── index.ts             barrel
    ├── config.ts            AuthConfig { apiBaseUrl, expectedRole }
    ├── session.types.ts     Sesion / PerfilSesion (reuse Role, ProfileStatus, CompanyStatus from @repon/types)
    ├── session-storage.ts   expo-secure-store, ONE key 'repon.session'
    ├── session-storage.web.ts   localStorage fallback  <-- see below
    ├── session-client.ts    iniciarSesion / refrescarSesion / cerrarSesion (fetch, no RN imports)
    ├── api-client.ts        authFetch(): bearer injection, proactive + reactive refresh
    ├── session-context.tsx  <SessionProvider>, useSession()
    └── role-gate.tsx        <RequireSession>
```

| Point | Decision |
|---|---|
| Storage shape | one JSON blob `{ accessToken, refreshToken, expiresAt, perfil }` under one SecureStore key. One write = atomic replacement, so token rotation can never persist a half-updated pair. Comfortably under SecureStore's ~2 KB Android value warning |
| Refresh single-flight | one instance-scoped `inFlight: Promise<Sesion> \| null`. Correct here precisely because the device has exactly one session — the mirror image of why D-1 rejects the same pattern server-side |
| Refresh-on-401 | `authFetch` retries **once** after a successful refresh. A second 401, or a failed refresh, calls `signOut()` (clear storage, state → unauthenticated). Never loops |
| 403 is not 401 | a 403 `PROFILE_SUSPENDED` MUST NOT trigger refresh — `AuthGuard`'s own comment explains suspension is 403 exactly to avoid a client refresh-retry loop. Honoured explicitly |
| Proactive refresh | refresh when `expiresAt - now < 60s` before issuing, so the common path is not a 401 round-trip |
| Rehydration | `SessionProvider` reads storage once at mount; state is `'loading' \| 'authenticated' \| 'unauthenticated'`; the root layout holds the splash until it leaves `'loading'`. This is what makes "survives app restart" true |
| Config injection | apps read `EXPO_PUBLIC_API_URL` (Expo inlines `EXPO_PUBLIC_*` at bundle time) and pass it as a prop. The package never reads `process.env`, so it stays app-agnostic and testable |
| Web target | **`expo-secure-store` is a native module and does not work on web**, and both apps ship a web target (`app.json` `web.bundler: metro`, `web` script in both `package.json`s). `session-storage.web.ts` is therefore mandatory, not optional — Metro resolves the platform extension automatically. Without it, `expo start --web` breaks on both apps |
| Testability | nothing outside `*.tsx` imports `react-native`, so storage/client/refresh logic unit-tests under plain Jest `testEnvironment: node` |

### D-7 (R3): how PR1 proves the Metro/pnpm wiring before any auth code

PR1 contains **no auth logic**. It ships `packages/auth` with exactly:

```ts
// src/index.ts
export const REPON_AUTH_PACKAGE_ID = '@repon/auth';
export function reponAuthReady(): boolean { return true; }
export { AuthWiringProbe } from './wiring-probe.js';   // a trivial <Text> component
```

A `.tsx` file is included on purpose: JSX transpilation of a *workspace package* through `babel-preset-expo` is a different code path from a plain `.ts` module, and it is the one that fails first. Both apps add `"@repon/auth": "workspace:*"` and render both exports in `app/(tabs)/perfil.tsx`.

PR1 acceptance gates — **all four**, before any auth code lands:

1. `pnpm typecheck` green (compile-time edge; already proven by `@repon/types`).
2. `pnpm --filter usuario-mobile exec expo export --platform web` succeeds and the bundle contains `REPON_AUTH_PACKAGE_ID`'s value — the actual **runtime bundle** proof.
3. Same for `proveedor-mobile`.
4. Jest + RNTL (scaffolded in this same PR per `openspec/config.yaml` `rules.tasks`) renders the screen and asserts the imported value. Jest resolution (`transformIgnorePatterns`, `moduleNameMapper`) is a **separate** problem from Metro's and is the one most likely to bite.

`nodeLinker: hoisted` (`pnpm-workspace.yaml`) materially de-risks this: `@repon/auth` lands as a symlink in the workspace-root `node_modules/`, which each app's existing `metro.config.js` already handles (`unstable_enableSymlinks: true`, `nodeModulesPaths` includes the workspace root, `watchFolders` includes it).

**Fallback ladder — decided here, not improvised** (proposal R3):

| Symptom | Step |
|---|---|
| `Unable to resolve module @repon/auth` | (a) ensure `"main": "./src/index.ts"` sits alongside `"exports"` — some Metro resolver paths still prefer `main`; `@repon/types` has no `main` today and never needed one because it is type-only |
| still unresolved | (b) `config.resolver.extraNodeModules = { '@repon/auth': path.resolve(workspaceRoot, 'packages/auth') }` in both `metro.config.js` |
| resolves but fails to parse TS/JSX | (c) add `babel.config.js` with `babel-preset-expo` to each app — **neither app has one today (verified)** |
| (a)–(c) all fail | (d) proposal's named fallback: `apps/*/lib/auth/index.ts` re-export shims (~3 lines each). This moves the resolution boundary; it does **not** duplicate logic |
| (d) fails too | **escalate — do not copy the code into both apps.** Divergent security-critical token handling is the one outcome D4 exists to prevent |

## Data Flow

```
LOGIN
  usuario-mobile / proveedor-mobile
    │ POST {EXPO_PUBLIC_API_URL}/identidad/sesion  { email, password, expectedRole }
    ▼
  RateLimitInterceptor · PRE  (runs before ValidationPipe and before the handler)   [D-3]
    │ keys  sesion:email:<sha256(lower(email))>   limit 5  / 15 min
    │       sesion:ip:<req.ip>                    limit 20 / 15 min
    ├── any key at/over limit ──▶ 429 DEMASIADOS_INTENTOS + Retry-After
    │        (GoTrue is never called; nothing is recorded, so a lockout
    │         can never extend itself — PRE throws before POST can run)
    │ ok — peek only, NO increment
    ▼
  IdentidadController.iniciarSesion  ──▶ IniciarSesionUseCase
    │ 1. AuthProvider.signIn(email, password)
    │      └─▶ SupabaseAuthProvider ─▶ GoTrueAuthClient
    │              POST {SUPABASE_URL}/auth/v1/token?grant_type=password
    │              apikey: SUPABASE_ANON_KEY            ┌──────────┐
    │              ◀── { access_token, refresh_token }  │  GoTrue  │
    │                                                   └──────────┘
    │      4xx ⇒ Deterministic ⇒ 401 CREDENCIALES_INVALIDAS
    │      5xx / timeout ⇒ Ambiguous ⇒ 503 AUTH_PROVIDER_NO_DISPONIBLE
    │ 2. ActorPort.findActorById(userId)        role / status / companyId / companyStatus (1 JOIN)
    │ 3. assertSesionPermitida(actor)                                            [D-4a]
    │      status === 'suspendido'                  ⇒ revokeSession(...) then 403 PROFILE_SUSPENDED
    │      provider && companyStatus 'suspendido'   ⇒ revokeSession(...) then 403 COMPANY_SUSPENDED
    │      companyStatus 'pendiente'                ⇒ pass through (success, gated client-side)
    │ 4. ProfileRepository.findById(userId)     nombre / email / telefono
    │ 5. expectedRole mismatch? ⇒ revokeSession(...) then 403 ROL_NO_PERMITIDO   [D-5, rule = spec]
    ▼
  RateLimitInterceptor · POST  (tap on the handler's stream)                      [D-3]
    │ handler emitted a value  ⇒ reset(sesion:email:…)   ← spec's "success resets the email
    │                                                       counter"; IP is NOT reset
    │ handler threw            ⇒ record(both keys) iff countsAsFailure(e)
    │        countsAsFailure = e instanceof CredencialesInvalidasError
    │        so: 401 recorded · 503 no · 403 no · 400 no · 429 unreachable
    ▼
  200 SesionResponseDto  { accessToken, refreshToken, expiresAt, perfil, companyStatus }
      invariant: perfil.status is always 'activo'; companyStatus ∈ {'activo','pendiente'}
    │
    ▼
  @repon/auth session-storage → expo-secure-store, ONE key, ONE atomic JSON write
    │
    ▼
SUBSEQUENT AUTHENTICATED REQUEST  (unchanged machinery)
  authFetch → Authorization: Bearer <accessToken>
    ▼
  AuthGuard (APP_GUARD)  → JwtVerifier.verify  → ActorPort.findActorById → request.actor
  RolesGuard (APP_GUARD) → @Roles / @AdminRoles
    ▼
  existing catalogo / consumo / refill / ofertas handler

  401 ⇒ authFetch refreshes once (single-flight) → POST /identidad/sesion/refresco → retry once
          same RateLimitInterceptor, IP key only (no email in the body):
            PRE  refresco:ip:<req.ip>  limit 20 / 15 min
            POST record iff e instanceof SesionExpiradaError; no reset on success   [D-3]
          refresh re-runs steps 2–3, so a suspension lands here too ⇒ 403 ⇒ terminal signOut()
  403 ⇒ NO refresh (PROFILE_SUSPENDED / COMPANY_SUSPENDED) → surface to UI
```

## File Changes

| File | Action | Description |
|---|---|---|
| `services/core-api/src/shared/supabase/gotrue-auth.client.ts` | Create | Stateless `fetch` client for the two grants (D-1) |
| `services/core-api/src/shared/supabase/supabase.module.ts` | Modify | Provide + export `GOTRUE_AUTH_CLIENT` alongside `SUPABASE_CLIENT` |
| `services/core-api/src/shared/rate-limit/rate-limit-store.port.ts` | Create | `RATE_LIMIT_STORE`, `RateLimitWindow`, `peek`/`record`/`reset` (D-3) |
| `services/core-api/src/shared/rate-limit/in-memory-rate-limit.store.ts` | Create | `Map<string, number[]>` sliding ring, pruned on read, capped at `limit`, no `setInterval` (D-3) |
| `services/core-api/src/shared/rate-limit/rate-limit.decorator.ts` | Create | `@RateLimit({ keys, resetOnSuccess, countsAsFailure })` metadata (D-3) |
| `services/core-api/src/shared/rate-limit/rate-limit.interceptor.ts` | Create | **Both phases**: PRE peek-and-429, POST record-on-qualifying-failure / reset-email-on-success (D-3) |
| `services/core-api/src/shared/rate-limit/demasiados-intentos.error.ts` | Create | `HttpException` carrying `{ 429, 'DEMASIADOS_INTENTOS', message }`; `auth.errors.ts` untouched (D-3) |
| `services/core-api/src/shared/rate-limit/rate-limit.module.ts` | Create | Binds `RATE_LIMIT_STORE` → in-memory adapter; exports the interceptor (D-3) |
| `services/core-api/src/shared/auth/decorators/bearer-token.decorator.ts` | Create | `@BearerToken()` for logout revocation (D-2) |
| `services/core-api/src/config/env.schema.ts`, `.env.example` | Modify | `SUPABASE_ANON_KEY` (required), `TRUST_PROXY_HOPS` (default 0) |
| `services/core-api/src/main.ts` | Modify | `NestFactory.create<NestExpressApplication>` + `app.set('trust proxy', TRUST_PROXY_HOPS)` |
| `services/core-api/src/domains/identidad/ports-out/auth-provider.port.ts` | Modify | `AuthSession` + `signIn`/`refreshSession`/`revokeSession`, no `tx?` (D-4) |
| `…/adapters/persistence/supabase-auth.provider.ts` | Modify | Grant calls + status-class classification (D-4) |
| `…/domain/identidad.errors.ts` | Modify | `CredencialesInvalidasError`, `SesionExpiradaError`, `AuthProviderNoDisponibleError`, `PerfilSuspendidoError`, `EmpresaSuspendidaError` (+ `RolNoPermitidoError` if spec keeps D-5's 403) |
| `…/domain/sesion-elegibilidad.ts` | Create | Pure `assertSesionPermitida(...)`, zero framework imports; shared by login + refresh (D-4a) |
| `…/adapters/http/identidad-exception.filter.ts` | Modify | One `@Catch()` entry + one map row per new error, incl. 403 `PROFILE_SUSPENDED` / `COMPANY_SUSPENDED` |
| `services/core-api/src/shared/auth/auth.errors.ts` | **Unchanged** | Listed to be explicit: D-4a reuses the `PROFILE_SUSPENDED` *code*, never the `AuthError` class — no shared-kernel edit |
| `…/ports-in/{iniciar,refrescar,cerrar}-sesion.use-case.ts` | Create | Session use cases; login + refresh both call `assertSesionPermitida` then revoke-on-refusal (D-4a) |
| `…/adapters/http/dto/{iniciar-sesion,refrescar-sesion,sesion-response}.dto.ts` | Create | DTOs, same `class-validator` + `@ApiProperty` conventions as `RegistrarUsuarioDto` |
| `…/adapters/http/identidad.controller.ts` | Modify | 3 routes + `@UseInterceptors(RateLimitInterceptor)` and `@RateLimit(...)` on the two public ones (the `countsAsFailure` predicate is supplied here, so `shared/` never imports `domains/`) |
| `…/adapters/http/identidad.mapper.ts` | Modify | `toSesionResponseDto` (reuses `toProfileResponseDto`) |
| `…/identidad.module.ts` | Modify | Register the 3 use cases; import `RateLimitModule` |
| `packages/auth/**` | Create | `@repon/auth` (D-6) |
| `apps/{usuario,proveedor}-mobile/package.json` | Modify | `@repon/auth`, `expo-secure-store`, Jest + RNTL, `EXPO_PUBLIC_API_URL` |
| `apps/{usuario,proveedor}-mobile/app/_layout.tsx` | Modify | Mount `SessionProvider` with the app's `expectedRole`; hold splash while `'loading'` |
| `apps/{usuario,proveedor}-mobile/app/login.tsx` | Create | Login screen |
| `apps/admin-web/SPEC.md`, `docs/ARCHITECTURE.md` | Modify | Declared deltas (proposal D2) |

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit | `GoTrueAuthClient` status → outcome matrix | `jest.spyOn(globalThis, 'fetch')`, table-driven: 400 / 401 / 429 / 500 / rejected promise / `AbortError` |
| Unit | `SupabaseAuthProvider` classification | assert exact `AuthProviderDeterministicError.reason` vs `AuthProviderAmbiguousError`; assert no password appears in any thrown message or `cause` chain |
| Unit | `IniciarSesionUseCase` branches | mocked ports: ok / bad creds / outage→503 / orphan profile→401 / suspended profile→`revokeSession` called then 403 `PROFILE_SUSPENDED` / suspended-company provider→same then 403 `COMPANY_SUSPENDED` / `'pendiente'` company→**200** / role mismatch→revoke then 403. Assert no branch returns a `SesionResponseDto` alongside a refusal |
| Unit | `assertSesionPermitida` truth table | pure function, no mocks: (role × status × companyStatus), incl. `role='user'` with `companyStatus=null`, and that a suspended profile is refused before a role mismatch (D-4a ordering) |
| Unit | `RefrescarSesionUseCase` suspension | a profile suspended *after* login is refused at the next refresh, tokens revoked (proves D-2's claim) |
| Unit | `InMemoryRateLimitStore` sliding window | fake timers: 5 failures inside 15 min ⇒ `count=5`; the same 5 spanning the boundary (4 at t=0, 1 at t=16m) ⇒ `count=1`, i.e. **no fixed-bucket rollover**; oldest entry ageing out drops `count` below `limit`; `retryAfterMs` equals `timestamps[count-limit] + windowMs - now`; ring never retains more than `limit` timestamps; `reset` empties one key only; key isolation; expired keys evicted on access with no `setInterval` left behind (assert no open handles) |
| Unit | `RateLimitInterceptor` two-phase policy | mocked store + `Reflector`: PRE `peek`s and **never** records; at/over limit ⇒ 429 `DEMASIADOS_INTENTOS` + `Retry-After`, and the handler is **never invoked** (a correct password is still rejected); a 429 records nothing (no self-extending lockout); POST records **only** when `countsAsFailure` is true — table-driven over `CredencialesInvalidasError` (yes) vs `AuthProviderNoDisponibleError` / `PerfilSuspendidoError` / `BadRequestException` (no); success resets the **email** key and leaves the **IP** key intact; a store rejection fails open (request allowed, 401 never becomes 500); email absent/non-string ⇒ IP key only |
| Unit | `@repon/auth` | mocked `fetch` + mocked `expo-secure-store`: rotation persists atomically, refresh single-flights under concurrent calls, one retry only, 403 never refreshes |
| e2e | `services/core-api/test/identidad-sesion.e2e-spec.ts` | supertest + overridden `AUTH_PROVIDER` (existing e2e pattern): 200 shape; wrong password and unknown email produce **byte-identical** bodies; 503 on ambiguous failure; **the four throttling scenarios verbatim** — 6th attempt after 5 failures for one email is 429; the *correct* password during that lockout is still 429; an unknown email locks out byte-identically to a real one; a 21st attempt from an IP spread over 20 emails is 429 — plus a successful login clearing that email's counter (5th failure, success, then 5 more failures still needed to re-lock) and a 503 outage burst **not** locking anyone out; suspended profile and suspended-company provider each return 403 with **no `accessToken`/`refreshToken` key anywhere in the body**; **the `accessToken` from login is accepted by an existing protected route unmodified** |
| Component | login screen + role gate, both apps | Jest + RNTL (scaffolded PR1) |

## Threat Matrix

N/A — this change adds HTTP routes inside an existing NestJS app and a React Native package. It introduces no shell command, subprocess, git/VCS or PR automation, executable-file classification, or process-integration boundary. The matrix's five rows (documentation-like paths, git repository selection, commit state, push state, PR commands) have no counterpart here; the applicable adversarial surface is credential handling and rate limiting, covered by D-1/D-3/D-4 and their tests above.

## Migration / Rollout

No database migration; this change only *reads* `profiles`/`companies`. `SUPABASE_ANON_KEY` must be present in every environment **before** the backend PR deploys (fail-fast at boot is intentional — revert code before env, per the proposal's rollback plan). PR1 is a pure wiring probe and is independently revertable.

## Open Questions

- [x] Q3 numbers — **resolved by `sdd-spec`**: 5 failed attempts per email, 20 per IP, 15-minute trailing window on **failed** attempts only, and a successful login resets the email counter. D-3's mechanism is written against exactly that predicate (sliding timestamp ring, not fixed buckets), so nothing is left to choose at apply time. The one number the spec does not fix is the refresh route's per-IP budget; D-3 sets it to the same 20 / 15 min and says so.
- [ ] Q4 — is `expectedRole` required, and does a mismatch 403 or issue a session? (`sdd-spec`; the mechanism exists either way, D-5.)
- [x] Q5 — **resolved by `sdd-spec`**: a `'pendiente'` company is a SUCCESS (the provider must be able to sign in to see its approval state); only `'suspendido'` is refused. Wired in D-4a.
- [ ] Q6 — which failures are indistinguishable by design; D-4 collapses all 4xx to 401 as the default, spec may split (`sdd-spec`).
- [ ] Deployment topology is unconfirmed — the in-process limiter (D-3) assumes a single `core-api` instance. If more than one instance is ever deployed, the effective threshold multiplies by N; swapping `RATE_LIMIT_STORE` for a shared store is the designed remedy.
