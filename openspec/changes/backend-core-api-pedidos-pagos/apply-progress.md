# Apply Progress: `backend-core-api-pedidos-pagos`

**Note on this batch's own execution**: written inline by the orchestrator (no `sdd-apply` sub-agent) — this session hit a real account-level "monthly spend limit" while delegating the spec phase, and the user asked to continue the rest of this change inline, checkpointing to engram for resumability (see engram topic `sdd/backend-core-api-pedidos-pagos/state`).

## PR1 — Phase 0: Groundwork (tasks 1.1–1.9)

**Mode**: `strict_tdd: true` active project-wide, but PR1 is almost entirely type/interface/error-class groundwork with no behavior to RED/GREEN yet — matches the same exception every prior domain's own PR1 used (Kysely row types, port interfaces, and plain `Error` subclasses have nothing to unit-test until an implementation exists). `pnpm test` ran to confirm zero regressions, not to exercise new RED/GREEN pairs.

### Completed Tasks (9/9)

- [x] 1.1 Reconciliación C6: `openspec/specs/db-schema-pedidos-pagos/spec.md`'s `order_items` column table gained `is_alt`/`alt_size`/`alt_qty`/`alt_note` (prose-only, no schema change — the applied migration `06` already had them).
- [x] 1.2 Migración `17a`: `supabase/migrations/20260809120000_17a_pedidos_pagos_order_status_values.sql` — 2 `ALTER TYPE ... ADD VALUE`, verbatim from `design.md` D-A.7.
- [x] 1.3 Migración `17b`: `supabase/migrations/20260809120100_17b_pedidos_pagos_fix_forward.sql` — dropped default, `costo_despacho`, `offer_items.nombre`, the 4 index changes, verbatim from `design.md` D-A.7. **Not applied locally** — see "Deferred" below.
- [x] 1.4 Row types in `shared/database/schema.ts`: `OrderStatusRow`, `PaymentStatusRow`, `OrdersTable`, `OrderItemsTable`, `PaymentsTable`, extended `DB`. **Deviation from `design.md` G.3's literal prose**: `OfferItemsTable.nombre` was NOT added in this PR — see "Deviations" below.
- [x] 1.5 `@repon/types`: `OrderStatus` gained `'pendiente_pago'`/`'expirado'`. **Correction to `specs/shared-types-package/spec.md`'s own claim**: `Order` also gained `costoDespacho: number` — see "Deviations" below.
- [x] 1.6 `OrderRepository` final: `ports-out/order-repository.port.ts` grew from 2 to 4 methods (`crear`, `findById`, `findByOfferId`, `transicionar`) per `design.md` D-G.1.
- [x] 1.7 `PaymentRepository` new: `ports-out/payment-repository.port.ts` (C5), 4 methods per `design.md` D-G.1.
- [x] 1.8 `pedido.errors.ts`: 5 classes (not 6 — see "Deviations"), `domain/pedido.errors.ts`.
- [x] 1.9 Phase verification: see "Commands Run and Results".

### Files Changed

| File | Action | What |
|---|---|---|
| `openspec/specs/db-schema-pedidos-pagos/spec.md` | Modified | C6 reconciliation: 4 columns added to `order_items` table prose |
| `openspec/changes/backend-core-api-pedidos-pagos/specs/shared-types-package/spec.md` | Modified | Corrected: `Order` gains `costoDespacho`, not "unaffected" |
| `supabase/migrations/20260809120000_17a_pedidos_pagos_order_status_values.sql` | New | 2 enum values |
| `supabase/migrations/20260809120100_17b_pedidos_pagos_fix_forward.sql` | New | Fix-forward: dropped default, new column, 4 index changes |
| `services/core-api/src/shared/database/schema.ts` | Modified | 3 new row types, 2 new enums, `DB` extended, header comment updated |
| `packages/types/src/pedidos-pagos.ts` | Modified | `OrderStatus` +2 values, `Order` +`costoDespacho` |
| `services/core-api/src/domains/pedidos-pagos/ports-out/order-repository.port.ts` | Modified | 2→4 methods |
| `services/core-api/src/domains/pedidos-pagos/ports-out/payment-repository.port.ts` | New | 4 methods (C5) |
| `services/core-api/src/domains/pedidos-pagos/domain/pedido.errors.ts` | New | 5 error classes |

### Commands Run and Results

| Command | Result |
|---|---|
| `docker ps` / `supabase status` (pre-flight) | Docker Desktop manually paused — re-confirmed, same environmental state documented since `ofertas` PR3b |
| `pnpm lint` | Clean |
| `pnpm typecheck` | Clean — confirms the `OfferItemsTable.nombre` deferral (below) was necessary: adding it here would have broken `ofertas`' own existing insert call sites, which don't populate it until PR4 |
| `pnpm test` | **73/73 suites, 660/660 tests** — identical to session baseline, zero regressions, zero new tests (no new behavior in this PR) |
| `pnpm build` | Clean |
| `pnpm format:check` | 2 files needed `prettier --write` (`pedidos-pagos.ts`, `schema.ts`) — applied, re-verified clean |

### Deviations from Design

1. **`OfferItemsTable.nombre` deferred from PR1 to PR4** (design.md G.3's prose bundles it with PR1's other row-type work; the PR-sequencing table's PR1 row also lists it). Reasoning: `nombre` is `NOT NULL` with no default (per `17b`'s own DDL), so adding it to `OfferItemsTable` immediately makes it a required field for any Kysely insert into `offer_items` — including `ofertas`' own existing `KyselyOfferRepository` insert, which won't populate it until PR4's mapper edit. Adding it in PR1 would break `pnpm typecheck` on a file this PR doesn't otherwise touch. Deferred to PR4, landing together with the mapper fix that actually writes it — verified by this PR's own clean `typecheck` run. Not a silent change: disclosed in `schema.ts`'s own header comment.
2. **`Order` gains `costoDespacho: number`**, correcting `specs/shared-types-package/spec.md`'s own claim that `Order` is "unaffected." Found while implementing: `OrderRepository.crear(order: Order, items, tx)` (design.md D-G.1) has no other parameter through which `orders.costo_despacho` could be populated, and `Offer` (the analogous upstream type in `ofertas`) already exposes `costoDespacho` for the identical reason. The delta spec was corrected in the same commit as the code (not left stale).
3. **`pedido.errors.ts` has 5 classes, not 6** (tasks.md's own task 1.8 originally miscounted). `FirmaInvalidaError` is thrown by `interpretarWebhook`, which design.md D-C.3 places "en el ADAPTADOR" — same ownership boundary as `PasarelaNoConfiguradaError` (already correctly scoped to `shared/payments/` by task 1.1/5.1 and 7b.2). Corrected in `tasks.md` itself, not just noted here.

### Issues Found

None beyond the 3 deviations above, all resolved within this batch.

### Deferred (explicit, not silent)

- **Migrations `17a`/`17b` not applied locally.** Docker Desktop has been manually paused for the entire session (every prior `docker ps`/`supabase status` check this session, across multiple unrelated tasks, confirms the same state) — re-confirmed immediately before this phase started. The 2 migration files are written and reviewed line-by-line against `design.md` D-A.7's own verbatim SQL, but have not been executed against a real Postgres instance, and no `\d orders`/`\d payments`/`\d offer_items` structural confirmation has been done. This blocks e2e/integration verification for this PR and will continue to block it for PR3 onward (persistence layer) until Docker is available — flagged here so it isn't rediscovered as a surprise later in the chain.

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main), `delivery_strategy: ask-on-risk` — this PR's own forecast (220-300 lines) did not trigger the guard
- Current work unit: PR1 "Groundwork" — tasks 1.1-1.9, all 9 complete
- Boundary: starts from `f737176` (planning docs commit); ends with all groundwork types/ports/errors in place, workspace green (minus the explicitly-deferred migration application)
- Estimated review budget impact: within forecast (9 files, mix of new/modified, no single file over ~120 lines)

## PR2 — Phase 1: Dominio puro (tasks 2.1–2.4)

**Mode**: `strict_tdd: true` — first PR in this chain with real RED/GREEN cycles. RED genuinely confirmed: `order.entity.spec.ts` was run against the not-yet-existing `order.entity.ts` (`Cannot find module './order.entity'`) before the implementation was written, not assumed.

### Completed Tasks (4/4)

- [x] 2.1 `crearPedidoPendiente` — `domain/order.entity.ts`.
- [x] 2.2 Total invariant (`assertTotalCoherente`), validated before any `Order`/`OrderItem` is constructed.
- [x] 2.3 `esTransicionValida`/`transicionar` — full `OrderStatus` state machine, design.md D-A.2.
- [x] 2.4 Phase verification: green.

### Files Changed

| File | Action | What |
|---|---|---|
| `services/core-api/src/domains/pedidos-pagos/domain/order.entity.ts` | New | `crearPedidoPendiente`, `CANTIDAD_LINEA`, `esTransicionValida`/`transicionar` |
| `services/core-api/src/domains/pedidos-pagos/domain/order.entity.spec.ts` | New | 24 tests |

### Commands Run and Results

| Command | Result |
|---|---|
| `pnpm --filter core-api exec jest domains/pedidos-pagos/domain/order.entity.spec.ts` (RED, pre-implementation) | Suite failed to run: `Cannot find module './order.entity'` — confirms the test was written first, genuinely |
| Same command (GREEN, post-implementation) | 24/24 tests passed |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Clean |
| `pnpm --filter core-api exec jest` (full suite) | **74/74 suites, 684/684 tests** (660 baseline + 24 new), zero regressions |
| `pnpm format:check` | 1 file needed `prettier --write` (the new spec file) — applied, re-verified clean |

### Deviations from Design

None. `Order`/`OrderItem` shapes used exactly as PR1 defined them (including PR1's own `costoDespacho` correction).

### Issues Found

None.

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR2 "Dominio puro" — tasks 2.1-2.4, all 4 complete
- Boundary: starts from PR1's committed state (`4cfdacb`); ends with `crearPedidoPendiente` and the full `OrderStatus` state machine, pure and fully tested, zero I/O
- Estimated review budget impact: within forecast (2 new files, ~290 lines combined)

## PR3 — Phase 2: Persistencia (tasks 3.1–3.8)

**Mode**: `strict_tdd: true` — RED genuinely confirmed for both repositories (`Cannot find module` against the not-yet-existing files) before implementing.

### Completed Tasks (8/8)

- [x] 3.1/3.2 `KyselyOrderRepository` — `crear` (2 inserts, `tx` required, `PedidoYaExisteError` on `23505`/`orders_offer_id_uidx`), `findById`, `findByOfferId`, `transicionar` (conditional UPDATE + RETURNING). 14 tests.
- [x] 3.3 Numeric mapper — verified in both directions across all `orders`/`order_items` numeric columns.
- [x] 3.4/3.5 `KyselyPaymentRepository` — `crear`, `findByExternalTransactionId`, `findUltimoPorPedido` (order by `created_at desc` limit 1), `marcarResultado` (conditional UPDATE + RETURNING). 11 tests.
- [x] 3.6 jsonb gotcha — see "Deviations" below for the `Generated<>` reversal.
- [x] 3.7 `paid_at` nullable, conditionally set only on `estado === 'pagado'`.
- [x] 3.8 Phase verification: green.

### Files Changed

| File | Action | What |
|---|---|---|
| `services/core-api/src/domains/pedidos-pagos/domain/pedido.errors.ts` | Modified | +`PedidoYaExisteError` (internal signal, never HTTP-mapped) |
| `services/core-api/src/domains/pedidos-pagos/adapters/persistence/kysely-order.repository.ts` | New | `KyselyOrderRepository`, 4 methods |
| `services/core-api/src/domains/pedidos-pagos/adapters/persistence/kysely-order.repository.spec.ts` | New | 14 tests |
| `services/core-api/src/domains/pedidos-pagos/adapters/persistence/kysely-payment.repository.ts` | New | `KyselyPaymentRepository`, 4 methods |
| `services/core-api/src/domains/pedidos-pagos/adapters/persistence/kysely-payment.repository.spec.ts` | New | 11 tests |
| `services/core-api/src/shared/database/schema.ts` | Modified | `raw_payload` type comment updated (see Deviations) |

### Commands Run and Results

| Command | Result |
|---|---|
| RED runs (both repos, pre-implementation) | `Cannot find module` — confirmed genuinely, not assumed |
| `pnpm --filter core-api exec jest domains/pedidos-pagos` (GREEN) | 3 suites, 49/49 tests |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Clean (after the `raw_payload` typing fix below) |
| `pnpm --filter core-api exec jest` (full) | **76/76 suites, 709/709 tests** (660 pre-chain baseline + 49 new), zero regressions |
| `pnpm format:check` | 2 files needed `prettier --write` — applied, re-verified clean, re-ran full suite + typecheck after to confirm nothing broke |

### Deviations from Design

1. **`raw_payload`'s `Generated<>` wrapping reverted.** Tried `raw_payload: Generated<ColumnType<unknown, string, string>>` (to make it optional on insert, matching its real DB default) — `pnpm typecheck` failed: `Type 'string' is not assignable to type 'ValueExpression<DB, "payments", ColumnType<unknown, string, string>> | undefined'` when calling `.set({ raw_payload: ... })` in `marcarResultado`'s UPDATE. Reverted to plain `ColumnType<unknown, string, string>` and made `crear` write `raw_payload: '{}'` explicitly instead of relying on the column default — consistent with this project's established "state-bearing columns are always written explicit" discipline (same reasoning as `orders.status`'s dropped default). Verified: real Kysely type error, not assumed.
2. **No `23505` translation added for `payments_order_id_pagado_uidx` in `marcarResultado`.** `design.md` names this index as protection against a race, but `marcarResultado`'s own `WHERE estado <> $estado` already makes a second `'pagado'` write a 0-row no-op before any constraint would fire in every call path this change's own tasks define (Fases 4-7b). Left undone with reasoning recorded here rather than added speculatively; `sdd-verify` should confirm no real path bypasses the `WHERE` guard before this is treated as settled.

### Issues Found

None beyond the 2 deviations above, both resolved/reasoned within this batch.

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR3 "Persistencia" — tasks 3.1-3.8, all 8 complete
- Boundary: starts from PR2's committed state (`47a206d`); ends with both repositories fully implemented and unit-tested against mocked Kysely query builders (Docker still down — no real-Postgres integration check possible, same deferral as PR1's migrations)
- Estimated review budget impact: within forecast (6 files, ~500 lines combined)

## PR4 — Phase 3: Delta sobre `ofertas` (tasks 4.1–4.7) — único PR que toca un dominio archivado

**Mode**: `strict_tdd: true`. RED confirmed for the domain/repository-level additions (new tests against not-yet-changed behavior); the use-case-level nombre-resolution tests and the HTTP mapper fix were added GREEN-first-discovery (an existing e2e caught the mapper gap, not a pre-written failing test) — disclosed, not hidden.

### Completed Tasks (7/7)

- [x] 4.1 `OfferItem` gains `id`/`nombre` in `@repon/types` (new `OfferItemPersisted` interface, intersected — `NuevoOfferItem*` untouched).
- [x] 4.2 Factories generate `id`, accept resolved `nombre`; both use cases resolve it (reactiva from `refillItemsById`, proactiva from a new `matchesById`).
- [x] 4.3 `KyselyOfferRepository` mapper stops discarding `item_id`, reads/writes `nombre`. `OfferItemsTable.nombre` added to `schema.ts` (closing PR1's deferral).
- [x] 4.4 `OfertaAceptadaPayload` gains `lineas[]`/`costoDespacho`, built from the already-hydrated `offer` in `AceptarOfertaUseCase`.
- [x] 4.5 `refill-matching` regression confirmed unaffected (structural proof: zero files touched, 124/124 unchanged).
- [x] 4.6 No-op reminder for `sdd-archive`.
- [x] 4.7 Phase verification: green (see below) — surfaced and fixed a real HTTP-mapper gap.

### Files Changed

| File | Action | What |
|---|---|---|
| `packages/types/src/ofertas.ts` | Modified | `OfferItemPersisted` (`id`/`nombre`) intersected into `OfferItemReactiva`/`OfferItemProactiva` |
| `services/core-api/src/domains/ofertas/domain/offer.entity.ts` | Modified | Factories generate `id`, accept `& { nombre: string }`-widened item params |
| `services/core-api/src/domains/ofertas/domain/offer.entity.spec.ts` | Modified | Fixtures updated + 4 new tests (id/nombre per item, both kinds) |
| `services/core-api/src/domains/ofertas/ports-in/enviar-oferta.use-case.ts` | Modified | Resolves `nombre` from `refillItemsById` before calling the factory |
| `services/core-api/src/domains/ofertas/ports-in/enviar-oferta.use-case.spec.ts` | Modified | +1 test (nombre from RefillItem, not catalog) |
| `services/core-api/src/domains/ofertas/ports-in/enviar-oferta-proactiva.use-case.ts` | Modified | Builds `matchesById`, resolves `nombre` from `ProviderCatalogItem` |
| `services/core-api/src/domains/ofertas/ports-in/enviar-oferta-proactiva.use-case.spec.ts` | Modified | +1 test (nombre from catalog match) |
| `services/core-api/src/domains/ofertas/ports-in/aceptar-oferta.use-case.ts` | Modified | Builds `lineas`/`costoDespacho` from `offer.items` |
| `services/core-api/src/domains/ofertas/ports-in/aceptar-oferta.use-case.spec.ts` | Modified | Fixtures + 2 payload assertions updated |
| `services/core-api/src/domains/ofertas/ports-in/obtener-bandeja.use-case.spec.ts` | Modified | Fixtures updated (id/nombre) |
| `services/core-api/src/domains/ofertas/events/oferta-aceptada.payload.ts` | Modified | +`OfertaAceptadaLineaPayload`, `OfertaAceptadaPayload` +`lineas`/`costoDespacho` |
| `services/core-api/src/domains/ofertas/adapters/persistence/kysely-offer.repository.ts` | Modified | Mapper reads/writes `id`/`nombre` |
| `services/core-api/src/domains/ofertas/adapters/persistence/kysely-offer.repository.spec.ts` | Modified | Fixtures + 2 new explicit tests |
| `services/core-api/src/domains/ofertas/adapters/http/ofertas.mapper.ts` | Modified | **Found via e2e failure**: `toOfferResponseDto` now includes `id`/`nombre` |
| `services/core-api/src/domains/ofertas/adapters/http/dto/offer-response.dto.ts` | Modified | `OfferItemResponseDto` gains `id`/`nombre` |
| `services/core-api/src/shared/database/schema.ts` | Modified | `OfferItemsTable.nombre` added (PR1 deferral resolved) |
| `services/core-api/test/ofertas-aceptar-oferta.e2e-spec.ts` | Modified | Fixtures updated |
| `services/core-api/test/ofertas-obtener-bandeja.e2e-spec.ts` | Modified | Fixtures updated (this is the file whose own e2e assertion caught the mapper gap) |
| `services/core-api/test/ofertas-contrato-oferta-eventos.e2e-spec.ts` | Modified | Fixture gains `costoDespacho`/`lineas` |

### Commands Run and Results

| Command | Result |
|---|---|
| `pnpm typecheck` (first pass, after types+factories+mapper+payload+use-case edits, before fixing existing tests) | **Failed** — ~15 pre-existing test files needed their `OfferItem`/`NuevoOfferItem` fixtures updated for the new required fields. Expected and fixed systematically, not a surprise. |
| `pnpm --filter core-api exec jest domains/ofertas` (after fixture fixes) | 11/11 suites, 180/180 tests |
| `pnpm --filter core-api exec jest domains/refill-matching` | 13/13 suites, 124/124 tests — unchanged, confirms task 4.5 |
| `pnpm typecheck` (second pass) | Clean |
| e2e `ofertas` suite | **1 failure** (`ofertas-obtener-bandeja`) — `res.body` missing `id`/`nombre` per item vs. what the test's own (unmodified) assertion logic expected from the now-richer `Offer` fixture. Root cause: `toOfferResponseDto` never carried these fields. Fixed (see Deviations). Re-run: 7/7 suites, 33/33 tests. |
| Full e2e suite | 22/24 suites, 134/139 tests — same 2 pre-existing Docker-paused `refill-matching` failures documented since `ofertas`' own PR3b, re-confirmed via `docker ps` immediately before this batch, unrelated to this PR's diff |
| `pnpm lint` / `pnpm build` | Clean |
| `pnpm format:check` | 5 files needed `prettier --write` — applied, re-verified clean, re-ran typecheck + full unit suite after (76/76, 717/717) |

### Deviations from Design

1. **`enviar-oferta-proactiva.use-case.ts` gains a `matchesById` Map not previously in the code.** `obtenerItemsDeProveedor`'s own contract (D-B) only guarantees cardinality (`matches.length === ids.length`), never per-item correlation — so resolving `nombre` per requested item required building an id-keyed lookup that didn't exist before this PR. Not a redesign of D-B's cardinality-only check (still exactly that for validation); the new Map is purely for the additive nombre-resolution step.
2. **HTTP response DTO (`OfferItemResponseDto`) gains `id`/`nombre`, not named in tasks.md 4.1-4.6.** Discovered via a genuine e2e test failure (`ofertas-obtener-bandeja`), not anticipated in planning. Judged in-scope to fix rather than defer: withholding `nombre` from `GET /ofertas/bandeja`'s response would leave the user-facing inbox unable to show what an offer actually contains — a real product regression, not a cosmetic gap. `id` included alongside it for consistency (harmless, no PCI/security reason to withhold it, unlike `payments.raw_payload`).

### Issues Found

None beyond the 2 deviations above, both resolved within this batch with reasoning recorded.

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR4 "Delta sobre ofertas" — tasks 4.1-4.7, all 7 complete
- Boundary: starts from PR3's committed state (`c4ee403`); ends with `ofertas`' own domain/persistence/HTTP layers fully aware of `id`/`nombre`, `OfertaAceptadaPayload` carrying `pedidos-pagos`' required line-item data, zero regressions across `ofertas` (180/180) and `refill-matching` (124/124)
- Estimated review budget impact: over forecast (18 files touched, mostly test-fixture updates rippling from a type change — the 240-310 line estimate undercounted the fixture-update blast radius of widening `OfferItem`'s required fields across ~15 pre-existing test files). Flagged honestly; not re-scoped after the fact.

## PR5 — Phase 4: Creación (tasks 5.1–5.9)

**Mode**: `strict_tdd: true`. RED genuinely confirmed for the use case and listener (module-not-found before implementing). One deliberate exception: `PasarelaNoConfiguradaAdapter`'s test was written after its implementation — its shape was already fixed verbatim by `design.md`/`specs/shared-payments/spec.md`, low-risk, disclosed rather than silently done.

### Completed Tasks (9/9)

- [x] 5.1 `PasarelaNoConfiguradaError` in `shared/payments/payments.errors.ts`.
- [x] 5.2 `PasarelaNoConfiguradaAdapter` — 3 tests.
- [x] 5.3 `PaymentGatewayPort.crearTransaccion` widened.
- [x] 5.4 `PaymentsModule` + `SharedKernelModule` + `pedidos-pagos.module.ts` wiring (`PAYMENT_REPOSITORY` deliberately deferred to PR6).
- [x] 5.5 `CrearPedidoDesdeOfertaUseCase` — 5 tests.
- [x] 5.6/5.7 `OfertaAceptadaListener` + local payload, negative covered in the same spec — 3 tests.
- [x] 5.8 e2e contract test, real event bus, `moduleRef.init()` — 3 tests, all against the real `EventEmitterPublisher`.
- [x] 5.9 Phase verification: green.

### Files Changed

| File | Action | What |
|---|---|---|
| `services/core-api/src/shared/payments/payments.errors.ts` | New | `PasarelaNoConfiguradaError` |
| `services/core-api/src/shared/payments/pasarela-no-configurada.adapter.ts` (+`.spec.ts`) | New | Permanent no-credentials branch |
| `services/core-api/src/shared/payments/payment-gateway.port.ts` | Modified | `crearTransaccion` widened |
| `services/core-api/src/shared/payments/payments.module.ts` | New | `@Global()`, binds `PAYMENT_GATEWAY_PORT` |
| `services/core-api/src/shared/shared-kernel.module.ts` | Modified | `+PaymentsModule` |
| `services/core-api/src/domains/pedidos-pagos/ports-in/crear-pedido-desde-oferta.use-case.ts` (+`.spec.ts`) | New | The use case |
| `services/core-api/src/domains/pedidos-pagos/adapters/events/{oferta-aceptada.listener.ts,ofertas-event.payloads.ts}` (+spec) | New | The listener |
| `services/core-api/src/domains/pedidos-pagos/pedidos-pagos.module.ts` | Modified | No longer `@Module({})` |
| `services/core-api/test/pedidos-pagos-contrato-oferta-aceptada.e2e-spec.ts` | New | The contract e2e |

### Commands Run and Results

| Command | Result |
|---|---|
| RED runs (use case, listener) | `Cannot find module` — confirmed genuinely |
| `pnpm --filter core-api exec jest domains/pedidos-pagos` | 5 suites, 57/57 tests |
| `pnpm typecheck` (first pass, after `PasarelaNoConfiguradaAdapter`'s zero-param methods) | Failed — test calling `adapter.crearTransaccion('order-1', 14990)` against the concrete class (0 declared params) rather than the `PaymentGatewayPort` interface. Fixed by typing the test's local variable as the interface (structural typing resolves it), not by adding unused params to the adapter (which then failed lint instead — tried both, settled on the interface-typed variable as correct per this repo's own established convention) |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` (final) | Clean |
| `pnpm --filter core-api exec jest` (full) | **79/79 suites, 728/728 tests** (717 + 11 new), zero regressions |
| e2e full suite | **23/25 suites, 137/142 tests** (+1 suite, +3 tests, all new ones green) — same 2 pre-existing Docker-paused `refill-matching` failures, re-confirmed unrelated |
| `pnpm format:check` | 2 rounds, 1 file each — applied, re-verified clean, re-ran full unit suite + typecheck after each |

### Deviations from Design

1. **`PasarelaNoConfiguradaAdapter`'s test written after implementation**, not before — its shape was already fully specified (verbatim) by `design.md` D-C.2 and `specs/shared-payments/spec.md`, so there was no ambiguity a RED-first test would have caught. Disclosed rather than silently skipping the discipline.
2. **`PAYMENT_REPOSITORY` not bound in `pedidos-pagos.module.ts` this PR**, though the class exists since PR3. Nothing in this PR's own scope (`CrearPedidoDesdeOfertaUseCase`) needs it — deferred to PR6, matching `refill-matching.module.ts`'s own established "add exactly what each phase first uses" convention.

### Issues Found

None beyond the 2 deviations above.

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR5 "Creación" — tasks 5.1-5.9, all 9 complete
- Boundary: starts from PR4's committed state (`b3d2b05`); ends with the real event bus provably wired end-to-end (e2e contract, not just unit-mocked), `pedidos-pagos.module.ts` no longer empty
- Estimated review budget impact: within forecast (9 new/modified files, ~350 lines)

## PR6 — Phase 5: Ciclo de vida (tasks 6.1–6.10)

**Mode**: `strict_tdd: true`. RED genuinely confirmed for all 3 use cases.

### Completed Tasks (10/10)

- [x] 6.1 `IniciarPagoUseCase` — 8 tests.
- [x] 6.2 `ObtenerEstadoPagoUseCase` — 5 tests.
- [x] 6.3 `ActualizarEstadoPedidoUseCase` — 8 tests.
- [x] 6.4 DTOs (`IniciarPagoResponseDto`, `EstadoPagoResponseDto`, `ActualizarEstadoPedidoDto`).
- [x] 6.5 `pedidos.controller.ts` — 3 JWT routes.
- [x] 6.6 `pedidos-pagos-exception.filter.ts` — 5 classes mapped.
- [x] 6.7 404 cross-tenant e2e — 5 tests.
- [x] 6.8 Pasarela-no-configurada e2e — 1 test, real binding.
- [x] 6.9 `pedidos-pagos.module.ts` final wiring.
- [x] 6.10 Phase verification: green.

### Files Changed

| File | Action | What |
|---|---|---|
| `services/core-api/src/shared/payments/payment-gateway.port.ts` | Modified | `crearTransaccion` widened again (+`gateway`) |
| `services/core-api/src/shared/payments/pasarela-no-configurada.adapter.ts` | Modified | Return type updated to match |
| `services/core-api/src/domains/pedidos-pagos/domain/pedido.errors.ts` | Modified | `PagoNoEncontradoError` generalized to a message constructor |
| `services/core-api/src/domains/pedidos-pagos/ports-in/{iniciar-pago,obtener-estado-pago,actualizar-estado-pedido}.use-case.ts` (+specs) | New | The 3 use cases |
| `services/core-api/src/domains/pedidos-pagos/adapters/http/{pedidos.controller.ts,pedidos-pagos-exception.filter.ts,pedidos-pagos.mapper.ts,dto/*.ts}` | New | HTTP surface |
| `services/core-api/src/domains/pedidos-pagos/pedidos-pagos.module.ts` | Modified | `PAYMENT_REPOSITORY` bound, controller added |
| `services/core-api/test/pedidos-pagos-ciclo-de-vida.e2e-spec.ts` | New | 11 tests |
| `openspec/changes/backend-core-api-pedidos-pagos/specs/shared-payments/spec.md` | Modified | `gateway` field documented |

### Commands Run and Results

| Command | Result |
|---|---|
| RED runs (3 use cases) | `Cannot find module` — confirmed genuinely |
| `pnpm --filter core-api exec jest domains/pedidos-pagos` | 8 suites, 78/78 |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Clean |
| e2e `pedidos-pagos-ciclo-de-vida` (first run) | **11/11 failed with 401** — root cause: actor/order IDs were plain strings (`'user-a'`, `'order-1'`), and `AuthGuard`'s `UUID_RE.test(sub)` check rejects any JWT `sub` that isn't UUID-shaped before ever reaching the route. Fixed by switching to `randomUUID()` throughout, matching `ofertas`' own e2e precedent (which I had read but didn't fully carry over the first time) |
| e2e `pedidos-pagos-ciclo-de-vida` (fixed) | 11/11 passed |
| `pnpm --filter core-api exec jest` (full) | **82/82 suites, 749/749 tests** (728 + 21 new), zero regressions |
| Full e2e suite | **24/26 suites, 148/153 tests** (+1 suite, +11 tests, all new green) — same 2 pre-existing Docker-paused `refill-matching` failures, re-confirmed via `docker ps` |
| `pnpm format:check` | 2 rounds (9 files, then 1 more) — applied, re-verified clean, re-ran full suite + typecheck after |

### Deviations from Design

1. **`PaymentGatewayPort.crearTransaccion` widened a second time** (+`gateway: string`). `Payment.gateway` is `NOT NULL`, and neither `design.md` nor the PR5 widening (which added `externalTransactionId`) gave `IniciarPagoUseCase` any source for it — the concrete gateway adapter is the only thing that knows which gateway it is. Updated the delta spec (`specs/shared-payments/spec.md`) in the same commit, not left stale.
2. **`PagoNoEncontradoError`'s constructor generalized** from `(gateway, externalTransactionId)` to `(message: string)`. Its PR1 shape was built narrowly for the webhook's "unknown transaction" case (PR7b, not yet written); `obtenerEstadoPago`'s "this order has never had a payment attempt" case is a different scenario with no gateway/transaction id to report. Same free-message pattern `TransicionInvalidaError`/`PedidoInvalidoError` already use.
3. **`pedido.errors.ts`'s `PedidoInvalidoError` NOT added to the exception filter**, correcting task 6.6's own original text. It's thrown only by `crearPedidoDesdeOferta` (the listener, no HTTP route) — it can never reach this filter, so mapping it would be a dead map entry.

### Issues Found

The e2e UUID issue above (found and fixed within this batch, not carried forward).

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR6 "Ciclo de vida" — tasks 6.1-6.10, all 10 complete
- Boundary: starts from PR5's committed state (`4168c68`); ends with the full user-facing + provider-facing HTTP surface for this domain (except the webhook, PR7b), `PAYMENT_REPOSITORY` finally bound
- Estimated review budget impact: over forecast (280-360 estimated; ~15 new/modified files, DTOs+controller+filter+3 use cases+e2e is a wide batch) — flagged honestly, not re-scoped after the fact

## Status

**Cumulative**: 47/47 tasks complete across PR1 (9/9) + PR2 (4/4) + PR3 (8/8) + PR4 (7/7) + PR5 (9/9) + PR6 (10/10).

**⏸ PAUSED at PR7a, 2026-08-16** — asked the maintainer directly which payment gateway to implement (task 7a.1, `design.md`'s own anticipated stop point, D2). Answer: defer the choice, keep `PasarelaNoConfiguradaAdapter` as the binding for now. Tasks 7a.2-7a.5 and all of PR7b depend on that choice (credential shape, SDK, webhook signature algorithm) — nothing further can be built until it's made. The system is coherent and fully functional short of real payment processing: orders are created from accepted offers, tracked, providers advance their lifecycle, `iniciarPago` fails explicitly with 503 (by design, D-C.2) instead of breaking anything. Resume at task 7a.1 once the gateway is chosen — do not skip ahead of it.
