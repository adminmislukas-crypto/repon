# Delta for db-schema-pedidos-pagos

## Schema (target state after migrations `17a`/`17b`)

Delivered as two files because a newly added enum value cannot be used until its own transaction commits: `17a` contains only the `ALTER TYPE ... ADD VALUE` statements; `17b` depends on `17a` already applied and carries the rest. Neither file edits `20260803120600_06_pedidos_pagos.sql` (D5).

### order_status

Two new values, inserted before `'confirmado'`: `'expirado'`, `'pendiente_pago'`. Resulting order: `expirado < pendiente_pago < confirmado < preparando < en_camino < entregado` — so `status >= 'confirmado'` reads as "paid and underway," and `'expirado'` never satisfies that predicate.

### orders

| Column | Change |
|---|---|
| `status` | `NOT NULL`, default DROPPED (was `default 'confirmado'`) — every `INSERT` MUST write it explicitly |
| `offer_id` | now `UNIQUE` (`orders_offer_id_uidx`); the prior non-unique `orders_offer_id_idx` is dropped |
| `costo_despacho` | NEW: `numeric(12,2) NOT NULL DEFAULT 0 CHECK (costo_despacho >= 0)` |

Invariant (verified in the use case and in tests, not a DB `CHECK` — it crosses `order_items`): `orders.total = Σ(order_items.subtotal) + orders.costo_despacho`.

### order_items — C6 reconciliation

The applied migration `06` and `packages/types/src/pedidos-pagos.ts` already carry these 4 columns; this spec's prose was missing them — no schema change, prose-only fix:

| Column | Type | Constraint |
|---|---|---|
| is_alt | boolean | NOT NULL DEFAULT false |
| alt_size | numeric | NULL |
| alt_qty | numeric | NULL |
| alt_note | text | NULL |

`cantidad` (already `numeric NOT NULL CHECK (cantidad > 0)`) is written as the constant `1` for every row created by this change (D-B.3) — a value discipline enforced in the domain, not a new database constraint.

### payments

| Column/constraint | Change |
|---|---|
| `order_id UNIQUE` | DROPPED (`payments_order_id_key`) |
| `payments_order_id_idx` | NEW non-unique index on `order_id` |
| `payments_order_id_pagado_uidx` | NEW partial unique index on `order_id WHERE estado = 'pagado'` — at most one successful payment per order, while multiple failed attempts are allowed |
| `payments_gateway_external_txn_uidx` | NEW unique index on `(gateway, external_transaction_id)` — the webhook's natural idempotency key |

## ADDED Requirements

### Requirement: order_status gains pendiente_pago and expirado, positioned before confirmado

The two new values MUST be inserted before `'confirmado'` in enum order, never after it, so that `status >= 'confirmado'` unambiguously means "paid and underway."

#### Scenario: expirado never satisfies the paid-and-underway predicate

- GIVEN an order with `status = 'expirado'`
- WHEN queried with `status >= 'confirmado'`
- THEN it is excluded — its enum position is before `'confirmado'`

#### Scenario: pendiente_pago sorts before confirmado

- GIVEN the `order_status` enum
- WHEN its members are ordered
- THEN `'pendiente_pago'` sorts strictly before `'confirmado'`

### Requirement: orders.status has no default; every insert must write it explicitly

An `INSERT` into `orders` that omits `status` MUST fail with a `NOT NULL` violation — there is no default value to fall back to.

#### Scenario: An insert without status fails

- GIVEN an `INSERT` into `orders` that does not set `status`
- WHEN it executes
- THEN it fails with a `NOT NULL` constraint violation

### Requirement: orders.offer_id is unique — one order per accepted offer

The database MUST reject a second `orders` row referencing an `offer_id` that already has one.

#### Scenario: A second order for the same offer is rejected at the database

- GIVEN an `orders` row already exists for `offer_id` X
- WHEN a second `INSERT` targets the same `offer_id` X
- THEN `orders_offer_id_uidx` rejects it

### Requirement: orders.costo_despacho decomposes the total, defaulting to zero

`orders.costo_despacho` MUST default to `0` for a free-shipping order and MUST reject a negative value.

#### Scenario: A free-shipping order defaults costo_despacho to zero

- GIVEN an `orders` insert that omits `costo_despacho`
- WHEN the row is read back
- THEN `costo_despacho` is `0`

#### Scenario: A negative shipping cost is rejected

- GIVEN an `orders` insert with `costo_despacho = -1`
- WHEN it executes
- THEN the `CHECK` constraint rejects it

### Requirement: order_items carries the full alt-presentation snapshot (C6 reconciliation)

Every `order_items` row MUST carry `is_alt`, `alt_size`, `alt_qty`, `alt_note`, copied by value from the source `offer_items` row at order-creation time — the same snapshot discipline already governing `nombre`/`precio_unitario`/`subtotal`. These 4 columns already exist in the applied migration; this requirement closes the prose gap between that migration and this spec (proposal C6).

#### Scenario: An alt-presentation line preserves its size, quantity, and note

- GIVEN an `offer_items` row with `is_alt: true`, `alt_size: 2`, `alt_qty: 3`, `alt_note: 'presentación familiar'`
- WHEN the order is created from it
- THEN the resulting `order_items` row carries the same 4 values

#### Scenario: A non-alt line has no alt fields set

- GIVEN an `offer_items` row with `is_alt: false`
- WHEN the order is created from it
- THEN the resulting `order_items` row has `is_alt: false` and `alt_size`/`alt_qty`/`alt_note` all `null`

### Requirement: payments allows multiple rows per order; at most one may be successful

`payments.order_id` MUST NOT be globally unique — the database MUST allow more than one row per `order_id`, but MUST reject a second row with `estado = 'pagado'` for the same `order_id` (C3/D-A.3).

#### Scenario: A second failed attempt for the same order is allowed

- GIVEN order O already has one `payments` row with `estado: 'fallido'`
- WHEN a second `payments` row is inserted for O with `estado: 'pendiente'`
- THEN the insert succeeds

#### Scenario: A second successful payment for the same order is rejected

- GIVEN order O already has a `payments` row with `estado: 'pagado'`
- WHEN a second `payments` row for O is inserted with `estado: 'pagado'`
- THEN `payments_order_id_pagado_uidx` rejects it

### Requirement: payments has a natural idempotency key on (gateway, external_transaction_id)

The database MUST reject two `payments` rows sharing the same `(gateway, external_transaction_id)` pair (R4).

#### Scenario: A duplicate (gateway, external_transaction_id) pair is rejected

- GIVEN a `payments` row exists with `gateway: 'webpay'`, `external_transaction_id: 'T1'`
- WHEN a second row is inserted with the same pair
- THEN `payments_gateway_external_txn_uidx` rejects it
