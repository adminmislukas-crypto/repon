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

## Status

**Cumulative**: 21/21 tasks complete across PR1 (9/9) + PR2 (4/4) + PR3 (8/8). Ready for PR4 (delta sobre `ofertas`).
