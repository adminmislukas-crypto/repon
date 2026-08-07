# Verify Report: `backend-core-api-catalogo`

**Verifier**: sdd-verify (independent pass, fresh context, no involvement in implementation)
**Commit range verified**: `31bbcb6`..`70287ed` on `main` (13 chained PRs + 1 fix-forward `b3312da` + 1 closure commit `70287ed`, plus a handful of interstitial `docs(core-api): record apply-progress` commits)
**Working tree**: clean at HEAD (`70287ed`), branch `main`
**Verdict: PASS WITH WARNINGS**

## 1. Test/build gates — run for real, this session

| Gate | Result | Evidence |
|---|---|---|
| `pnpm lint` | PASS (exit 0) | Only the pre-existing unrelated Node engine WARN |
| `pnpm typecheck` | PASS (exit 0) | `packages/types` + `services/core-api` both `Done` |
| `pnpm test` | PASS (exit 0) | `core-api`: **235 unit / 36 suites**, **54 e2e / 8 suites** — matches apply-progress.md's claimed "235 unit + 54 e2e" exactly |
| `pnpm build` | PASS (exit 0) | `tsc -p tsconfig.build.json: Done` |
| `pnpm format:check` | PASS (exit 0) | "All matched files use Prettier code style!" |
| Opt-in integration suite (local Supabase available, ran it) | PASS | `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm exec jest --config ./test/jest-integration.json` → **3 suites / 10 tests**, matches apply-progress.md's claim exactly |
| Isolation re-run: non-catalogo slice | PASS | `pnpm exec jest --testPathIgnorePatterns="domains/catalogo"` → **120 unit**; `--config jest-e2e.json --testPathIgnorePatterns="catalogo"` → **22 e2e**. Matches the R9 regression claim ("120 unit + 22 e2e") exactly |

No test count was taken on faith — every number above was reproduced independently in this session, not copied from apply-progress.md.

## 2. R1 (highest-severity risk) — cross-tenant `actualizarPrecio` — VERIFIED, holds

Read `services/core-api/src/domains/catalogo/ports-in/actualizar-precio.use-case.ts` directly:

```ts
const item = await this.catalogRepository.findById(itemId);
if (!item || item.companyId !== companyId) {
  throw new CatalogItemNotFoundError(itemId);
}
```

- **Single `if`, single `throw`, single error class** for both "doesn't exist" and "exists but belongs to another company" — no branch-specific message, no second error class. `CatalogItemNotFoundError`'s only interpolated value is `itemId`, which the caller already supplied.
- `CatalogoExceptionFilter` maps `CatalogItemNotFoundError` → `404 CATALOG_ITEM_NOT_FOUND` only; `EmpresaNoActivaError` is the only class mapped to 403, and it's gated earlier (`companyStatus !== 'activo'`), structurally unreachable from the ownership-check branch.
- e2e test (`test/catalogo-mi-catalogo.e2e-spec.ts`) has two dedicated tests: `'returns 404 CATALOG_ITEM_NOT_FOUND — never 403 — for a cross-tenant item, and does not mutate (R1)'` and `'returns 404 CATALOG_ITEM_NOT_FOUND for a genuinely missing item — byte-identical to the cross-tenant case'`. Both assert `res.body` matches `{ statusCode: 404, code: 'CATALOG_ITEM_NOT_FOUND' }` and `catalogRepository.save`/`eventPublisher.publish` were never called on the cross-tenant path.
- **Confirmed**: apply-progress.md's "byte-identical response" claim is real, not just asserted — verified by direct source read plus a passing e2e test that actually distinguishes 404-vs-403.

## 3. D2 structural guarantee — `cargarCatalogoMasivo` never injects `TRANSACTION_MANAGER` — VERIFIED

`cargar-catalogo-masivo.use-case.ts` constructor: `@Inject(CATALOG_REPOSITORY)` + `@Inject(EVENT_PUBLISHER)` only — no `TRANSACTION_MANAGER` import or injection anywhere in the file. Additionally, `cargar-catalogo-masivo.use-case.spec.ts` has a dedicated structural test reading `Reflect.getMetadata('self:paramtypes', CargarCatalogoMasivoUseCase)` and asserting the token list does not contain `TRANSACTION_MANAGER` — this is a compile/reflection-level guarantee, not just "never called at runtime."

## 4. R9 regression guarantee — `identidad` byte-unmodified — VERIFIED

`git diff --stat d34efb2 70287ed -- services/core-api/src/domains/identidad/` shows exactly 10 touched files, all newly created or append-only:
- `identidad.controller.ts`, `identidad-exception.filter.ts`, `identidad.errors.ts`, `identidad.module.ts`, `identidad-dto.spec.ts`, `identidad-exception.filter.spec.ts` — all **modified** with pure additions (new route method, new `Map` entry + `@Catch()` name, new error class, new provider, new describe block).
- `reactivacion.dto.ts`, `empresa-reactivada.event.ts`, `reactivar-empresa.use-case.ts`, `reactivar-empresa.use-case.spec.ts` — all **new files**.

Ran `git diff --stat d34efb2 70287ed` against the 6 named pre-existing use-case files explicitly (`aprobar-empresa.use-case.ts`, `suspender-empresa.use-case.ts`, `suspender-usuario.use-case.ts`, `asignar-rol-admin.use-case.ts`, `registrar-usuario.use-case.ts`, `registrar-empresa.use-case.ts`) — **empty diff, byte-identical**. R9 holds.

## 5. Mandatory D-A contract test — VERIFIED, genuinely load-bearing

`services/core-api/test/catalogo-visibility.e2e-spec.ts`:
- **Correctly named** `.e2e-spec.ts`, not `.contract-spec.ts` as `tasks.md`/`design.md`'s prose literally says — verified `test/jest-e2e.json`'s `testRegex: ".e2e-spec\\.ts$"` and `package.json`'s unit-test block (`rootDir: "src"`, so `test/` is never scanned by `pnpm test:unit`). A `.contract-spec.ts` file would have matched **none** of the 3 configured Jest patterns and silently never run — the apply-progress.md note about this rename is accurate and the fix is real.
- Imports `identidad`'s **real** event classes (`EmpresaSuspendida`, `EmpresaReactivada`, `EmpresaAprobada`) and publishes them through the **real** `EventEmitterPublisher`/`EventEmitter2` (`emitAsync`), with only `CATALOG_VISIBILITY_PROJECTION` mocked.
- Would genuinely fail on an `@OnEvent` string mismatch: the listener subscribes by literal string (`'empresa.suspendida'` etc.), and the test's own header comment documents a real bug this test caught during authoring (`.compile()` alone doesn't fire `onApplicationBootstrap`, so `@OnEvent` wasn't wired until `moduleRef.init()` was added) — evidence the test was actually executed and iterated on, not written-and-assumed-green.
- 4th test explicitly proves fail-open/no-rethrow (R4) with a real `emitAsync` round trip.

## 6. `CatalogQueryPort` fail-closed contract — VERIFIED

`KyselyCatalogQueryAdapter.buscarCoincidencias` wraps its entire query body in `try { ... } catch (error) { throw new CatalogQueryUnavailableError(undefined, { cause: error }); }` — every failure path re-throws as the domain error; there is no `catch { return [] }` anywhere. The empty-input short-circuit (`itemsSolicitados.length === 0 → return []`) is a genuine "no items requested" case, not a degraded-on-failure path, and is outside the `try` block by construction.

## 7. Module boundary — VERIFIED

`catalogo.module.ts`: `exports: [CATALOG_QUERY_PORT]` — read directly, exactly one export, nothing else. `eslint.config.js`'s `RESTRICTED_SUBPATHS` (`ports-out`, `adapters/persistence`, `adapters/events`, `domain`) confirms `contracts/` is the only cross-domain-importable subpath — matches PR2's own verification method.

## 8. DB schema — verified directly against a live local Postgres (not just migration-file reading)

Ran `psql` against the local Supabase instance (already running in this environment):
- `catalog_hidden_companies`: exact column shape, `updated_at` trigger present, **RLS enabled, zero policies**, **zero grants to `anon`/`authenticated`**, **no `DELETE` grant to `service_role`** — all match design.md D-A verbatim.
- `provider_catalog`: both partial unique indexes present with the exact predicates design.md specifies (`WHERE catalog_product_id IS NOT NULL` / `WHERE catalog_product_id IS NULL`, with `lower(btrim(...))` normalization on the second).

## 9. Spec-to-test spot checks — `core-api-catalogo` and `core-api-identidad`

Every scenario spot-checked has a discoverable, named, currently-passing test:
- `buscarProductos` happy path / 401 → `test/catalogo-buscar-productos.e2e-spec.ts`
- Cross-tenant visibility (`findMatching` anti-join present, `findByCompany`/`findByCompanyAndCategoria` anti-join absent) → `kysely-catalog.repository.spec.ts`, describe blocks named exactly per the spec scenario titles
- `ajustarPreciosPorCategoria` proportional scaling (`1000/1500 @10% → 1100/1650`, the exact spec.md numbers), `porcentaje <= -100` rejection before any repo call, cross-company isolation → `test/catalogo-ajustes-precio.e2e-spec.ts`
- `reactivarEmpresa`: happy path, 409 non-suspended, 404 missing company, soporte role → `test/identidad.e2e-spec.ts` + `reactivar-empresa.use-case.spec.ts`

No scenario in either of these two specs was found without a corresponding test.

## 10. Residual risks (design.md's 6 named open items) — none silently required by spec

Cross-checked each of the 6 against `specs/core-api-catalogo/spec.md`'s actual requirements: none is mandated by a spec.md scenario. `spec.md`'s own "Open item deferred beyond this spec" section explicitly defers upload limits; no scenario requires a self-catalog-listing endpoint, `totalActualizados` in the HTTP response body (only in the event payload), an RLS-bypass fix, or reconciliation. These are correctly accepted risks / named follow-ups, not dropped requirements.

---

## Issues Found

### WARNING — Self-promised SPEC.md delta for the 413-vs-400 upload split was not delivered, despite Phase 9 marked complete

`apply-progress.md`'s own PR5b/orchestrator fix-forward note (commit `b3312da`) states explicitly: *"For Phase 9 closure: this 413/400 split should be named explicitly in `catalogo/SPEC.md`'s delta list (task 9.1) — it's a real HTTP contract detail no spec.md scenario currently pins."*

Checked `services/core-api/domains/catalogo/SPEC.md` directly (`grep -n "413\|PayloadTooLarge\|ARCHIVO_CARGA_INVALIDO"`) — **zero matches**. Task 9.1 is checked `[x]` and its own apply-progress.md description lists 7 specific deltas that were applied, and the 413/400 split is not among them. The code behavior itself is correct and intentional (Multer's `limits.fileSize` legitimately intercepts before `parseArchivoCarga` runs, verified in the controller's `@ApiPayloadTooLargeResponse` decorator and doc comment) — this is a **documentation-completeness gap**, not a functional defect: a self-identified action item was tracked, promised for Phase 9, and then not actually delivered, while the closing task was checked off as done anyway.

**Fix**: append one line to `catalogo/SPEC.md` (or an explicit HTTP-contract-detail note near `cargarCatalogoMasivo`) documenting that an oversized upload surfaces as `413 Payload Too Large` (Multer/framework-level, not this domain's `400 ARCHIVO_CARGA_INVALIDO`).

### SUGGESTION — No e2e test proves the oversized-upload path actually returns 413 (self-acknowledged gap)

`test/catalogo-carga-masiva.e2e-spec.ts` tests wrong-mimetype and malformed-header (both → `400 ARCHIVO_CARGA_INVALIDO`) but has no test sending an actually-oversized multipart body. apply-progress.md documents this as a deliberate choice ("framework-guaranteed behavior, not custom application logic"), which is a reasonable call, but it does mean the 413 behavior is asserted only by code inspection in this verify pass, not by a running test. Low risk (NestJS/Multer's own behavior), worth a follow-up e2e test if the maintainer wants full black-box proof.

### SUGGESTION — Review-workload estimates were consistently, substantially exceeded (2–3x on several PRs)

PR4a (591/617 vs 320-400 est.), PR4b (930/960 vs 260-340 est.), PR5a (~35% over), PR5b (978/1,006 vs 300-380 est., 2.6-3.3x), PR6 (~2-2.5x) all landed well over `tasks.md`'s own forecast, every time self-flagged transparently in apply-progress.md's "Workload note" sections (not silently absorbed) and attributed to test-coverage depth rather than scope creep — consistent with the code inspected in this pass (test files are consistently the majority of each diff). Not a defect in this change, but worth feeding back into how `sdd-tasks` calibrates line-count forecasts for strict-TDD, high-authorization-risk work: the pattern held across 5 of 13 PRs, so the estimation model itself, not any one PR, is the thing to recalibrate for the next SDD change.

---

## Verdict

**PASS WITH WARNINGS** — 0 CRITICAL, 1 WARNING, 2 SUGGESTION.

No CRITICAL issue was found. R1 (the change's highest-severity named risk) is structurally closed and independently re-verified against live code and a passing e2e test, not just apply-progress.md's own narrative. R9's regression guarantee is verified via direct `git diff`, not trust. All 5 mandatory gate commands plus the opt-in integration suite were re-run in this session and match the numbers apply-progress.md claims exactly. The one WARNING is a real but non-blocking documentation gap (a self-promised SPEC.md delta that didn't land); it does not affect runtime correctness and is trivial to close in a follow-up docs-only commit, so it should not block archive — but it should be logged so it doesn't silently disappear a second time.
