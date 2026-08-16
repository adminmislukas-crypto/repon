# core-api-pedidos-pagos Specification

## Purpose

The `pedidos-pagos` domain vertical: order creation from an accepted offer (`crearPedidoDesdeOferta`), payment initiation and status (`iniciarPago`, `obtenerEstadoPago`), provider-driven order lifecycle (`actualizarEstadoPedido`), and gateway webhook processing (`procesarWebhookPago`) — the `OrderStatus` state machine, cross-tenant authorization where every cross-tenant read/write is 404 never 403 (D4), idempotency guarantees for both order creation and webhook processing (R4/R5/R6), and the 3 published events (`PedidoConfirmado`, `PagoRecibido`, `PagoFallido`).

## Requirements

### Requirement: crearPedidoDesdeOferta is an internal listener-triggered use case with no HTTP route

`crearPedidoDesdeOferta` MUST have no HTTP route — it MUST be invoked exclusively by an `@OnEvent('ofertas.oferta_aceptada')` listener living in `pedidos-pagos/adapters/events/`, subscribed by channel-name string, never importing `ofertas`' event class. The listener MUST type the payload with a locally-declared interface (D3).

#### Scenario: No route resolves crearPedidoDesdeOferta

- GIVEN the domain's HTTP surface
- WHEN every route is enumerated
- THEN none maps to `crearPedidoDesdeOferta` — it is reachable only via the event listener

#### Scenario: The listener subscribes by channel name, not by class

- GIVEN `pedidos-pagos/adapters/events/oferta-aceptada.listener.ts`
- WHEN its `@OnEvent` decorator is inspected
- THEN it subscribes to the string `'ofertas.oferta_aceptada'`, and no file in `pedidos-pagos` imports `ofertas`' event class

### Requirement: crearPedidoDesdeOferta creates the order and its items in one transaction, with pendiente_pago as the sole initial state

On a successful `OfertaAceptada` delivery, the use case MUST, inside a single transaction, insert one `orders` row with `status: 'pendiente_pago'` — written explicitly, never relying on a column default — and a bulk insert of its `order_items`, copied by value from the event payload's `lineas`. No other status is a legal initial state.

#### Scenario: A first delivery creates exactly one order with its items

- GIVEN an `OfertaAceptada` event for an offer with 2 lines never processed before
- WHEN the listener handles it
- THEN exactly one `orders` row is created with `status: 'pendiente_pago'`, and exactly 2 `order_items` rows are created in the same transaction

#### Scenario: order_items is never written outside the order's own transaction

- GIVEN the transaction that creates order O
- WHEN it is inspected
- THEN O's `order_items` insert happens inside the same `runInTransaction` call as the `orders` insert — never a separate, later write

### Requirement: crearPedidoDesdeOferta is idempotent against a duplicate OfertaAceptada for the same offer

A second `OfertaAceptada` delivery for an `offerId` that already produced an order MUST result in zero writes and zero events — read-and-skip via `findByOfferId` before the insert, backed by the unique index on `orders.offer_id` as the defense against a concurrent duplicate (R5).

#### Scenario: A second delivery for the same offer is a complete no-op

- GIVEN an order already exists for `offerId` O
- WHEN a second `OfertaAceptada` for O is delivered
- THEN no new `orders`/`order_items` rows are created, and no event is published

#### Scenario: A concurrent duplicate is caught by the unique index, not just the read

- GIVEN two near-simultaneous deliveries of `OfertaAceptada` for the same `offerId`, both past the read-and-skip check
- WHEN the second `INSERT` runs
- THEN it violates `orders_offer_id_uidx`, is translated to the same no-op outcome, and no second order survives

### Requirement: The listener never re-throws — a failure in crearPedidoDesdeOferta must not fail the already-committed OfertaAceptada

Any error while handling `crearPedidoDesdeOferta` — including a validation failure or an unexpected repository error — MUST be caught and logged by the listener, never re-thrown. `emitAsync` would otherwise propagate a rejection back into `AceptarOfertaUseCase`, after its own transaction already committed, turning a successful acceptance into a 5xx for the user (D3/R8).

#### Scenario: A use-case failure resolves the listener without propagating

- GIVEN `crearPedidoDesdeOferta` throws while handling a delivered `OfertaAceptada`
- WHEN the listener's handler runs
- THEN the error is logged and the handler resolves — `AceptarOfertaUseCase`'s caller receives its normal success response

### Requirement: The snapshot's total invariant is validated before any insert

Before opening the transaction, the use case MUST verify `orders.total === Σ(order_items.subtotal) + orders.costo_despacho`, and reject with `PedidoInvalidoError` (400) if it does not hold. Every line MUST have `cantidad: 1` and `precio_unitario === subtotal === linea.precio` (D-B.3). Validating before the insert is mandatory because `order_items` accepts no `UPDATE`/`DELETE`, ever, for any role (R6).

#### Scenario: An incoherent total is rejected before any write

- GIVEN a payload whose `total` does not equal the sum of its lines' `precio` plus `costoDespacho`
- WHEN `crearPedidoDesdeOferta` validates it
- THEN `PedidoInvalidoError` is thrown and no `orders`/`order_items` row is ever inserted

#### Scenario: Every line is quantity 1 with equal unit price and subtotal

- GIVEN a valid `OfertaAceptada` payload with 3 lines
- WHEN the order is created
- THEN every resulting `order_items` row has `cantidad === 1` and `precio_unitario === subtotal`

### Requirement: OrderStatus is a monotonic state machine; pendiente_pago is the sole entry point and confirmado is unreachable by the provider

`orders.status` transitions MUST follow: creation → `pendiente_pago` (sole initial state); `pendiente_pago → confirmado`, exclusively via `procesarWebhookPago` confirming a successful payment; `confirmado → preparando → en_camino → entregado`, exclusively via `actualizarEstadoPedido`, one adjacent step at a time, never skipping and never reversing. `entregado` and `expirado` are terminal. Any other transition — including any attempt by `actualizarEstadoPedido` to set `'confirmado'`, `'pendiente_pago'`, or `'expirado'` — MUST be rejected with `TransicionInvalidaError` (409); the request DTO itself MUST NOT accept these 3 values, rejecting them with 400 before the use case runs.

#### Scenario: A new order always starts pendiente_pago

- GIVEN `crearPedidoDesdeOferta` succeeds
- WHEN the resulting order is read
- THEN its `status` is `'pendiente_pago'`

#### Scenario: Only the payment path reaches confirmado

- GIVEN an order in `'pendiente_pago'`
- WHEN `actualizarEstadoPedido` is called with any target status
- THEN the call is rejected before reaching `'confirmado'` — that transition happens exclusively inside `procesarWebhookPago`

#### Scenario: A skipped step is rejected

- GIVEN an order in `'confirmado'`
- WHEN a provider calls `actualizarEstadoPedido` with `'en_camino'`
- THEN the response is 409 `TRANSICION_INVALIDA` — `'preparando'` cannot be skipped

#### Scenario: A terminal state accepts no further transition

- GIVEN an order in `'entregado'` or `'expirado'`
- WHEN any transition is attempted
- THEN the response is 409 `TRANSICION_INVALIDA`

### Requirement: iniciarPago is an HTTP-triggered use case, kept off the OfertaAceptada listener path

`iniciarPago(orderId)` MUST be a port-in invoked only via `POST /pedidos/:orderId/pago`, never called from the `OfertaAceptada` listener (D-D). The call to `PaymentGatewayPort.crearTransaccion` MUST happen outside any database transaction — it is a network call to a third party. On success, the use case MUST insert exactly one `payments` row with `estado: 'pendiente'` and `monto` derived from the order's own `total`, never accepted from the client.

#### Scenario: The listener never calls the payment gateway

- GIVEN `crearPedidoDesdeOferta`'s full execution path
- WHEN it is inspected
- THEN no call to `PaymentGatewayPort` occurs anywhere in it

#### Scenario: A successful initiation returns the checkout URL and persists the attempt

- GIVEN an order O in `'pendiente_pago'` owned by user A
- WHEN A calls `POST /pedidos/O/pago`
- THEN the response is 201 with `{ checkoutUrl }`, and exactly one `payments` row exists for O with `estado: 'pendiente'`

#### Scenario: A non-pendiente_pago order cannot be paid again

- GIVEN order O is already `'confirmado'`
- WHEN its owner calls `POST /pedidos/O/pago`
- THEN the response is 409 `PEDIDO_NO_PAGABLE`

#### Scenario: The amount is never accepted from the client

- GIVEN `POST /pedidos/:orderId/pago`'s request DTO
- WHEN its fields are enumerated
- THEN it accepts no amount field — the amount always derives from `orders.total`

### Requirement: A failed payment leaves the order retryable without duplicating

`payments.estado: 'fallido'` MUST NOT move `orders.status` — the order remains `'pendiente_pago'` (C3/D-A.3). A subsequent `iniciarPago` call on the same order MUST succeed and create a new `payments` row with a new gateway transaction, never reusing or overwriting the failed attempt's row.

#### Scenario: A failed payment does not move the order

- GIVEN a webhook reports `'fallido'` for order O's payment
- WHEN the webhook is processed
- THEN O's `status` remains `'pendiente_pago'`

#### Scenario: Retrying after a failure creates a new payment row

- GIVEN order O has one `payments` row in `'fallido'`
- WHEN O's owner calls `iniciarPago` again
- THEN a second `payments` row is created for O, and the first row is unchanged

### Requirement: procesarWebhookPago is idempotent, and the webhook body is never the authority on payment state

The webhook handler MUST verify the request's signature before any read or write — an invalid signature MUST result in `FirmaInvalidaError` (401) with zero database access and zero events. Once the signature is valid, the state persisted MUST come from a call to the gateway's own status-query method for the transaction the webhook names — never from the webhook body's own claimed state (D-C.3). Both the payment-row update and, when the result is `'pagado'`, the `pendiente_pago → confirmado` order transition MUST be conditional `UPDATE ... WHERE <current-state> RETURNING id` statements, and an event MUST publish only when the calling execution's own `UPDATE` reports a changed row — never on a 0-row result (R4).

#### Scenario: An invalid signature makes zero database calls

- GIVEN a webhook request with a signature that fails verification
- WHEN it is processed
- THEN `FirmaInvalidaError` maps to 401, and no repository method and no event publisher is called

#### Scenario: A forged body claiming pagado is overridden by the gateway's own answer

- GIVEN a webhook body claims `'pagado'` but the gateway's own status query returns `'fallido'` for that transaction
- WHEN the webhook is processed
- THEN the persisted result is `'fallido'` — the body's claim is never trusted

#### Scenario: A duplicate delivery changes nothing on the second pass

- GIVEN a webhook for transaction T was already processed and O confirmed
- WHEN the exact same webhook is delivered a second time
- THEN the conditional `UPDATE`s affect zero rows, and no event is published a second time

#### Scenario: A webhook for an unknown transaction is 404, on purpose

- GIVEN no `payments` row matches the webhook's transaction id
- WHEN it is processed
- THEN the response is 404 — a non-2xx status, so the gateway retries, covering the race where the webhook arrives before `iniciarPago`'s own insert commits

### Requirement: Authorization on every actor-facing route is 404, never 403, byte-identical between nonexistent and cross-tenant

`iniciarPago`, `obtenerEstadoPago`, and `actualizarEstadoPedido` MUST derive the owning user/company exclusively from the authenticated actor — no DTO in this domain accepts `companyId` or `userId` (D4). An order that does not exist and an order that exists but belongs to a different user/company MUST both throw the same error class, mapped to HTTP 404, never 403.

#### Scenario: A user cannot act on another user's order

- GIVEN order O belongs to user B
- WHEN user A calls `iniciarPago`/`obtenerEstadoPago` on O
- THEN the response is 404, byte-identical to a nonexistent order id

#### Scenario: A provider cannot move another company's order

- GIVEN order O belongs to company C
- WHEN a provider profile of a different company D calls `actualizarEstadoPedido` on O
- THEN the response is 404, never 403

#### Scenario: No DTO exposes companyId or userId

- GIVEN every HTTP DTO in `pedidos-pagos/adapters/http/`
- WHEN their fields are enumerated
- THEN none includes `companyId` or `userId`

### Requirement: orders and order_items carry no dedicated read route; payment status does

`orders`/`order_items` MUST NOT have a dedicated `core-api` read route — they are readable directly against Postgres via RLS. `payments` — which has no client-facing SELECT policy — MUST be readable only through `GET /pedidos/:orderId/pago`, returning a narrow DTO with `estado`, `monto`, `moneda`, and `paidAt?` only. `raw_payload` and `external_transaction_id` MUST NOT appear in this or any response DTO.

#### Scenario: Payment status is queryable by its owner

- GIVEN order O owned by user A has a `payments` row
- WHEN A calls `GET /pedidos/O/pago`
- THEN the response is 200 with `{ estado, monto, moneda, paidAt? }` and no other field

#### Scenario: raw_payload never reaches a response

- GIVEN any response DTO in `pedidos-pagos/adapters/http/`
- WHEN its fields are enumerated
- THEN `raw_payload` and `external_transaction_id` appear in none of them

#### Scenario: obtenerEstadoPago reads local state only, never the gateway

- GIVEN a call to `GET /pedidos/:orderId/pago`
- WHEN it executes
- THEN it queries `payments` directly and never calls `PaymentGatewayPort`

### Requirement: actualizarEstadoPedido and obtenerEstadoPago run without a database transaction

Neither use case MUST inject `TRANSACTION_MANAGER` — each performs at most one read and one conditional single-row write, and their atomicity is the `WHERE`/`RETURNING` clause itself, not a transaction wrapper (D-G.2, precedent D13 of `ofertas`).

#### Scenario: Neither use case's constructor injects a transaction manager

- GIVEN `ActualizarEstadoPedidoUseCase` and `ObtenerEstadoPagoUseCase`'s constructors
- WHEN their injected dependencies are inspected
- THEN `TRANSACTION_MANAGER` appears in neither

### Requirement: The 3 published events fire only after commit, and order creation itself publishes none

`crearPedidoDesdeOferta` MUST publish no event — a `'pendiente_pago'` order is not yet a fact worth broadcasting. `PedidoConfirmado` and `PagoRecibido` MUST publish together, after commit, exactly once, only when `procesarWebhookPago`'s own execution is the one that moved the state (per its rowcount check). `PagoFallido` MUST publish after commit when the gateway reports a failed payment, without moving the order.

#### Scenario: Order creation publishes nothing

- GIVEN a successful `crearPedidoDesdeOferta`
- WHEN its execution completes
- THEN no event is published — not `PedidoConfirmado`, not any other

#### Scenario: A successful payment publishes both events exactly once, after commit

- GIVEN a webhook confirms payment for order O
- WHEN it is processed successfully
- THEN `PagoRecibido` and `PedidoConfirmado` both publish exactly once, only after the transaction commits

#### Scenario: A failed payment publishes only PagoFallido

- GIVEN a webhook reports a failed payment for order O
- WHEN it is processed
- THEN only `PagoFallido` publishes — `PedidoConfirmado`/`PagoRecibido` do not

### Requirement: The payment gateway is called only outside database transactions

`PaymentGatewayPort` calls (`crearTransaccion` in `iniciarPago`; the gateway's own status query in `procesarWebhookPago`) MUST NEVER execute inside a `runInTransaction` callback — a network call to a third party inside an open transaction risks exhausting the connection pool under timeout (same discipline as `ofertas`' C2 for `CatalogQueryPort`).

#### Scenario: crearTransaccion resolves before any transaction opens

- GIVEN a successful `iniciarPago` call
- WHEN its execution is inspected
- THEN `PaymentGatewayPort.crearTransaccion` has already resolved before any `runInTransaction` call, if any, begins

### Requirement: An unconfigured payment gateway fails explicitly, and the process still boots

When no real gateway adapter is bound, every `PaymentGatewayPort` method MUST reject with an error mapped to HTTP 503, naming the missing configuration — never a boot failure and never a silent `undefined`-shaped error (D2/D-C.2/R7).

#### Scenario: iniciarPago on an unconfigured gateway returns 503

- GIVEN no payment gateway credentials are configured
- WHEN a user calls `iniciarPago` on a payable order
- THEN the response is 503 `PASARELA_NO_CONFIGURADA`, and no `payments` row is created

#### Scenario: The application still starts with no gateway configured

- GIVEN an environment with no payment gateway credentials set
- WHEN the application boots
- THEN it starts successfully — the absence of credentials is a runtime 503, not a startup failure

## HTTP surface (Q5)

| Method + route | Guard | Use case | Success |
|---|---|---|---|
| `POST /pedidos/:orderId/pago` | `@Roles('user')` + owner | `iniciarPago` | 201 `{ checkoutUrl }` |
| `GET /pedidos/:orderId/pago` | `@Roles('user')` + owner | `obtenerEstadoPago` | 200 `{ estado, monto, moneda, paidAt? }` |
| `PATCH /pedidos/:orderId/estado` | `@Roles('provider')` + owning company | `actualizarEstadoPedido` | 204 |
| `POST /pagos/webhook` | `@Public()` + signature | `procesarWebhookPago` | 200 |

`POST /pedidos/:orderId/pago` and `GET /pedidos/:orderId/pago` live in `pedidos.controller.ts`; `POST /pagos/webhook` lives in its own `pagos.controller.ts`, isolated so `@Public()` never sits in the same file as a JWT-guarded route.

| Error | HTTP | code |
|---|---|---|
| `PedidoNoEncontradoError` | 404 | `PEDIDO_NO_ENCONTRADO` |
| `TransicionInvalidaError` | 409 | `TRANSICION_INVALIDA` |
| `PedidoNoPagableError` | 409 | `PEDIDO_NO_PAGABLE` |
| `PagoNoEncontradoError` | 404 | `PAGO_NO_ENCONTRADO` |
| `FirmaInvalidaError` | 401 | `FIRMA_INVALIDA` |
| `PasarelaNoConfiguradaError` | 503 | `PASARELA_NO_CONFIGURADA` |
| `PedidoInvalidoError` | 400 | `PEDIDO_INVALIDO` |

## Deferred (named, not resolved here)

- **Q6 — audit_log for order transitions/payment results**: not decided by this change; open, owned by product.
- **Q7 — orphan-order lifecycle**: the `'expirado'` state exists (schema-level, `db-schema-pedidos-pagos`), but no job transitions an order into it in this change; timing, user notice, and whether it reopens `offer_opportunities.cerrada_at` are open, owned by product.
- **Q9 — retry limits and attempt visibility**: `payments` supports multiple attempts per order, one row each; how many retries are allowed and whether a failed attempt is surfaced to the user beyond the latest one are open, owned by product.
