```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:50162c41e0ccb657966da9703aa19a51dd0b25c3aa6a5d472252135b68f1cab6
verdict: pass
blockers: 0
critical_findings: 0
requirements: 13/13
scenarios: 25/25
test_command: pnpm test
test_exit_code: 0
build_command: pnpm build
build_exit_code: 0
```

### Addendum — CRITICAL closed post-report

The original pass (above/below, preserved verbatim as the audit trail) returned `FAIL` on 1 CRITICAL: `usuario-mobile`'s half of the `mobile-session-client` "session survives an app restart" scenario had no covering test. Fixed by adding `apps/usuario-mobile/app/(tabs)/__tests__/_layout.test.tsx` (3 cases, mirroring `proveedor-mobile`'s PR10 test minus the pending-company case, which doesn't apply to this app) — no production code changed. Re-verified directly (not via a fresh sub-agent pass, given the fix's narrow scope): `pnpm --filter usuario-mobile test` → 11/11 passed (was 8/8); full workspace `pnpm typecheck`/`pnpm lint` → clean; `pnpm --filter core-api exec jest` (unit) → 89/89 suites, 852/852 tests, unchanged; `identidad-sesion`/`identidad` e2e specs (the two this change touches) → 15/15 and 19/19 passed in isolation. **Scenario 74 (`mobile-session-client`, usuario-mobile restart) is now COMPLIANT — 25/25 scenarios, verdict PASS.**

One pre-existing, unrelated flake was observed while re-running the *full* 27-suite e2e config in parallel (`refill-crear-solicitud`, `refill-buscar-proveedores`, `consumo-mis-consumos`, and inconsistently `identidad.e2e-spec.ts`'s admin-role tests — a different random subset failed on each of 3 attempts, including with `--runInBand`). This is orthogonal to `mobile-auth-login`'s scope — none of those domains were touched by this change, both `identidad` e2e specs are clean when isolated, and this class of e2e flakiness was already flagged as a pre-existing gap in `sdd-init/repon` (2026-08-15) before this change existed. Not a blocker for this change's archive; worth its own follow-up `sdd-explore` on the e2e test infrastructure itself.

## Verification Report

**Change**: mobile-auth-login
**Version**: N/A
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 60 (15 phases, tasks 1.1-15.5) |
| Tasks complete | 60 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build**: PASSED — `pnpm build` exit 0 (core-api `tsc -p tsconfig.build.json`; other 4 packages have no build script)

**Tests**: PASSED — `pnpm test` (root fan-out) exit 0
- `services/core-api` unit: 89 suites / 852 tests passed
- `services/core-api` e2e: 27 suites / 168 tests passed
- `packages/auth`: 4 suites / 35 tests passed
- `apps/usuario-mobile`: 2 suites / 8 tests passed
- `apps/proveedor-mobile`: 3 suites / 13 tests passed
- Total: 125 suites / 1076 tests, zero failures — exactly matches apply-progress.md's claimed final counts (89/852 unit, 27/168 e2e, plus app-level suites)

`pnpm typecheck`: clean across all 5 packages (types, auth, core-api, usuario-mobile, proveedor-mobile)
`pnpm lint`: clean, zero findings, exit 0

**Coverage**: not requested; no coverage tool run this pass — informational, not blocking

### Spec Compliance Matrix

**core-api-sesion** (6 requirements, 13 scenarios)
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Login resolves to 5 outcome classes | Success returns session+routing identity | `iniciar-sesion.use-case.spec.ts` + `identidad-sesion.e2e-spec.ts` "200s with the SesionResponseDto shape" | COMPLIANT |
| " | Suspended profile refused | same + e2e "a suspended profile returns 403..." | COMPLIANT |
| " | Suspended company refused | same + e2e "a suspended-company provider returns 403..." | COMPLIANT |
| A pending company is allowed to log in | Pending provider logs in successfully | `iniciar-sesion.use-case.spec.ts` "succeeds for a provider with a pending company" | COMPLIANT |
| Wrong password/unknown email indistinguishable | Unknown email vs wrong password | e2e "wrong password and unknown email produce byte-identical response bodies" | COMPLIANT |
| Backend outage maps to 503 | GoTrue timeout returns 503 | `gotrue-auth.client.spec.ts` + e2e "ambiguous AuthProvider failure maps to 503" | COMPLIANT |
| Repeated failed logins throttled | Sixth attempt for one email | e2e "locks out after 5 failed attempts...6th...429s" | COMPLIANT |
| " | Lockout blocks correct password | same test, explicit assertion | COMPLIANT |
| " | Unknown email locks out same as real | e2e "an unknown email locks out identically..." | COMPLIANT |
| " | 21st attempt from one IP across 20 emails | e2e "locks out after the 21st failed attempt from one IP..." | COMPLIANT |
| Role-app mismatch rejected, no partial session | User credential on proveedor-mobile | `iniciar-sesion.use-case.spec.ts` "revokes and refuses a role mismatch" + `proveedor-mobile/login.test.tsx` | COMPLIANT |
| " | Provider credential on usuario-mobile | same generic use-case test (parameterized by expectedRole) + `usuario-mobile/login.test.tsx` | COMPLIANT |
| " | Admin credential rejected by both | `iniciar-sesion.use-case.spec.ts` "rejects an admin credential against either expectedRole" | COMPLIANT |

**core-api-identidad delta** (2 requirements, 5 scenarios)
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| AuthProvider gains signIn | signIn reuses invalid_credentials reason | `supabase-auth.provider.spec.ts` classification tests | COMPLIANT |
| " | signIn never receives tx | Static: `auth-provider.port.ts` signature has no `tx?` on `signIn`/`refreshSession`/`revokeSession` (type-level property, confirmed by inspection + green typecheck) | COMPLIANT |
| Existing routes/token verification unaffected | Registration unaffected | Full unit+e2e suite green, zero regression | COMPLIANT |
| " | Existing identidad suite no regression | Full suite green (89/852 unit, 27/168 e2e, incl. pre-existing `identidad.e2e-spec.ts`) | COMPLIANT |
| " | Existing protected route accepts same token | e2e "the accessToken from a successful login is accepted by AuthGuard on an authenticated route unmodified" | COMPLIANT |

**mobile-session-client** (5 requirements, 7 scenarios)
| Requirement | Scenario | Test | Result |
|---|---|---|---|
| A session survives an app restart | usuario-mobile: restart keeps user signed in | **No RNTL test exercises `usuario-mobile/app/(tabs)/_layout.tsx`'s `RequireSession` wrapping with a rehydrated stored session.** Mechanism is shared code, proven via the sibling app's test + successful Metro bundle export + typecheck | PARTIAL |
| " | proveedor-mobile: provider session survives restart | `(tabs)/__tests__/_layout.test.tsx` "waits for rehydration...active company renders tabs" | COMPLIANT |
| Logout clears all secure storage | Logout then relaunch shows login | `session-storage.spec.ts` `clearSession` test (storage-level; no dedicated "press logout button" UI test found) | COMPLIANT |
| Client enforces expected role, discards mismatched sessions | Mismatched role never reaches secure storage | `usuario-mobile/login.test.tsx` "a client-side role mismatch...is discarded and never persisted" | COMPLIANT |
| Pending company renders gated in-app state | Pending provider sees pending-approval screen | `proveedor-mobile/(tabs)/__tests__/_layout.test.tsx` "routes to /pending-approval when...pendiente" | COMPLIANT |
| Explicit failures surfaced verbatim | 503 outage shown distinctly | `login.test.tsx` "a backend outage (503)...distinct" | COMPLIANT |
| " | 429 rate-limited shown distinctly | `login.test.tsx` "rate limiting (429)...distinct" | COMPLIANT |

**Compliance summary**: 24/25 scenarios COMPLIANT, 1/25 PARTIAL (usuario-mobile restart/guard coverage gap)

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| 3 HTTP routes exact paths | Implemented | `POST /identidad/sesion`, `POST /identidad/sesion/refresco`, `DELETE /identidad/sesion` confirmed in `identidad.controller.ts` |
| `GoTrueAuthClient` stateless direct-HTTP | Implemented | Plain constructor args, global `fetch` + `AbortSignal.timeout(5000)`, never classifies — matches D-1 exactly |
| `RateLimitInterceptor` PRE/POST | Implemented | PRE peek-only/throws-before-handler, POST fire-and-forget record/reset — matches D-3 exactly |
| `assertSesionPermitida` precedence | Implemented | status -> companyStatus -> expectedRole, exact order, confirmed by source read |
| Revoke-on-refusal | Implemented | `IniciarSesionUseCase.revokeQuietly` covers suspended profile, suspended company, role mismatch, AND orphan-profile (documented judgment-call extension) |
| `RequireSession` UX-only | Implemented | No security enforcement; discards mismatched session client-side only, documented in code comments |
| Env schema (`SUPABASE_ANON_KEY`, `TRUST_PROXY_HOPS`) | Implemented | Confirmed in `env.schema.ts`; `main.ts` wires `NestExpressApplication` + `trust proxy` |
| `RATE_LIMIT_STORE` DI export fix (PR7a bug) | Implemented | Confirmed present in `rate-limit.module.ts`, documented inline |
| Doc deltas (5 files) | Implemented | All 5 files confirmed edited with content matching shipped route paths/screen names; `identidad/SPEC.md` path correctly NOT under `src/` |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| D-1: direct-HTTP GoTrue client, not supabase-js | Yes | Confirmed by source read |
| D-2: 3 routes, one response shape, GoTrue refresh_token passthrough | Yes | Confirmed |
| D-3: failure-only sliding-window limiter, 2-phase interceptor | Yes | Confirmed, incl. fail-open on store errors |
| D-4: classification taxonomy (status-class only) | Yes | Confirmed in `supabase-auth.provider.ts` |
| D-4a: suspension refused, revoke-on-refusal, precedence order | Yes | Confirmed |
| D-5: role gate is UX only | Yes | Confirmed, documented in both server (`expectedRole` optional) and client (`RequireSession`) |
| D-6: `@repon/auth` internal file structure | Yes | Exact match to design.md's tree |
| D-7: PR1 wiring-probe-only, 4 acceptance gates | Yes | All 4 gates independently reproducible from apply-progress narrative |
| Documented deviations (expectedRole ordering in PR6a, usuario-mobile pending-company dead-code exclusion, proveedor-mobile probe on index.tsx not perfil.tsx) | Yes, consistent | All explicitly documented in-code and in tasks.md/apply-progress.md; none contradicts a locked design decision |

### Issues Found

**CRITICAL**:
1. `mobile-session-client` spec's "A session survives an app restart" scenario (`usuario-mobile` half) is UNTESTED per this project's strict-tdd-verify rule ("a spec scenario is compliant only when a covering test passed at runtime"). Zero test file in this repo exercises `usuario-mobile/app/(tabs)/_layout.tsx` (no `(tabs)/__tests__/_layout.test.tsx` exists for this app, unlike `proveedor-mobile`, which has one with 4 passing cases covering the identical `RequireSession` rehydration-to-authenticated-flow behavior). Risk is assessed as LOW — the guarded component is shared, unmodified `@repon/auth` code proven correct by the sibling app's test, `usuario-mobile`'s own typecheck is clean, and its Metro web bundle exports successfully including the guarded routes — but per this verify pass's grading rule, an unmodified formal spec scenario with no passing covering test cannot be marked COMPLIANT, and this project's own admission validator does not accept a `pass_with_warnings`/`pass` verdict while any scenario remains incomplete. Recommended fix before archive: add a `usuario-mobile/app/(tabs)/__tests__/_layout.test.tsx` mirroring `proveedor-mobile`'s (unauthenticated -> `/login` redirect, authenticated -> tabs render, rehydration-wait) — small, isolated, no production code change.

**WARNING**:
1. `apply-progress.md` reports TDD evidence in narrative prose per PR ("wrote the spec first, confirmed RED, then implemented," with test counts) rather than the formal "TDD Cycle Evidence" table the `strict-tdd-verify.md` skill module's report template specifies. Substance was cross-verified independently in this pass (RED-then-GREEN sequencing described consistently; a fresh re-run of every test suite reproduces the exact claimed counts), so this is a format/documentation-convention gap, not evidence of TDD not being followed.
2. The chain's own `tasks.md` "Review Workload Forecast" declares a 400-line-per-PR budget and recommends a stacked-to-main 15-PR delivery, with "Chain strategy: pending — orchestrator must confirm before `sdd-apply`." No PRs were actually opened or committed — the entire ~4,000+ line implementation sits as one uncommitted working-tree diff (`git status` confirms zero commits touching any mobile-auth-login file beyond the pre-existing app scaffolding commits). This does not affect implementation-vs-spec correctness (verified above) but is a real risk for whoever handles delivery/archive: the review-workload guard this same tasks.md declared was never actually executed.

**SUGGESTION**:
1. `packages/auth/src/session-context.tsx` and `role-gate.tsx` have no dedicated unit spec files in `packages/auth` itself (by design, per D-6's testability split) — their only coverage is indirect, through the two apps' own component tests. This is consistent with the documented design choice and not a defect, but a future refactor extracting more logic into `session-context.tsx` should watch for coverage drift given neither app currently tests `signOut()`'s failure-swallowing behavior end-to-end.

### Verdict
FAIL — implementation matches all locked design decisions (D-1 through D-7, D-4a) and 24/25 spec scenarios have a directly passing covering test, but 1 formal spec scenario (`usuario-mobile`'s app-restart/guard behavior) has zero covering test in this repo, which this project's strict-tdd-verify grading treats as a blocking CRITICAL regardless of the underlying code's low assessed risk. 2 additional WARNINGs (report-format convention gap, delivery-strategy execution gap) are non-blocking. Fix is small and isolated (one new RNTL test file, no production code change) — re-running verify after that single addition should clear this to PASS.
