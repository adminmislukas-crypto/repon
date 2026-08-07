# Archive Report: backend-core-api-catalogo

**Date**: 2026-08-07
**Change**: `backend-core-api-catalogo`
**Status**: ARCHIVED and CLOSED
**Verification**: PASS WITH WARNINGS (0 CRITICAL, 1 WARNING — fixed post-verify in `4a6459d` — 2 SUGGESTIONS, see `verify-report.md`)
**Test Coverage**: 235 unit tests + 54 e2e tests + 10 opt-in integration tests, all passing

---

## Executive Summary

The `backend-core-api-catalogo` change has been fully implemented, independently verified, and archived. It is the second of six SDD changes covering the 5 remaining `core-api` domains (`catalogo`, `consumo`, `refill-matching`, `ofertas`, `pedidos-pagos`) after `backend-core-api-foundation`. The change delivers 5 delta specs (1 new capability + 4 modified), a complete `catalogo` domain vertical (5 use cases, price invariant, batch partial-failure semantics, cross-tenant authorization closing R1, event-driven suspended-company visibility), the repo's first domain-owned cross-domain contract (`CatalogQueryPort`) and first real `adapters/events/` consumer, and a purely additive extension to the already-archived `identidad` domain (`reactivarEmpresa`, D16) with zero regression to its existing suite.

Implementation shipped as 13 chained PRs (split from an original 9-PR forecast at the `sdd-tasks` review-workload gate, per the maintainer's explicit choice to sub-divide oversized PRs rather than request a size exception), plus 1 orchestrator fix-forward commit and 1 closure commit — 15 substantive commits total, interspersed with 4 apply-progress tracking commits (19 commits in the full range). Two `sdd-apply` batches (PR3b, PR8b/PR9) hit the session's monthly API spend limit mid-task; both were completed directly by the orchestrator with its own tools rather than left incomplete, and this is documented transparently in `apply-progress.md` rather than silently smoothed over.

---

## Delta Specs Merged to Main Specs

| Spec | Merge type | Change |
|---|---|---|
| `core-api-catalogo` | **NEW** | Created at `openspec/specs/core-api-catalogo/spec.md` (213 lines, 12 requirements: `buscarProductos`, `cargarProductoCatalogo`, `cargarCatalogoMasivo` partial-failure + duplicate-in-file rejection, `actualizarPrecio` cross-tenant 404, `ajustarPreciosPorCategoria` proportional scaling, visibility exclusion/reactivation, `CatalogQueryPort` fail-closed contract) |
| `core-api-identidad` | MODIFIED (additive) | +46 lines: `reactivarEmpresa` (D16) — 2 requirements, 6 scenarios, including the explicit R9 no-regression scenario |
| `core-api-hexagonal-layout` | MODIFIED (2 requirements replaced) | +26/-4 lines: `adapters/events/` conditional-presence rule (closes WARNING-2 formally — also corrects an existing scenario that incorrectly claimed `identidad` has `adapters/events/`); domain-owned vs. kernel-owned `contracts/` placement distinction (D1) |
| `shared-types-package` | MODIFIED (additive) | +16 lines: `ArchivoCarga`, `FilaCarga`, `ResultadoCargaMasiva`, `NuevoProductoProveedor` (D12) |
| `db-schema-catalogo` | MODIFIED (additive) | +16 lines: `provider_catalog`'s idempotency behavior (D15's partial unique indexes) |

**All 4 merges into pre-existing main specs were verified diff-by-diff against their source delta files before this report was finalized** — each is a clean append or a precise requirement replacement, nothing in a main spec outside this change's scope was altered.

---

## Change Folder Archive Location

**Source**: `openspec/changes/backend-core-api-catalogo/` (now removed, empty)
**Archived to**: `openspec/changes/archive/2026-08-07-backend-core-api-catalogo/`

Archived artifacts, moved via `git mv` (preserves file history), real line counts:

| File | Lines |
|---|---|
| `proposal.md` | 179 |
| `design.md` | 707 |
| `exploration.md` | 105 |
| `tasks.md` | 206 |
| `apply-progress.md` | 1,070 |
| `verify-report.md` | 112 |
| `specs/core-api-catalogo/spec.md` | 213 |
| `specs/core-api-identidad/spec.md`, `specs/core-api-hexagonal-layout/spec.md`, `specs/shared-types-package/spec.md`, `specs/db-schema-catalogo/spec.md` | delta specs, preserved for reference |
| `archive-report.md` | this file |

---

## Verification Status

**Verdict** (independent `sdd-verify` pass, fresh context, no involvement in implementation): **PASS WITH WARNINGS**

- **Gates**: `pnpm lint`/`typecheck`/`test`/`build`/`format:check` all PASS, re-run independently by the verifier (not trusted from `apply-progress.md`). `pnpm test`: **235 unit / 36 suites, 54 e2e / 8 suites**. Opt-in integration suite: **10 tests / 3 suites**, also re-run.
- **R1 (highest-severity named risk — cross-tenant `actualizarPrecio`)**: VERIFIED CLOSED by direct source read of `actualizar-precio.use-case.ts` (single `if`, single `throw`, single error class for both "not found" and "wrong company") plus a passing e2e test proving byte-identical 404 responses.
- **R9 (identidad regression guarantee)**: VERIFIED via `git diff --stat d34efb2 70287ed -- services/core-api/src/domains/identidad/` — the 6 pre-existing use-case files (`aprobar-empresa`, `suspender-empresa`, `suspender-usuario`, `asignar-rol-admin`, `registrar-usuario`, `registrar-empresa`) are byte-identical; only new files and append-only edits exist. `identidad`'s full suite grew from its pre-change baseline of 111 unit + 17 e2e (as of `backend-core-api-foundation`'s own archive) to **120 unit + 22 e2e** after this change's additive `reactivarEmpresa` (+9 new tests, 0 modified), confirmed isolated from `catalogo`'s own test count via a `--testPathIgnorePatterns` re-run.
- **D2's structural guarantee** (`cargarCatalogoMasivo` never wraps a transaction): VERIFIED via a reflection-level test asserting `TRANSACTION_MANAGER` is absent from the use case's DI token list, not just "never called."
- **The mandatory D-A cross-domain contract test**: VERIFIED to actually run under CI (`test/catalogo-visibility.e2e-spec.ts` — the verifier independently confirmed this filename, not `*.contract-spec.ts` as `tasks.md`/`design.md`'s prose literally says, is what matches this repo's actual Jest config) and to genuinely fail on an `@OnEvent` channel-string mismatch.
- **`CatalogQueryPort` fail-closed contract**, **module export boundary** (`exports: [CATALOG_QUERY_PORT]` exactly), and the **DB schema** (both partial unique indexes, `catalog_hidden_companies`' RLS/grants) were each independently re-verified against source and a live local Postgres instance.

### Issues Found (from `verify-report.md`)

1. **WARNING** — a self-promised `catalogo/SPEC.md` delta note (the 413-vs-400 HTTP status split for oversized `cargarCatalogoMasivo` uploads) was flagged in the PR5b fix-forward commit's own text but not delivered when Phase 9 was checked off. **Fixed post-verify**, commit `4a6459d` — documentation-only, the runtime behavior was already correct.
2. **SUGGESTION** — no e2e test proves the 413 path specifically (accepted: framework-guaranteed Multer behavior, low regression risk).
3. **SUGGESTION** — `tasks.md`'s review-workload line-count estimates ran 2-3x under actual on 5 of 13 PRs (4a, 4b, 5a, 5b, 6), consistently attributable to thorough test-coverage depth rather than scope creep (self-flagged transparently in every affected PR's own risk report). Worth recalibrating `sdd-tasks`'s forecasting model for the next SDD change in this project — not a defect in this one.

---

## Commits Archived

**All 19 commits on `main`** (commit range `4b6bf49..4a6459d`, i.e. everything after `backend-core-api-foundation`'s own closure), exact subjects per `git log --oneline 4b6bf49..4a6459d`:

| Commit | Subject | Note |
|--------|---------|------|
| `31bbcb6` | feat(core-api): add catalogo DB foundation — migrations, row types, pool timeouts | PR1 |
| `2455e86` | feat(core-api): move CatalogQueryPort to contracts/, extend catalogo ports-out | PR2 |
| `283caad` | feat(core-api): add ProviderCatalogItem entity with price invariant | PR3a |
| `24fe29a` | feat(core-api): add catalogo read-side adapters, buscarProductos, and visibility filter | PR3b |
| `ab097e8` | feat(core-api): add catalogo unit-write use cases with cross-tenant 404 protection | PR4a — closes R1 |
| `761e32d` | docs(core-api): record PR4a apply-progress for backend-core-api-catalogo | tracking |
| `3c38204` | docs(core-api): clarify Engram tool-availability note in apply-progress | tracking |
| `1accff1` | feat(core-api): add catalogo write HTTP surface, exception filter, and PrecioActualizado event | PR4b |
| `6e52136` | docs(core-api): record PR4b apply-progress for backend-core-api-catalogo | tracking |
| `176c4a2` | feat(core-api): add carga-masiva CSV parser with envelope validation | PR5a |
| `372f280` | feat(core-api): add cargarCatalogoMasivo use case with per-row partial-failure reporting | PR5b |
| `d7ea5fd` | chore(openspec): record PR5b apply-progress for backend-core-api-catalogo | tracking |
| `b3312da` | fix(core-api): document 413 vs 400 split for oversized carga-masiva uploads | orchestrator fix-forward |
| `8cb8264` | feat(core-api): add ajustarPreciosPorCategoria with transactional saveMany | PR6 |
| `5587673` | feat(core-api): add identidad reactivarEmpresa use case (additive, R9) | PR7 — touches identidad |
| `3902d7c` | feat(core-api): add catalogo visibility listener and projection writer | PR8a |
| `a0532bc` | test(core-api): add catalogo cross-domain event contract test | PR8b |
| `70287ed` | docs(core-api): close backend-core-api-catalogo — SPEC.md deltas and SDD planning artifacts | PR9 closure |
| `4a6459d` | docs(core-api): add verify-report and close 413/400 SPEC.md gap for catalogo | post-verify fix |

**Working tree**: Clean at the time of this archive (after this report's own commit).
**All tasks in `tasks.md`**: Marked `[x]` (verified via `grep -c '\- \[ \]' tasks.md` returning 0 before archiving).

---

## Artifact Store Mode

**Mode**: `hybrid` (openspec files + Engram)

- ✅ Delta specs merged to `openspec/specs/*/spec.md` (filesystem)
- ✅ Change folder moved to `openspec/changes/archive/2026-08-07-backend-core-api-catalogo/` (filesystem, via `git mv`)
- ✅ This archive report (filesystem)
- ⚠️ Engram: `mem_*` MCP tools were not exposed to any `sdd-*` sub-agent in this session (confirmed across all 6 phases — explore/propose/spec/design/tasks/apply/verify/archive) despite being listed in each agent type's tool definition. The orchestrator persisted every phase's summary to Engram itself from the main thread throughout this change; this archive report should be persisted the same way.

---

## Next Steps

**This change is complete and closed.**

**Recommended follow-ups**:
1. `consumo` is the next of the 5 remaining `core-api` domains (per the user's original request order: catalogo → consumo → refill-matching → ofertas → pedidos-pagos), now with `core-api-hexagonal-layout`'s spec carrying real precedent for a domain-owned cross-domain contract and an event-consuming domain — both patterns `consumo`/`refill-matching`/`ofertas` are likely to need.
2. Recalibrate `sdd-tasks`'s review-workload line-count forecasting for strict-TDD, high-authorization-risk work before the next domain's task breakdown (SUGGESTION 3 above).
3. Frontend work remains scheduled after all 5 backend domains are done.

---

## Archive Integrity Checklist

- [x] All 5 delta specs merged into main specs, diff-verified (1 new, 4 modified)
- [x] Change folder moved to archive with `YYYY-MM-DD` prefix via `git mv` (history-preserving)
- [x] Verification: PASS WITH WARNINGS, 0 CRITICAL, the 1 WARNING fixed pre-archive
- [x] All tasks marked `[x]` in the archived `tasks.md`
- [x] All 19 commits present on `main` (range `4b6bf49..4a6459d`), subjects verified against real `git log`, not paraphrased
- [x] Archive report rewritten with independently-verified data after an initial draft was found to contain fabricated commit subjects and line counts — corrected before this change was considered closed
- [x] Orchestrator review complete (no push — per instructions)

---

**Change Archived**: 2026-08-07
**Archived by**: orchestrator (main thread), completing and correcting an initial `sdd-archive` sub-agent pass that left the file move incomplete, made no commit, and fabricated the commits table
**Ready for next phase**: YES — proceed with `consumo`
