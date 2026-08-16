# shared-payments Specification

## Purpose

`PaymentGatewayPort`: a shared-kernel port for hosted-checkout payment gateway integration (Webpay Plus or MercadoPago Checkout Pro, chosen in this change's own final phase), bound to a real adapter for the first time in this change. Mirrors `shared-notifications`' structure — declared in `backend-core-api-foundation` with a token and no provider, `pedidos-pagos` is its first and only caller (design.md D-C).

## Requirements

### Requirement: PaymentGatewayPort binds in a new @Global() shared-kernel module, not inside pedidos-pagos' own module

The real (or temporary) adapter for `PAYMENT_GATEWAY_PORT` MUST bind in `src/shared/payments/payments.module.ts`, decorated `@Global()`, mirroring `shared/notifications/notifications.module.ts`: it MUST export `PAYMENT_GATEWAY_PORT`. `SharedKernelModule` MUST import and export `PaymentsModule` alongside its existing shared modules, and its own doc comment (today stating the token "binds no provider... intentionally not wired") MUST be updated to reflect that it does. `pedidos-pagos.module.ts` MUST NOT bind or export `PAYMENT_GATEWAY_PORT` — the port is not this domain's to own, the same rule `core-api-ofertas`' own SPEC already applies to `NotificationPort`/`EventPublisher`.

#### Scenario: PaymentsModule mirrors NotificationsModule's shape

- GIVEN `src/shared/payments/payments.module.ts`
- WHEN it is inspected
- THEN it is decorated `@Global()`, provides `PAYMENT_GATEWAY_PORT`, and exports it — the same shape `NotificationsModule` already has for `NOTIFICATION_PORT`

#### Scenario: pedidos-pagos.module.ts does not bind or export PAYMENT_GATEWAY_PORT

- GIVEN `pedidos-pagos.module.ts` after this change
- WHEN its `providers` and `exports` are enumerated
- THEN `PAYMENT_GATEWAY_PORT` appears in neither — the token resolves only through `SharedKernelModule` → `PaymentsModule`

### Requirement: crearTransaccion returns the gateway's own transaction identifier, not only a checkout URL

`PaymentGatewayPort.crearTransaccion(orderId, monto)` MUST return `{ checkoutUrl: string; externalTransactionId: string }`. The narrower `{ checkoutUrl: string }` shape MUST NOT be used going forward: `payments.external_transaction_id` is `NOT NULL`, and without the gateway's own identifier at creation time no `payments` row can be written.

#### Scenario: A created transaction always carries an external id

- GIVEN a successful call to `crearTransaccion(orderId, monto)`
- WHEN the result is used to write a `payments` row
- THEN `externalTransactionId` from the result populates `payments.external_transaction_id`, and the insert never has to leave that `NOT NULL` column unset

### Requirement: verificarPago is the sole authority on payment state; a webhook body is never trusted directly

`PaymentGatewayPort.verificarPago(externalTransactionId)` MUST be the only source written into `payments.estado` / `orders.status`. A webhook delivery MUST NOT have its body's claimed status persisted directly — it identifies *which* transaction changed, and the confirmed state is always re-fetched from `verificarPago`. `verificarPago` MUST be safe to call more than once for the same `externalTransactionId` without side effects beyond returning the current `PaymentStatus` (idempotent by nature — it is a read against the gateway's own record, not a mutation).

#### Scenario: A webhook triggers a re-check, not a direct write

- GIVEN a webhook delivery naming `externalTransactionId` X with a claimed status of "pagado" in its body
- WHEN the domain processes the webhook
- THEN it calls `verificarPago(X)` and persists whatever THAT call returns, never the body's own claimed status verbatim

#### Scenario: Two webhook deliveries for the same transaction leave the system in the same state

- GIVEN the same webhook delivered twice for `externalTransactionId` X
- WHEN both deliveries are processed
- THEN both trigger `verificarPago(X)`, both observe the same confirmed state, and the system ends in that one state regardless of delivery order or count

### Requirement: interpretarWebhook lives in the concrete adapter, never in the controller or use case

`interpretarWebhook(raw: { headers: Readonly<Record<string, string>>; body: unknown }): { externalTransactionId: string; estado: PaymentStatus }` MUST be implemented only inside the concrete gateway adapter added in this change's final phase (gateway-specific signature verification algorithm and header names are not portable across Webpay/MercadoPago). Neither the HTTP controller nor any `pedidos-pagos` use case MUST parse a webhook signature or know which header carries it. `interpretarWebhook` MUST throw a signature-invalid error (mapped to 401/403 by the domain's exception filter) rather than returning a best-effort guess when verification fails.

#### Scenario: An invalid signature is rejected before any database access

- GIVEN a webhook request whose signature does not verify against the configured gateway credentials
- WHEN `interpretarWebhook` is called
- THEN it throws, no `payments` or `orders` row is read or written, and no event is published

### Requirement: the port MUST have a valid "not configured" binding, and it MUST NOT block application boot

At least one implementation of `PaymentGatewayPort` MUST be bindable with zero gateway credentials present, and the application MUST boot successfully in that state. Every method of this "not configured" implementation MUST reject with an explicit, named error (mapped to HTTP 503) rather than the application failing to start or a method call producing an unhandled `undefined is not a function`-class failure. This binding is not temporary scaffolding removed once a real adapter exists — it remains the permanent branch selected whenever gateway credentials are absent from configuration (design.md C.2), so environment variables for gateway credentials MUST NOT be modeled as unconditionally required.

#### Scenario: The application boots with no gateway credentials configured

- GIVEN an environment with no Webpay/MercadoPago credentials set
- WHEN the application starts
- THEN it boots successfully, `PAYMENT_GATEWAY_PORT` resolves to the not-configured adapter, and `validateEnv`'s fail-fast checks do not reject the environment for this reason alone

#### Scenario: Calling any port method without credentials fails explicitly

- GIVEN the not-configured adapter is bound
- WHEN any `PaymentGatewayPort` method is called
- THEN it rejects with a named "gateway not configured" error, mapped to HTTP 503, naming which credential is missing

#### Scenario: The not-configured adapter remains reachable after a real gateway is configured elsewhere

- GIVEN an environment with valid gateway credentials
- WHEN `PaymentsModule` resolves the binding
- THEN it selects the real adapter instead of the not-configured one — the not-configured adapter is chosen purely by the presence or absence of credentials, not removed as code
