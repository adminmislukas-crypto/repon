# Tasks: `ofertas` — quinto vertical, primera proyección de descubrimiento y primer delta sobre un `contracts/` ajeno congelado

Expands design.md's finalized **8-PR chained sequence** (§"Secuencia de implementación") into checkable, test-first tasks. Order, PR boundaries, and rationale are design.md's (D1-D18 from proposal.md, D-A..D-G.5 from design.md, R1-R11) — not re-derived here.

**Reconciliation finding, surfaced not silently applied**: design.md's own closing section (§"Reconciliación con `specs/`") instructs `sdd-tasks` explicitly — "`sdd-tasks` debe tomar `design.md` como fuente para las 10 filas y emitir los ajustes de prosa correspondientes sobre `specs/`." Rows 1-3 of that table are **not cosmetic**: `specs/db-schema-ofertas/spec.md` and `specs/core-api-catalogo/spec.md`, as approved, still say "provisional, pending design.md's Q1/Q2" — verified by reading both files directly during this phase. Unlike `refill-matching`'s tasks.md (where this reconciliation was already applied before tasks ran), `ofertas`' delta specs still carry the stale placeholder language. This document does not edit those files itself (out of `sdd-tasks`' mandate — checklist only); **Task 1.1 below makes it the first implementation task**, so it isn't lost in `sdd-apply`.

**Pre-split per the `ask-on-risk` delivery strategy**: design.md names PR4 (descubrimiento) as its own explicit split candidate ("el 4 es el candidato #1 a partirse en 4a... y 4b..."), which this document honors verbatim. Independently, this domain bundles **four firsts simultaneously** (first discovery projection, first delta over a frozen `contracts/`, first write inside an archived sibling domain's folder, and — per PR — several "logic + first-HTTP-surface" combinations that `consumo`'s PR2 and `refill-matching`'s PR4/PR5 already proved exceed budget when left whole). PR3 (persistencia) bundles **two** full repository adapters (11 methods total, vs. `refill-matching`'s single 4-method repository) and is additionally split for reviewer-focus reasons design.md states directly ("el PR con la mecánica más delicada del cambio"). PR5 (creación), PR6 (proactiva), PR7 (aceptación) and PR8 (cableado) are each pre-split on the same "logic vs. HTTP" / "isolate the delicate mechanic" / "keep the closing PR docs-only" precedents already established by `consumo` and `refill-matching`. **8 PRs become 14** — every dependency edge below is unchanged from design.md; only the granularity changed.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~3,500-4,480 total, across **14** chained PRs; per-PR range 140-480 |
| 400-line budget risk | **Medium** — 13 of 14 PRs sit clearly under 400 on their upper bound; **PR1 (groundwork)** is the one borderline PR, forecast 380-480, with a named fallback split below |
| Chained PRs recommended | Yes — 14 sequential PRs, dependency-ordered, cannot parallelize except where noted (3a/3b) |
| Chain strategy | stacked-to-main (each PR merges to `main` in order) — 100% precedent across `catalogo`/`consumo`/`refill-matching`, recommended here but **not yet confirmed for this specific 14-PR granularity** |
| Delivery strategy | ask-on-risk (cached this session) — **not yet resolved by a maintainer for this change**; this forecast is `sdd-tasks`' recommendation |

```text
Decision needed before apply: Yes — confirm the 14-PR granularity (vs. a coarser split) and PR1's fallback-split trigger before sdd-apply starts
Chained PRs recommended: Yes
Chain strategy: stacked-to-main, 14 PRs
400-line budget risk: Medium
```

### Per-PR estimate

| PR | Slice | Est. lines | Risk | Note |
|---|---|---|---|---|
| 1 | 0 · groundwork | 380-480 | **Medium-High** | 3-table migration (heaviest DDL in the repo so far) + 5 row types + 3 `@repon/types` additions + `OfferRepository` final form (+3 methods) + new `OfferOpportunityRepository` port (5 methods) + 8 error classes + the reconciliation-prose task (1.1). Pure costuras, but the largest groundwork PR of the 5 domains. **Fallback split if it runs over**: PR1a (migration + 5 row types — pure DB layer) / PR1b (`@repon/types` + both ports-out + `oferta.errors.ts` — pure TS layer), mirroring `refill-matching` PR1's own fallback note |
| 2 | 1 · dominio | 260-330 | Low | Factories `crearOfertaReactiva`/`crearOfertaProactiva`, `isAlt ⇒ altNote`, `total`, `precioPorUnidad`, `OfferStatus` transition with D-G.3's non-`'pendiente'` rejection. Jest puro, sin contenedor Nest |
| 3a | 2a · persistencia (`OfferRepository`) | 280-350 | Low-Medium | `KyselyOfferRepository`'s 6 methods (`save`/`findById`/`findByUser`/`marcarAceptada`/`desplazarHermanas`) + numeric mapper + the `23505`→`OfertaYaAceptadaError` translation (R4) |
| 3b | 2b · persistencia (`OfferOpportunityRepository`, el writer de D5) | 260-330 | **Medium** | design.md's own words: "el PR con la mecánica más delicada del cambio" — isolated for dedicated review of the retire→upsert order, independent of raw size |
| 4a | 3a · descubrimiento (writer + listener) | 220-280 | Low-Medium | design.md's explicit split candidate #1. `RegistrarOportunidadUseCase` + local payload + `MatchEncontradoListener`. Zero HTTP |
| 4b | 3b · descubrimiento (lectura + ruta) | 260-330 | Low-Medium | design.md's split candidate #1, half b. **First HTTP surface of this domain** — `OfertasController`/`OfertasExceptionFilter` bootstrap here, same first-controller cost `consumo`'s 2b/`refill-matching`'s 4b absorbed |
| 5a | 4a · creación (lógica) | 300-380 | **Medium-High** | `EnviarOfertaUseCase` — design.md's "PR que más merece review dedicada"; closes R2+R3; carries the single most important test in the change (D-C ordered-resolution). Zero HTTP |
| 5b | 4b · creación (HTTP) | 240-300 | Medium | `POST /ofertas` + DTOs + 4 filter mappings + e2e. Depends on 5a |
| 6a | 5a · delta de `CatalogQueryPort` | 140-190 | Low | The único PR que toca `catalogo` (R8) — isolated so the diff is a single, small reading |
| 6b | 5b · proactiva | 280-350 | Medium | `EnviarOfertaProactivaUseCase` (D10 + D-B cardinality) + its own instance of the D13 order guarantee + route + e2e |
| 7a | 6a · aceptación (lógica + bandeja) | 260-330 | Medium | `AceptarOfertaUseCase` (tx + displacement + cierre, R4) + `ObtenerBandejaUseCase`. Zero HTTP |
| 7b | 6b · aceptación (HTTP) | 220-290 | Low-Medium | 2 routes on the already-existing controller/filter (cheaper than a first-surface PR) + e2e |
| 8a | 7a · cableado (listeners en `refill-matching`) | 260-340 | Medium | 2 listeners + local payloads + module wiring + 2 e2e de contrato con `moduleRef.init()`. Único diff dentro de un dominio hermano. **Fallback split if it runs over**: 8a-i (listeners + payloads + module wiring) / 8a-ii (the 2 e2e contract tests), mirroring `refill-matching` PR6a's own fallback note |
| 8b | 7b · cierre | 150-210 | Low | Docs-only: 2 SPEC.md deltas + module audit + full workspace verification — kept docs-only on purpose, same precedent as `consumo`/`refill-matching`'s own closing phases |

### Suggested Work Units

| Unit | Goal | PR | Base | Notes |
|---|---|---|---|---|
| 1 | Reconciliation prose + groundwork: migración 16, 5 row types, `@repon/types`, ambos ports-out finales, 8 errores | PR 1 | `main` | Sin dependencias; bloquea todo lo demás |
| 2 | Dominio: factories + `isAlt⇒altNote` + `total`/`precioPorUnidad` + máquina de `OfferStatus` | PR 2 | `main` | Depende de PR 1's tipos/errores. Cero I/O |
| 3a | Persistencia: `KyselyOfferRepository` (6 métodos) | PR 3a | `main` | Depende de PR 2's entidades. **Independiente de 3b** — puede ir en paralelo |
| 3b | Persistencia: `KyselyOfferOpportunityRepository` (el writer de D5) | PR 3b | `main` | Depende de PR 1's puerto/row types. **Independiente de 3a** — puede ir en paralelo |
| 4a | `registrarOportunidad` + `MatchEncontradoListener` | PR 4a | `main` | Depende de 3b's `reemplazar` |
| 4b | `listarSolicitudesElegibles` + HTTP (primer controller/filter) | PR 4b | `main` | Depende de 3b's `listarPorCompany`. Secuenciado después de 4a por orden de diseño; su única dependencia real es 3b |
| 5a | `enviarOferta` (lógica + el test de orden C2) | PR 5a | `main` | Depende de 3a's `save`, 3b's `findElegible`, PR 2's `total` |
| 5b | HTTP de creación | PR 5b | `main` | Depende de 5a. Agrega `CatalogoModule` a `imports` |
| 6a | Delta de `CatalogQueryPort` en `catalogo` | PR 6a | `main` | Sin dependencia de `ofertas`. Aislado (R8) |
| 6b | `enviarOfertaProactiva` + HTTP | PR 6b | `main` | Depende de 6a's método nuevo y 5b's `CatalogoModule` import |
| 7a | `aceptarOferta` + `obtenerBandeja` (lógica) | PR 7a | `main` | Depende de 3a's `marcarAceptada`/`desplazarHermanas`, 3b's `cerrar` |
| 7b | HTTP de aceptación + bandeja | PR 7b | `main` | Depende de 7a |
| 8a | 2 listeners en `refill-matching` + e2e de contrato | PR 8a | `main` | Depende de 5a's `OfertaEnviada` y 7a's `OfertaAceptada` |
| 8b | Cierre: SPEC.md deltas + auditoría | PR 8b | `main` | Depende de 8a — describe comportamiento que ya debe existir |

---

## Phase 1: Groundwork — Spec: `db-schema-ofertas`, `shared-types-package`, `core-api-ofertas` (port final form), `core-api-catalogo` (reconciliation)

- [x] 1.1 **Reconciliation prose** (design.md §"Reconciliación con `specs/`", rows 1-3): edit the 3 approved delta spec files to remove stale "provisional, pending design.md's Q1/Q2" language and state the locked decisions — `openspec/changes/backend-core-api-ofertas/specs/db-schema-ofertas/spec.md` (`urgencia` is `text`, no `CHECK`; the replace mechanism is `vigente boolean` + retire-blanket-then-upsert, never `retirado_at`/versioned `matched_at`) and `openspec/changes/backend-core-api-ofertas/specs/core-api-catalogo/spec.md` (`obtenerItemsDeProveedor(companyId, ids)` is the confirmed, non-provisional signature). Row 4 (`@Roles('user')`) needs no edit — already confirmed in `specs/core-api-ofertas/spec.md`.
- [x] 1.2 Write `supabase/migrations/20260808120000_16_ofertas_discovery_projection.sql` — **verify against the actual latest applied migration file before finalizing the timestamp** (at spec-writing time it is `20260807120100_15_refill_matching_completitud_diferida.sql`, so `20260808...` is the next free day-slot). 3 tables verbatim per design.md §D-A.4: `offer_opportunities` (PK `refill_request_id`; `urgencia text` no `CHECK`, D-A.1; `cerrada_at` never reset by the writer's `ON CONFLICT DO UPDATE`, D-A.3), `offer_opportunity_companies`/`offer_opportunity_items` (both `vigente boolean not null default true`, D-A.2/D5). The 3 indexes (partial on `company_id` where `vigente`; `refill_request_id` on items; `user_id` on opportunities), `set_updated_at()` triggers, RLS enabled zero policies, grants `select/insert/update` to `service_role` only, no `DELETE` anywhere, no FK to `refill_requests`/`refill_items`/`companies`/`profiles` (D4). Confirm `20260803120500_05_ofertas.sql` is **not** edited (fix-forward).
- [x] 1.3 Apply locally (`supabase start`/`db reset`); verify `db-schema-ofertas` Scenarios "A MatchEncontrado with companyIds: [] still writes the header", "The 3 tables carry exactly the columns D1 declares", "No row is ever physically deleted", "No authenticated client can query the projection directly", "service_role can read and write", "No cross-domain FK exists on any of the 3 tables".
- [x] 1.4 `shared/database/schema.ts`: add `OfferKindRow`/`OfferStatusRow` + `OffersTable`/`OfferItemsTable` (first row types for the already-applied `offers`/`offer_items`) + `OfferOpportunitiesTable`/`OfferOpportunityCompaniesTable`/`OfferOpportunityItemsTable` (D14, 5 row types total); register all 5 on `DB`. Numeric columns as `string` (`costo_despacho`, `total`, `precio`, `alt_size`, `alt_qty`, `precio_referencia`) with the callout that `offer_opportunity_items.precio_referencia`/`.categoria` are `NOT NULL` (unlike `refill_items`'s nullable pair) — `Number(row.precio_referencia)` is safe here by the event's own contract, not by luck; `alt_size`/`alt_qty` stay the nullable exception (`=== null ? undefined : Number(...)`, never a naive `Number()`).
- [x] 1.5 `packages/types/src/ofertas.ts`: add `NuevoOfferItem` (discriminated `NuevoOfferItemReactiva`/`NuevoOfferItemProactiva`, `?: never` on the excluded discriminant, mirroring `OfferItemReactiva`/`OfferItemProactiva` — a **named type**, never an alias of `OfferItem`, per the reconciliation table's row 9), `DatosEntrega` (`{ tiempoEntregaHoras, costoDespacho }`), `SolicitudElegible`/`SolicitudElegibleItem` (`urgencia: Urgencia`, imported from `./refill-matching.js`, never re-declared, no `userId` field). Confirm the export count stays at exactly these 3 additions (D14).
- [x] 1.6 Run `pnpm --filter @repon/types typecheck` and workspace-root `pnpm typecheck` — confirm `catalogo`'s files are untouched by this types-only addition.
- [x] 1.7 Rewrite `services/core-api/src/domains/ofertas/ports-out/offer-repository.port.ts` to its final form (D-G.1): add `findById(offerId, tx?)`, `marcarAceptada(offerId, tx: TransactionContext)` (**`tx` required, not `tx?`** — D-G.5), `desplazarHermanas(refillRequestId, exceptoOfferId, tx: TransactionContext): Promise<readonly string[]>` (**`tx` required**). `save`/`findByUser`/`findByRefillRequest` unchanged; doc-comment `findByRefillRequest` as declared-but-uncalled on purpose (D-G.1).
- [x] 1.8 Create `ports-out/offer-opportunity-repository.port.ts` (NEW): `OfferOpportunityRepository` — `reemplazar(snapshot: OportunidadSnapshot, tx: TransactionContext)` (**`tx` required**, D-G.5), `findElegible(refillRequestId, companyId): Promise<OportunidadElegible | null>`, `listarPorCompany(companyId): Promise<SolicitudElegible[]>`, `existeRelacion(companyId, userId): Promise<boolean>`, `cerrar(refillRequestId, tx: TransactionContext)` (**`tx` required**). Declare `OportunidadSnapshot`/`OportunidadElegible` locally in this file (D-G.1 — neither goes to `@repon/types`); `OFFER_OPPORTUNITY_REPOSITORY` token.
- [x] 1.9 Create `domain/oferta.errors.ts`: the 8 error classes from design.md's error table — `SolicitudNoElegibleError`, `OportunidadCerradaError`, `DestinatarioNoElegibleError`, `OfferNotFoundError`, `OfertaYaAceptadaError`, `TransicionInvalidaError`, `ItemsNoDisponiblesError`, `OfertaInvalidaError`.
- [x] 1.10 Run `pnpm lint`/`pnpm typecheck` at workspace root — confirm the new interfaces compile with zero implementers yet.

## Phase 2: Dominio (puro, sin I/O) — Spec: `core-api-ofertas`

Depends on Phase 1's types/errors. Zero adapters, zero I/O.

- [x] 2.1 RED: `domain/offer.entity.spec.ts` — `crearOfertaReactiva(companyId, refillRequestId, items: NuevoOfferItem[], entrega, userId, mensaje?)` rejects `isAlt: true` without `altNote`; happy path returns an `Offer` with `status: 'pendiente'` by construction, id via `randomUUID()`.
- [x] 2.2 GREEN: `domain/offer.entity.ts` — `crearOfertaReactiva()` factory.
- [x] 2.3 RED (extend): `crearOfertaProactiva(companyId, userId, items, entrega, mensaje?)` — same `isAlt ⇒ altNote` rule; `providerCatalogItemId` required per item; `refillRequestId` absent by construction.
- [x] 2.4 GREEN (extend): `crearOfertaProactiva()` factory.
- [x] 2.5 RED (extend): `total(items, costoDespacho)` — pure function, `Σ(item.precio) + costoDespacho`.
- [x] 2.6 GREEN (extend): `total()`.
- [x] 2.7 RED (extend, D-G.2): `precioPorUnidad(item)` — pure function for comparing an `isAlt` item's price against `precioReferencia`; doc-commented residual risk: this function does **not** enforce any ceiling on `isAlt` items — the price cap only applies to non-`isAlt` items, and is enforced in the use case (Phase 5a), not here.
- [x] 2.8 GREEN (extend): `precioPorUnidad()`.
- [x] 2.9 RED (extend, D-G.3): `OfferStatus` transition — accepting from any origin state other than `'pendiente'` (`'aceptada'`/`'rechazada'`/`'expirada'`, including the same offer twice) throws `TransicionInvalidaError` — a double-accept is not a silent no-op.
- [x] 2.10 GREEN (extend): the transition function.

## Phase 3a: Persistencia — `KyselyOfferRepository` — Spec: `core-api-ofertas`, `db-schema-ofertas`

Depends on Phase 2's entities. **Independent of Phase 3b** — can proceed in parallel.

- [x] 3a.1 RED: `adapters/persistence/kysely-offer.repository.spec.ts` — `save()` on a NEW reactiva `Offer`: 1 insert `offers` (`status` **always explicit**, never the column default) + 1 bulk insert `offer_items` (single statement, not N round-trips); numeric mapper for `costo_despacho`/`total`/`precio`; `alt_size`/`alt_qty` `NULL` survive as `undefined`, **never `0`**.
- [x] 3a.2 GREEN: `kysely-offer.repository.ts` — `save()`'s insert path.
- [x] 3a.3 RED (extend): `findById(offerId)` — `Offer | null`, items inline, 1 query with join.
- [x] 3a.4 GREEN (extend): `findById()`.
- [x] 3a.5 RED (extend): `findByUser(userId)` — `obtenerBandeja`'s read, items inline, no N+1.
- [x] 3a.6 GREEN (extend): `findByUser()` gets its first real implementation (previously a thin placeholder).
- [x] 3a.7 RED (extend, R4): `marcarAceptada(offerId, tx)` — a single narrow `UPDATE ... SET status = 'aceptada'` (never a `save()` that rewrites items); the driver's `23505` on constraint `offers_refill_request_id_aceptada_uidx` is caught and re-thrown as `OfertaYaAceptadaError`; any other driver error re-thrown as-is.
- [x] 3a.8 GREEN (extend): `marcarAceptada()`.
- [x] 3a.9 RED (extend): `desplazarHermanas(refillRequestId, exceptoOfferId, tx)` — single `UPDATE ... RETURNING id` (`status = 'rechazada' WHERE refill_request_id = $1 AND id <> $2 AND status = 'pendiente'`), returns exactly the ids the statement moved — **no prior `SELECT`** (D-D).
- [x] 3a.10 GREEN (extend): `desplazarHermanas()`.
- [x] 3a.11 Confirm `findByRefillRequest()` stays declared and unimplemented-beyond-interface with no caller added in this change (D-G.1) — do not wire it to anything.

## Phase 3b: Persistencia — `KyselyOfferOpportunityRepository` (el writer de D5) — Spec: `db-schema-ofertas`, `core-api-ofertas`

Depends on Phase 1's port/row types. **Independent of Phase 3a**. Gets its own PR: design.md's own words, "el PR con la mecánica más delicada del cambio."

- [x] 3b.1 RED (**D18-4, mandatory, written first**): `adapters/persistence/kysely-offer-opportunity.repository.spec.ts` — `reemplazar(snapshot, tx)`: assert the exact 5-statement order against a mocked query builder — (1) upsert cabecera, `cerrada_at` **excluded** from the `ON CONFLICT DO UPDATE SET` (D-A.3); (2) `UPDATE companies SET vigente = false WHERE refill_request_id = $R AND vigente = true` happens **before** (3) upsert companies `SET vigente = true`; (4) `UPDATE items SET vigente = false` happens **before** (5) upsert items `SET vigente = true`. Reversing retire↔upsert is "the easiest bug to introduce in this file" (design.md) — this is the test that catches it. `companyIds: []` omits statement 3 only.
- [x] 3b.2 GREEN: `kysely-offer-opportunity.repository.ts` — `reemplazar()`, with the order-is-not-commutative comment inline.
- [x] 3b.3 RED (extend, D-A.3): a re-run on an already-closed opportunity refreshes the header but the `SET` clause never touches `cerrada_at` — closing is monotonic, a `MatchEncontrado` can never reopen it.
- [x] 3b.4 GREEN (extend): confirm 3b.2 satisfies this, or adjust the `SET` clause.
- [x] 3b.5 RED (extend): `findElegible(refillRequestId, companyId)` — returns `OportunidadElegible` (cabecera + items with `vigente = true`, mapped 1:1 to `RefillItem[]`) only when this `companyId` currently appears in `offer_opportunity_companies` with `vigente = true`; `null` otherwise (feeds `enviarOferta`'s D11 404, Phase 5a).
- [x] 3b.6 GREEN (extend): `findElegible()`.
- [x] 3b.7 RED (extend): `listarPorCompany(companyId)` — 1 query, 2 joins, filters `c.vigente AND o.cerrada_at IS NULL AND i.vigente` (Diagram 3); items inline, no N+1; excludes `userId`.
- [x] 3b.8 GREEN (extend): `listarPorCompany()`.
- [x] 3b.9 RED (extend, D10): `existeRelacion(companyId, userId)` — true iff at least one `offer_opportunities` row owned by `userId` has ever listed this `companyId` as eligible.
- [x] 3b.10 GREEN (extend): `existeRelacion()`.
- [x] 3b.11 RED (extend, D12): `cerrar(refillRequestId, tx)` — idempotent, monotonic `UPDATE ... WHERE cerrada_at IS NULL`.
- [x] 3b.12 GREEN (extend): `cerrar()`.
- [ ] 3b.13 Opt-in integration test (`supabase start` local, not CI): real Postgres round-trip of `reemplazar` — `[A,B] → [A]` leaves B unreadable as eligible; an identical re-run doesn't duplicate rows; zero `DELETE` statements issued across the whole `ofertas` persistence layer (3a + 3b). **NOT RUN this batch — environmental blocker, not skipped silently**: `supabase status` confirms no local stack is currently up, and `docker ps` fails with `Error response from daemon: Docker Desktop is manually paused. Unpause it through the Whale menu or Dashboard.` Checked for a CLI-only fix first (`docker desktop start` → "already running"; `docker desktop --help` → no `resume`/`unpause` subcommand exists, only GUI "Whale menu or Dashboard") before concluding it's blocked — this is a deliberate paused state, not "Docker missing", and forcing it via a GUI action is outside this agent's authority. Opt-in/non-CI per its own task text, so this does not block `pnpm test` below. Left for the orchestrator/user to run once Docker Desktop is unpaused; the mocked-query-builder tests in 3b.1-3b.12 already cover the same 5-statement order and idempotency-by-upsert structurally.

## Phase 4a: Descubrimiento (writer + listener) — Spec: `core-api-ofertas`

Depends on Phase 3b's `reemplazar`. Design.md's explicit split candidate #1, half a.

- [x] 4a.1 `adapters/events/refill-matching-event.payloads.ts` (local, D-F): `MatchEncontradoItemPayload` + `MatchEncontradoPayload` — `Urgencia` imported from `@repon/types`; deliberately **omits** `providerCatalogItemIds` — the doc comment naming this omission is the D8 enforcement (a field that doesn't exist can't be persisted by accident).
- [x] 4a.2 In `ports-in/registrar-oportunidad.use-case.ts`: declare `RegistrarOportunidadInput` locally, field-for-field matching 4a.1's payload shape (own vocabulary — never imports the adapter's payload type from `ports-in/`, same layering discipline as every other boundary in the repo).
- [x] 4a.3 RED: `ports-in/registrar-oportunidad.use-case.spec.ts` — `runInTransaction` wraps exactly 1 `reemplazar(snapshot, tx)` call, snapshot built 1:1 from the input; `companyIds: []` still calls `reemplazar` (`core-api-ofertas` Scenario "A MatchEncontrado with companyIds: [] still writes the header", D2/D5 — never suppressed); constructor injects `TRANSACTION_MANAGER` (D13 — one of the 4 write use cases).
- [x] 4a.4 GREEN: `ports-in/registrar-oportunidad.use-case.ts`.
- [x] 4a.5 RED (**D18-5, one of the 5 mandatory negatives**): `adapters/events/match-encontrado.listener.spec.ts` — `@OnEvent('refill.match_encontrado')` (channel-name STRING, never importing `refill-matching`'s `MatchEncontrado` class); `registrarOportunidad` mocked to reject → the handler still resolves, `logger.error` called, **never re-thrown** (`core-api-ofertas` Scenario "A projection write failure does not propagate to the emitter", R5); confirm no `@OnEvent('refill.creado')` handler exists anywhere in `ofertas/adapters/events/` (Scenario "RefillCreado alone creates no opportunity", D2 — an enumeration/inspection assertion, not just "we didn't write one").
- [x] 4a.6 GREEN: `adapters/events/match-encontrado.listener.ts` — try/execute/catch-and-log, never re-throw.
- [x] 4a.7 `ofertas.module.ts`: first real providers — `imports: [DatabaseModule]` (`CatalogoModule` lands in 5b); bind `OFFER_OPPORTUNITY_REPOSITORY`→`KyselyOfferOpportunityRepository`, `OFFER_REPOSITORY`→`KyselyOfferRepository`; register `RegistrarOportunidadUseCase` (internal, no route) and `MatchEncontradoListener` (in `providers`, `DiscoveryService` finds `@OnEvent` regardless); `exports: []` (D15).

## Phase 4b: Descubrimiento (lectura + ruta) — Spec: `core-api-ofertas`

Depends on Phase 3b's `listarPorCompany`. **First HTTP surface of this domain** — controller/filter created here, not extended, mirroring `refill-matching`'s 4b/`consumo`'s 2b precedent.

- [x] 4b.1 RED: `ports-in/listar-solicitudes-elegibles.use-case.spec.ts` — derives `companyId` only from the actor argument (no DTO input); constructor-injection inspection test: `TRANSACTION_MANAGER` absent (D13, `core-api-ofertas` Scenario "The two read use cases have no transaction manager injected" — first half; `obtenerBandeja` is the other half, Phase 7a).
- [x] 4b.2 GREEN: `ports-in/listar-solicitudes-elegibles.use-case.ts` — constructor takes only `OFFER_OPPORTUNITY_REPOSITORY`.
- [x] 4b.3 `adapters/http/dto/solicitud-elegible-response.dto.ts` (mirrors `SolicitudElegible`, no `userId` field — Diagram 3) + `ofertas.mapper.ts`: `toSolicitudElegibleResponseDto()`.
- [x] 4b.4 `adapters/http/ofertas.controller.ts` (NEW): `GET /ofertas/oportunidades`, `@Roles('provider')`, 200 `SolicitudElegibleDto[]`.
- [x] 4b.5 `adapters/http/ofertas-exception.filter.ts` (NEW, bootstrap): mirrors `RefillExceptionFilter`/`ConsumoExceptionFilter`/`CatalogoExceptionFilter` exactly — constructor-keyed map, `{ statusCode, code, message }` envelope, `@Catch()` scoped. Starts with **zero** mappings (this route throws no domain error); later PRs extend this same file's map incrementally, never replace it.
- [x] 4b.6 `ofertas.module.ts`: add `ListarSolicitudesElegiblesUseCase` + `OfertasController` + `OfertasExceptionFilter` (not in `providers` — `@UseFilters` instantiates it directly, same convention as the repo's other 3 filters).
- [x] 4b.7 E2e: `test/ofertas-listar-oportunidades.e2e-spec.ts` — 401 no token; 403 role `user`; 200 scoped to the actor's own `companyId` (`core-api-ofertas` Scenario "A provider sees only solicitudes where their own company is eligible"); a closed opportunity absent from every provider's list (Scenario "A closed opportunity does not appear in any provider's list" — seed the closed row directly since `aceptarOferta` doesn't exist until Phase 7, document why).

## Phase 5a: Creación (lógica) — Spec: `core-api-ofertas`

Depends on Phase 3a's `save`, 3b's `findElegible`, Phase 2's `total`. Design.md's "PR que más merece review dedicada" — cierra R2 y R3.

- [x] 5a.1 `events/oferta-enviada.payload.ts` + `events/oferta-enviada.event.ts` — `OfertaEnviadaPayload` (`offerId`, `kind`, `companyId`, `userId`, `refillRequestId: string | null`, `total`, `tiempoEntregaHoras`) verbatim D6; `type = 'ofertas.oferta_enviada'`.
- [x] 5a.2 RED (**D18-1, written first per D18**): `ports-in/enviar-oferta.use-case.spec.ts` — non-eligible company → `SolicitudNoElegibleError`; nonexistent `refillRequestId` → the **same** error, byte-identical (`core-api-ofertas` Scenarios "A non-eligible company is rejected with 404" / "A nonexistent refillRequestId is rejected with the same 404").
- [x] 5a.3 RED (extend, Q4): a closed opportunity → `OportunidadCerradaError`/409, checked **after** eligibility so a non-eligible company on a closed R still gets 404, never 409 (Scenario "An offer against a closed opportunity is rejected with 409, not 404").
- [x] 5a.4 RED (extend): a `refillItemId` not belonging to R (validated against the projection's items, never trusted from the client) → `OfertaInvalidaError`/400, rejected before any write (Scenario "A refillItemId from another solicitud is rejected").
- [x] 5a.5 RED (extend, **D-C/Q7/R3 — the single most important test in the change**): `buscarCoincidencias` mocked with an `await Promise.resolve()` delay pushing `'catalogo:resuelto'`; `runInTransaction` mocked pushing `'tx:abierta'`; assert the order array is exactly `['catalogo:resuelto', 'tx:abierta']` — catches both an un-awaited call and a call made from inside the transaction (design.md D-C, `core-api-ofertas` Scenario "The catalog port resolves before the transaction opens"). Write it standalone, not folded into another scenario.
- [x] 5a.6 RED (extend): `CatalogQueryUnavailableError` from `buscarCoincidencias` is **not** caught by the use case — propagates uncaught (Scenario "A catalog outage maps to 503, never a degraded offer" — the 503 mapping itself is 5b's job).
- [x] 5a.7 RED (extend, D-G.2): an item with no live match in the catalog result → rejected (the hard rule); a non-`isAlt` item priced above `precioMaximo` → rejected; an `isAlt` item priced above `precioMaximo` → **not** rejected (the residual risk, asserted explicitly so it isn't silently "fixed" later).
- [x] 5a.8 RED (extend): happy path — `offers.user_id` set from `oportunidad.userId`, never a join (Scenario "offers.user_id matches the projection, not a fresh join"); `total` computed in the domain **before** the transaction opens; `publish(OfertaEnviada)` fires only **after** commit; `sendPush` best-effort in the same use case body (D17, never via an intermediate listener).
- [x] 5a.9 GREEN: `ports-in/enviar-oferta.use-case.ts` — Diagram 2's exact order: `findElegible` → 404/409 checks → item-membership check → `buscarCoincidencias` outside any tx → `total()` → `runInTransaction{save}` → publish + push.

## Phase 5b: Creación (HTTP) — Spec: `core-api-ofertas`

Depends on Phase 5a.

- [x] 5b.1 `adapters/http/dto/nuevo-offer-item.dto.ts` (discriminated reactiva/proactiva, mirrors `NuevoOfferItem`), `dto/datos-entrega.dto.ts`, `dto/enviar-oferta.dto.ts` (`{ refillRequestId, items: NuevoOfferItemDto[], entrega }` — no `companyId`, D11), `dto/offer-response.dto.ts` (`OfferResponseDto`, items inline — reused by 6b/7b).
- [x] 5b.2 `ofertas.mapper.ts`: `toOfferResponseDto()`.
- [x] 5b.3 `ofertas.controller.ts`: `POST /ofertas`, `@Roles('provider')`, `actor.companyId` passed to the use case, 201 `OfferResponseDto`.
- [x] 5b.4 RED (extend `ofertas-exception.filter.spec.ts`): `SolicitudNoElegibleError`→404 `SOLICITUD_NO_ELEGIBLE`, `OportunidadCerradaError`→409 `OFERTA_OPORTUNIDAD_CERRADA`, `OfertaInvalidaError`→400 `OFERTA_INVALIDA`, `CatalogQueryUnavailableError` (**imported from `catalogo/contracts/`**, the one legitimate cross-domain import here)→503 `CATALOG_UNAVAILABLE`.
- [x] 5b.5 GREEN (extend the filter): the 4 mappings.
- [x] 5b.6 `ofertas.module.ts`: register `EnviarOfertaUseCase`; add `CatalogoModule` to `imports` — this domain's first inter-domain module edge, second in the whole repo after `refill-matching`'s own.
- [x] 5b.7 E2e: `test/ofertas-enviar-oferta.e2e-spec.ts` — 201 happy path; 404 non-eligible; 404 nonexistent (byte-identical body assertion); 409 closed opportunity; 400 foreign `refillItemId`; 503 with `CATALOG_QUERY_PORT` mocked to throw (offer **not** persisted); 401; 403 role `provider` missing.

## Phase 6a: Delta de `CatalogQueryPort` — Spec: `core-api-catalogo`

Sin dependencia de `ofertas`. El único PR que toca `catalogo` (R8) — aislado.

- [x] 6a.1 RED: `adapters/persistence/kysely-catalog-query.adapter.spec.ts` (extend) — `obtenerItemsDeProveedor(companyId, ids)`: `ids.length === 0` → `[]` with zero round-trips (C6/C10); an id belonging to another company silently discarded (C9, `core-api-catalogo` Scenario "An id belonging to another company is silently discarded"); `disponible = false` discarded; a hidden-company anti-join discards all ids for that company (C4 inherited); infra failure throws `CatalogQueryUnavailableError`, never `[]` (Scenario "An infrastructure failure still throws, never a degraded empty array"); all-match happy path, one round-trip (Scenario "All requested ids belonging to the caller's company are returned").
- [x] 6a.2 `catalogo/contracts/catalog-query.port.ts`: add `obtenerItemsDeProveedor(companyId: string, ids: readonly string[]): Promise<ProviderCatalogItem[]>` — `companyId` **first** (opposite order from `buscarCoincidencias`'s optional `companyId`, documented inline why: alcance obligatorio vs. estrechamiento opcional). JSDoc carries C9/C10 verbatim. Confirm `buscarCoincidencias`'s signature and C1-C8 JSDoc are byte-unchanged (Scenario "buscarCoincidencias is untouched").
- [x] 6a.3 GREEN: `kysely-catalog-query.adapter.ts` — implementation per design's exact query (`company_id` scope + `id IN` + `disponible = true` + hidden-companies anti-join, `mapProviderCatalogRow` reused).
- [x] 6a.4 Confirm the diff touches exactly these 2 files under `domains/catalogo/` (`core-api-ofertas` success criterion: "`catalogo` se toca en exactamente 2 archivos").

## Phase 6b: Proactiva — Spec: `core-api-ofertas`

Depends on Phase 6a's new method and Phase 5b's `CatalogoModule` import.

- [x] 6b.1 RED (D10, written first): `ports-in/enviar-oferta-proactiva.use-case.spec.ts` — no qualifying relationship (`existeRelacion` → `false`) → `DestinatarioNoElegibleError`/404 (`core-api-ofertas` Scenario "A userId with no matching relationship is rejected with 404"); a prior match (even without acceptance) qualifies (Scenario "A userId with a prior match qualifies as a recipient").
- [x] 6b.2 RED (extend, D-B cardinality): `obtenerItemsDeProveedor` returns fewer items than requested (a competitor's id silently discarded) → `ItemsNoDisponiblesError`/400, rejected before any write (Scenario "An id belonging to a competitor is rejected, not silently dropped"); all-match happy path → `'pendiente'` offer (Scenario "All items belong to the offering company").
- [x] 6b.3 RED (extend): this use case's own instance of the D13 order guarantee — `obtenerItemsDeProveedor` resolves before `runInTransaction` is invoked (same shape as 5a.5; a separate use case class needs its own test — the repo has no shared cross-class enforcement of C2).
- [x] 6b.4 GREEN: `ports-in/enviar-oferta-proactiva.use-case.ts`.
- [x] 6b.5 `adapters/http/dto/enviar-oferta-proactiva.dto.ts` (`{ userId, items: NuevoOfferItemDto[], entrega, mensaje? }` — `userId` **is** present here, the sole D11 exception, bounded by D10).
- [x] 6b.6 `ofertas.controller.ts`: `POST /ofertas/proactivas`, `@Roles('provider')`, 201 `OfferResponseDto`.
- [x] 6b.7 RED (extend the filter spec): `DestinatarioNoElegibleError`→404 `DESTINATARIO_NO_ELEGIBLE`, `ItemsNoDisponiblesError`→400 `OFERTA_ITEMS_NO_DISPONIBLES`.
- [x] 6b.8 GREEN (extend the filter): the 2 mappings.
- [x] 6b.9 `ofertas.module.ts`: register `EnviarOfertaProactivaUseCase`.
- [x] 6b.10 E2e: `test/ofertas-enviar-oferta-proactiva.e2e-spec.ts` — 201 happy path; 404 no relationship; 400 competitor id; 503 catalog outage; 401; 403.

## Phase 7a: Aceptación (lógica) + bandeja — Spec: `core-api-ofertas`

Depends on Phase 3a's `marcarAceptada`/`desplazarHermanas`, Phase 3b's `cerrar`.

- [x] 7a.1 `events/oferta-aceptada.payload.ts` + `events/oferta-aceptada.event.ts` — `OfertaAceptadaPayload` (`offerId`, `companyId`, `userId`, `refillRequestId: string | null`, `total`, `desplazadas: readonly string[]`) verbatim D6; `type = 'ofertas.oferta_aceptada'`.
- [x] 7a.2 RED (**D18-2, written first**): `ports-in/aceptar-oferta.use-case.spec.ts` — user A on user B's offer → `OfferNotFoundError`; nonexistent `offerId` → the **same** error, byte-identical (`core-api-ofertas` Scenarios "User A cannot accept user B's offer" / "A nonexistent offerId is rejected with the same 404").
- [x] 7a.3 RED (extend, D-G.3): offer exists and is owned but `status !== 'pendiente'` → `TransicionInvalidaError`/409.
- [x] 7a.4 RED (extend, D12): a `'proactiva'` offer (`refillRequestId: null`) — accepting it calls **neither** `desplazarHermanas` **nor** `cerrar` (Scenario "Accepting a proactive offer displaces nothing and closes nothing" — a tested branch, not a dead one).
- [x] 7a.5 RED (extend, D12): a `'reactiva'` offer with 2 pending siblings — accepting displaces exactly those 2 to `'rechazada'` via `desplazarHermanas`'s own `RETURNING`, and `cerrar()` runs on the opportunity (Scenario "Accepting a reactive offer displaces its siblings and closes the opportunity"); `OfertaAceptada.desplazadas` equals exactly what `desplazarHermanas` returned (Scenario "OfertaAceptada's desplazadas lists exactly the displaced offerIds").
- [x] 7a.6 RED (extend, R4): `OfertaYaAceptadaError` (from 3a.7's translation) propagates out of the transaction as a domain error, never a raw driver exception (Scenario "A double-tap race maps to 409, never 500" — the HTTP mapping is 7b's job).
- [x] 7a.7 GREEN: `ports-in/aceptar-oferta.use-case.ts` — `runInTransaction{findById → 404/409 checks → marcarAceptada → if reactiva: desplazarHermanas+cerrar else []}`, `publish(OfertaAceptada)` after commit.
- [x] 7a.8 RED: `ports-in/obtener-bandeja.use-case.spec.ts` — returns only the actor's own offers with items inline (Scenarios "obtenerBandeja never returns another user's offers" / "The bandeja includes items without a second request"); constructor-injection inspection: `TRANSACTION_MANAGER` absent (completes D13's Scenario, second half of 4b.1).
- [x] 7a.9 GREEN: `ports-in/obtener-bandeja.use-case.ts` — constructor takes only `OFFER_REPOSITORY`.

## Phase 7b: Aceptación (HTTP) + bandeja HTTP — Spec: `core-api-ofertas`

Depends on Phase 7a.

- [ ] 7b.1 `ofertas.controller.ts`: `POST /ofertas/:offerId/aceptar` (`@Roles('user')`, `ParseUUIDPipe`, **204 sin cuerpo** — `SPEC.md` declara `Promise<void>`, precedente `PUT .../precio`→204); `GET /ofertas/bandeja` (`@Roles('user')`, 200 `OfferResponseDto[]`, reusing 5b's DTO).
- [ ] 7b.2 RED (extend the filter spec): `OfferNotFoundError`→404 `OFFER_NOT_FOUND`, `TransicionInvalidaError`→409 `TRANSICION_INVALIDA`, `OfertaYaAceptadaError`→409 `OFERTA_YA_ACEPTADA`.
- [ ] 7b.3 GREEN (extend the filter): the 3 mappings.
- [ ] 7b.4 `ofertas.module.ts`: register `AceptarOfertaUseCase`, `ObtenerBandejaUseCase`.
- [ ] 7b.5 E2e: `test/ofertas-aceptar-oferta.e2e-spec.ts` — 204 happy path (siblings `'rechazada'`, opportunity closed, `OfertaAceptada` observable on the real bus after commit); 404 cross-tenant (byte-identical body to nonexistent); 409 already-non-`'pendiente'`; 409 double-tap (2 near-simultaneous requests on 2 sibling offers of the same R); proactiva accept touches nothing else; 401; 403 role `user` missing.
- [ ] 7b.6 E2e: `test/ofertas-obtener-bandeja.e2e-spec.ts` — 200 own offers only with items inline; 401.

## Phase 8a: Cableado — 2 listeners en `refill-matching` — Spec: `core-api-refill-matching`

Depends on Phase 5a's `OfertaEnviada` and Phase 7a's `OfertaAceptada`. Último a propósito (design.md): el único diff dentro de un dominio hermano, legible sin ruido de `ofertas` alrededor. Separado de 8b porque acá SÍ hay código nuevo — la fase de cierre se mantiene docs-only, mismo precedente que `consumo`/`refill-matching`.

- [ ] 8a.1 `domains/refill-matching/adapters/events/ofertas-event.payloads.ts` (local, D7): `OfertaEnviadaPayload`/`OfertaAceptadaPayload` (both `{ offerId, refillRequestId: string | null }`) — never importing `ofertas`' event classes.
- [ ] 8a.2 RED (**D18-3, mandatory, written first**): `oferta-enviada.listener.spec.ts` — `refillRequestId: null` → does **NOT** call `MarcarComoOfertadaUseCase.execute` (`core-api-refill-matching` Scenario "A proactive OfertaEnviada does not call marcarComoOfertada"); `refillRequestId: R` → calls it exactly once (Scenario "A reactive OfertaEnviada calls marcarComoOfertada exactly once"); **D18-5**: the use case mocked to reject → handler resolves, `logger.error` called, never re-thrown (Scenario "Neither listener re-throws back into ofertas").
- [ ] 8a.3 GREEN: `oferta-enviada.listener.ts` — `@OnEvent('ofertas.oferta_enviada')`, early return on `null`, try/catch-and-log.
- [ ] 8a.4 RED (**D18-3/D18-5 continued**): `oferta-aceptada.listener.spec.ts` — identical shape against `MarcarComoConfirmadaUseCase` and `'ofertas.oferta_aceptada'` (Scenarios "A proactive OfertaAceptada does not call marcarComoConfirmada" / "A reactive OfertaAceptada calls marcarComoConfirmada exactly once").
- [ ] 8a.5 GREEN: `oferta-aceptada.listener.ts`.
- [ ] 8a.6 `refill-matching.module.ts`: add the 2 listeners to `providers` **only** — confirm `imports`/`controllers`/`exports` remain byte-identical (Scenario "The module's public surface is untouched"); confirm neither `marcar-como-ofertada.use-case.ts` nor `marcar-como-confirmada.use-case.ts` is edited.
- [ ] 8a.7 E2e contrato 1: `test/ofertas-contrato-match-encontrado.e2e-spec.ts` — real `EventEmitterModule`, **`await moduleRef.init()`, never only `.compile()`** (the `catalogo` PR8b bug, cited inline: without `init()`, `onApplicationBootstrap` never fires and `@OnEvent` never registers). Publishing a real `MatchEncontrado`-shaped event creates exactly one `offer_opportunities` row with the right eligible set.
- [ ] 8a.8 E2e contrato 2: `test/ofertas-contrato-oferta-eventos.e2e-spec.ts` — `await moduleRef.init()`; publishing real `OfertaEnviada`/`OfertaAceptada` instances on the real bus drives `refill_requests.estado` to `'ofertada'`/`'confirmada'` respectively.

## Phase 8b: Cierre — Spec: all 5 delta specs + raw domain `SPEC.md` files

Depends on Phase 8a — describes behavior that must already exist. Docs-only, on purpose.

- [ ] 8b.1 Rewrite `services/core-api/domains/ofertas/SPEC.md`: "Eventos que consume" corrected to `MatchEncontrado` only, `RefillCreado` explicitly out (D2); auto-oferta conflation removed, named out-of-scope with a pointer to Fase 6 of the roadmap (D3); `enviarOfertaProactiva`'s `userId` documented as scoped by D10's relationship rule; every raw signature gains "derived from actor" framing (D11); `NotificationPort`/`EventPublisher` not re-declared in ports-out (D17, already shared-kernel).
- [ ] 8b.2 `packages/types/SPEC.md`: update the `src/ofertas.ts` table row to list `NuevoOfferItem`, `DatosEntrega`, `SolicitudElegible` alongside the existing `OfferKind`/`OfferStatus`/`OfferItem`/`Offer` exports (D14).
- [ ] 8b.3 Audit `ofertas.module.ts`: confirm `exports: []` (D15), `imports: [DatabaseModule, CatalogoModule]` exactly.
- [ ] 8b.4 Audit `refill-matching.module.ts` end-to-end: `providers` has exactly the 2 entries added in 8a, nothing else changed since before this whole change.
- [ ] 8b.5 Confirm `domains/ofertas/` folder shape: contains `adapters/events/` (1 listener), **no** `contracts/`, **no** `adapters/scheduling/` (D15) — an inspection assertion.
- [ ] 8b.6 Full workspace verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit+e2e, incl. full regression of `identidad`/`catalogo`/`consumo`/`refill-matching` suites — `catalogo` matters especially since 6a touches it), `pnpm build`, `pnpm format:check`; opt-in integration suite (3b.13's replace round-trip).
- [ ] 8b.7 Carry forward the residual risks from design.md's "Riesgos residuales y preguntas abiertas" as documented follow-ups — R1's residual window (`EmpresaSuspendida` unheard), `isAlt`'s unenforced price ceiling, `urgencia` as unchecked `text`, `cerrada_at`'s one-way monotonicity, `desplazarHermanas` crossing all companies (Q6), no push to the provider on acceptance (D-G.4), `findByRefillRequest` still uncalled, `tx`-required on 4 methods as a deliberate convention break, R7's payload-freeze risk once `pedidos-pagos` lands — none silently dropped.

---

## Dependency Notes

14 PRs. Strictly sequential per design.md's dependency chain plus the pre-split boundaries, with 2 parallelizable pairs: PR1 → PR2 → {PR3a ∥ PR3b} → PR4a → PR4b → PR5a → PR5b → {PR6a, independent} → PR6b → PR7a → PR7b → PR8a → PR8b. PR3a and PR3b share no files and depend only on PR1/PR2 — they may land in either order or be worked in parallel; PR4a is sequenced first only to match design.md's own slice ordering (its real dependency is PR3b alone). PR6a has no dependency on any `ofertas` PR and could in principle land any time after PR1 — it is kept at position 6 to match design.md's own slice numbering and to keep the isolated `catalogo` diff easy to find in history. PR8a depends on PR5a's `OfertaEnviada` and PR7a's `OfertaAceptada` specifically, not on 5b/6b/7b. Per this project's DoD (`openspec/config.yaml`): implementation + its unit/e2e tests + the relevant `SPEC.md` delta land in the same commit/PR — Phase 8b is the exception by design, same as every prior domain's own closing phase. `strict_tdd: true` is active for every task introducing real logic — RED items are failing tests written first, GREEN items are the minimal implementation that passes them.
