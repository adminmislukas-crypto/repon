# Verify Report: `backend-core-api-foundation`

**Change**: `backend-core-api-foundation` | **Mode**: hybrid (openspec file + Engram) | **Verifier**: sdd-verify (fresh-context, adversarial) | **Commit range verified**: `22ad302`..`fbfda5b` on `main` (HEAD `fbfda5b`), plus `172be33`/`38842b5`

## Verdict: **PASS WITH WARNINGS**

Core functional correctness, the authorization boundary, and the auth-provisioning compensation contract are all genuinely implemented and covered by real, passing tests — verified by direct source inspection and live command execution, not by trusting prior PR self-reports. No CRITICAL defect blocks archival on functional/security grounds. One CRITICAL process-integrity finding was discovered (a declared toolchain command that actually fails) and should be fixed before or immediately after archive; it is trivial to fix and does not indicate any behavioral or security defect.

---

## 1. Real Commands Run — Evidence, Not Claims

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` (root) | **PASS** | `packages/types` + `services/core-api`, both `tsc --noEmit` clean |
| `pnpm lint` (root, ESLint) | **PASS** | Zero violations across the whole repo |
| `pnpm format:check` (root, Prettier) | **FAIL** | Exit 1 — 23 files with formatting drift (see CRITICAL-1) |
| `pnpm --filter core-api run test:unit` | **PASS** | 19 suites, **111/111 tests** passed |
| `pnpm --filter core-api run test:e2e` | **PASS** | 3 suites, **17/17 tests** passed |
| `pnpm --filter core-api run test:integration` | **PASS** | Ran against real local Supabase (`supabase start`, DB on 54322). 2 suites, **7/7 tests** passed, including a genuine (non-mocked) `UPDATE`/`DELETE audit_log` → `permission denied` assertion and a real `IdentidadActorAdapter` JOIN against the seeded `super_admin` row |
| `pnpm build` (root) | **PASS** | `services/core-api` compiles via `tsc -p tsconfig.build.json` |
| Live boot (`node dist/main.js` + local Supabase) | **PASS** | All 7 modules (`SharedKernelModule` + 6 domains) initialized, zero unresolved DI providers, all 6 identidad routes mapped |
| `GET /health` | **200** `{"status":"ok"}` | Confirmed live |
| `GET /api/docs` (`NODE_ENV=development`) | **200**, real OpenAPI UI | Confirmed live |
| `GET /api/docs` (`NODE_ENV=production`) | **404** | Confirmed live in a second boot — genuinely dev-only |
| `GET /api/docs-json` | 6 identidad routes + `/health`, 6 DTO schemas, `bearer` securityScheme all present | Confirmed via `curl` + JSON inspection, not just source reading |
| Guard e2e scenario (`PUT /identidad/usuarios/:id/rol-admin`, no token) | **401** `{"code":"MISSING_BEARER_TOKEN"}` | Confirmed live against the real compiled app |
| ESLint cross-domain boundary (real trigger) | **Fails as designed** | A deliberately-added `consumo → catalogo/ports-out` import was rejected by `import-x/no-restricted-paths` with the exact spec-quoted message, then removed. Full `pnpm lint` re-confirmed clean afterward (no false positives on the real codebase's legitimate `@repon/types` / same-domain imports) |

Node/pnpm note (environment-only, not a repo defect): this sandbox has Node v26.5.1 and no version manager installed; the repo's own `.nvmrc`/`.tool-versions` correctly pin `24.19.0` in both places (`repo-toolchain` spec's "Node 24.x pinned in two places" requirement is satisfied by inspection). All commands above ran under the available Node 26 with only a benign `engines` warning — no actual incompatibility observed.

---

## 2. Spec Compliance Matrix

### `repo-toolchain`
| Requirement | Status | Evidence |
|---|---|---|
| pnpm workspace at repo root | PASS | `pnpm-workspace.yaml`/root `package.json` cover `apps/*`,`services/*`,`packages/*`; `pnpm install --frozen-lockfile` resolves cleanly |
| Node 24.x pinned in two places | PASS | `.nvmrc` and `.tool-versions` both `24.19.0` |
| Shared TypeScript base config | PASS | `tsconfig.base.json` `strict:true`; `services/core-api/tsconfig.json` extends it, no override |
| Lint/format enforced, not advisory | PARTIAL | ESLint is real and CI-gating (verified). Prettier is configured and CI-gating **but currently fails** on 23 files (CRITICAL-1) |
| Test runner present, wired to CI | PASS | Jest configured, `pnpm test` is the real entrypoint, 111+17+7 tests genuinely pass |
| CI gate covers install→build | PASS (structurally) / WARNING (never actually executed) | `ci.yml` gates install→lint→format→typecheck→test→build correctly in sequence; but see WARNING-1 — it has literally never run on GitHub |
| `strict_tdd` flips only after suite green | PASS | Flip is the literal last task (5.6); `pnpm test`/`build`/`lint`/`typecheck` (the 4 commands this specific requirement names) are all genuinely green |

### `core-api-bootstrap`
| Requirement | Status | Evidence |
|---|---|---|
| Env validation fails fast | PASS (by design, not re-tested destructively here) | `env.schema.ts` unit-tested (9 tests, confirmed passing in the unit run); zod discriminated union matches spec exactly |
| Swagger dev-only | PASS | Live-verified both ways: 200 in dev, 404 in prod |
| Global ValidationPipe rejects malformed DTOs | PASS | `whitelist`+`forbidNonWhitelisted` present in `main.ts`; e2e-tested (`identidad.e2e-spec.ts` extra-field→400) |
| Module composition wires kernel + 6 domains | PASS | Live boot: all 7 modules initialized, zero unresolved provider |
| Shared kernel exposes fixed tokens | PASS | `SUPABASE_CLIENT`/`DATABASE`/`TRANSACTION_MANAGER`/`NOTIFICATION_PORT`/`PAYMENT_GATEWAY_PORT` all present per `shared/` folder inspection |
| DI tokens are Symbols | PASS | Spot-checked `AUDIT_LOG_PORT`, `ACTOR_PORT`, `ORDER_REPOSITORY`, `CATALOG_QUERY_PORT` — all `Symbol('...')`, declared once next to their interface |
| Placeholder modules declare tokens, bind nothing | PASS | All 5 (`catalogo`,`consumo`,`refill-matching`,`ofertas`,`pedidos-pagos`) modules are literal empty `@Module({})`; grepped for `useValue` across all 5 — zero matches |
| Health check unauthenticated, stays 200 post-guard | PASS | Live-verified 200 with no `Authorization` header, guard globally active |

### `core-api-auth-guard`
| Requirement | Status | Evidence |
|---|---|---|
| ActorPort declared by kernel, implemented by identidad | PASS | `shared/auth/ports/actor.port.ts` has zero domain imports; `IdentidadActorAdapter` in `domains/identidad/contracts/`, single JOIN confirmed via passing integration test |
| AuthGuard authentication matrix (7 scenarios) | PASS | `auth.guard.ts` source matches every status code/error code 1:1 with spec; 12 guard-specific unit tests + integration-level e2e (401 `MISSING_BEARER_TOKEN` live-verified) |
| RolesGuard authorization matrix (6 scenarios) | PASS | `roles.guard.ts` matches the spec's exact precedence order (role→adminRole-missing→adminRole-not-allowed); 8 unit tests + e2e `ADMIN_SUBROLE_NOT_ALLOWED` scenario live-covered |
| JWT verification configurable, fixed at boot | PASS | `Hs256`/`Jwks` verifiers selected once via factory at DI-construction time; dedicated unit tests with real `jose` crypto (not mocked) |
| AuthenticatedActor never crosses ports-in | PASS | Controller passes `actor.profileId` as a scalar to every use case (`identidad.controller.ts` inspected line-by-line); no use case signature accepts `AuthenticatedActor` |
| Global exception filter emits stable codes | PASS | `GlobalExceptionFilter` + `IdentidadExceptionFilter` both produce `{statusCode, code, message}`, no stack leakage (asserted by dedicated filter spec tests) |
| **APP_GUARD is genuinely global** | PASS | `app.module.ts` registers both `AuthGuard`/`RolesGuard` via `APP_GUARD`, unconditionally, imported after `IdentidadModule` — matches design.md's cycle-avoidance ordering |
| **`@Public()` only on the 3 intended routes** | PASS | Grepped every non-test `@Public()` usage: `registrarUsuario`, `registrarEmpresa`, `/health` — nothing else |
| **`@AdminRoles` sub-role matrix matches spec exactly** | PASS | `aprobarEmpresa`/`suspenderEmpresa`/`suspenderUsuario` → `@AdminRoles('super_admin','soporte')`; `asignarRolAdmin` → `@AdminRoles('super_admin')` only. `soporte` calling `asignarRolAdmin` is e2e-tested → 403 `ADMIN_SUBROLE_NOT_ALLOWED`, confirmed in the passing e2e run |

### `core-api-identidad`
All 6 Requirements (tx-context on ports-out, registrarUsuario's saga ownership, registrarEmpresa's single-insert scope, admin-mutation-audits-in-one-transaction, asignarRolAdmin's `adminId`→`granted_by`, the admin sub-role matrix, `company_dispatch_zones` out-of-scope) were checked against source and are **PASS** — each has a real unit and/or e2e test that passed in this run. `AprobarEmpresaUseCase`/`AsignarRolAdminUseCase` source inspected directly: both wrap mutation + `AuditLogPort.record` in one `TransactionManager.runInTransaction` call sharing `tx`, event publishes only after the `await runInTransaction(...)` resolves (post-commit), matching the spec's transaction map exactly.

### `auth-provisioning`
**PASS**, both scenarios independently re-derived from source + a real passing test run:
- `RegistrarUsuarioUseCase` (`ports-in/registrar-usuario.use-case.ts`) owns 100% of the compensation decision-making — it is the only component holding both `AuthProvider` and `ProfileRepository`.
- `SupabaseAuthProvider` (`adapters/persistence/supabase-auth.provider.ts`) was read end-to-end: it **only** classifies (`AuthProviderDeterministicError` / `AuthProviderAmbiguousError`); it never calls `deleteAccount` itself except when the use case explicitly invokes it as a public method.
- `registrar-usuario.use-case.spec.ts` (9 tests, all passing) covers: success, invariant-rejected-before-Auth-call, deterministic-failure→delete+503+no-retry, compensation-itself-fails→still throws+logs orphan, ambiguous→forward-recovery-found→retries, ambiguous→not-found→503-no-delete, deterministic `email_taken`→409-equivalent, deterministic other reasons→502-equivalent. This is a strict superset of the two scenarios the delta spec requires.

### `shared-audit-log`
**PASS**. `AuditLogPort`/`AUDIT_LOG_PORT` live in `src/shared/audit/`, not any domain's `ports-out/`. Write-only (`record` is the only method, confirmed by reading the interface). `cambios` shape matches `{ campo: { antes, despues } }` exactly in both `AprobarEmpresaUseCase` and `AsignarRolAdminUseCase`. Transaction participation and rollback-removes-audit-entry are proven by a **real, non-mocked integration test** (`database.integration-spec.ts`) that ran and passed against local Postgres in this session.

### `shared-types-package`
**PASS**. `packages/types/src/**` is real, importable `.ts` (7 files + barrel), zero `schema.ts`-style row types present. `services/core-api/src/shared/database/schema.ts` (the actual Kysely row types) lives entirely inside `core-api`, never re-exported from `@repon/types` — confirmed by inspecting both files directly.

### `core-api-hexagonal-layout`
| Requirement | Status | Evidence |
|---|---|---|
| Fixed per-domain folder shape | **WARNING** (see WARNING-2) | `identidad`'s actual tree is `domain/`,`ports-in/`,`ports-out/`,`contracts/`,`adapters/{http,persistence}/` — **no `adapters/events/`** exists, contradicting the spec's own literal Scenario text ("contains exactly ... `adapters/{http,persistence,events}/`") |
| Only `contracts/` importable cross-domain | **WARNING** (see WARNING-3) for `catalogo`'s `CatalogQueryPort`; **PASS** for everything else | `CatalogQueryPort` (a declared sync cross-domain query port per the domain's own doc comment) lives in `catalogo/ports-out/`, not `catalogo/contracts/` — a genuine, self-documented deviation from this requirement's letter, currently inert (nothing consumes it yet) |
| Boundary is CI-enforced | PASS | Live-triggered: a real disallowed import was written, `eslint` failed with the exact spec-quoted message, removed, `pnpm lint` re-confirmed clean |
| DTOs/framework decorators stay in adapters/http | PASS | `domain/`, `ports-in/`, `ports-out/` grepped for `@nestjs/swagger`/`class-validator` imports — none found; `RegistrarUsuarioUseCase.execute` takes a plain `RegistrarUsuarioCommand`, no decorators |

---

## 3. Design Coherence (`design.md` D-A through D-E)

| Decision | Status | Evidence |
|---|---|---|
| D-A: Kysely+pg for repos, supabase-js for Auth/Storage only, `service_role`-grant connection | PASS | `pool.provider.ts` + real integration test proving `current_user='service_role'` and `UPDATE`/`DELETE audit_log` → `permission denied` |
| D-B: use case owns compensation, adapter only classifies | PASS | Re-derived independently from source, see `auth-provisioning` above |
| D-C: AuditLogPort as shared-kernel service, not identidad ports-out | PASS | Confirmed location + write-only surface |
| D-D: JWT mode fixed once at boot via discriminated union | PASS | Factory pattern confirmed, real `jose`-backed unit tests |
| D-E: two global guards, fail-closed, `@Public()` only opt-out | PASS | Live-verified end-to-end (401 on an unauthenticated admin route) |
| §7 (`APP_GUARD` registration ordering, avoiding the `AuthModule`↔`IdentidadModule` cycle) | PASS | `AuthModule` does not register `APP_GUARD`; `AppModule` does, after importing both — confirmed by reading `app.module.ts` and `auth.module.ts` |

---

## 4. Tasks Verification

- `grep '\[ \]' tasks.md` → **zero matches**. All 9 phases (0–5, including sub-slices 4a/4b/4c) are checked off.
- Spot-checked a non-trivial sample of `[x]` items against real code (not just reading the self-report prose): 0.4 (ESLint boundary rule — triggered live), 2.6 (`/health` e2e — live-verified), 3.2 (DB grants integration test — ran live), 3.7/3.8 (guards — read source + counted 20 tests), 4a.6 (`APP_GUARD` registration — read source), 4b.1/4b.2 (saga — read source + 9 passing tests), 4b.4 (audit-in-transaction — read source for 2 of 3 use cases), 4c.3/4c.6 (controller + e2e — read source + live curl), 5.1 (placeholder modules — read all 5, zero `useValue`), 5.6 (config flip — read `config.yaml`, but format_command's "verified" claim does not hold, see CRITICAL-1).
- No sampled task was found to be falsely marked complete on functional grounds.

---

## 5. Findings

### CRITICAL

**CRITICAL-1 — `pnpm format:check` (declared in `openspec/config.yaml`'s `testing` block and wired as a real CI-gating step in `.github/workflows/ci.yml`) currently fails on the committed state of `main`.**
Running it live: `prettier --check .` exits 1 with 23 files flagged, spanning PR5 (guards: `auth.guard.ts`, `roles.guard.spec.ts`, JWT verifier specs/factory) through PR8 (identidad use cases, adapters, and one e2e spec). `openspec/config.yaml`'s `testing.reason` states the toolchain was "verified it green locally across 9 PRs" and lists `format_command` as one of "all 5 command fields filled" (tasks.md 5.6) — but `format:check` itself was apparently never actually re-run after PR5 introduced the drift. Because `ci.yml`'s steps gate sequentially (install→lint→format→typecheck→test→build), if this were pushed through an actual GitHub Actions run, CI would go red at the "Format check" step before typecheck/test/build ever execute — directly undermining the "gates ... on every step passing" claim this whole 9-PR chain rests on.
Note on severity/scope: this is purely cosmetic (whitespace/quote-style, zero behavior change), trivially fixed with `pnpm format && git commit`, and does **not** contradict `repo-toolchain`'s literal `strict_tdd`-flip requirement, which names only `test_command`/`build_command`/`lint_command`/`typecheck_command` (not `format_command`) as its gating set — all four of those genuinely pass. Flagged CRITICAL per the verify skill's own decision gate ("test command exits non-zero → CRITICAL") because it is a real, declared, currently-failing command, not because it indicates any functional or security defect.
**Recommendation**: run `pnpm format` and commit the fix as a small follow-up before or immediately after archiving; it does not require reopening any of the 9 PRs' logic.

### WARNING

**WARNING-1 — CI (`.github/workflows/ci.yml`) has never actually executed on GitHub for this change.**
Verified via the GitHub API (public repo, no auth needed): 0 pull requests ever opened (`pulls?state=all` → 0), 0 workflow runs (`actions/runs` → 0), 0 check-runs on `main`'s HEAD commit. The workflow triggers only `on: pull_request`; since all 9 "PRs" were pushed as direct commits to `main` (confirmed: linear git history, no merge commits) rather than opened as real GitHub PRs, the CI gate has literally never fired, despite `tasks.md`/`openspec/config.yaml` repeatedly asserting "verified ... in CI" / "gates install → lint → typecheck → test → build on every step passing." The workflow file itself is structurally correct (verified by reading it and by reproducing every one of its steps locally in this session), so this is a traceability/process gap, not a functional defect — but it means the "in CI" half of every green claim in this change's artifacts was never actually substantiated by GitHub, only by local runs (which is exactly what this verify pass re-did).

**WARNING-2 — `identidad`'s folder tree does not literally match `core-api-hexagonal-layout/spec.md`'s own "identidad matches the reference shape" Scenario.**
That scenario states the tree "contains exactly `domain/`, `ports-in/`, `ports-out/`, `contracts/`, `adapters/{http,persistence,events}/`, `identidad.module.ts`" — but no `adapters/events/` folder exists; all 5 events publish directly from `ports-in/` use cases via `EVENT_PUBLISHER`. This is PR7/PR8's own documented, judged decision (tasks.md 4c.4: `identidad/SPEC.md`'s "Eventos que consume: Ninguno" means there's nothing to subscribe to, so an inbound-event-subscriber folder would be empty ceremony) — a defensible reading, but the openspec delta spec's own scenario text was never updated to match it. This is a spec-drafting gap (the spec should have been revised once the real decision was made, per design.md's own §"Deltas de SPEC.md que sdd-spec debe absorber" pattern), not a runtime risk: nothing is broken, nothing is untested, no security/correctness impact. **Recommendation**: amend this scenario in `core-api-hexagonal-layout/spec.md` before or during archive to describe `adapters/events/` as conditional (like `contracts/` already is), matching what was actually built and judged correct.

**WARNING-3 — `CatalogQueryPort` lives in `catalogo/ports-out/` instead of `catalogo/contracts/`, contradicting the literal text of "Only contracts/ is importable across a domain boundary."**
The port's own doc comment explicitly self-identifies as "Consulta que expone a otros dominios (síncrona, solo lectura)" — i.e., it self-describes as exactly the kind of interface the spec says belongs in `contracts/`. PR9's own report flags this as an intentional, scoped deviation (no `contracts/` folder created for any of the 5 thin placeholders in this PR; nothing imports it cross-domain yet since the consumers — `refill-matching`/`ofertas` — are placeholders too). Verified this is currently inert: grepped the whole `src/domains/` tree for any cross-domain import of `catalogo/ports-out/` — none exists, so the ESLint boundary rule has nothing to catch yet. Low risk today, real risk the day `catalogo`'s own SDD change lands and something reaches for this port without first relocating it. **Recommendation**: track this explicitly as a must-fix item in the next `catalogo` SDD change (proposal/design should not silently inherit `ports-out/` placement).

**WARNING-4 — `@ApiBearerAuth()` is applied at the controller class level, so Swagger's OpenAPI JSON declares a `security: [{bearer: []}]` requirement on the two `@Public()` routes (`registrarUsuario`, `registrarEmpresa`) even though they genuinely work unauthenticated.**
Confirmed via `/api/docs-json` inspection: both public routes show a `security` array in the generated spec, and confirmed via a real curl (no `Authorization` header) that both routes actually work regardless — this is a Swagger-documentation cosmetic issue only, already independently proven non-functional by the passing e2e tests ("creates a profile/company with no Authorization header"). **Recommendation**: move `@ApiBearerAuth()` off the two `@Public()` handlers (or add `@ApiBearerAuth()` only to the 4 protected routes) so the generated docs stop implying auth is required where it isn't.

### SUGGESTION

**SUGGESTION-1** — `openspec/config.yaml`'s `testing.reason` narrative describes CI's gate order as "install -> lint -> typecheck -> test -> build" but the actual `.github/workflows/ci.yml` has 6 steps (install, lint, **format check**, typecheck, test, build). Worth syncing the prose to the real file the next time this config block is touched, independent of CRITICAL-1's actual-failure issue.

**SUGGESTION-2** — `SupabaseAuthProvider.findAccountByEmail`'s documented limitation (single `listUsers({perPage:1000})` page, no server-side email filter) is real and already flagged in-code; worth an explicit backlog item once user volume approaches 1000, rather than only a code comment, since it's a correctness cliff-edge for the ambiguous-Auth-failure recovery path specifically.

---

## 6. Summary

- **CRITICAL**: 1 (toolchain-integrity, trivially fixable, zero functional/security impact)
- **WARNING**: 4 (1 process/traceability, 2 spec-text-vs-implementation drift on placeholder/scope boundaries already self-documented by PR9, 1 Swagger cosmetic)
- **SUGGESTION**: 2

The authorization boundary (the change's own top-flagged risk area) held up under direct adversarial re-derivation: `APP_GUARD` is genuinely global, `@Public()` is exactly and only on the 3 intended routes, the admin sub-role matrix matches spec exactly including the `soporte`-cannot-`asignarRolAdmin` restriction, and a live unauthenticated request against an admin route was independently confirmed to return 401. The auth-provisioning compensation saga is genuinely owned by the use case, not the adapter, with both required scenarios covered by real passing tests. `order_items`/`audit_log` immutability carries through correctly into the new placeholder port signatures and is proven by a real (non-mocked) integration test against local Postgres. Swagger is genuinely dev-only and genuinely renders real route/DTO/security-scheme data.

**Recommendation**: fix CRITICAL-1 (`pnpm format --write`, one commit) before or immediately after archive — it is cheap and unblocks the CI-integrity claim entirely. WARNING-1 through WARNING-4 do not block archive; WARNING-2/3 should be carried forward as explicit tracked items into whichever SDD change next touches `identidad`'s events folder or implements real `catalogo`.
