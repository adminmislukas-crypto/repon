# db-schema-pedidos-pagos Specification

## Purpose

Orders created from an accepted offer, their immutable line-item snapshot, and payment records referencing the hosted-checkout transaction. Never stores card data (PCI-DSS scope avoidance, per `docs/ARCHITECTURE.md`).

## Schema

### orders

Columns fixed by `Order` (`packages/types/SPEC.md`), plus physical: `offer_id` REFERENCES `offers(id)` NOT NULL; `user_id` REFERENCES `profiles(id)` NOT NULL; `company_id` REFERENCES `companies(id)` NOT NULL; `created_at`/`updated_at`.

### order_items (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | NOT NULL REFERENCES orders(id) |
| offer_item_id | uuid | NOT NULL REFERENCES offer_items(id) |
| nombre | text | NOT NULL (snapshot) |
| cantidad | numeric | NOT NULL, CHECK (cantidad > 0) |
| precio_unitario | numeric(12,2) | NOT NULL, CHECK (precio_unitario >= 0) |
| subtotal | numeric(12,2) | NOT NULL, CHECK (subtotal >= 0) |
| created_at | timestamptz | NOT NULL DEFAULT `now()` |

No `updated_at` — rows are immutable snapshots by design. No owner column (Q8).

### payments (newly finalized)

| Column | Type | Constraint |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | NOT NULL, UNIQUE, REFERENCES orders(id) |
| gateway | text | NOT NULL, CHECK IN ('webpay','mercadopago') |
| external_transaction_id | text | NOT NULL |
| monto | numeric(12,2) | NOT NULL, CHECK (monto > 0) |
| moneda | text | NOT NULL DEFAULT `'CLP'` |
| estado | payment_status | NOT NULL DEFAULT `'pendiente'` |
| raw_payload | jsonb | NOT NULL DEFAULT `'{}'::jsonb` |
| paid_at | timestamptz | NULL |
| created_at / updated_at | timestamptz | NOT NULL DEFAULT `now()` |

`payment_status` enum: `'pendiente' | 'pagado' | 'fallido' | 'reembolsado'`. `gateway` uses a CHECK, not an enum, so adding a new gateway is a one-line migration.

## Requirements

### Requirement: order_items is an immutable snapshot, enforced beyond RLS

Because `core-api` connects with service-role (bypasses RLS per D1), the "never alter historical order data" invariant MUST be enforced with a database trigger rejecting `UPDATE` on `order_items` for every role, including service-role — this is a data-integrity guarantee, not a row-level authorization concern.

#### Scenario: Any UPDATE attempt is rejected regardless of role

- GIVEN an existing `order_items` row
- WHEN any role, including service-role, attempts `UPDATE order_items SET precio_unitario = ...`
- THEN the trigger raises an exception and the transaction fails

#### Scenario: Catalog price change does not alter past orders

- GIVEN `provider_catalog.precio_base` for a product changes after an order was placed
- WHEN the historical order is queried
- THEN `order_items.precio_unitario` still reflects the price at time of purchase

### Requirement: payments has no direct client SELECT policy

Unlike `order_items` (readable via `orders`' owner/company), `payments` MUST NOT have any SELECT policy for `anon`/`authenticated` — `raw_payload` may contain gateway-internal fields not meant for client consumption. Clients read payment status through core-api.

#### Scenario: Direct read of payments is denied

- GIVEN a payment P for order O owned by user A
- WHEN A queries `payments` directly
- THEN zero rows are returned — A must call core-api for payment status

### Requirement: orders and order_items SELECT allowlist

`orders` MUST allow SELECT for the owning user (`user_id = auth.uid()`) and the owning company (`EXISTS` on `profiles.company_id = orders.company_id`). `order_items` MUST use the Owner-less Child Table Read Policy (`db-access-control`) via `EXISTS` against `orders`.

#### Scenario: Both parties to an order can read it

- GIVEN order O between user A and company C
- WHEN A or a profile of C queries `orders`
- THEN O is returned to both

#### Scenario: An unrelated party cannot read the order or its items

- GIVEN order O between user A and company C
- WHEN user B (unrelated) queries `orders` or `order_items`
- THEN nothing referencing O is returned to B

### Requirement: payments never stores card data

`payments` MUST NOT include any column capable of holding a card PAN, CVV, or expiry — only `external_transaction_id` and gateway metadata, matching the hosted-checkout PCI scope-avoidance decision.

#### Scenario: Schema review confirms no card columns

- GIVEN the `payments` migration
- WHEN reviewed against this requirement
- THEN no column name or type suggests raw card data storage
