# Archive Report: `backend-core-api-refill-matching`

**Archived**: 2026-08-12
**Commit range**: `b860970`..`17bed4b` on `main` (12 commits)
**Verify status**: PASS (0 CRITICAL, 0 WARNING, 2 SUGGESTION — both informational process observations about `sdd-tasks`' line-count forecasting and the still-unrun opt-in integration test, neither blocking archive). Full report at `verify-report.md` in this folder.

## Commit history

| SHA | Subject | Files | +/- |
|---|---|---|---|
| `b860970` | feat(core-api): add refill-matching groundwork — migrations, types, repository port, errors (PR1) | 9 | +736/-28 |
| `3b5d6ae` | docs(openspec): rescue untracked refill-matching planning artifacts | 5 | +1619 |
| `6bd2fd0` | feat(core-api): add refill-matching domain entities and state machine (PR2) | 4 | +829/-8 |
| `69b26a7` | feat(core-api): add refill-matching Kysely persistence adapter (PR3) | 4 | +1117/-10 |
| `bf0c93e` | feat(core-api): add refill-matching crearSolicitud use case (PR4a) | 6 | +485/-4 |
| `a2f2b58` | feat(core-api): add refill-matching crearSolicitud HTTP surface (PR4b) | 12 | +954/-11 |
| `6fc11f0` | feat(core-api): add refill-matching buscarProveedoresCompatibles use case (PR5a) | 6 | +679/-10 |
| `4d68b6b` | feat(core-api): add refill-matching buscarProveedoresCompatibles HTTP surface (PR5b) | 9 | +713/-36 |
| `9b800f7` | feat(core-api): add refill-matching auto-borrador listener (PR6a) | 9 | +805/-8 |
| `7f93ba0` | feat(core-api): add refill-matching completarBorrador use case (PR6b) | 11 | +1280/-25 |
| `c94b7e5` | docs(core-api): close refill-matching SPEC.md/ARCHITECTURE.md gaps and add state-machine use cases (PR7) | 10 | +575/-23 |
| `17bed4b` | test(core-api): add sdd-verify report for refill-matching — PASS, 0 critical/warning | 1 | +147 |

`3b5d6ae` is out of PR-sequence order: it rescues `proposal.md`/`design.md`/`specs/*` from earlier SDD phases that had been written to disk but never committed (discovered as untracked files right after PR1, before PR2 was launched) — same risk class `consumo`'s own `c911c82` rescue commit closed. No functional code; a documentation-safety commit.

10 apply-phase PRs (PR1 through PR7, tasks.md 80/81 — task 3.11, an opt-in local-Postgres integration test explicitly marked "not CI", is deliberately unchecked) plus 2 supporting commits: 1 rescued-planning-docs (`3b5d6ae`) and 1 verify-report (`17bed4b`, committed separately since `sdd-verify` ran clean on the first full attempt with no WARNING-closure commits needed, unlike `consumo`'s cycle).

## Domain final shape

`services/core-api/src/domains/refill-matching/`:
- `domain/` — `refill-request.entity.ts` (plain factory functions, zero framework imports): `crearSolicitudActiva()`, `crearBorrador()`, `completar()` (borrador→abierta transition, non-mutating on rejection), `marcarOfertada()`/`marcarConfirmada()` (4-state machine); `refill.errors.ts` (6 error classes); `refill-item-borrador.type-test.ts` (type-level `@ts-expect-error` fixture, checked by `tsc` not Jest)
- `ports-in/` — 6 use cases: `crearSolicitud` (manual path, transactional, publishes `RefillCreado`), `buscarProveedoresCompatibles` (matching — **no `TRANSACTION_MANAGER` injected**, first real consumer of `catalogo`'s frozen `CatalogQueryPort`), `crearBorradorRefill` (internal-only, listener's entry point, publishes nothing), `completarBorrador` (borrador→abierta, reuses `RefillCreado`), `marcarComoOfertada`/`marcarComoConfirmada` (D6: built and tested, zero HTTP surface, zero callers in this change — same class as `consumo`'s `adherenciaUltimos7Dias`)
- `ports-out/` — `RefillRepository` (`save`, `findById`, `findBorradorByConsumption`, `actualizarEstado`)
- `events/` — `RefillCreado`, `MatchEncontrado` (share a `RefillSolicitudPayload` base; never carry `direccion` or a `ProviderCatalogItem` snapshot)
- `adapters/http/` — `RefillController` (3 routes under `refill` prefix, `mis-solicitudes`/`mis-solicitudes/:id/matching`/`mis-solicitudes/:id/completar`, all `POST`, no `@Roles()`), DTOs, mapper, exception filter (7 error→HTTP mappings total)
- `adapters/persistence/` — `KyselyRefillRepository` (the `Number(null) === 0` mapper callout handled with explicit conditional conversion)
- `adapters/events/` — `RefillAutoSolicitadoListener` (this domain's only event consumer; catches and logs, never re-throws; subscribes to `consumo.refill_auto_solicitado` only, never `consumo.stock_bajo_detectado`)
- `refill-matching.module.ts` — `imports: [DatabaseModule, CatalogoModule]` (the **first inter-domain module edge in the repo** — purely additive, zero edits to any `catalogo` file across the whole 10-PR chain), `exports: []` (D7)
- No `contracts/`, no `adapters/scheduling/` (D7/D8, confirmed by folder-shape audit)

Schema: 2 new fix-forward migrations (`14_refill_matching_estado_borrador.sql`, `15_refill_matching_completitud_diferida.sql`) — a 4th `refill_estado` enum value (`'borrador'`, added `BEFORE 'abierta'` in its own migration since Postgres forbids using a newly-added enum value in the same transaction that adds it), 4 columns relaxed to nullable (`direccion`, `comuna`, `categoria`, `precio_referencia`), a new nullable `consumption_id` correlation key (no FK, by design) with a partial unique index for listener-side dedup. The original, already-applied `04_refill_matching.sql` was never edited.

`packages/types/src/refill-matching.ts` rewritten: `RefillItem`'s shape is **byte-identical to before this change** (verified via zero `catalogo` diff across the whole range) — `RefillItemBorrador` is a new sibling type, not a widened `RefillItem`. `RefillRequest` is now a discriminated union on `estado` (`RefillRequestBorrador` | `RefillRequestActiva`).

## Specs merged into `openspec/specs/`

| Spec | Action |
|---|---|
| `core-api-refill-matching` | Created (new) — did not previously exist as a main spec |
| `db-schema-refill-matching` | Modified — 1 requirement replaced in place (`comuna` framing corrected, stale "Edge Function" language removed), 3 new requirements appended (`'borrador'` enum value, nullable-column relaxation, `consumption_id` + partial unique index) |
| `shared-types-package` | Modified — 3 new requirements appended after `consumo`'s prior delta (named `Urgencia`/`RefillEstado` exports, the `RefillRequest` discriminated union with `RefillItem`'s frozen-shape guarantee, `NuevoRefillItem`) |

All 3 merges verified content-correct: the 1 new file is byte-identical to its delta source (confirmed via `diff`); the 2 modified files' diffs were reviewed directly to confirm `catalogo`'s and `consumo`'s prior content (upload types, `UserConsumption.userId`, the 2 pre-existing `db-schema-refill-matching` RLS requirements) was fully preserved, with only this change's own delta added/replaced.

## Final gate status (re-run at archive time)

lint PASS · typecheck PASS · test PASS (472 unit / 60 suites, 106 e2e / 17 suites) · build PASS · format:check PASS. Zero regressions on `identidad`/`catalogo`/`consumo`. Numbers match both `sdd-verify`'s live run and every individual PR's own gate run throughout the apply phase — no drift observed at any point across the whole change.

## Residual risks and open items carried forward (13, from design.md's "Riesgos residuales y preguntas abiertas")

1. Borrador does not expire (D-D.1) — no draft-expiry mechanism exists, and D8 forbids `adapters/scheduling/` for this domain, the only mechanism that could build one. Accepted; named exit path is a future `'descartada'` state + discard route.
2. `consumption_id` is a schema/types change additional to D3/D4, declared as such — deferring it would have made the correlation data irrecoverable once the triggering event passed.
3. `MatchEncontrado` is not deduplicated across repeat calls to the matching route — verified directly against `buscar-proveedores-compatibles.use-case.ts`: no state-based guard exists, so `POST .../matching` called N times publishes N events. Partially bounded by `POST` (not prefetchable). Named, not built: idempotency on `ofertas`' side, or a state guard here.
4. Matching is permitted on `'ofertada'`/`'confirmada'`, not only `'abierta'` — verified: the use case's only state rejection is `estado === 'borrador'`. Unreachable in practice today only because `marcarComoOfertada`/`marcarComoConfirmada` have no caller yet (D6) — revisit when `ofertas` wires them.
5. Default `estado = 'abierta'` is fail-open under D3 (D-G.4) — neutralized by `KyselyRefillRepository` always writing `estado` explicitly (PR3, dedicated test). The column default itself is unchanged (out of scope — would be a delta on migration `04`).
6. `refill_items` has no `updated_at`/trigger despite migration `04`'s own comment calling it immutable — `completarBorrador` (PR6b) updates existing item rows in place, so that comment's claim is no longer true. The contradiction is declared in `db-schema-refill-matching`'s delta spec; no column added.
7. `Number(null) === 0` could have silently defeated D3 from the mapper — the single highest mechanical-risk item design.md named. Mitigated with an explicit conditional conversion in `KyselyRefillRepository` (PR3) plus a dedicated round-trip test asserting `undefined` (never `0`, never `''`).
8. A listener-created borrador carries only `nombre` — `consumo`'s `kind` never maps to `categoria` (this domain refuses to claim authority over `catalogo`'s vocabulary), no price, no `catalogProductId`. Highest-value named follow-up, inherited from `consumo`'s own PR7 carry-forward list: an additive `user_consumption.catalog_product_id` column would let a future automatic borrador carry a real `catalogProductId`.
9. The `refill` HTTP prefix breaks precedent (every other controller uses its own domain's name) — a declared deviation, not an oversight (a hyphenated domain exposes its resource family, not its internal name; `pedidos-pagos` inherits this rule). Zero clients today; reverting is a one-line change.
10. `?: never` is deliberately NOT used in `RefillRequest`'s discriminated union, unlike `Offer` — there is no structural exclusivity here, only an unknown-yet value; a type unable to represent a legal row would force the mapper to silently drop data.
11. `RefillCreado`/`MatchEncontrado` freeze with zero consumers today (R6) — the RULE governing their payloads (own facts + own computed outputs, never another domain's entity shape) is what has to survive for `ofertas`, not the exact current field list.
12. `ALTER TYPE ... ADD VALUE` is not reversible (R8/D-A) — trivial to undo today with zero rows in production; will not be once `ofertas` holds foreign keys against `refill_requests`.
13. `CatalogoModule` is the first module-to-module edge between two domains in this repo (re-verified at PR7's audit: zero edits to `catalogo` across the whole 10-PR chain) — purely additive and revertible by removing an import, but it is the precedent the two remaining domains (`ofertas`, `pedidos-pagos`) will copy for consuming a `contracts/` they don't own.

## Known follow-ups not fixed in this change (flagged, non-blocking)

- None surfaced by `sdd-verify` beyond the 2 informational SUGGESTIONs already noted above (both process/planning observations, not code defects) — unlike `consumo`'s cycle, this change's `sdd-verify` pass returned PASS with zero WARNINGs on the first attempt, so no post-verify closure commits were needed.

## Process note

Consistent with `backend-core-api-consumo`'s and `backend-core-api-catalogo`'s own archives, the `sdd-archive` sub-agent for this run had no Bash tool access in its delegated context (Read/Edit/Write/Glob only). It correctly performed the 3 spec merges it *could* do with its available tools, verified them by reading the results back in full, and stopped to honestly report the blocker rather than fabricate the remainder — the same positive pattern `consumo`'s run established. The orchestrator completed the `git mv`, commit-history gathering (`git log`), the final gate re-run, and this report using real command output throughout, then verified the sub-agent's 3 spec merges independently (byte-diff for the new file, full diff review for the 2 modified files) before trusting them.

Separately, mid-session the user asked directly whether context was being saved to Engram — it was not, for the entirety of this change's apply phase, despite the project's CLAUDE.md mandating proactive `mem_save` calls by the orchestrator after significant decisions/discoveries. This was corrected once identified (2 memories saved covering the change's architecture and the event-payload-nesting gotcha discovered in PR6a), and a standing behavior correction was recorded in the orchestrator's own personal memory to prevent recurrence in the `ofertas`/`pedidos-pagos` cycles that follow.
