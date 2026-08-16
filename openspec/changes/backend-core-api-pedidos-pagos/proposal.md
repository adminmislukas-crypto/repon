# Proposal: `pedidos-pagos` — sexto y último vertical de dominio, primera dependencia de un tercero externo y primer punto del repo donde un error cuesta dinero

## Intent

`services/core-api/src/domains/pedidos-pagos/` son hoy **2 archivos**: un `ports-out/order-repository.port.ts` con 2 firmas y un `@Module({})` vacío. Todo lo que está debajo ya existe y está en verde: `orders`/`order_items`/`payments` migradas con RLS, políticas, triggers de `updated_at`, la inmutabilidad de `order_items` por revocación de grants (incluido `service_role`) y pgTAP (`20260803120600_06_pedidos_pagos.sql`, `supabase/tests/06_pedidos_pagos_test.sql`); `Order`/`OrderItem`/`Payment`/`PaymentStatus` tipados en `@repon/types`; `PAYMENT_GATEWAY_PORT` y `NOTIFICATION_PORT` declarados en el kernel compartido; y `ofertas` publicando `OfertaAceptada` a **cero** consumidores desde el PR8a de este mismo mes.

Falta el final del flujo: **nadie crea un pedido y nadie cobra**. El paso 5 de `docs/ARCHITECTURE.md` ("el usuario acepta una oferta y paga") termina hoy en un evento que nadie escucha, y el paso 6 ("se crea el pedido y se notifica al proveedor") no existe. `PAYMENT_GATEWAY_PORT` es un `Symbol` sin proveedor. Las 3 tablas están vacías y sin una sola escritura posible.

Este cambio hace cinco cosas que solo se hacen una vez:

1. **Cierra el sexto y último vertical del repo.** Después de este cambio no queda ningún `@Module({})` vacío en `app.module.ts` — los 6 dominios de `openspec/config.yaml` tienen código real.
2. **Estrena la primera dependencia de un tercero externo.** Los 5 dominios previos solo hablaban con Postgres y entre sí por `EventEmitter2`. Éste habla con Webpay Plus o MercadoPago Checkout Pro: timeouts de red, callbacks asíncronos que llegan tarde, dos veces o nunca, y verificación de firma. **Modos de falla que no existen en ningún test del repo hoy.**
3. **Estrena el primer punto donde un error tiene costo monetario.** `pedidos-pagos/SPEC.md` lo dice él mismo: "el dominio con los requisitos de confiabilidad más altos (dinero real de por medio)". Un pedido duplicado es un cobro duplicado; un webhook mal procesado es un pedido pagado que nadie prepara.
4. **Estrena la primera ruta que MUTA estado sin JWT.** El webhook de la pasarela se autentica por **firma**, no por token: `@Public()` ya existe y ya se usa (registro, health, lecturas de `catalogo`), pero siempre sobre lecturas o altas anónimas — nunca sobre una escritura disparada por un tercero.
5. **Es el primer dominio cuyo esquema ya estaba migrado y probado antes de que existiera su código.** Su groundwork es estructuralmente **más chico** que el de los 5 previos: no hay tabla base nueva que crear, solo los row types de Kysely y lo que las preguntas abiertas de abajo obliguen a agregar en fix-forward.

Éxito = un usuario acepta una oferta, el sistema crea el pedido con un **snapshot inmutable** de los ítems, lo lleva por el checkout hospedado, confirma contra el resultado real de la pasarela, publica `PedidoConfirmado`/`PagoRecibido`/`PagoFallido`, y el proveedor puede mover el pedido por su ciclo de vida — todo sin que ningún archivo de `pedidos-pagos` importe nada de `ofertas` ni viceversa, y con `pnpm test` verde con los negativos escritos **antes** que el código.

## Conflictos declarados con contratos preexistentes

`openspec/config.yaml` (`rules.proposal`) exige leer el `SPEC.md` del dominio y **declarar los conflictos en vez de sobrescribirlos en silencio**. `services/core-api/domains/pedidos-pagos/SPEC.md` es un contrato de producto escrito a mano, anterior a SDD, y **no es propiedad de este cambio**. Estos son todos los puntos donde no cierra contra el código o el esquema reales:

| # | El contrato dice | La realidad verificada dice | Resolución |
|---|---|---|---|
| **C1** | `NotificationPort.sendPush(companyId, mensaje)` | `shared/notifications/notification.port.ts` declara `sendPush(recipientProfileId, mensaje)` | **Gana el puerto real.** Ligado al diferido #3: resolver `companyId → profileId[]` exige un contrato nuevo contra `identidad` que nadie definió. **Fuera de alcance**, ver Out of Scope |
| **C2** | "El pedido se crea en estado `confirmado` solo después de que `verificarPago` lo confirma, nunca antes" | `order_status` es `('confirmado','preparando','en_camino','entregado')` — **no hay estado pre-pago**; y `payments.order_id` es `NOT NULL UNIQUE REFERENCES orders(id)`, o sea **no puede existir un pago sin un pedido ya creado** | **Q1**, bloqueante antes de la fase 0. La ventana de consistencia que el propio SPEC llama "importante en este dominio en particular" **no tiene hoy dónde representarse** |
| **C3** | `PagoFallido` — "el pedido queda en un estado que permite reintentar sin duplicar" | Ni ese estado existe en el enum, ni `payments.order_id UNIQUE` admite una segunda fila de intento para el mismo pedido | **Q9** |
| **C4** | `crearPedidoDesdeOferta(offerId): Promise<Order>`, disparado al escuchar `OfertaAceptada` | Un listener de `EventEmitter2` no devuelve nada a ningún cliente, y `crearTransaccion` produce una `checkoutUrl` que **ningún camino del sistema transporta al usuario** | **Q3** |
| **C5** | Ports-out: solo `OrderRepository` | `payments` es una tabla propia, con estado propio y sin lectura directa de cliente | **Delta declarado**: se agrega `PaymentRepository` |
| **C6** | `openspec/specs/db-schema-pedidos-pagos/spec.md` lista las columnas de `order_items` **sin** `is_alt`/`alt_size`/`alt_qty`/`alt_note` | La migración `06` y `packages/types/src/pedidos-pagos.ts` **sí** los tienen | **Reconciliación de prosa** en la fase 0 — mismo trabajo que la tarea 1.1 de `ofertas` hizo con su propio spec desactualizado. El esquema **no se toca**: gana la migración aplicada |
| **C7** | Redeclara `PaymentGatewayPort`/`NotificationPort`/`EventPublisher` entre sus ports-out | Los tres son kernel compartido (`shared/payments`, `shared/notifications`, `shared/event-bus`), y el propio `order-repository.port.ts` ya documenta que **no se redeclaran** | **Delta menor declarado**, idéntico a la D17 de `ofertas` |
| **C8** | Firmas con `WebhookPayload`, `UrlCheckout`, `EstadoPago` | Ninguno de los tres tipos existe; el puerto real usa `Promise<{checkoutUrl: string}>` y `Promise<PaymentStatus>` | Se resuelven en la fase 6, con la pasarela ya elegida (**Q8**). `WebhookPayload` es gateway-específico por naturaleza |

## Decisiones ya tomadas (no re-abrir)

| # | Decisión | Consecuencia directa |
|---|---|---|
| **D1** | **El snapshot de ítems se resuelve extendiendo el payload de `OfertaAceptada` con las líneas de la oferta. NO se crea un `contracts/` sobre `ofertas`.** Decisión del usuario, cerrada. | Es el **segundo cambio del repo que escribe dentro de la carpeta de un dominio hermano ya archivado**, y se nombra como tal — mismo patrón con el que `ofertas` extendió el `CatalogQueryPort` de `catalogo` (su D9) y escribió listeners dentro de `refill-matching` (su D7). La D15 de `ofertas` dejó esta bifurcación **abierta con nombre** ("elegirá entre un `contracts/` sobre `ofertas` o un payload más gordo, ambas aditivas"); acá se cierra por la segunda. Verificado y a favor: `OfferRepository.findById` ya hidrata los ítems con un `innerJoin` contra `offer_items`, y `AceptarOfertaUseCase` ya tiene el `Offer` completo en la mano al publicar ⇒ **cero round-trips nuevos, cero métodos de puerto nuevos**. En contra y sin resolver: `offer_items` **no tiene `nombre` ni `cantidad`**, y `order_items` los exige `NOT NULL` (**Q2**). El delta sobre `ofertas` puede terminar siendo más que un campo de payload |
| **D2** | **Se construye TODO el dominio contra el `PaymentGatewayPort` que ya existe, y el adaptador concreto es la ÚLTIMA fase. La elección Webpay Plus vs. MercadoPago Checkout Pro se toma en esa fase, no en este documento.** Decisión del usuario, cerrada. | Misma forma con la que `ofertas` dejó su fase de cierre al final: el diff que toca lo ajeno se aísla para que se lea solo. Acá el motivo es más fuerte — la elección de pasarela arrastra SDK, credenciales, formato de webhook, algoritmo de firma y un entorno sandbox, y **nada de eso cambia una sola línea del dominio** si el puerto se respeta. `payments.gateway` usa un `CHECK IN ('webpay','mercadopago')`, no un enum, "para que sumar un gateway sea una migración de una línea" (comentario literal de la migración `06`): el esquema **ya** está diseñado para que esta decisión llegue tarde. Costo conocido: las fases 4-5 inyectan un token sin proveedor real y **Nest no arranca así** (**Q4**) |
| **D3** | **El listener de `OfertaAceptada` vive DENTRO de `pedidos-pagos/adapters/events/`, con su propio `ofertas-event.payloads.ts` local, suscrito por nombre de canal STRING (`'ofertas.oferta_aceptada'`), nunca importando la clase del evento.** Captura y loguea; **jamás** re-lanza. | Convención establecida tres veces (`CompanyVisibilityListener`, `RefillAutoSolicitadoListener`, los 2 listeners de `refill-matching` que escribió `ofertas`). No es una decisión nueva, es la aplicación de una regla archivada. `EventEmitterPublisher.publish` usa `emitAsync`: un rechazo acá propagaría **de vuelta** a `AceptarOfertaUseCase` **después de su commit**, convirtiendo una aceptación exitosa en un 5xx para el usuario. Se hereda el gotcha documentado: `emitAsync` entrega la instancia completa, el handler tipa `{ payload: ... }` y desestructura |
| **D4** | **Dueño forzado desde el actor; toda lectura/escritura cross-tenant devuelve 404, nunca 403, con error byte-idéntico.** Ningún DTO acepta `companyId` ni `userId`. | Cuarta repetición de la misma regla (D7 de `catalogo`, D7 de `consumo`, D13 de `refill-matching`, D11 de `ofertas`). `core-api` conecta con service-role y **bypassea RLS**: un `orderId` sin chequeo de dueño permite enumerar pedidos ajenos y, peor, moverles el estado. El 403 filtraría existencia cross-tenant |
| **D5** | **Fix-forward siempre: `20260803120600_06_pedidos_pagos.sql` NO se edita.** Todo lo que las preguntas abiertas obliguen a agregar va en un **batch `17`** nuevo. | Convención establecida en `20260804090500_10_grants_domain_tables_service_role.sql` y respetada por los batches `11`–`16`. La migración `06` ya está aplicada y pgTAP-testeada |
| **D6** | **`strict_tdd: true` activo, sin excepciones. Sexto dominio del repo construido así.** | `openspec/config.yaml` lo declara a nivel proyecto. Acá pesa más que en los 5 previos: los modos de falla nuevos (webhook duplicado, webhook que no llega, firma inválida, timeout de la pasarela) **solo existen como tests** — no hay forma de provocarlos a mano de forma confiable |
| **D7** | **`order_items` es un snapshot copiado POR VALOR. `offer_item_id` es solo procedencia y NUNCA se joinea para leer precio o descripción.** | No es una decisión de este cambio: es el contrato ya escrito en la migración (`comment on column`), en `openspec/specs/db-schema-pedidos-pagos/spec.md` (Requirement "immutable snapshot") y en el TSDoc de `OrderItem`. Se declara para que ningún adaptador de esta fase lo relaje. La inmutabilidad está **enforced por revocación de grants** (`revoke update, delete ... from ... service_role`), no por RLS: escribir mal una fila es **irreversible sin migración** |

## Scope

### In Scope

1. **Groundwork** — row types de Kysely para `orders`/`order_items`/`payments` + `OrderStatusRow`/`PaymentStatusRow` en `shared/database/schema.ts` (cierra el "The remaining 1 table (`pedidos-pagos`)" que su propia cabecera dejó anotado); aportes a `@repon/types`; **reconciliación de prosa** de `openspec/specs/db-schema-pedidos-pagos/spec.md` con la migración real (C6: `is_alt`/`alt_size`/`alt_qty`/`alt_note`); y la **migración batch `17`** con lo que Q1/Q2 exijan.
2. **`pedidos-pagos` vertical completo** — `domain/` (factories `Order`/`OrderItem`, máquina de estados de `OrderStatus`, cálculo puro de `subtotal`/`total`, regla de snapshot por valor), `ports-in/`, `ports-out/` (`OrderRepository` extendido + `PaymentRepository` nuevo, C5), `adapters/http|persistence|events`, providers reales en `pedidos-pagos.module.ts`.
3. **`crearPedidoDesdeOferta`** — listener de `OfertaAceptada` (D3) + creación del pedido con sus `order_items` en **una sola transacción**, con `TRANSACTION_MANAGER` inyectado, e **idempotente** frente a una segunda entrega del mismo evento (R6).
4. **El delta cross-dominio sobre `ofertas`** (D1) — `OfertaAceptadaPayload` gana las líneas de la oferta; `AceptarOfertaUseCase` y sus tests se actualizan; el `OfertaAceptadaListener` de `refill-matching` **no se toca** (su payload local es independiente y solo lee `refillRequestId`). Aislado en su propia fase para que el diff sobre `ofertas` se lea solo.
5. **`actualizarEstadoPedido`** — transiciones del proveedor (`confirmado → preparando → en_camino → entregado`), monótonas, con autorización por empresa dueña y 404 cross-tenant (D4).
6. **Lectura de estado de pago por HTTP** — `payments` **no tiene grant ni política de SELECT para `authenticated`** a propósito (PCI scope avoidance, `db-schema-pedidos-pagos`): si `core-api` no expone el estado, el cliente queda ciego. `orders`/`order_items` **sí** son legibles directo por RLS y por eso **no** llevan ruta de lectura propia (`docs/ARCHITECTURE.md`: las lecturas simples sin lógica van directo a Postgres).
7. **Los 3 eventos de `SPEC.md`** — `PedidoConfirmado`, `PagoRecibido`, `PagoFallido`, publicados **después** del commit, con payloads bajo la regla ya establecida (hechos propios + claves de correlación, cero vocabulario ajeno).
8. **Adaptador de pasarela — última fase (D2)** — elección de proveedor, `crearTransaccion`/`verificarPago`, ruta `@Public()` del webhook con **verificación de firma**, `procesarWebhookPago` idempotente, variables de entorno en `config/env.schema.ts` y el **primer binding real** de `PAYMENT_GATEWAY_PORT`.
9. **Deltas declarados** — `services/core-api/domains/pedidos-pagos/SPEC.md` (C1, C2, C3, C4, C5, C7, C8), `services/core-api/domains/ofertas/SPEC.md` (D1), `openspec/specs/db-schema-pedidos-pagos/spec.md` (C6 + batch `17`), `openspec/specs/core-api-ofertas/spec.md` (D1), `packages/types/SPEC.md`.
10. **Tests** — unitarios con todos los ports-out y `PaymentGatewayPort` mockeados; los negativos obligatorios de D4/D6; semántica transaccional e idempotencia; y **e2e de contrato cross-dominio** (`OfertaAceptada` real por el bus real → fila de `orders` + `order_items`), con `await moduleRef.init()`, nunca solo `.compile()`.

### Out of Scope

- **Push al proveedor** (diferido #3, C1) — `sendPush` toma un `profileId` y este dominio solo tiene `companyId`; resolverlo exige un contrato nuevo contra `identidad` que nadie definió. **Consecuencia declarada: el paso 6 de `docs/ARCHITECTURE.md` ("se crea el pedido y se notifica al proveedor por push") queda a medias en este cambio** — el pedido se crea y `PedidoConfirmado` se publica; el push no se envía. Es aditivo: un consumidor más del evento, sin tocar este dominio.
- **Cancelación y reembolso** (diferido #4) — `cancelarPedido`, el estado `cancelado`, el `'reembolsado'` de `payment_status` (que **ya existe en el enum**, igual que el `'expirada'` de `ofertas` existía sin disparador) y la reapertura de `offer_opportunities.cerrada_at`. La D-A.3 de `ofertas` ya anticipó esta conversación textualmente: "cerrar la oportunidad es monótono y no hay forma de reabrirla... es exactamente la conversación que `pedidos-pagos` va a tener que abrir". **Se nombra, no se abre acá.**
- **Modelado de comisiones** (diferido #6) — no hay columna, no hay regla de negocio escrita, y `admin-web` sigue pre-implementación. Definirlo antes de tener un consumidor real es sobre-construir.
- **Expiración del pedido huérfano** — el propio `SPEC.md` dice que "si el webhook nunca llega, el pedido queda huérfano y expira". El **estado** entra en Q1 (para no pagar una migración dos veces); el **job** que lo dispara no está en este cambio, mismo criterio con el que `ofertas` dejó `'expirada'` sin disparador. Sería el primer `adapters/scheduling/` fuera de `consumo`.
- **`contracts/` en `pedidos-pagos`** — cero dominios hacen una lectura síncrona sobre éste, y **no queda ningún dominio después** que pueda necesitarla. Tercer/cuarto dominio sin `contracts/`.
- **Realtime sobre `orders`** — la migración `06` deliberadamente no publica nada (`-- 8. Realtime / publication: (no aplica a este lote)`). Cero código de Realtime.
- **Editar `20260803120600_06_pedidos_pagos.sql`** (D5) — ya aplicada y pgTAP-testeada. Fix-forward en el batch `17`.
- **Reintentos automáticos / cola de reintento del webhook** — la pasarela reintenta por su cuenta; construir una cola propia antes de tener una pasarela elegida es especular.

## Capabilities

### New Capabilities

- `core-api-pedidos-pagos`: los casos de uso del dominio (`crearPedidoDesdeOferta`, `actualizarEstadoPedido`, `procesarWebhookPago` + lo que Q3 agregue), su superficie HTTP, la máquina de estados de `OrderStatus`, las reglas de autorización (D4), la semántica transaccional y de idempotencia (R6), el consumo de `OfertaAceptada` (D3) y los 3 eventos publicados.
- `shared-payments`: el contrato de `PaymentGatewayPort` — hermano de `shared-notifications`. Qué lanza y qué no, qué pasa ante timeout, si `verificarPago` es idempotente, y por qué el número de tarjeta nunca toca este servicio (checkout hospedado, PCI scope avoidance).

### Modified Capabilities

- `db-schema-pedidos-pagos`: reconciliación con la migración aplicada (C6) + lo que el batch `17` agregue (Q1/Q2/R6). Las 3 tablas base **no cambian de forma**.
- `core-api-ofertas`: `OfertaAceptada` gana las líneas de la oferta (D1) — delta aditivo sobre un dominio archivado hace días.
- `shared-types-package`: tipos nuevos del dominio (entrada de `crearPedidoDesdeOferta`, forma normalizada del webhook, y lo que Q2/Q3 exijan).
- `core-api-hexagonal-layout`: **ninguna regla cambia** — se agregan escenarios de confirmación para dos casos que ninguna scenario cubre todavía: dónde vive el adaptador concreto de un puerto del **kernel compartido** (Q4), y una ruta `@Public()` que **muta estado** autenticada por firma en vez de JWT.

## Approach

Bottom-up, 7 fases, cada una revisable de forma independiente y terminando con `pnpm test` verde. Bajo D6, **cada fase arranca por los tests**. La lógica de dominio va **primero**, la pasarela **última** (D2).

```
0. groundwork    row types orders/order_items/payments + enums (schema.ts),
                 tipos de @repon/types, reconciliacion de prosa del spec (C6),
                 migracion batch 17 con lo que Q1/Q2/R6 exijan
1. dominio       factories Order/OrderItem, maquina de OrderStatus (monotona),
                 snapshot por valor (D7), calculo puro de subtotal/total
2. persistencia  KyselyOrderRepository (insert atomico order + items,
                 mapper numeric->number) + PaymentRepository (C5)
3. delta ofertas OfertaAceptadaPayload gana las lineas (D1) + de donde salen
                 `nombre`/`cantidad` (Q2). UNICA fase que toca `ofertas`
4. creacion      listener de OfertaAceptada (D3) + crearPedidoDesdeOferta:
                 order + items + payment 'pendiente' en UNA transaccion,
                 idempotente (R6). PaymentGatewayPort MOCKEADO (D2)
5. ciclo de vida actualizarEstadoPedido + superficie HTTP (estado de pago,
                 checkout url segun Q3) + autorizacion 404 cross-tenant (D4)
6. pasarela      ELECCION del gateway (Q8) + adaptador concreto + ruta
                 @Public() del webhook + firma + procesarWebhookPago
                 idempotente + PagoRecibido/PagoFallido + env vars +
                 primer binding real de PAYMENT_GATEWAY_PORT
```

La fase 0 aterriza **antes** de toda lógica por el mismo motivo que en los 5 dominios previos: los row types y una migración son costuras, y una costura mal puesta con el dominio encima ya no es gratis. Acá hay un motivo extra: **Q1 y Q2 se resuelven en `sdd-design` antes de la fase 0**, porque las dos pueden exigir columnas o valores de enum nuevos, y descubrirlo en la fase 4 significa una segunda migración y reescribir el adaptador.

La fase 3 se aísla porque es la **única** que toca `ofertas`, un dominio archivado — mismo criterio con el que la fase 5 de `ofertas` aisló su delta sobre `catalogo`.

La fase 6 va última **por decisión explícita (D2)**, no por comodidad: es la única que arrastra un SDK, credenciales y un sandbox externo, y es la única cuyo contenido cambia entero según qué pasarela se elija. Todo lo anterior se prueba contra el puerto. `sdd-tasks` puede partirla en dos PRs (adaptador + SDK, y después webhook + firma) si el presupuesto de review lo pide.

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `services/core-api/src/domains/pedidos-pagos/domain/` | New | Factories `Order`/`OrderItem`, máquina de `OrderStatus`, cálculo puro de `subtotal`/`total`, snapshot por valor (D7) |
| `services/core-api/src/domains/pedidos-pagos/ports-in/` | New | `crear-pedido-desde-oferta`, `actualizar-estado-pedido`, `procesar-webhook-pago` + lo que Q3 agregue |
| `services/core-api/src/domains/pedidos-pagos/ports-out/order-repository.port.ts` | Modified | De 2 firmas a lo que exijan D4 (lectura con dueño), la escritura atómica de `order + items` y la transición de estado. `tx` **requerido** donde la atomicidad **sea** la operación (precedente D-G.5 de `ofertas`) |
| `services/core-api/src/domains/pedidos-pagos/ports-out/payment-repository.port.ts` | New | **Delta declarado sobre `SPEC.md`** (C5) |
| `services/core-api/src/domains/pedidos-pagos/adapters/http/` | New | Controller(s), DTOs, mapper; ningún DTO acepta `companyId`/`userId` (D4); **ruta `@Public()` del webhook** (fase 6) |
| `services/core-api/src/domains/pedidos-pagos/adapters/persistence/` | New | `KyselyOrderRepository` + `KyselyPaymentRepository`; conversión `numeric` → `number` en el mapper, con el callout de `Number(null) === 0` para las nullables (`alt_size`/`alt_qty`/`paid_at`) |
| `services/core-api/src/domains/pedidos-pagos/adapters/events/` | New | `oferta-aceptada.listener.ts` + `ofertas-event.payloads.ts` local (D3) |
| `services/core-api/src/domains/pedidos-pagos/pedidos-pagos.module.ts` | Modified | De `@Module({})` vacío a providers reales. **Último módulo vacío del repo** |
| `services/core-api/src/domains/ofertas/events/oferta-aceptada.payload.ts` | **Modified** | **Las líneas de la oferta entran al payload (D1).** Segundo cambio del repo que escribe dentro de un dominio hermano archivado |
| `services/core-api/src/domains/ofertas/ports-in/aceptar-oferta.use-case.ts` | Modified | Arma el payload extendido a partir del `Offer` que **ya tiene en la mano** (verificado: `findById` hidrata ítems por `innerJoin`) |
| `services/core-api/src/domains/ofertas/` (persistencia / `@repon/types`) | Modified (condicional) | Solo si Q2 resuelve que `nombre`/`cantidad` se persisten en `offer_items` |
| `services/core-api/src/domains/refill-matching/adapters/events/oferta-aceptada.listener.ts` | None | **No se toca** — su payload local es independiente y solo lee `refillRequestId` (ésa es exactamente la propiedad que el patrón compra) |
| `services/core-api/src/shared/payments/` | Modified | Adaptador concreto de la pasarela + su módulo, **si Q4 lo ubica acá** (precedente: `NotificationsModule`) |
| `services/core-api/src/shared/shared-kernel.module.ts` | Modified (condicional) | Agregar `PaymentsModule` al agregado `@Global()`, cerrando el "`shared/payments` still declares a token but binds no provider" de su propio comentario (Q4) |
| `services/core-api/src/shared/database/schema.ts` | Modified | `OrdersTable`, `OrderItemsTable`, `PaymentsTable` + los 2 row enums; extender `DB`. Cierra "The remaining 1 table" de su cabecera |
| `services/core-api/src/config/env.schema.ts` | Modified | Credenciales de la pasarela, fase 6. **Nunca como vars requeridas incondicionales** — rompería el boot de todo entorno que no las tenga; el precedente es la unión discriminada de `AUTH_JWT_MODE` |
| `services/core-api/src/app.module.ts` | None | `PedidosPagosModule` ya está importado (verificado) |
| `packages/types/src/pedidos-pagos.ts` | Modified | Tipos de entrada del dominio + forma normalizada del webhook. `Order`/`OrderItem`/`Payment`/`PaymentStatus` **sin cambios de forma** |
| `packages/types/src/ofertas.ts` | Modified (condicional) | Solo si Q2 obliga (D1) |
| `supabase/migrations/` | New | Batch `17`, fix-forward: lo que Q1/Q2/R6 exijan (estado pre-pago, `orders.offer_id` único, columnas de snapshot) |
| `supabase/migrations/20260803120600_06_pedidos_pagos.sql` | None | **No se toca** — aplicada y pgTAP-testeada (D5) |
| `services/core-api/domains/pedidos-pagos/SPEC.md` | Modified | Deltas declarados: C1, C2, C3, C4, C5, C7, C8 |
| `services/core-api/domains/ofertas/SPEC.md` | Modified | Delta declarado del payload de `OfertaAceptada` (D1) |
| `openspec/specs/db-schema-pedidos-pagos/spec.md` | Modified | Reconciliación C6 + batch `17` |
| `openspec/specs/core-api-ofertas/spec.md` | Modified | Payload de `OfertaAceptada` (D1) |
| `packages/types/SPEC.md` | Modified | Tipos nuevos y sus reglas de validación |

## Risks

| Riesgo | Prob. / Impacto | Mitigación |
|---|---|---|
| **R1 — La ventana de consistencia no tiene dónde representarse (C2).** El enum migrado no tiene estado pre-pago, y `payments.order_id NOT NULL` impide registrar un intento de pago sin pedido. Sin resolverlo, o se crea el pedido `confirmado` antes de cobrar (contradice el `SPEC.md` en su párrafo más enfático) o no se puede registrar el intento | **Alta / Crítico** | **Q1, bloqueante antes de la fase 0.** Candidato líder: batch `17` agrega el/los valores de enum faltantes. Es la decisión más cara de revertir de todo el cambio: cambiarla después implica migrar filas con dinero asociado |
| **R2 — El snapshot inmutable no tiene fuente para 2 de sus columnas `NOT NULL`.** Verificado: `offer_items` no tiene `nombre` ni `cantidad`; `refill_items` tiene `nombre` pero **`cantidad` no existe en ninguna tabla del repo fuera de `consumption_logs` y `order_items`** | **Alta / Alto** | **Q2.** Candidato líder: columnas nuevas en `offer_items` (batch `17`) pobladas **al componer la oferta**, que es exactamente el instante en que el precio se congela. La alternativa (resolver nombres al aceptar, contra la proyección o contra `catalogo`) contradice el espíritu del snapshot: sería una foto tomada tarde |
| **R3 — La `checkoutUrl` no tiene camino de vuelta al cliente (C4).** El pedido lo crea un listener fire-and-forget; `crearPedidoDesdeOferta` devuelve un `Order`, no una URL, y nadie está esperando ese retorno | **Alta / Alto** | **Q3.** Sin esto, el paso 5 del flujo central **no se puede completar desde la app**. Candidato: un port-in nuevo `iniciarPago(orderId)` por HTTP (delta declarado sobre `SPEC.md`), que además separa limpiamente "el pedido existe" de "el usuario decidió pagar ahora" |
| **R4 — El webhook llega dos veces, fuera de orden, o nunca.** Es el modo de falla nativo de todo checkout hospedado y **no existe en ningún test del repo**: los 5 dominios previos solo tenían entrega en proceso por `EventEmitter2` | **Alta / Crítico** | `payments.order_id UNIQUE` + `external_transaction_id` dan la clave natural de idempotencia; `procesarWebhookPago` debe ser idempotente por contrato de spec, no por comentario, y `raw_payload jsonb` guarda el cuerpo crudo para poder auditar una entrega rara. El "nunca llega" queda como pedido huérfano (Q1/Q7). **Tests obligatorios escritos primero** (D6) |
| **R5 — Un `OfertaAceptada` duplicado crea DOS pedidos para la misma oferta.** Verificado: `orders_offer_id_idx` **no es único**. Hoy `EventEmitter2` entrega en proceso una sola vez, pero el `SPEC.md` de este dominio es el que más explícitamente anticipa su extracción a microservicio — y ahí la entrega pasa a ser at-least-once | Media hoy / **Crítico** mañana | Idempotencia en `crearPedidoDesdeOferta` (buscar por `offer_id` antes de insertar) **más** un índice único en el batch `17`: hoy la tabla está vacía y el índice es gratis; con filas, no. Un cerrojo en la base es la única defensa que sobrevive a la extracción |
| **R6 — Un `order_items` mal escrito es irreversible.** `revoke update, delete on order_items from anon, authenticated, service_role`: ni la aplicación puede corregir una fila | Media / **Alto** | Es una garantía deseada (D7), no un defecto — pero obliga a que la validación del snapshot ocurra **antes** del insert y a que el test de mapper sea exhaustivo. Corregir en producción exigiría una migración. Se declara para que nadie descubra la propiedad tarde |
| **R7 — Nest no arranca con un token sin proveedor.** Las fases 4-5 inyectan `PAYMENT_GATEWAY_PORT` y su adaptador real no llega hasta la fase 6 (D2) | **Alta / Medio** | **Q4.** Candidato: un proveedor temporal que lance `PasarelaNoConfiguradaError` → **503**, declarado y testeado, reemplazado en la fase 6. Es el precio conocido de la secuenciación elegida, y es barato |
| **R8 — El delta sobre `OfertaAceptada` toca un dominio archivado hace días (D1)** y su payload ya tiene **dos** consumidores potenciales (el listener de `refill-matching` y el nuevo) | Media / Medio | El delta es **aditivo**: el listener de `refill-matching` redeclara su payload local y solo lee `refillRequestId`, así que campos nuevos no lo afectan — exactamente la propiedad que el patrón de payloads locales compró. La fase 3 aísla el diff. La R7 de la proposal de `ofertas` predijo este momento textualmente |
| **R9 — `payments` es ciego para el cliente por diseño.** Cero grants, cero políticas de SELECT | Media / Medio | Ruta HTTP propia de estado de pago (In Scope #6). Si se omite, el usuario no puede saber si su pago salió — una falla de producto silenciosa, no un error de sistema |
| **R10 — Presupuesto de review.** 7 fases, un dominio completo, un delta cross-dominio, una migración y un adaptador de tercero superan holgadamente 400 líneas | **Alta / Medio** | Expectativa declarada acá; la decisión real la toma **`sdd-tasks`** con `delivery_strategy: ask-on-risk` cacheado. Las 7 fases ya están dibujadas como unidades de trabajo autónomas, cada una con inicio, fin y verificación propios |
| **R11 — El paso 6 de `docs/ARCHITECTURE.md` queda a medias** (push al proveedor diferido, C1) | Alta / Bajo | Declarado en Out of Scope, no omitido. `PedidoConfirmado` se publica igual; el push es un consumidor más, aditivo, el día que exista el contrato `companyId → profileId[]` contra `identidad` |

## Rollback Plan

Greenfield en código, **no** en esquema: sin deploy, sin datos productivos, y con **cero consumidores aguas abajo** (`pedidos-pagos` es el último dominio; nadie escucha sus 3 eventos). El rollback operacional es `git revert` de la cadena de PRs y `pedidos-pagos` vuelve a ser un módulo vacío; `app.module.ts` ya lo importa y arranca igual.

Cuatro excepciones que no revierten con `git revert` solo:

1. **La migración del batch `17`** se revierte con una migración fix-forward, nunca editando la aplicada (D5). Hoy las 3 tablas están **vacías**, así que agregar un valor de enum o un índice único es trivial; con filas que representan dinero cobrado, deja de serlo.
2. **El delta sobre `OfertaAceptada`** (D1/R8): es aditivo y sus dos consumidores redeclaran payloads locales, así que quitar campos no rompe compilación — rompe **en runtime y en silencio**, que es peor. Se paga con el e2e de contrato de la fase 4.
3. **El adaptador de pasarela** (fase 6): revertirlo deja transacciones **reales creadas en el sandbox del proveedor** sin correlato local. Es el único punto del cambio con efectos fuera de este repo.
4. **Cualquier fila de `order_items` escrita** (R6/D7): sin `UPDATE` ni `DELETE`, ni siquiera para `service_role`.

| Barato de cambiar después | Caro de cambiar después |
|---|---|
| **Cambiar de pasarela**: `payments.gateway` es un `CHECK`, no un enum, y el dominio habla por el puerto (D2) | **La máquina de estados de `orders` (Q1/R1)**: con pedidos pagados en la tabla, migrar estados es migrar dinero |
| **Sumar el push al proveedor** (C1): un consumidor más de `PedidoConfirmado`, cero cambios en este dominio | **Que `order_items` guarde o no una columna (R6/D7)**: sin `UPDATE`, corregir el pasado exige una migración |
| **Sumar campos al payload de `OfertaAceptada`** (D1): aditivo, los consumidores redeclaran localmente | **Quitar campos de `OfertaAceptada`**: rompe en runtime y en silencio, no en compilación |
| **El índice único de `orders.offer_id` (R5)**: hoy la tabla está vacía | **Ese mismo índice con duplicados ya escritos**: exige backfill y decidir cuál pedido sobrevive |
| **La forma del payload local del listener**: lo lee un solo archivo, dentro de su propio dominio | **La semántica 404-en-vez-de-403 (D4)**: es contrato de API observable por los clientes |

## Dependencies

- `backend-core-api-foundation` (archivado): kernel compartido, `AuthGuard`/`RolesGuard` como `APP_GUARD`, `@Public()`, `EventBusModule`, `TRANSACTION_MANAGER`, `NOTIFICATION_PORT` bindeado, `PAYMENT_GATEWAY_PORT` **declarado y sin proveedor**, `validateEnv` fail-fast y el runner de Jest. **Todo presente y verificado.**
- `backend-core-api-ofertas` (archivado hace días): `OfertaAceptada` publicada por `AceptarOfertaUseCase` después del commit, con `offerId`/`companyId`/`userId`/`refillRequestId`/`total`/`desplazadas`; `OfferRepository.findById` hidratando ítems por `innerJoin`; y el patrón `listener + payloads locales`. **Presente.** Este cambio lo **extiende** de forma aditiva (D1) — único punto de contacto.
- Migraciones de `backend-supabase-migrations` aplicadas: `orders`/`order_items`/`payments` con RLS, políticas, triggers, la inmutabilidad por revocación de grants y los grants a `service_role` del batch `10`. **Todo presente y pgTAP-testeado** (`supabase/tests/06_pedidos_pagos_test.sql`).
- **Dependencias externas NUEVAS — las primeras del repo**, todas concentradas en la fase 6: SDK del proveedor elegido (Transbank o MercadoPago), credenciales de sandbox, y una **URL pública alcanzable por la pasarela** para el webhook (túnel en desarrollo local). Ninguna de las 5 fases anteriores las necesita — ése es exactamente el punto de D2.
- **Q1 y Q2 resueltas en `sdd-design` ANTES de la fase 0**: las dos pueden exigir DDL, y descubrirlo a mitad de la fase 4 significa una segunda migración sobre tablas que ya guardan dinero.

## Preguntas abiertas (para `sdd-spec` / `sdd-design`)

| # | Pregunta | Dueño | Estado |
|---|---|---|---|
| **Q1** | **Máquina de estados de `orders` y DDL del batch `17` (C2/R1).** El esquema migrado no tiene estado pre-pago ni de fallo/expiración, y `payments.order_id NOT NULL UNIQUE` impide un intento de pago sin pedido. ¿Se agrega `pendiente_pago` (y `expirado`) al enum? ¿`orders.offer_id` pasa a único (R5)? **Bloqueante antes de la fase 0** | `sdd-design` | Abierta |
| **Q2** | **De dónde salen `order_items.nombre` y `.cantidad` (D1/R2).** Verificado: no existen en `offer_items` ni en `refill_items`. ¿Columnas nuevas en `offer_items`, pobladas al componer la oferta? ¿`cantidad` es constante 1 con justificación escrita, o sale de `alt_qty` cuando `isAlt`? **Bloqueante antes de la fase 0** | `sdd-design` | Abierta |
| **Q3** | **Cómo llega la `checkoutUrl` al cliente (C4/R3).** ¿Un port-in nuevo `iniciarPago(orderId)` por HTTP —delta declarado sobre `SPEC.md`— o se persiste y se lee junto al estado del pago? Define si el flujo del usuario se puede completar | `sdd-spec` + producto | Abierta |
| **Q4** | **Dónde vive el adaptador de pasarela y qué se bindea mientras tanto (D2/R7).** ¿`shared/payments/payments.module.ts` agregado a `SharedKernelModule` —precedente literal de `NotificationsModule`— o `pedidos-pagos/adapters/payments/`? ¿Y qué proveedor temporal usan las fases 4-5 para que Nest arranque? | `sdd-design` | Abierta |
| **Q5** | **Superficie HTTP y roles.** `actualizarEstadoPedido` es claramente `provider`; las transiciones, ¿monótonas y sin retroceso? `orders`/`order_items` son legibles directo por RLS (grants + políticas ya existen) ⇒ **no** llevan ruta propia; `payments` no lo es ⇒ la sí lleva. Falta confirmarlo como regla escrita | `sdd-spec` | Abierta |
| **Q6** | **¿Las transiciones de pedido y los resultados de pago van a `audit_log`?** Los 5 dominios previos concluyeron que no (acciones self-service, no mutaciones administrativas). Acá hay dinero y disputas de por medio, y `raw_payload` solo cubre el lado del gateway. Es la primera vez que el cálculo no es obvio | `sdd-spec` + producto | Abierta |
| **Q7** | **Qué le pasa al pedido huérfano.** `SPEC.md` dice que "expira". ¿El estado entra en Q1 aunque el job quede fuera (precedente `'expirada'` de `ofertas`), o se descarta el concepto entero? | producto | Abierta |
| **Q8** | **Elección de pasarela y forma de la verificación de firma (D2, fase 6).** Webpay Plus vs. MercadoPago Checkout Pro; algoritmo y fuente de la firma; y la forma de las env vars — unión discriminada estilo `AUTH_JWT_MODE`, **nunca** requeridas incondicionales, o todo entorno sin credenciales deja de bootear | `sdd-design` | Abierta |
| **Q9** | **Reintento de pago sin duplicar (C3).** `payments.order_id` es `UNIQUE`: un segundo intento no puede crear una segunda fila. ¿Se sobrescribe la fila con el nuevo `external_transaction_id` —perdiendo el rastro del intento fallido—, se relaja el `UNIQUE` en el batch `17`, o el reintento reusa la misma transacción del gateway? | `sdd-design` + producto | Abierta |

## Success Criteria

- [ ] Un `OfertaAceptada` real, por el bus real, crea **exactamente una** fila de `orders` con sus `order_items`, verificado por e2e de contrato con `await moduleRef.init()` —no solo `.compile()`— (D3)
- [ ] Un **segundo** `OfertaAceptada` con el mismo `offerId` **no** crea un segundo pedido: idempotencia probada en el caso de uso **y** respaldada por un cerrojo en la base (R5)
- [ ] El listener **captura y loguea, nunca re-lanza**: una falla suya no convierte la aceptación ya commiteada de `ofertas` en un 5xx (D3/R8 — negativo obligatorio de D6)
- [ ] `order_items` se escribe **por valor**: ningún adaptador joinea `offer_item_id` para leer precio o descripción, y un cambio posterior de precio en `catalogo` **no** altera el pedido histórico (D7)
- [ ] El pedido **no** alcanza el estado que representa "pagado y en marcha" antes de que la pasarela lo confirme — la ventana de consistencia de `SPEC.md` se cumple con el estado que Q1 defina (C2/R1)
- [ ] `procesarWebhookPago` es **idempotente**: dos entregas del mismo webhook dejan el sistema en el mismo estado y publican el evento **una sola vez** (R4)
- [ ] Un webhook con **firma inválida** se rechaza sin tocar la base y sin publicar nada; la ruta es `@Public()` pero **no** es anónima (R4)
- [ ] `PedidoConfirmado`/`PagoRecibido`/`PagoFallido` se publican **después** del commit, nunca dentro del callback transaccional
- [ ] Un usuario A recibe **404 —no 403—** sobre un pedido de B, con error byte-idéntico al de un pedido inexistente; una empresa C recibe 404 al intentar mover el estado de un pedido ajeno (D4 — negativos obligatorios de D6)
- [ ] Ningún DTO de `pedidos-pagos` acepta `companyId` ni `userId`: se derivan siempre del actor (D4)
- [ ] El estado de pago es consultable por HTTP; `payments` sigue **sin** grant ni política de SELECT para `authenticated`, y `raw_payload` **nunca** viaja al cliente
- [ ] `orders`/`order_items` **no** tienen ruta de lectura propia en `core-api` — se leen directo por RLS, como manda `docs/ARCHITECTURE.md`
- [ ] `PAYMENT_GATEWAY_PORT` tiene **un solo** proveedor real, bindeado en la fase 6; las fases 4-5 corren con el puerto mockeado en tests y con un proveedor temporal que **falla explícitamente** en runtime (D2/R7)
- [ ] Las credenciales de la pasarela **no** son variables de entorno requeridas incondicionales: un entorno sin ellas sigue bootéando (Q8)
- [ ] `schema.ts` tipa las 3 tablas, `DB` las incluye, y toda columna `numeric` se declara `string` con la conversión en el mapper — con `alt_size`/`alt_qty`/`paid_at` nullables preservadas como `undefined`, **jamás como `0`**
- [ ] `openspec/specs/db-schema-pedidos-pagos/spec.md` incluye `is_alt`/`alt_size`/`alt_qty`/`alt_note` en la tabla de `order_items`, reconciliado contra la migración aplicada (C6)
- [ ] `20260803120600_06_pedidos_pagos.sql` **no fue editada**; todo DDL nuevo vive en el batch `17` (D5)
- [ ] El delta sobre `ofertas` toca **solo** el payload de `OfertaAceptada`, su caso de uso y sus tests (más lo que Q2 obligue); `refill-matching/adapters/events/oferta-aceptada.listener.ts` **no se edita** (D1/R8)
- [ ] Los deltas sobre `pedidos-pagos/SPEC.md` (C1–C8), `ofertas/SPEC.md` (D1), `db-schema-pedidos-pagos` (C6), `core-api-ofertas` (D1) y `packages/types/SPEC.md` están escritos **en esos archivos**, no solo en este cambio
- [ ] `pedidos-pagos.module.ts` deja de ser `@Module({})`: **no queda ningún módulo de dominio vacío en el repo**
- [ ] Las suites completas de `identidad`, `catalogo`, `consumo`, `refill-matching` y `ofertas` siguen en verde — sin regresión
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verde en CI; ningún `DELETE` físico introducido
