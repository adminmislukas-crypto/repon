# Delta for shared-types-package

## ADDED Requirements

### Requirement: OfferItem gains id and nombre; NuevoOfferItem is unchanged

`OfferItemReactiva`/`OfferItemProactiva` (the two members of `OfferItem`, `packages/types/src/ofertas.ts`) MUST each gain `id: string` (the domain-generated `offer_items.id`, never left to the column's `Generated<>` default — `pedidos-pagos` needs it as `order_items.offer_item_id`, `NOT NULL` with a foreign key) and `nombre: string` (frozen at composition time, D-B.2). `NuevoOfferItemReactiva`/`NuevoOfferItemProactiva` (and therefore `NuevoOfferItem`) MUST NOT change — the client never supplies either field. This is the first divergence between `OfferItem` and `NuevoOfferItem` since `NuevoOfferItem` was deliberately kept a separate named type rather than an alias of `OfferItem`, precisely so this divergence would be an additive field, not a breaking rename (this spec's own prior requirement, "NuevoOfferItem is added...").

#### Scenario: OfferItem exposes id and nombre

- GIVEN `@repon/types`'s `OfferItem` union
- WHEN either variant's fields are enumerated
- THEN both include `id: string` and `nombre: string`

#### Scenario: NuevoOfferItem is untouched by this change

- GIVEN `NuevoOfferItemReactiva`/`NuevoOfferItemProactiva`
- WHEN their fields are enumerated before and after this change
- THEN neither gains `id` or `nombre` — only `OfferItem` changes shape

### Requirement: OrderStatus gains pendiente_pago and expirado

`packages/types/src/pedidos-pagos.ts`'s `OrderStatus` MUST export `'pendiente_pago'` and `'expirado'` alongside the existing `'confirmado' | 'preparando' | 'en_camino' | 'entregado'`, matching `db-schema-pedidos-pagos`'s `order_status` enum (D-A.1) — without this, `pedidos-pagos`' own domain layer and HTTP DTOs cannot type the state machine's two new states. `Order`, `OrderItem`, `Payment`, `PaymentStatus` keep their existing shape unchanged; only `OrderStatus`'s member set grows.

#### Scenario: OrderStatus includes both new states

- GIVEN `@repon/types`'s `OrderStatus`
- WHEN its members are enumerated
- THEN they are exactly `'expirado' | 'pendiente_pago' | 'confirmado' | 'preparando' | 'en_camino' | 'entregado'`

#### Scenario: Order, OrderItem, Payment, and PaymentStatus are unaffected

- GIVEN `@repon/types`'s `Order`, `OrderItem`, `Payment`, `PaymentStatus`
- WHEN their fields/members are compared before and after this change
- THEN none of the four changes shape — only `OrderStatus` gains members
