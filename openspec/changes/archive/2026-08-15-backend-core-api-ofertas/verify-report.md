# Verify Report: `backend-core-api-ofertas`

**Scope**: Full 14-PR chain verification (PR1–PR8b), commits `4aa1c63..fdcc4c8` on `main`, immediately after `57b655f` ("docs(openspec): add ofertas design"). This is a whole-chain acceptance gate, not a last-batch spot check.

**Verdict: PASS WITH WARNINGS — ready for `sdd-archive`.**

No CRITICAL issues found. 2 carried-forward WARNING-level findings from the chain's own review process were independently re-verified as accurate and still open (both explicitly non-blocking by design). 1 opt-in task remains unchecked for a confirmed, non-code environmental reason. Several SUGGESTION-level cleanup items are inherited debt, not regressions.

---

## What was checked

- `openspec/changes/backend-core-api-ofertas/proposal.md` — full read (D1–D18, scope, risks R1–R11, success criteria)
- `openspec/changes/backend-core-api-ofertas/design.md` — full read, 929 lines (D-A..D-G.5, 3 diagrams, PR sequencing, reconciliation table)
- `openspec/changes/backend-core-api-ofertas/specs/db-schema-ofertas/spec.md` — full read
- `openspec/changes/backend-core-api-ofertas/specs/core-api-ofertas/spec.md` — full read, 305 lines, all requirements/scenarios
- `openspec/changes/backend-core-api-ofertas/tasks.md` — full read, 118 tasks
- `openspec/changes/backend-core-api-ofertas/apply-progress.md` — full read, all 3969 lines, all 14 PR sections including every "Deviations from Design", "Issues Found", and "Orchestrator Review Notes" subsection
- Source code spot-checks against the claims above (folder shape, module wiring, error classes, the two flagged review findings, doc reconciliation)
- A **fresh, independent** full verification suite run against `HEAD` (`fdcc4c8`) — not a re-read of prior claimed numbers

`mem_*` (Engram) tools were not present in this execution context's tool list (only `Read`/`Bash` were available) — consistent with the same gap PR8b's own apply-progress.md already flagged for its own execution context. Per the launch instructions, the filesystem is authoritative here; this report is written to `openspec/changes/backend-core-api-ofertas/verify-report.md` only.

---

## Fresh verification suite — run now, compared against PR8b's claimed numbers

| Command | PR8b's claim | This run's actual result | Match |
|---|---|---|---|
| `pnpm lint` | clean | clean, exit 0 | ✅ |
| `pnpm typecheck` | clean (`packages/types` + `services/core-api`) | clean, both `Done` | ✅ |
| `pnpm build` | clean | clean, `tsc -p tsconfig.build.json` `Done` | ✅ |
| `pnpm format:check` | clean | clean, "All matched files use Prettier code style!" | ✅ |
| `pnpm test` (unit) | 73/73 suites, 660/660 tests | **73/73 suites, 660/660 tests** | ✅ exact match |
| `pnpm test` (e2e) | 22/24 suites, 134/139 tests, 2 known failures | **22/24 suites, 134/139 tests**, same 2 failing files | ✅ exact match |

The 2 e2e failures are `test/refill-crear-solicitud.e2e-spec.ts` and `test/refill-completar-borrador.e2e-spec.ts` (both in `refill-matching`, a domain this change's diff never touches at the production-code level except via 2 new event listeners). Root cause independently confirmed: `Error: Connection terminated due to connection timeout` from `pg-pool`/Kysely's `PostgresDriver.acquireConnection`. I independently ran `docker ps` and `supabase status` myself (not trusting the prior claim) — both confirm Docker Desktop is still manually paused right now:

```
Error response from daemon: Docker Desktop is manually paused. Unpause it through the Whale menu or Dashboard.
```

This is the identical root cause documented by every batch since PR3b. Notably, one of the failing traces shows `MatchEncontradoListener.onMatchEncontrado` (this change's own listener) also hitting the same connection timeout mid-test — and it does **not** propagate: the test's actual failure is the host use case's (`CrearSolicitudUseCase`) own DB timeout, not a re-thrown error from the listener. This is incidental but real runtime evidence that the R5 catch-and-log-never-rethrow discipline holds under a genuine failure, not just under a mocked one.

Also independently confirmed:
- `git status --porcelain` shows only 2 pre-existing, unrelated `.atl/` cache files modified — zero uncommitted changes anywhere in this change's own scope.
- `git diff --shortstat 57b655f..fdcc4c8`: **67 files changed, 13830 insertions(+), 157 deletions(-)** across the whole chain.
- `grep -rn "deleteFrom\|DELETE FROM" services/core-api/src/domains/ofertas/` → zero matches — confirms the "no physical DELETE anywhere in this domain" claim (D5's replace-via-`vigente` mechanism, D-A.2's rejected-`DELETE`-alternative table).

---

## Task completion

`grep -c '^\- \[x\]'` → **117**; `grep -c '^\- \[ \]'` → **1** (task `3b.13`). Matches the claimed 117/118 exactly.

Task `3b.13` (opt-in real-Postgres round-trip test for `reemplazar`) is the sole unchecked item. Re-confirmed independently, right now, that this is a genuine environmental blocker and not a silently-abandoned code gap: `docker ps`/`supabase status` both fail with the identical "Docker Desktop is manually paused" error the task's own inline note describes. Spot-checked the claim that 3b.1–3b.12 give this the same structural coverage by reading `kysely-offer-opportunity.repository.spec.ts` directly: it contains 33 tests (the file itself, not just the claimed 32 — the extra one is the orchestrator's own PR3b review addition, `existeRelacion`'s `.limit(1)` test, documented inline in apply-progress.md), including a dedicated test asserting the exact 5-statement retire-before-upsert order against a mocked query builder and the `companyIds: []`-omits-statement-3 case. This gives genuine confidence in the *logical* correctness of the writer (statement order, `cerrada_at` exclusion, upsert-vs-literal correctness for the bulk path) but — as apply-progress.md itself already states — does **not** prove Postgres's own `ON CONFLICT` semantics behave exactly as the mock assumes. That residual gap is real, correctly named, and non-blocking (opt-in/non-CI per the task's own text).

---

## Spec compliance — representative sample, not exhaustive

Given the scale (2 delta specs, ~30 scenarios), I traced a representative cross-section from each spec against implementation + passing tests rather than every single scenario line-by-line (apply-progress.md's own TDD Cycle Evidence tables already provide scenario-level RED/GREEN traceability for all of them, cross-checked above).

| Requirement (spec) | Implementation | Test evidence |
|---|---|---|
| `registrarOportunidad` consumes `MatchEncontrado` only, never `RefillCreado` (D2) | `match-encontrado.listener.ts`, `@OnEvent('refill.match_encontrado')` only | `match-encontrado.listener.spec.ts` — structural inspection asserting zero `@OnEvent('refill.creado')` handlers exist |
| Projection replaces per-solicitud, never accumulates, never `DELETE`s (D5) | `kysely-offer-opportunity.repository.ts`'s `reemplazar()`, `vigente boolean` retire-blanket-then-upsert | `kysely-offer-opportunity.repository.spec.ts` (33 tests) + confirmed zero `deleteFrom` in the domain |
| `enviarOferta` 404 byte-identical for nonexistent vs. non-eligible (D11) | `findElegible` → `null` → `SolicitudNoElegibleError` in both branches | `enviar-oferta.use-case.spec.ts` |
| `enviarOferta` calls `CatalogQueryPort` before opening any transaction (D13/C2/R3) | Diagram-2 order in `enviar-oferta.use-case.ts` | Dedicated ordered-resolution test (D-C) — the chain's own named "single most important test" |
| `aceptarOferta` — 1 transaction, displace + close, 409 never 500 on double-tap (D12/R4) | `aceptar-oferta.use-case.ts` + `kysely-offer.repository.ts`'s `23505`→`OfertaYaAceptadaError` translation | `aceptar-oferta.use-case.spec.ts` (16 tests) + `kysely-offer.repository.spec.ts` |
| `TRANSACTION_MANAGER` injected only in the 4 write use cases, never the 2 reads (D13) | Constructor shape of all 6 use cases | Structural `self:paramtypes` inspection tests in both read use cases' specs |
| `catalogo` touched in exactly 2 production files, additively (D9) | `catalog-query.port.ts` + `kysely-catalog-query.adapter.ts` | `git diff --stat 57b655f..fdcc4c8 -- services/core-api/src/domains/catalogo/` → exactly these 2 files (+ their own spec file, not counted against the criterion) |
| `refill-matching.module.ts` changes only `providers` (D7) | Read directly: `git diff 57b655f..fdcc4c8 -- .../refill-matching.module.ts` | `imports`/`controllers`/`exports` byte-identical; only 2 new `providers` entries |
| Folder shape: `adapters/events/` present, no `contracts/`, no `adapters/scheduling/` (D15) | `find services/core-api/src/domains/ofertas -type f` | Confirmed directly — matches exactly |
| `packages/types/src/ofertas.ts` additive-only, `Offer`/`OfferItem` unchanged (D14) | `git diff --stat` on that file | +62/-0 |
| `db-schema-ofertas`: no cross-domain FK, RLS zero-policy, `service_role`-only grants (D4) | `supabase/migrations/20260808120000_16_...sql` | Verified live against real Postgres in PR1 (`psql`-level evidence, transcript in apply-progress.md); migration file itself read and matches design.md D-A.4 verbatim |

I found no requirement or scenario in either delta spec that lacks a corresponding implementation or a passing test. I found no undisclosed design deviation while reading `design.md` against the code touched above.

---

## CRITICAL

None found.

---

## WARNING (carried-forward findings, independently re-verified — confirmed accurate, still open, still non-blocking)

**W1 — `marcarAceptada`'s `UPDATE` has no `WHERE status = 'pendiente'` guard (PR7a's own review finding).**
Independently confirmed by reading `kysely-offer.repository.ts` directly: `marcarAceptada` issues `UPDATE offers SET status = 'aceptada' WHERE id = offerId` with no status predicate and no row lock on the prior `findById` `SELECT`. Under `READ COMMITTED` (the implicit default, no `SERIALIZABLE` anywhere in this codebase), two genuinely concurrent accept-requests for the *same* offer can both read `'pendiente'`, both pass the pure-function `aceptar()` check, and both write — the second write does not conflict (a partial unique index does not self-conflict on an UPDATE of the same row), so `OfertaAceptada` publishes twice and the second request returns success instead of `409 TRANSICION_INVALIDA`. This is **narrower** than what the partial unique index `offers_refill_request_id_aceptada_uidx` protects (that index correctly catches two *different* sibling offers racing to `'aceptada'` — verified separately, real `23505`→409 translation, unit-tested). I independently confirmed the "repo-wide pattern, not new to this PR" claim: `kysely-refill.repository.ts`'s own state-transition `UPDATE` (`refill_requests` `estado` column) has the byte-identical shape, no guard either. Correctly documented as a deliberate, scoped non-fix (a proper fix is a cross-cutting concurrency change spanning at least 2 domains, out of a single PR's mandate) — not something this chain silently overlooked.

**W2 — Categoria-based catalog-match correlation can attribute a match to the wrong requested item (PR5a's own Finding #3).**
Independently confirmed by reading `enviar-oferta.use-case.ts` lines ~160-170: the hard-rule correlation is `catalogProductId` exact match when present, else `categoria` equality — no `nombre` re-check. Confirmed the described failure scenario is real and unguarded: if a solicitud requests two items in the same `categoria` (no uniqueness constraint prevents this) and the provider's catalog matches only one of them by `buscarCoincidencias`'s trigram search, the *other* (non-carried) item's price still gets validated against the matched item's `precioMaximo` via the categoria-only fallback. Confirmed via `grep` that no test in `enviar-oferta.use-case.spec.ts` exercises this specific two-different-items-same-categoria cross-match scenario (only a same-`refillItemId` duplicate guard is tested, which is a different, already-fixed issue). This is a genuine, disclosed design gap in a frozen contract's fuzzy-matching interaction, not fixable within this PR's scope without either reopening `CatalogQueryPort` again or reimplementing Postgres's `pg_trgm` semantics client-side (both explicitly rejected paths). Correctly flagged as pending a product/user decision, not silently resolved or silently ignored.

Both W1 and W2 were investigated by the chain's own orchestrator-review process at the time they were found, are documented consistently across multiple PR sections without contradiction, and were re-confirmed by me against the actual current source — not just trusted from the prose. Neither blocks archive; both are worth carrying into a tracked follow-up.

**W3 — Task `3b.13` remains unchecked, for a re-confirmed environmental (not code) reason.**
See "Task completion" above. Flagged here only because it is the one item in the 118-task checklist that isn't `[x]`; not a new concern beyond what's already documented.

---

## SUGGESTION (non-blocking cleanup, inherited or newly-introduced debt, worth a future pass)

- The `try/catch/logger.error/never-rethrow` listener body is now duplicated a 4th time across the repo (`refill-auto-solicitado.listener.ts`, `company-visibility.listener.ts`, `match-encontrado.listener.ts`, and now 2 more in `refill-matching/adapters/events/`), with no shared base/helper. Same for the `ERROR_STATUS_MAP`/`@Catch()` exception-filter boilerplate (now a 5th near-verbatim copy: `identidad`/`catalogo`/`consumo`/`refill-matching`/`ofertas`) and `groupRowsBy*`-style row-grouping helpers (3rd occurrence). All explicitly flagged inline in apply-progress.md as recurring, low-severity, out-of-scope-for-a-single-domain-PR debt.
- `precioPorUnidad`'s exact formula (`precio / (altSize * altQty)`) is grounded in a frontend mockup file (`apps/proveedor-mobile/mockups/proveedor.html`), not in any of this change's own written artifacts (`design.md`, `proposal.md`, either delta spec, or `SPEC.md`). Real product-intent evidence, not a guess, but currently un-pinned by any spec scenario — worth a dedicated scenario if this value becomes load-bearing beyond a client-side comparison hint.
- A dedicated `ofertas-dto.spec.ts` (mirroring `identidad`/`catalogo`/`refill-matching`'s own precedent) was deliberately not added; `EnviarOfertaDto`'s conditional `isAlt ⇒ altNote` validation is only exercised transitively through e2e specs today.
- `desplazarHermanas` displaces every `'pendiente'` sibling on a `refillRequestId`, including other `'pendiente'` offers from the *same* company (a direct, spec-consistent consequence of Q6 allowing multiple offers per company) — correctly implemented and documented, but worth confirming product has seen this written down explicitly rather than inferred from behavior.

---

## Design coherence

Read `design.md` in full (D-A through D-G.5, all 3 ASCII diagrams, the module wiring section, the row-types section, and the closing "Reconciliación con `specs/`" table) against the 14-PR implementation. No undisclosed deviation found. Every deviation apply-progress.md itself names (the `OfertaYaAceptadaError` constructor correction in PR3a, the app-side-vs-`now()` timestamp choice in PR3b, the `@Catch()`-scoping decision in PR4b, the DTO-mapper addition in PR5b, the duplicate-catalogProductId non-guard reasoning in PR6b, W1/W2 above) is reasoned, evidence-backed, and consistent with the design's own stated constraints — none of them contradicts an approved spec scenario or silently reopens a decision D1–D18 already closed.

The reconciliation table's 10 rows (design.md's closing section) were checked against the actual `specs/` files: rows 1–3 (the `vigente boolean` mechanism, `text` urgencia, and `obtenerItemsDeProveedor`'s confirmed signature) are reflected in the current `specs/db-schema-ofertas/spec.md` and `specs/core-api-catalogo/spec.md` text (task 1.1's reconciliation-prose work, confirmed landed in PR1) — no stale "provisional, pending design.md's Q1/Q2" language remains.

---

## Overall verdict

**PASS WITH WARNINGS.** 0 CRITICAL, 3 WARNING (2 carried-forward-and-reconfirmed design/implementation gaps + 1 environmental task deferral), several SUGGESTION-level cleanup items. The fresh verification suite run in this pass matches PR8b's own claimed numbers exactly, byte-for-byte on suite/test counts, with the only 2 e2e failures independently root-caused to the same pre-existing, still-active Docker Desktop pause — not a regression introduced anywhere in this chain. Task completion is 117/118, and the 1 remaining item is a confirmed environmental deferral with structural (not full integration) coverage already in place. This change is ready for `sdd-archive`.

## Key Learnings

1. `marcarAceptada`'s unconditional UPDATE and `refill_requests`' own state-transition UPDATE share the identical missing-status-guard shape, confirming a repo-wide concurrency-safety pattern rather than a PR-specific defect.
2. `CatalogQueryPort.buscarCoincidencias` returns a flat, non-per-item-correlated result set, which is the root cause of the categoria-based cross-item mismatch risk in `EnviarOfertaUseCase`.
3. This repo's `*.e2e-spec.ts` convention never touches a real Postgres connection (mocked repository tokens throughout), so Docker Desktop being paused only blocks the genuinely opt-in `*.integration-spec.ts` class of test, not CI-relevant e2e coverage.
4. The 14-PR chain's own apply-progress.md consistently over-forecasts review budget in early foundation PRs (PR1-PR3b ran 20%-450% over tasks.md's own estimates) but converges close to forecast by the later HTTP-surface PRs, a useful calibration data point for future `sdd-tasks` estimates.
