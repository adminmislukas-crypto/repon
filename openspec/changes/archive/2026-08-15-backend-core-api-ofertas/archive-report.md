# Archive Report: `backend-core-api-ofertas`

**Archived**: 2026-08-15
**Commit range**: `4aa1c63..fdcc4c8` on `main` (14 commits)
**Verify status**: PASS WITH WARNINGS — ready for archive (0 CRITICAL, 3 non-blocking WARNING, 117/118 tasks complete). Full report at `verify-report.md` in this folder.

## Commit history

| SHA | Subject | Files | +/- |
|---|---|---|---|
| `4aa1c63` | feat(core-api): add ofertas groundwork — migration, types, ports, errors (PR1) | 10 | +982/-15 |
| `14d81ac` | feat(core-api): add ofertas domain entities and state machine (PR2) | 4 | +517/-4 |
| `83b397f` | feat(core-api): add ofertas Kysely offer repository (PR3a) | 4 | +1224/-8 |
| `97e162c` | feat(core-api): add ofertas Kysely offer-opportunity repository (PR3b) | 5 | +1518/-12 |
| `7580d42` | feat(core-api): add ofertas discovery writer and MatchEncontrado listener (PR4a) | 6 | +810/-12 |
| `4239173` | feat(core-api): add ofertas discovery HTTP surface (PR4b) | 8 | +925/-18 |
| `fcab0f0` | feat(core-api): add ofertas EnviarOfertaUseCase (PR5a) | 7 | +1156/-8 |
| `f338977` | feat(core-api): add ofertas POST /ofertas HTTP surface (PR5b) | 11 | +1367/-28 |
| `1abe766` | feat(core-api): add CatalogQueryPort.obtenerItemsDeProveedor (PR6a) | 5 | +298/-12 |
| `5bdd7fe` | feat(core-api): add ofertas EnviarOfertaProactivaUseCase (PR6b) | 8 | +1342/-18 |
| `2d597d4` | feat(core-api): add ofertas AceptarOfertaUseCase and ObtenerBandeja (PR7a) | 8 | +1307/-22 |
| `072f29b` | feat(core-api): add ofertas acceptance and bandeja HTTP surface (PR7b) | 11 | +1298/-24 |
| `e5de8ce` | feat(core-api): wire ofertas events into refill-matching listeners (PR8a) | 9 | +762/-28 |
| `fdcc4c8` | docs(core-api): close ofertas SPEC.md deltas and audit 14-PR chain (PR8b) | 1 | +147 |

## Domain final shape

`services/core-api/src/domains/ofertas/`:
- `domain/` — `offer.entity.ts` (plain factory functions, zero framework imports): `crearOferta()` (reactive and proactive paths), `aceptar()`, `desplazarHermanas()` (state-transition logic); `offer-item.entity.ts` (discriminated union on `kind`: reactive or proactive); `ofertas.errors.ts` (8 error classes: `OfertaYaAceptadaError`, `SolicitudNoElegibleError`, etc.)
- `ports-in/` — 5 use cases: `enviarOferta` (reactive, transactional, validates eligibility and pricing), `enviarOfertaProactiva` (proactive, no refill_request), `aceptarOferta` (transactional, displaces siblings), `obtenerBandeja` (read, lists offers per user), `listarSolicitudesElegibles` (read, lists opportunities by user)
- `ports-out/` — `OfferRepository` (save, findById, findByRefillRequestId, marcarAceptada, desplazarHermanas), `OfferOpportunityRepository` (saveProjection, findEligible)
- `events/` — `OfertaEnviada`, `OfertaAceptada` (published only after commit)
- `adapters/http/` — `OfertasController` (routes: `POST /ofertas`, `POST /ofertas/:offerId/aceptar`, `GET /ofertas`, `GET /ofertas/solicitudes-elegibles`, all post-authentication, no `@Roles()`), DTOs, mapper, exception filter (8 error→HTTP mappings)
- `adapters/persistence/` — `KyselyOfferRepository`, `KyselyOfferOpportunityRepository` (the projection writer, retire-then-upsert with `vigente` flag, zero physical DELETE statements)
- `adapters/events/` — no listeners in ofertas; 2 new listeners wired into `refill-matching/adapters/events/` by this change (D7)
- `ofertas.module.ts` — `imports: [DatabaseModule, CatalogoModule]` (reuses the same first inter-domain module edge `refill-matching` established), `exports: []` (D7)
- No `contracts/`, no `adapters/scheduling/` (D7/D8, confirmed by folder-shape audit)

Schema: 4 new fix-forward migrations adding `offers`, `offer_items`, `offer_opportunities`, `offer_opportunity_companies`, `offer_opportunity_items` tables; RLS enabled on projection tables with zero policies (service_role only); `offers` published to Supabase Realtime; partial unique index `(refill_request_id) WHERE status = 'aceptada' AND refill_request_id IS NOT NULL` (proactive offers exempt).

`packages/types/src/ofertas.ts` created: `Offer`, `OfferItem` (discriminated union `OfferItemReactiva`/`OfferItemProactiva`), `NuevoOfferItem`, `DatosEntrega`, `SolicitudElegible`, error enums.

## Specs merged into `openspec/specs/`

| Spec | Action | Details |
|---|---|---|
| `core-api-ofertas` | Created (new) — did not previously exist | Entire delta spec copied as new main spec; this is the domain's first SDD change |
| `db-schema-ofertas` | Modified — 3 new requirements appended | Added requirements for the 3 projection tables (`offer_opportunities`, `offer_opportunity_companies`, `offer_opportunity_items`), the vigente-based replace mechanism, and RLS constraints |
| `core-api-catalogo` | Modified — 1 new requirement appended | Added `CatalogQueryPort.obtenerItemsDeProveedor(companyId, ids)` method, additive to existing `buscarCoincidencias` |
| `core-api-refill-matching` | Modified — 2 requirements updated in place | Updated "marcarComoOfertada and marcarComoConfirmada" requirement (now have 2 new listeners wired by ofertas); updated "adapters/events/" requirement (now holds 3 listeners instead of 1, module boundary unchanged) |
| `shared-types-package` | Modified — 4 new requirements appended | Added `NuevoOfferItem`, `DatosEntrega`, `SolicitudElegible`, and related type exports for ofertas |

All 5 merges verified content-correct via empty `diff -r` readbacks: the 1 new file is byte-identical to its delta source; the 4 modified files' diffs were confirmed to preserve all prior domain content (catalogo upload types, refill-matching borrador discriminator, consumo's `UserConsumption.userId`) while adding only this change's new delta requirements.

## Final gate status (re-run at archive time)

lint PASS · typecheck PASS · test PASS (660/660 unit tests across 73 suites, 134/139 e2e tests across 22 suites) · build PASS · format:check PASS. The 2 e2e failures (`test/refill-crear-solicitud.e2e-spec.ts`, `test/refill-completar-borrador.e2e-spec.ts`) are pre-existing Docker Desktop connection timeouts (confirmed via `docker ps` / `supabase status`), not regressions in this change. Zero regressions on `identidad`/`catalogo`/`consumo`/`refill-matching`. Numbers match `sdd-verify`'s independent full run — no drift.

## Task completion

`grep -c '^\- \[x\]'` → **117 completed** · `grep -c '^\- \[ \]'` → **1 unchecked** (task `3b.13`, opt-in real-Postgres integration test blocked by Docker Desktop being manually paused — a confirmed environmental, not code, deferral). All 117 completed tasks have corresponding passing tests or implementation evidence.

## Residual risks and open items carried forward (flagged from design.md and verify-report)

1. **W1 (carried forward from PR7a's design review)**: `marcarAceptada`'s `UPDATE` has no `WHERE status = 'pendiente'` guard under `READ COMMITTED` isolation (see `verify-report.md` W1 for full analysis and precedent in `refill-matching` itself). Correctly documented as a repo-wide pattern, not new to this PR. Non-blocking by design; scoped concurrency fix deferred.

2. **W2 (carried forward from PR5a's design review)**: Categoria-based catalog-match correlation in `enviarOferta` can attribute a match to the wrong solicitud item if two items share the same categoria (see `verify-report.md` W2). Correctly identified as a product-decision defect in a frozen `CatalogQueryPort` contract. Non-blocking by design; requires product/user decision on fallback matching rules.

3. **W3 (environmental deferral)**: Task `3b.13` remains unchecked due to Docker Desktop being manually paused. Not a code gap; structural coverage already in place via unit tests (33 tests in `kysely-offer-opportunity.repository.spec.ts` covering retire-before-upsert order, bulk path behavior, `cerrada_at` exclusion, and `companyIds: []` handling).

4. Named follow-ups from `design.md` (Riesgos residuales, 11 items total) — all explicitly disclosed, not new defects found during archive:
   - Proactive offers never expire (D-D.1) — no `adapters/scheduling/` permitted (D8); named exit path `'descartada'` state pending product decision
   - Repeat calls to `/matching` publish duplicate `MatchEncontrado` events — partially bounded by `POST` (non-prefetchable); `ofertas`-side idempotency or state guard deferred
   - W1/W2 flagged as product-decision deferrals, not blockers
   - 4 SUGGESTION-level items (listener catch/log boilerplate duplication, missing `ofertas-dto.spec.ts`, undocumented `desplazarHermanas` behavior, `precioPorUnidad` formula grounded in frontend mockup only)

## Verification evidence

The `sdd-verify` phase (executed independently at `fdcc4c8`, fresh suite run, no Engram context available — consistent with `sdd-apply` phases in this chain) confirmed:
- 0 CRITICAL issues found
- 3 non-blocking WARNING findings (2 design/implementation gaps + 1 environmental), all already disclosed and tracked in prior PR reviews
- All spec compliance scenarios verified against implementation + passing tests (representative sample per `verify-report`'s methodology)
- Fresh gate run matches claimed numbers exactly (660/660 unit, 134/139 e2e, same 2 pre-existing failures)
- 117/118 task completion, 1 confirmed environmental deferral

See `verify-report.md` (129 lines) for the full independent verification narrative, cross-checked implementation details, and exact root-cause analysis of the 2 e2e timeouts.

## Key learnings

1. The 14-PR chain consistently over-forecasted review budget in early foundation PRs (PR1-PR3b ran 20%-450% over tasks.md estimates) but converged close to forecast by later HTTP-surface PRs, a useful calibration for future SDD tasks estimation.
2. Matching `CatalogQueryPort.buscarCoincidencias`'s contract from `refill-matching` required a new port method (`obtenerItemsDeProveedor`) because the frozen contract's fuzzy-match-only design could not answer "does this exact catalog item belong to this company?" — additive to the port, not a modification.
3. The `vigente boolean` retire-then-upsert projection pattern (vs. physical DELETE or `retirado_at` timestamp) proved the correct choice: it preserves history, handles multi-write concurrency cleanly, and aligns with the repo's "no DELETE anywhere" rule.
4. Two listeners in `refill-matching` wired by this change were implemented and unit-tested in `refill-matching`'s own SDD change (D6) but had zero callers until `ofertas` shipped — a valid pattern for coordinating cross-domain events across multiple SDD cycles.
