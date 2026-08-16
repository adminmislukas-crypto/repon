# Design: `pedidos-pagos` — la ventana de consistencia, el snapshot que no tenía fuente, y el primer puerto del kernel que va a tener adaptador

Cierra las **3 preguntas que `proposal.md` asignó a esta fase** (**Q1**, **Q2**, **Q4**), más la **mitad de esquema de Q9** — inseparable de Q1: las dos escriben el mismo archivo de migración y no se pueden decidir por separado. Adopta **Q3** con la evidencia que el propio diseño produjo. Deja explícitamente abiertas **Q6**, **Q7 (mitad de producto)**, **Q8** y **Q9 (mitad de producto)**, y deja **Q5** como insumo tabulado para `sdd-spec`, que es su dueño.

**Este documento corre ANTES que `sdd-spec`, a propósito.** En `ofertas` el orden fue el inverso y sus delta specs quedaron diciendo "provisional, pendiente de Q1/Q2 de design.md" hasta que `sdd-tasks` tuvo que agregar una tarea 1.1 de reconciliación. Acá Q1 y Q2 se resuelven primero para que `sdd-spec` escriba requisitos **finales**. La contrapartida está en §Insumos para `sdd-spec`, al final: todo lo que este documento fija y el spec debe recoger tal cual.

No re-abre D1–D7. No define escenarios Given/When/Then. Diagramas en ASCII, convención del repo.

## Qué cierra este documento

| Sección | Cierra | Respuesta en una línea |
|---|---|---|
| **D-A** | **Q1** — máquina de estados y DDL | **`pendiente_pago` y `expirado`** entran al enum en un archivo propio (`17a`), y `orders.status` **pierde su `default 'confirmado'`**: olvidar el estado pasa a ser un error de compilación, no un pedido pagado gratis. `orders.offer_id` se vuelve **único** (R5) |
| **D-A.3** | **Q9, mitad de esquema** | `payments.order_id` **deja de ser `UNIQUE`**: una fila **por intento**, más un **índice único parcial `where estado = 'pagado'`** (precedente literal: `offers_refill_request_id_aceptada_uidx`). Un `PagoFallido` **no mueve el pedido** — sigue `pendiente_pago`, y eso *es* "un estado que permite reintentar sin duplicar" (C3) |
| **D-B** | **Q2** — `nombre` y `cantidad` | **`offer_items` gana `nombre`** (batch `17b`), poblada **al componer la oferta**, que es el instante en que el precio ya se congela — verificado contra el código, no supuesto. **`cantidad` es constante `1`** con justificación escrita, **nunca `alt_qty`**. Y aparece un tercer hueco que ninguna Q nombró: **`offer_items.id` no viaja en ningún tipo del dominio**, y `order_items.offer_item_id` es `NOT NULL` |
| **D-C** | **Q4** — dónde vive el adaptador | **`shared/payments/payments.module.ts` agregado a `SharedKernelModule`** (precedente literal `NotificationsModule`). El proveedor temporal **no es andamio**: `PasarelaNoConfiguradaAdapter` es la **rama permanente** de todo entorno sin credenciales, y por eso el criterio de éxito "un entorno sin credenciales sigue booteando" se cumple sin código extra |
| **D-C.3** | Hueco encontrado en el kernel | **`crearTransaccion` no devuelve `externalTransactionId`** y `payments.external_transaction_id` es `NOT NULL`. El puerto **tiene que ensancharse**. Nadie lo había nombrado |
| **D-D** | **Q3**, adoptada | `iniciarPago(orderId)` por HTTP. No por preferencia: es la **única** forma que deja la llamada a la pasarela fuera del camino del evento |
| **D-E** | Insumo de **Q5** (decide `sdd-spec`) | 4 rutas, **2 controladores** — el webhook `@Public()` va en su propio controlador para que el radio de explosión de `@Public()` no toque una sola ruta con JWT |
| **D-F / D-G** | Flujos, ports-out, transacciones, row types | 3 diagramas, el mapa de transacciones y el gotcha de `jsonb` (que es nuevo: el de `numeric` ya está documentado 5 veces) |

---

## D-A · Máquina de estados de `orders` y DDL del batch `17` (Q1 / C2 / C3 / R1 / R5 + Q9-esquema)

### A.1 · Dos valores nuevos, no tres, no cinco

`order_status` es hoy `('confirmado','preparando','en_camino','entregado')`. `pedidos-pagos/SPEC.md` exige, textualmente, que "el pedido se crea en estado `confirmado` **solo después** de que `verificarPago` lo confirma, nunca antes". Hoy eso es **inexpresable**: el único estado inicial disponible ya significa "pagado".

| Valor | ¿Entra? | Por qué |
|---|---|---|
| **`pendiente_pago`** | **Sí — bloqueante** | Es el estado que la ventana de consistencia de `SPEC.md` necesita para existir. Sin él, o se crea el pedido `confirmado` antes de cobrar (contradice el párrafo más enfático del contrato) o no se puede crear el pedido, y entonces `payments.order_id NOT NULL` hace imposible registrar el intento |
| **`expirado`** | **Sí — mitad de esquema de Q7** | `SPEC.md` dice que el pedido huérfano "expira". El **estado** es la mitad barata y se paga ahora; el **job** que lo dispara no está en este cambio. Precedente exacto y reciente: `offer_status.'expirada'` y `payment_status.'reembolsado'` existen sin disparador. Agregar el valor con la tabla **vacía** es gratis; agregarlo con filas que representan dinero cobrado no lo es |
| `pago_fallido` | **No** | Un intento fallido es un hecho del **pago**, no del pedido: `payments.estado = 'fallido'` ya lo registra, con `raw_payload` y `external_transaction_id`. Un estado espejo en `orders` duplicaría el mismo hecho en dos tablas con dos ciclos de vida y **cero comportamiento distinto** — desde `pago_fallido` se podría hacer exactamente lo mismo que desde `pendiente_pago`: reintentar. Ver A.3 |
| `cancelado` | **No** | Cancelación y reembolso son el diferido #4 completo (reapertura de `offer_opportunities.cerrada_at`, `payment_status.'reembolsado'`, política de reembolso). El valor sin su transición sería el único del enum sin dueño. **Y agregarlo después es barato**: `ALTER TYPE ... ADD VALUE` **no reescribe filas** — lo caro que R1 nombra es cambiar el *significado* o el *default* de estados ya escritos, no sumar un valor |

**Posición en el enum, y no es cosmética.** El batch `14` fijó la regla: "la posición en el enum define el orden de comparación y de `ORDER BY`". Los dos valores se insertan **antes de `'confirmado'`**, en este orden:

```
expirado < pendiente_pago < confirmado < preparando < en_camino < entregado
```

Así `status >= 'confirmado'` se lee, literalmente, como **"ya está pagado y en marcha"** — el predicado que toda lectura de proveedor va a querer. Con `'expirado'` al final del enum ese predicado incluiría pedidos que **nunca se pagaron**, que es exactamente el error que cuesta dinero. Las dos sentencias usan `'confirmado'` (valor **preexistente**) como ancla, nunca una a la otra: dentro de la misma transacción, anclar contra una etiqueta recién agregada es territorio que no hace falta pisar.

### A.2 · La máquina de estados completa

```
                  crearPedidoDesdeOferta (listener)
                              |
                              v
                     [ pendiente_pago ]  <--- UNICO estado inicial. Escrito SIEMPRE
                       |            |          explicito por el adaptador (A.4).
      procesarWebhook  |            |  (job de expiracion: FUERA DE ESTE CAMBIO)
      pago 'pagado'    |            |
                       v            v
                 [ confirmado ]  [ expirado ]   <- terminal
                       |
                       |  actualizarEstadoPedido  @Roles('provider')
                       v
                 [ preparando ]
                       |
                       v
                 [ en_camino ]
                       |
                       v
                 [ entregado ]   <- terminal
```

| Desde | Hacia | Quién | Regla |
|---|---|---|---|
| — | `pendiente_pago` | `crearPedidoDesdeOferta` | Único estado de creación. Nunca se apoya en un default de columna |
| `pendiente_pago` | `confirmado` | `procesarWebhookPago` (y solo él) | La transición se ejecuta como `UPDATE ... WHERE id = $1 AND status = 'pendiente_pago' RETURNING id`. **El rowcount es la idempotencia**: 0 filas ⇒ ya estaba confirmado ⇒ no se publica el evento de nuevo |
| `pendiente_pago` | `expirado` | **nadie, hoy** | El estado existe; el disparador no. Declarado, no olvidado |
| `pendiente_pago` | `preparando`/`en_camino`/`entregado` | — | **Prohibido**: 409 `TRANSICION_INVALIDA`. Un proveedor **no** puede empujar un pedido no pagado a "preparando" |
| `confirmado` → `preparando` → `en_camino` → `entregado` | | `actualizarEstadoPedido` | **Monótona y estrictamente adyacente**: sin saltos, sin retroceso. Cada transición es un hecho observable por el usuario; permitir el salto `confirmado → en_camino` borra "preparando" del historial sin forma de reconstruirlo, y la monotonía impide corregirlo |
| `entregado`/`expirado` | cualquiera | — | Terminales. 409 |

**El proveedor nunca alcanza `confirmado`**: no es un valor aceptado por el DTO de `actualizarEstadoPedido`. Es la mitad estructural de la ventana de consistencia — la otra mitad es que la única escritura de `'confirmado'` vive en el camino de confirmación de pago.

### A.3 · `PagoFallido` no mueve el pedido, y `payments` pasa a una fila por intento (C3 + Q9-esquema)

C3 es una contradicción real: `SPEC.md` promete que tras `PagoFallido` "el pedido queda en un estado que permite reintentar sin duplicar", y `payments.order_id UNIQUE` **impide físicamente** una segunda fila de intento.

| Opción | Veredicto |
|---|---|
| Mantener `UNIQUE` y **sobrescribir** la fila con el nuevo `external_transaction_id` | **Rechazada.** Destruye el rastro del intento fallido en la única tabla que registra dinero. Una disputa ("me cobraron dos veces") se vuelve irresoluble con los datos propios, y `raw_payload` guardaría solo el último cuerpo |
| Mantener `UNIQUE` y **reusar** la transacción del gateway | **Rechazada acá**: depende de si la pasarela elegida admite reabrir una transacción expirada (Q8, fase 6). Decidir el esquema contra una propiedad de un proveedor **todavía no elegido** es exactamente lo que D2 prohíbe |
| **Una fila por intento + índice único parcial** ✅ | **Elegida.** `alter table public.payments drop constraint payments_order_id_key`, más `create unique index payments_order_id_pagado_uidx on public.payments (order_id) where estado = 'pagado'` |

La invariante que de verdad importa no es "un pago por pedido", es **"a lo sumo UN pago exitoso por pedido"**, y esa se expresa exacta con un índice único parcial. **Precedente literal, del mes pasado**: `offers_refill_request_id_aceptada_uidx` es el mismo patrón — la unicidad no aplica a todas las filas, aplica al estado terminal que no puede repetirse. Un doble-tap concurrente sobre el mismo pedido choca contra un cerrojo de la base, no contra un chequeo en memoria, y el `23505` se traduce a error de dominio **en el adaptador** (misma frontera que `KyselyOfferRepository.marcarAceptada` ya establece).

Y con eso, **`PagoFallido` no necesita mover el pedido**: el pedido sigue `pendiente_pago`, un `iniciarPago` posterior crea una **fila nueva** con una transacción nueva del gateway, y "reintentar sin duplicar" se cumple sin un estado de pedido dedicado. C3 queda resuelto por el esquema de `payments`, no por el enum de `orders`.

Se agrega además **`create unique index payments_gateway_external_txn_uidx on public.payments (gateway, external_transaction_id)`**: es la **clave natural de idempotencia del webhook** (R4). Compuesta y no sobre la columna sola porque dos pasarelas pueden emitir el mismo identificador y el esquema ya está diseñado para convivir con más de una (`gateway` es un `CHECK`, no un enum).

### A.4 · El `default 'confirmado'` de `orders.status` se **dropea**, no se cambia

`orders.status` tiene hoy `not null default 'confirmado'`. Con la tabla vacía hay dos salidas:

| Opción | Consecuencia |
|---|---|
| `set default 'pendiente_pago'` | Un `INSERT` que olvide `status` escribe el estado correcto **en silencio**. Suena seguro, y es la opción cómoda |
| **`drop default`** ✅ | Un `INSERT` que olvide `status` **falla** (`not null`), y — más importante — el row type de Kysely deja de ser `Generated<OrderStatusRow>` y pasa a `OrderStatusRow` **requerido**: olvidarlo es un **error de compilación** |

Se elige **dropear**. Es la aplicación literal de la regla de la fundación que `ofertas` endureció en su D-G.5 ("«olvidé» debe ser un error de compilación") a la columna donde olvidarse cuesta dinero: con el default puesto, hoy un insert incompleto crea un pedido **pagado gratis**. Nada inserta en `orders` todavía, así que el costo de compatibilidad es cero. La convención "el estado se escribe SIEMPRE explícito" ya existe en el repo (`refill_requests.estado`, `offers.status`); acá se vuelve **inviolable por construcción**.

### A.5 · Índices: uno nace único, otro sobra

- **`create unique index orders_offer_id_uidx on public.orders (offer_id)`** (R5). Una oferta aceptada produce **exactamente un** pedido. Es el cerrojo que sobrevive a la extracción a microservicio, donde `EventEmitter2` deja de garantizar entrega única. Hoy la tabla está vacía y el índice es gratis; con filas, exige backfill y decidir cuál pedido sobrevive.
- **`drop index orders_offer_id_idx`**: el índice no-único de la migración `06` queda **estrictamente contenido** por el único. Dejar los dos es pagar dos escrituras de índice por cada pedido para siempre.

### A.6 · `orders.costo_despacho`: la única columna que este documento agrega sin que una Q la pidiera

`offers.total = Σ(item.precio) + costo_despacho`. `orders.total` se copia **por valor** desde `offer.total` (nunca se recalcula: recalcular es la puerta por la que entra un total distinto al que el usuario aceptó). Pero `order_items.subtotal` solo suma los ítems ⇒ **`Σ subtotal ≠ orders.total`**, y la diferencia — el despacho — **no está en ninguna parte de este dominio**.

| Opción | Veredicto |
|---|---|
| No agregar nada; recuperar el despacho joineando `orders.offer_id → offers.costo_despacho` | **Rechazada.** Es la misma clase de lectura tardía que D7 prohíbe para el precio: el monto cobrado quedaría explicado por una fila **mutable de otro dominio**. Ante una disputa, "cobramos X" sería indemostrable con los datos propios |
| **`add column costo_despacho numeric(12,2) not null default 0 check (costo_despacho >= 0)`** ✅ | El total se vuelve **descomponible y auditable**: `total = Σ(items.subtotal) + costo_despacho`, verificable como invariante en el caso de uso y en un test, sin joins |

Se agrega ahora por el mismo argumento que el índice único: la tabla está vacía y el costo es una línea de DDL; con filas que representan dinero cobrado, agregar una columna obliga a decidir qué valor tuvo el pasado. **El default `0` se conserva** (a diferencia de `status`): `0` es un valor semánticamente correcto y completo para un despacho gratis, no un centinela que oculte un dato faltante.

### A.7 · La migración: **dos archivos**, y la razón es de Postgres, no de gusto

La proposal dice "batch `17`". Se materializa en **dos archivos**, exactamente por el motivo que ya obligó a partir `14`/`15` y que su propia cabecera dejó escrito: desde PG12 `ALTER TYPE ... ADD VALUE` puede correr dentro de una transacción, pero **el valor agregado no puede usarse hasta que esa transacción commitee**, y el runner de Supabase aplica cada archivo en una transacción. El sufijo `a`/`b` en vez de `17`/`18` sigue el precedente `01a`/`01b`: es **un** batch lógico partido por una restricción del motor.

```sql
-- supabase/migrations/20260809120000_17a_pedidos_pagos_order_status_values.sql
-- Batch 17a -- pedidos-pagos: los 2 valores que le faltan a order_status
-- (design.md D-A.1, C2/R1). Delta declarado sobre db-schema-pedidos-pagos.
-- NO edita 20260803120600_06_pedidos_pagos.sql: fix-forward (D5).
--
-- ESTE ARCHIVO CONTIENE SOLO ALTER TYPE, A PROPOSITO -- misma restriccion
-- que obligo a partir 14/15: el valor agregado no puede USARSE hasta que
-- esta transaccion commitee. El batch 17b nombra 'pendiente_pago' en un
-- comment y podria querer usarlo en un indice parcial mañana, asi que la
-- separacion es estructural, no defensiva. No agregar aca ningun default,
-- CHECK, backfill ni indice.
--
-- POSICION: los dos ANTES de 'confirmado', anclados contra 'confirmado'
-- (valor preexistente), nunca uno contra el otro. Orden resultante:
--   expirado < pendiente_pago < confirmado < preparando < en_camino < entregado
-- Asi `status >= 'confirmado'` significa "ya pagado y en marcha". Con
-- 'expirado' al final, ese mismo predicado incluiria pedidos NUNCA pagados.
-- No es reversible: quitar un valor de un enum exige recrear el tipo.

alter type public.order_status add value 'expirado'       before 'confirmado';
alter type public.order_status add value 'pendiente_pago' before 'confirmado';
```

```sql
-- supabase/migrations/20260809120100_17b_pedidos_pagos_fix_forward.sql
-- Batch 17b -- pedidos-pagos: el resto del fix-forward (design.md D-A.3/4/5/6,
-- D-B.2). Depende del batch 17a YA COMMITEADO.
-- Secciones 2/4 del layout estandar: cero tablas nuevas, cero enums, cero RLS
-- (las 3 tablas ya tienen sus politicas y grants desde el batch 06).

-- ============================================================
-- 2. Tables
-- ============================================================

-- D-A.4: se DROPEA el default, no se cambia. Un INSERT que olvide `status`
-- debe FALLAR, no crear un pedido 'confirmado' -- es decir, pagado -- gratis.
-- Efecto colateral buscado: el row type de Kysely deja de ser Generated<> y
-- olvidar la columna pasa a ser un error de compilacion.
alter table public.orders alter column status drop default;

-- D-A.6: el total se copia por valor desde offers.total (que YA incluye el
-- despacho). Sin esta columna, `Sum(order_items.subtotal) != orders.total` y
-- la diferencia solo seria recuperable joineando una tabla MUTABLE de otro
-- dominio -- la misma lectura tardia que D7 prohibe para el precio.
alter table public.orders
  add column costo_despacho numeric(12,2) not null default 0
    check (costo_despacho >= 0);

comment on column public.orders.status is
  'pendiente_pago es el UNICO estado inicial (design.md D-A.2). confirmado lo escribe EXCLUSIVAMENTE el camino de confirmacion de pago, nunca actualizarEstadoPedido: esa es la mitad estructural de la ventana de consistencia de SPEC.md. Sin default a proposito (D-A.4).';
comment on column public.orders.costo_despacho is
  'Copiado por valor desde offers.costo_despacho al crear el pedido (D-A.6). Invariante: total = SUM(order_items.subtotal) + costo_despacho, verificada en el caso de uso y en test -- no expresable como CHECK (cruza tablas).';
comment on column public.order_items.cantidad is
  'SIEMPRE 1 en este cambio (design.md D-B.3). Una fila de offer_items ES una linea cotizada y offer_items.precio es el precio TOTAL de esa linea, no un unitario: por eso precio_unitario = subtotal = offer_items.precio y cantidad = 1. NUNCA se llena con alt_qty: alt_qty ya se copia por valor a su propia columna y significa "cuantas unidades de la presentacion alternativa", no "cuantas lineas". El dia que el proveedor cotice cantidades, la columna ya existe y el cambio es de DTO, no de esquema.';

-- D-B.2 (Q2): la fuente de order_items.nombre. Se puebla al COMPONER la
-- oferta -- el mismo instante en que el precio se congela (verificado:
-- EnviarOfertaUseCase ya tiene el nombre en la mano, ver design.md D-B.2).
-- Se agrega con default temporal y se DROPEA el default acto seguido: el
-- default existe solo para que la sentencia sea valida si alguna base de
-- desarrollo ya tiene filas; despues de esto, todo INSERT debe escribirlo.
alter table public.offer_items add column nombre text not null default '';
alter table public.offer_items alter column nombre drop default;

comment on column public.offer_items.nombre is
  'Nombre congelado de la linea, escrito al componer la oferta (design.md D-B.2). Rama reactiva: el nombre del RefillItem solicitado (lo que el usuario pidio y el proveedor acepto surtir). Rama proactiva: ProviderCatalogItem.nombre. NUNCA lo envia el cliente: un proveedor no puede escribir texto arbitrario en un snapshot inmutable de pedido. De aca sale order_items.nombre, que es NOT NULL.';

-- ============================================================
-- 4. Indexes
-- ============================================================

-- R5: una oferta aceptada produce EXACTAMENTE un pedido. Cerrojo en la base,
-- unica defensa que sobrevive a la extraccion a microservicio (donde la
-- entrega del evento pasa a ser at-least-once). Gratis hoy: tabla vacia.
create unique index orders_offer_id_uidx on public.orders (offer_id);
-- Estrictamente contenido por el anterior: dos escrituras de indice por pedido
-- para siempre, a cambio de nada.
drop index public.orders_offer_id_idx;

-- Q9/D-A.3: una fila POR INTENTO. La invariante real no es "un pago por
-- pedido" sino "a lo sumo UN pago exitoso por pedido", y eso es un indice
-- unico PARCIAL. Mismo patron que offers_refill_request_id_aceptada_uidx.
alter table public.payments drop constraint payments_order_id_key;
create index payments_order_id_idx on public.payments (order_id);
create unique index payments_order_id_pagado_uidx
  on public.payments (order_id)
  where estado = 'pagado';

-- R4: la clave natural de idempotencia del webhook. Compuesta con gateway
-- porque dos pasarelas pueden emitir el mismo id y `gateway` es un CHECK, no
-- un enum, justamente para que convivan.
create unique index payments_gateway_external_txn_uidx
  on public.payments (gateway, external_transaction_id);
```

**Lo que este batch NO toca**, y se dice en voz alta: las 3 tablas conservan forma, RLS, políticas, grants y la revocación de `update`/`delete` sobre `order_items`. `payments` sigue **sin grant ni política de `SELECT`** para `authenticated` (PCI scope avoidance). Cero `DELETE` introducido.

---

## D-B · De dónde salen `order_items.nombre` y `.cantidad` (Q2 / D1 / R2)

### B.1 · La premisa de D1 se verificó contra el código — y aparece un tercer campo que nadie nombró

D1 apuesta todo a que `AceptarOfertaUseCase` ya tiene la oferta **con sus líneas** en la mano al publicar. **Verificado, término a término:**

- `KyselyOfferRepository.findById` (`adapters/persistence/kysely-offer.repository.ts:216`) hace `innerJoin('offer_items as i', 'i.offer_id', 'o.id')` y devuelve un `Offer` con `items` hidratados en **una** query.
- `AceptarOfertaUseCase.execute` (`ports-in/aceptar-oferta.use-case.ts:104`) llama a ese `findById` dentro de la transacción, y el objeto que sale de `aceptar(found)` — el mismo que arma el payload en la línea 135 — **conserva `items`**.

⇒ **Cero round-trips nuevos, cero métodos de puerto nuevos.** La premisa de D1 es correcta.

**Pero el inventario de lo que falta es más largo que Q2**, y el tercer faltante es el que rompe una FK:

| Columna de `order_items` | ¿Está en `OfferItem`? | Estado |
|---|---|---|
| `precio_unitario`, `subtotal` | `precio` | ✔ (ver B.3) |
| `is_alt`, `alt_size`, `alt_qty`, `alt_note` | sí, 1:1 | ✔ |
| **`nombre` `NOT NULL`** | **no** | **Q2** → B.2 |
| **`cantidad` `NOT NULL check (> 0)`** | **no** | **Q2** → B.3 |
| **`offer_item_id` `NOT NULL references offer_items(id)`** | **NO — y nadie lo había nombrado** | → B.4 |

`OfferItem` **no expone `id`**, deliberadamente: la factory lo dice literal ("`items` no lleva `id` propio... `offer_items.id` es `Generated<string>`, `shared-types-package` deliberadamente no lo expone en el dominio"), y `toOfferItem` **descarta** el `i.id as item_id` que el `JOIN_SELECT` ya trae. Sin ese id, `order_items.offer_item_id` — `NOT NULL`, con FK — **no se puede escribir**. Relajarlo a nullable está descartado: la procedencia es contrato escrito en tres lugares (D7, `comment on column`, spec).

### B.2 · `nombre`: columna nueva en `offer_items`, poblada al componer

| Opción | Veredicto |
|---|---|
| **Columna en `offer_items`, escrita al componer la oferta** ✅ | **Elegida.** Es el instante en que el precio ya se congela (`crearOfertaReactiva` calcula y persiste `total` ahí mismo), así que el nombre se congela **con** el precio, no después. `order_items` pasa a ser una copia por valor de una fila **que ya era una foto**, sin una sola resolución tardía |
| Resolver el nombre al **aceptar**, contra la proyección o contra `catalogo` | **Rechazada.** Sería una foto tomada tarde: entre componer y aceptar pueden pasar días, y el nombre del catálogo pudo cambiar. Además obligaría a `AceptarOfertaUseCase` a inyectar `CATALOG_QUERY_PORT` **dentro de su transacción**, que es exactamente lo que la C2 de `ofertas` prohíbe |
| Resolverlo en `pedidos-pagos`, en el listener | **Rechazada.** Obliga a este dominio a leer tablas de `ofertas`/`catalogo`. El snapshot dejaría de ser "copia por valor de lo aceptado" para ser "reconstrucción con datos de hoy" |

**De dónde sale el valor, verificado en cada rama** (ambas ya lo tienen, cero round-trips nuevos):

- **Reactiva** (`EnviarOfertaUseCase`): `oportunidad.items` es `RefillItem[]`, con `nombre`, ya indexado por `id` en el `Map` de la línea 140 (`refillItemsById`). El nombre correcto es el del **ítem solicitado**: es lo que el usuario pidió y lo que el proveedor aceptó surtir. Nótese que una línea reactiva **no identifica** qué ítem del catálogo del proveedor la cubre (`NuevoOfferItemReactiva` solo lleva `refillItemId`), así que el nombre del catálogo ni siquiera es determinable; el desvío de presentación ya viaja en `altNote`.
- **Proactiva** (`EnviarOfertaProactivaUseCase`): `ProviderCatalogItem.nombre`, del resultado de `obtenerItemsDeProveedor`, cardinalidad ya validada.

**El cliente nunca envía `nombre`.** `NuevoOfferItem` no lo declara y no debe declararlo: dejar que el proveedor escriba texto libre que termina en un snapshot **físicamente inmutable** (sin `UPDATE` ni `DELETE`, ni para `service_role`) es regalar un canal de escritura irreversible.

### B.3 · `cantidad` es **constante `1`**, y `alt_qty` queda descartado con nombre y apellido

| Opción | Veredicto |
|---|---|
| **Constante `1`, con justificación escrita** ✅ | **Elegida.** Una fila de `offer_items` **es** una línea cotizada, y `offer_items.precio` es el precio **total de esa línea**, no un unitario — está verificado en `offer.entity.ts`: `total()` suma `item.precio` directo, sin ningún paso de `precio × cantidad` en ninguna parte del repo, y el doc de `precioPorUnidad` lo dice explícito ("`item.precio` es el total YA MULTIPLICADO de la línea"). Con `cantidad = 1`: `precio_unitario = subtotal = offer_items.precio`, y `subtotal = cantidad × precio_unitario` se cumple **trivialmente y siempre** |
| `alt_qty` cuando `isAlt` | **Rechazada, y es la peor de las tres.** (a) `order_items` **ya copia `alt_qty` a su propia columna**: usarlo también como `cantidad` guardaría el mismo hecho dos veces con dos significados distintos, en una tabla que **no se puede corregir sin migración** (R6). (b) `alt_qty` es `NULL` para todo ítem no-alt ⇒ haría falta un fallback a `1` ⇒ **la misma columna tendría dos semánticas** y, mirando una fila vieja, sería indistinguible cuál se usó. (c) Rompería la invariante: para que `subtotal = cantidad × precio_unitario` siguiera cerrando, `precio_unitario` tendría que pasar a ser el precio por unidad de presentación (`precio / (altSize × altQty)`), y entonces `precio_unitario` significaría **algo distinto** en filas alt y no-alt |
| Columna `cantidad` nueva en `offer_items` | **Rechazada hoy.** Sería una columna que solo puede valer `1`: **ninguna** tabla del repo fuera de `consumption_logs` y `order_items` tiene una cantidad, ningún DTO la acepta y ningún caso de uso la produce. Cotizar cantidades es un cambio de producto con su propio DTO; cuando llegue, `order_items.cantidad` **ya existe** y el cambio es de DTO, no de esquema |

La constante vive en el dominio (`domain/order.entity.ts`, `CANTIDAD_LINEA = 1`) con su razón al lado, y queda escrita en el `comment on column` del batch `17b` y en el delta de spec — **tres lugares**, porque es la decisión que un lector futuro va a querer discutir.

### B.4 · El payload extendido de `OfertaAceptada` y los 3 campos que `OfferItem` gana

**`OfferItem` gana `id` y `nombre`. `NuevoOfferItem` no cambia.** Y esto es la primera vindicación de la D14 de `ofertas`, que se negó a hacer `NuevoOfferItem` un alias de `OfferItem` "para que la primera divergencia sea un campo nuevo y no un rename breaking": **la divergencia llegó, y es exactamente esa**.

```ts
// packages/types/src/ofertas.ts  (aditivo)
export type OfferItemReactiva = OfferItemPricing & OfferItemAlt & {
  /** offer_items.id, generado por el dominio (randomUUID) al componer, nunca
   *  por el default de la columna -- misma regla que Offer.id. `pedidos-pagos`
   *  lo necesita para order_items.offer_item_id (NOT NULL, FK). */
  id: string;
  /** Congelado al componer (design.md D-B.2). Fuente de order_items.nombre. */
  nombre: string;
  refillItemId: string;
  providerCatalogItemId?: never;
};
// OfferItemProactiva: idéntico, con providerCatalogItemId.
// NuevoOfferItemReactiva / NuevoOfferItemProactiva: SIN CAMBIOS (el cliente
// no envía ni el id ni el nombre).
```

Consecuencias, todas dentro de la fase 3 (la única que toca `ofertas`):

1. `crearOfertaReactiva`/`crearOfertaProactiva` mapean `NuevoOfferItem → OfferItem` agregando `id: randomUUID()` y el `nombre` resuelto por el caso de uso. Escribir ids desde la app **ya es la convención** (`Offer.id`, `RefillRequest.id`): esto la extiende a los hijos.
2. `toOfferItemRowValues` escribe `id` y `nombre` explícitos; `toOfferItem` deja de descartar `row.item_id` y lee `row.nombre`. `OfferItemsTable` gana `nombre: string` (el `id: Generated<string>` **no cambia**: `Generated` permite proveer el valor).
3. `OfertaAceptadaPayload` gana **un** campo:

```ts
// domains/ofertas/events/oferta-aceptada.payload.ts  (aditivo, D1)
export interface OfertaAceptadaLineaPayload {
  readonly offerItemId: string;   // -> order_items.offer_item_id (FK)
  readonly nombre: string;        // -> order_items.nombre
  readonly precio: number;        // -> precio_unitario Y subtotal (cantidad = 1, D-B.3)
  readonly isAlt: boolean;
  readonly altSize?: number;
  readonly altQty?: number;
  readonly altNote?: string;
}
export interface OfertaAceptadaPayload {
  // ... offerId, companyId, userId, refillRequestId, total, desplazadas (sin cambios)
  readonly costoDespacho: number;              // -> orders.costo_despacho (D-A.6)
  readonly lineas: readonly OfertaAceptadaLineaPayload[];
}
```

`lineas` y no `items`: el payload es **vocabulario propio de `ofertas` viajando por el bus**, no el tipo `OfferItem` exportado. El consumidor lo redeclara localmente (D3) y así un cambio de forma en `OfferItem` no lo rompe en silencio. El `OfertaAceptadaListener` de `refill-matching` **no se toca**: su payload local declara 2 campos y campos nuevos le son invisibles — la propiedad exacta que el patrón compró (R8).

---

## D-C · Dónde vive el adaptador de pasarela y qué se bindea mientras tanto (Q4 / D2 / R7)

### C.1 · `shared/payments/payments.module.ts`, agregado a `SharedKernelModule`

| | **`shared/payments/payments.module.ts`** ✅ | `pedidos-pagos/adapters/payments/` |
|---|---|---|
| Dónde vive el **puerto** | `shared/payments/payment-gateway.port.ts` — kernel compartido, y C7 declara que este dominio **no lo redeclara** | Igual: el puerto seguiría siendo ajeno. El adaptador quedaría implementando una interfaz que su propio dominio no posee |
| Precedente | **Literal**: `NotificationsModule` bindea `NOTIFICATION_PORT` en `shared/notifications/` y se agrega a `SharedKernelModule`. `ofertas` consume `sendPush` sin poseer su adaptador | Ninguno en el repo |
| Alcance de DI | Un solo binding `@Global()`, un solo lugar donde mirar quién provee el token | Un token `@Global()` provisto desde un módulo de dominio: dos lugares con autoridad sobre el mismo símbolo |
| Config/credenciales | Ya viven en `config/env.schema.ts`, compartido | Un dominio leyendo config de infraestructura de tercero |
| Deuda que cierra | El comentario de `shared-kernel.module.ts` ("`shared/payments` still declares a token but binds no provider... intentionally not wired") | La deja abierta para siempre |

Se elige **`shared/payments`**. El contraargumento honesto es el hexagonal purista: el adaptador de un puerto con un solo consumidor "debería" vivir con su consumidor. No aplica acá porque **el puerto no es de este dominio** — es del kernel, exactamente como `NotificationPort`, y el repo ya resolvió ese caso una vez.

```ts
// shared/payments/payments.module.ts  (fase 4, con el adaptador null; fase 6 agrega la rama real)
@Global()
@Module({
  providers: [{ provide: PAYMENT_GATEWAY_PORT, useClass: PasarelaNoConfiguradaAdapter }],
  exports: [PAYMENT_GATEWAY_PORT],
})
export class PaymentsModule {}
```

`SharedKernelModule` suma `PaymentsModule` a `imports` y a `exports`, y su doc comment se actualiza (hoy afirma lo contrario). `app.module.ts` **no se toca**.

### C.2 · El proveedor temporal no es andamio: es la rama permanente

`PasarelaNoConfiguradaAdapter` implementa `PaymentGatewayPort` y **cada método lanza `PasarelaNoConfiguradaError`**, que el filtro del dominio mapea a **503**. Importado desde `shared/payments/payments.errors.ts` y **jamás redeclarado** — misma única importación cross-frontera legítima que `CatalogQueryUnavailableError` ya estableció, con el mismo código HTTP.

Lo interesante es que **no se borra en la fase 6**. Ahí `PaymentsModule` pasa a `useFactory` sobre la config: con credenciales presentes bindea el adaptador real; **sin credenciales, bindea éste**. Con eso el criterio de éxito "las credenciales no son variables de entorno requeridas incondicionales — un entorno sin ellas sigue booteando" se cumple **sin una línea de código nueva**, y el modo de falla es explícito (503 con un mensaje que nombra la variable faltante) en vez de un `undefined is not a function` en runtime. La forma de la discriminación de env vars es de Q8/fase 6; lo único que este documento fija es que **debe existir una rama "sin configurar" válida**, no un `throw` en el arranque.

### C.3 · El puerto tiene que ensancharse — hueco que ninguna Q nombró

```ts
export interface PaymentGatewayPort {
  crearTransaccion(orderId: string, monto: number): Promise<{ checkoutUrl: string }>;  // HOY
  verificarPago(transactionId: string): Promise<PaymentStatus>;
}
```

`payments.external_transaction_id` es **`NOT NULL`**, y `crearTransaccion` **no lo devuelve**. Con el puerto de hoy, la fila de `payments` es **inescribible**. La firma se ensancha (delta declarado sobre el kernel compartido, aditivo en el tipo de retorno):

```ts
crearTransaccion(orderId: string, monto: number): Promise<{ checkoutUrl: string; externalTransactionId: string }>;
```

Y la fase 6 agrega el tercer método, el único **inherentemente gateway-específico** (C8):

```ts
/** Verifica FIRMA y normaliza. Lanza FirmaInvalidaError. Vive en el ADAPTADOR:
 *  ni el controlador ni el caso de uso conocen el algoritmo ni el header. */
interpretarWebhook(raw: { headers: Readonly<Record<string, string>>; body: unknown }): ResultadoWebhook;
// ResultadoWebhook = { externalTransactionId: string; estado: PaymentStatus }
```

**Regla que se fija ahora y no en la fase 6: el cuerpo del webhook nunca es la autoridad del estado.** `interpretarWebhook` solo dice *de qué transacción habla* el mensaje; el estado que se persiste sale de **`verificarPago(externalTransactionId)`**, o sea de la API de la pasarela. El webhook es un **disparador**, no una fuente de verdad. Cuesta una llamada saliente por webhook y compra: inmunidad a un cuerpo forjado que pasara la firma, idempotencia natural (dos entregas consultan y obtienen lo mismo) y un camino de recuperación idéntico el día que exista el job del pedido huérfano.

---

## D-D · Q3 adoptada: `iniciarPago(orderId)` por HTTP (C4 / R3)

La proposal la marcó `sdd-spec` + producto y nombró `iniciarPago` como candidato. **El diseño la vuelve la única opción viable**, así que se adopta acá y `sdd-spec` la recibe fijada:

`crearPedidoDesdeOferta` corre en un listener `@OnEvent`. Si ese listener también llamara a `crearTransaccion`, la `checkoutUrl` nacería **en un camino que no tiene cliente esperando** (C4) y, peor, una llamada de red a un tercero quedaría en la ruta de un `emitAsync` que propaga rechazos **de vuelta** a `AceptarOfertaUseCase` **después de su commit** (D3): un timeout de la pasarela convertiría una aceptación exitosa en un 5xx. Persistir la URL para leerla después no arregla nada — la transacción del gateway expira, y se estaría creando una transacción de pago por cada oferta aceptada, la pague el usuario o no.

⇒ **El listener crea el pedido y NADA más.** El usuario, cuando decide pagar, llama a `POST /pedidos/:orderId/pago`. Separa limpiamente "el pedido existe" de "el usuario quiere pagar ahora", hace que el reintento sea **la misma llamada otra vez** (D-A.3) y deja la pasarela fuera del bus.

Lo que **queda abierto para producto** (mitad de Q3): si la app llama a `iniciarPago` automáticamente al aceptar o requiere un tap explícito. Es UX y no cambia una línea de este diseño.

---

## D-E · Superficie HTTP, roles y errores — insumo para **Q5**, que decide `sdd-spec`

**Dos controladores, no uno**, y ésta sí es una decisión de diseño: el webhook es `@Public()`, y `@Public()` es un decorador cuyo radio de explosión conviene mantener **físicamente separado** de toda ruta con JWT. Un `@Public()` mal ubicado a nivel de clase, o copiado de la ruta de al lado, abre una ruta autenticada. En archivos distintos, ese error no se escribe solo.

Prefijos `pedidos` y `pagos`: `pedidos-pagos` es un dominio de nombre compuesto, y el precedente es `refill-matching` → `@Controller('refill')` ("un dominio con nombre compuesto expone su familia de recursos").

| Método + ruta | Guard | Caso de uso | Éxito |
|---|---|---|---|
| `POST /pedidos/:orderId/pago` | `@Roles('user')` + dueño | `iniciarPago` | **201** `{ checkoutUrl }` |
| `GET /pedidos/:orderId/pago` | `@Roles('user')` + dueño | `obtenerEstadoPago` | **200** `EstadoPagoDto` |
| `PATCH /pedidos/:orderId/estado` | `@Roles('provider')` + empresa dueña | `actualizarEstadoPedido` | **204** sin cuerpo |
| `POST /pagos/webhook` | **`@Public()` + firma** | `procesarWebhookPago` | **200** sin cuerpo |
| — | — | `crearPedidoDesdeOferta` | **Sin ruta. Nunca** (interno, solo el listener) |

- **`orders`/`order_items` no llevan ruta de lectura**: son legibles directo por RLS (grants + políticas del batch `06`), y `docs/ARCHITECTURE.md` reserva `core-api` para lecturas con lógica.
- **`EstadoPagoDto` es angosto a propósito**: `{ estado, monto, moneda, paidAt? }`. **`raw_payload` no viaja jamás**, ni `external_transaction_id` (identificador de un tercero, sin valor para el cliente y con valor para quien quiera correlacionar). Lee **estado local**, nunca llama a la pasarela: un GET no debe depender de un tercero.
- **404, nunca 403** (D4), byte-idéntico entre "no existe" y "es de otro": una sola rama, un solo constructor de error.
- El **DTO de `actualizarEstadoPedido` no acepta `'confirmado'`, `'pendiente_pago'` ni `'expirado'`**: los tres son inalcanzables por el proveedor, y la validación de DTO es la primera barrera (400 antes que 409).

| Error de dominio | HTTP | `code` | Cuándo |
|---|---|---|---|
| `PedidoNoEncontradoError` | **404** | `PEDIDO_NO_ENCONTRADO` | No existe **o** no es tuyo/de tu empresa (D4) |
| `TransicionInvalidaError` | **409** | `TRANSICION_INVALIDA` | Transición no adyacente, hacia atrás, o desde/hacia terminal |
| `PedidoNoPagableError` | **409** | `PEDIDO_NO_PAGABLE` | `iniciarPago` sobre un pedido que no está `pendiente_pago` |
| `PagoNoEncontradoError` | **404** | `PAGO_NO_ENCONTRADO` | Webhook de una transacción desconocida. **404 a propósito**: un no-2xx hace que la pasarela **reintente**, que es la red contra la carrera "webhook antes del commit" |
| `FirmaInvalidaError` | **401** | `FIRMA_INVALIDA` | Firma que no valida. **Cero escrituras, cero eventos** |
| **`PasarelaNoConfiguradaError`** | **503** | `PASARELA_NO_CONFIGURADA` | Importado de `shared/payments/`, nunca redeclarado (C.2) |
| `PedidoInvalidoError` | 400 | `PEDIDO_INVALIDO` | Oferta sin líneas, total incoherente con la suma de líneas |

---

## D-F · Los tres flujos

### Diagrama 1 · `crearPedidoDesdeOferta`: el listener, la transacción y la idempotencia (D1 + D3 + R5 + R6)

```
 ofertas                      OfertaAceptadaListener            CrearPedidoDesdeOfertaUseCase      OrderRepository
 AceptarOfertaUseCase         pedidos-pagos/adapters/events/    ports-in (interno, sin ruta)       ports-out
    |                                  |                                  |                             |
 publish(OfertaAceptada{ ...payload, costoDespacho, lineas[] }) -- emitAsync, DESPUES del commit
    |--------------------------------->|                                  |                             |
    |                          (1) @OnEvent('ofertas.oferta_aceptada')
    |                              Suscripcion por NOMBRE DE CANAL STRING (D3). El payload se
    |                              tipa con la interfaz LOCAL de ofertas-event.payloads.ts --
    |                              jamas se importa la clase de evento de `ofertas`.
    |                              emitAsync entrega la instancia COMPLETA: el handler tipa
    |                              `{ payload: ... }` y desestructura (gotcha heredado).
    |                                  |
    |                          (2) try {                                   |
    |                                |--- execute(payload) --------------->|                             |
    |                                  |                            2a. crearPedidoPendiente(payload)
    |                                  |                                DOMINIO PURO: id, status
    |                                  |                                'pendiente_pago' EXPLICITO,
    |                                  |                                total/costoDespacho por valor,
    |                                  |                                lineas -> OrderItem[] con
    |                                  |                                cantidad = 1 (D-B.3) y
    |                                  |                                subtotal = precio_unitario.
    |                                  |                                Invariante verificada ACA:
    |                                  |                                total == SUM(subtotal) + despacho
    |                                  |                                -> PedidoInvalidoError si no.
    |                                  |                                VALIDAR ANTES DEL INSERT es
    |                                  |                                obligatorio: order_items no
    |                                  |                                admite UPDATE ni DELETE (R6).
    |                                  |                            2b. runInTransaction ===============
    |                                  |                                |--- findByOfferId(offerId, tx) ->|
    |                                  |                                |    !== null -> RETURN no-op:
    |                                  |                                |    cero escrituras, CERO eventos
    |                                  |                                |--- crear(order, items, tx) ---->|
    |                                  |                                |    1 INSERT orders + 1 INSERT
    |                                  |                                |    bulk order_items. Nunca N+1.
    |                                  |                                |    23505 sobre orders_offer_id_uidx
    |                                  |                                |    -> traducido EN EL ADAPTADOR a
    |                                  |                                |    PedidoYaExisteError, que el caso
    |                                  |                                |    de uso trata como el MISMO no-op
    |                                  |                                |    (read-and-skip cubre el camino
    |                                  |                                |    normal; el indice cubre el TOCTOU)
    |                                  |                            ---- COMMIT -----------------------
    |                                  |                                  |
    |                                  |                            2c. CERO EVENTOS. Un pedido en
    |                                  |                                'pendiente_pago' no es un hecho que
    |                                  |                                nadie deba consumir: PedidoConfirmado
    |                                  |                                se publica cuando el pago confirma
    |                                  |                                (Diagrama 3). Esa es la ventana de
    |                                  |                                consistencia de SPEC.md, ejecutable.
    |                          (3) } catch (e) { this.logger.error(...) }  <-- NUNCA re-lanza (D3/R8)
    |<-- resuelve -------------------- |
    |   emitAsync propaga los rechazos DE VUELTA: sin este catch, un fallo escribiendo el pedido
    |   convertiria una aceptacion YA COMMITEADA en un 5xx para el usuario. Negativo obligatorio de D6.
```

### Diagrama 2 · `iniciarPago`: la pasarela, fuera de toda transacción (D-D / C2-discipline)

```
 usuario           PedidosController          IniciarPagoUseCase        PaymentGatewayPort     PaymentRepository
 POST /pedidos/:orderId/pago   @Roles('user')   -- el DTO no tiene body: el monto NO se acepta del cliente (D4)
    |------------------------>|                        |                       |                    |
    |                    (1) |--- execute(actor.profileId, orderId) ---------->|                    |
    |                         |                  (2) findById(orderId)   SIN tx
    |                         |                      null || userId !== profileId -> PedidoNoEncontradoError -> 404
    |                         |                  (3) status !== 'pendiente_pago' -> PedidoNoPagableError -> 409
    |                         |                        |                       |                    |
    |                         |                  (4) |--- crearTransaccion(orderId, order.total) -->|
    |                         |                      ***FUERA DE TODA TRANSACCION DE BASE***: es una
    |                         |                      llamada de red a un tercero; mantenerla dentro
    |                         |                      agotaria el pool bajo timeout (misma regla que la
    |                         |                      C2 de `ofertas` para CatalogQueryPort).
    |                         |                      Sin credenciales -> PasarelaNoConfiguradaError -> 503 (C.2)
    |                         |                        |<-- { checkoutUrl, externalTransactionId } --|
    |                         |                  (5) |--- crear(payment 'pendiente', monto = order.total) ----->|
    |                         |                      UNA sentencia: no hay transaccion, no hay nada que
    |                         |                      hacer atomico. El monto sale de `orders`, JAMAS del cliente.
    |<-- 201 { checkoutUrl } -|
```

**Riesgo residual aceptado y declarado**: entre (4) y (5) existe una ventana donde la transacción del gateway ya está creada y la fila local todavía no. Si (5) falla, queda una transacción **huérfana del lado del proveedor**, que simplemente nunca se confirma; el usuario reintenta y obtiene una nueva. No se invierte el orden porque `external_transaction_id` es `NOT NULL` — insertar antes exigiría relajarlo a nullable y aceptar filas de pago sin transacción, que es peor: filas de dinero a medio nacer, en una tabla donde el `UNIQUE` parcial ya nos protege del duplicado que importa.

### Diagrama 3 · `procesarWebhookPago`: firma, autoridad y publicación exactamente una vez (R4)

```
 pasarela          PagosController (@Public)       ProcesarWebhookPagoUseCase        Gateway / Repos
 POST /pagos/webhook   -- SIN JWT, autenticada POR FIRMA. Primera ruta del repo que MUTA sin token.
    |------------------------>|                             |                              |
    |                    (1) |--- execute({ headers, body }) ------------------------------>|
    |                         |                       (2) interpretarWebhook(raw)   <-- ADAPTADOR: firma + normalizacion
    |                         |                           firma invalida -> FirmaInvalidaError -> 401
    |                         |                           CERO escrituras, CERO eventos, cero lecturas
    |                         |                       (3) verificarPago(externalTransactionId)  <-- LA AUTORIDAD
    |                         |                           El cuerpo del webhook NO decide el estado (C.3)
    |                         |                       (4) findByExternalTransactionId(gateway, extId)
    |                         |                           null -> PagoNoEncontradoError -> 404 A PROPOSITO:
    |                         |                           un no-2xx hace que la pasarela REINTENTE, y ese
    |                         |                           reintento ES la red contra la carrera
    |                         |                           "webhook antes de que commitee iniciarPago"
    |                         |                       (5) runInTransaction ==========================
    |                         |                           |--- marcarResultado(paymentId, estado, raw, tx)
    |                         |                           |    UPDATE ... WHERE id = $1 AND estado <> $estado
    |                         |                           |    RETURNING id   -> 0 filas = YA aplicado
    |                         |                           |--- si estado === 'pagado':
    |                         |                           |      transicionar(orderId,'pendiente_pago','confirmado',tx)
    |                         |                           |      UPDATE ... WHERE status = 'pendiente_pago' RETURNING id
    |                         |                           |      0 filas -> ya estaba confirmado -> NO publicar
    |                         |                           |    si estado === 'fallido': el pedido NO SE MUEVE.
    |                         |                           |      Sigue 'pendiente_pago' = reintentable (C3/D-A.3)
    |                         |                       ---- COMMIT --------------------------------
    |                         |                       (6) publish(...) DESPUES del commit, y SOLO si el
    |                         |                           rowcount dijo que este proceso fue el que cambio algo:
    |                         |                             pagado  -> PagoRecibido + PedidoConfirmado
    |                         |                             fallido -> PagoFallido
    |<-- 200 ----------------|
```

**La idempotencia no es un `if`, es el rowcount de dos `UPDATE` condicionales.** Es el mismo mecanismo que `desplazarHermanas` ya usa (`RETURNING` como verdad exacta) y sobrevive a dos entregas concurrentes, cosa que un `SELECT` previo seguido de un `UPDATE` no hace.

---

## D-G · Ports-out, transacciones y row types

### G.1 · `OrderRepository` (delta declarado sobre `SPEC.md`) y `PaymentRepository` (C5)

`SPEC.md` declara `save(order: Order)`. **No alcanza, y no por gusto**: `Order` en `@repon/types` **no tiene `items`** (es `{id, offerId, userId, companyId, status, total}`), así que un `save(order)` no puede escribir `order_items`. La forma final:

```ts
export interface OrderRepository {
  /** UN insert en orders + UN insert bulk en order_items. `tx` REQUERIDO
   *  (precedente D-G.5 de `ofertas`): acá la atomicidad ES la operación —
   *  un pedido sin líneas es un cobro sin detalle, y order_items no admite
   *  UPDATE ni DELETE para arreglarlo después (R6). */
  crear(order: Order, items: readonly OrderItem[], tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Order | null>;
  /** Idempotencia de R5: read-and-skip antes del insert. El índice único es la red del TOCTOU. */
  findByOfferId(offerId: string, tx?: TransactionContext): Promise<Order | null>;
  /** UPDATE ... WHERE id = $1 AND status = $desde RETURNING id. Devuelve si ESTA
   *  sentencia movió la fila: el rowcount es la idempotencia, nunca un SELECT previo. */
  transicionar(orderId: string, desde: OrderStatus, hacia: OrderStatus, tx?: TransactionContext): Promise<boolean>;
}

export interface PaymentRepository {           // C5 — delta declarado
  crear(payment: Payment, tx?: TransactionContext): Promise<void>;
  /** Clave natural de idempotencia del webhook (índice único compuesto, D-A.3). */
  findByExternalTransactionId(gateway: string, externalTransactionId: string, tx?: TransactionContext): Promise<Payment | null>;
  /** El intento más reciente por `created_at desc` — lo que lee GET /pedidos/:id/pago. */
  findUltimoPorPedido(orderId: string, tx?: TransactionContext): Promise<Payment | null>;
  /** UPDATE condicional + RETURNING; `raw_payload` se escribe ACÁ y no sale nunca de este dominio. */
  marcarResultado(paymentId: string, estado: PaymentStatus, rawPayload: unknown, tx: TransactionContext): Promise<boolean>;
}
```

### G.2 · Mapa de transacciones

| Operación | ¿`runInTransaction`? | Sentencias | Razón |
|---|---|---|---|
| **`crearPedidoDesdeOferta`** | **Sí** | 1 select + 1 insert + 1 insert bulk | Un pedido sin sus líneas es un cobro sin detalle, y las líneas **no se pueden corregir** (R6) |
| **`procesarWebhookPago`** | **Sí** | 1 update + 1 update | Pago marcado sin pedido confirmado deja dinero cobrado y un pedido que nadie prepara. **Las 2 llamadas al gateway quedan FUERA** |
| **`iniciarPago`** | **No** | 1 select + 1 insert | Una sola escritura. La llamada a la pasarela es de red y **jamás** entra a una transacción |
| **`actualizarEstadoPedido`** | **No — estructuralmente** | 1 select + 1 update condicional | Una sola escritura, y su atomicidad la da el `WHERE status = $desde`. **No inyecta `TRANSACTION_MANAGER`, y esa ausencia es el test** (precedente D13 de `ofertas`) |
| **`obtenerEstadoPago`** | **No — estructuralmente** | 1 select | Cero escrituras. Ídem |

### G.3 · Row types (`shared/database/schema.ts`) y el gotcha nuevo

Cierra el "The remaining 1 table (`pedidos-pagos`)" de la cabecera del archivo. Los 3 row types + los 2 enums + `DB`, más `nombre: string` en `OfferItemsTable` (D-B.4).

```ts
export type OrderStatusRow = 'expirado' | 'pendiente_pago' | 'confirmado' | 'preparando' | 'en_camino' | 'entregado';
export type PaymentStatusRow = 'pendiente' | 'pagado' | 'fallido' | 'reembolsado';

export interface OrdersTable {
  id: Generated<string>; offer_id: string; user_id: string; company_id: string;
  status: OrderStatusRow;          // SIN Generated: el batch 17b DROPEA el default (D-A.4).
                                   // Olvidar la columna es un error de COMPILACION.
  total: string; costo_despacho: Generated<string>;   // numeric(12,2) -> STRING; despacho tiene default 0
  created_at: Generated<string>; updated_at: Generated<string>;
}

export interface OrderItemsTable {
  id: Generated<string>; order_id: string; offer_item_id: string;
  nombre: string; cantidad: string;                    // numeric -> STRING (siempre '1', D-B.3)
  precio_unitario: string; subtotal: string;           // numeric(12,2) -> STRING
  is_alt: Generated<boolean>;
  alt_size: string | null; alt_qty: string | null; alt_note: string | null;
  created_at: Generated<string>;                       // sin updated_at: inmutable por grants
}

export interface PaymentsTable {
  id: Generated<string>; order_id: string; gateway: string; external_transaction_id: string;
  monto: string; moneda: Generated<string>;
  estado: Generated<PaymentStatusRow>;                 // conserva su default 'pendiente'; se escribe explícito igual
  raw_payload: ColumnType<unknown, string, string>;    // ver gotcha abajo
  paid_at: string | null;
  created_at: Generated<string>; updated_at: Generated<string>;
}
```

> **El gotcha de `numeric` sigue vigente, y `Number(null) === 0` SÍ aplica acá.** `alt_size`/`alt_qty` son nullable en `order_items` igual que en `offer_items`: `altSize: row.alt_size === null ? undefined : Number(row.alt_size)`, **jamás** `Number(row.alt_size)` a secas. `paid_at` es nullable y es un timestamp: `paidAt: row.paid_at ?? undefined`, nunca `new Date(null)` (que da la época). `total`/`monto`/`precio_unitario`/`subtotal`/`cantidad` son `NOT NULL` y `Number(...)` directo es seguro.
>
> **Gotcha NUEVO — `jsonb`, primera vez en el repo.** `raw_payload` **se lee** como objeto ya parseado por el driver y **se escribe** como `string`: `JSON.stringify(raw)`. Pasarle el objeto crudo a Kysely produce un error del driver o, peor, un `"[object Object]"` guardado como texto. Por eso el tipo es `ColumnType<unknown, string, string>` (lectura, insert, update) y no un `Generated<>`: la asimetría es real y el tipo la hace visible. **`raw_payload` nunca sale de `adapters/persistence/`** — no está en `Payment` de `@repon/types` y no debe estarlo.

### G.4 · Estructura de archivos

```
domains/pedidos-pagos/
├── domain/
│   ├── order.entity.ts       (crearPedidoPendiente, maquina de OrderStatus (D-A.2),
│   │                          CANTIDAD_LINEA = 1, subtotal/total puros, invariante del total)
│   └── pedido.errors.ts      (las 6 clases propias de la tabla de D-E)
├── ports-in/
│   ├── crear-pedido-desde-oferta.use-case.ts   ── TX, interno (sin ruta)
│   ├── iniciar-pago.use-case.ts                ── SIN TX (D-G.2)
│   ├── procesar-webhook-pago.use-case.ts       ── TX
│   ├── actualizar-estado-pedido.use-case.ts    ── **SIN TRANSACTION_MANAGER** (garantia estructural)
│   └── obtener-estado-pago.use-case.ts         ── **SIN TRANSACTION_MANAGER**
├── ports-out/
│   ├── order-repository.port.ts    (de 2 firmas a 4 — D-G.1)
│   └── payment-repository.port.ts  (NUEVO — C5)
├── events/  pedido-confirmado · pago-recibido · pago-fallido (.event.ts + .payload.ts)
├── adapters/
│   ├── http/          pedidos.controller.ts · pagos.controller.ts (@Public, aislado — D-E)
│   │                  pedidos-pagos.mapper.ts · pedidos-pagos-exception.filter.ts · dto/*.dto.ts
│   ├── persistence/   kysely-order.repository.ts (traduce 23505) · kysely-payment.repository.ts
│   └── events/        ofertas-event.payloads.ts · oferta-aceptada.listener.ts   (D3)
└── pedidos-pagos.module.ts    <- deja de ser @Module({}): ULTIMO modulo vacio del repo

shared/payments/   (+3 archivos — Q4/D-C)
├── payments.module.ts · payments.errors.ts · pasarela-no-configurada.adapter.ts
└── (fase 6) el adaptador concreto del gateway elegido

SIN `contracts/`            — nadie hace lecturas sincronas sobre este dominio, y no queda dominio despues.
SIN `adapters/scheduling/`  — 'expirado' sigue sin disparador (Q7).
```

---

## Threat matrix (aplicabilidad)

| Boundary | Aplicabilidad | Respuesta de diseño |
|---|---|---|
| Documentation-like paths | **N/A** — cero clasificación de archivos, cero ejecución de contenido | — |
| Git repository selection / Commit state / Push state / PR commands | **N/A** — este cambio no automatiza VCS ni PRs; no ejecuta shell ni subprocesos | — |
| **Process integration (webhook de un tercero)** | **Aplicable** — es la única frontera de proceso del cambio, y la primera del repo | Ver tabla siguiente |

| Caso adversario | Comportamiento seguro esperado | Test RED planificado |
|---|---|---|
| Firma inválida / ausente | **401**, cero escrituras, cero eventos, ni siquiera un `SELECT` | `procesarWebhookPago` con firma mala ⇒ ninguna llamada a repos ni al publisher |
| **Entrega duplicada** (el modo de falla nativo) | Segundo webhook: mismo estado final, evento publicado **una sola vez** | Dos ejecuciones seguidas ⇒ `publish` llamado exactamente 1 vez |
| Webhook de una transacción desconocida (llega antes del commit de `iniciarPago`) | **404** — no-2xx a propósito, para que la pasarela reintente | Repo devuelve `null` ⇒ 404, cero escrituras |
| Cuerpo forjado que **sí** pasa la firma y declara `'pagado'` | El estado lo decide `verificarPago`, no el cuerpo | Cuerpo dice `pagado`, `verificarPago` dice `fallido` ⇒ se persiste `fallido` |
| `externalTransactionId` de **otro pedido** | La fila de `payments` gobierna el `orderId`; el cuerpo no puede reasignarlo | Nunca se transiciona un pedido distinto al de la fila encontrada |
| Timeout / caída de la pasarela | `iniciarPago` ⇒ 503 sin fila de `payments`; webhook ⇒ no-2xx sin escrituras | Puerto que lanza ⇒ cero escrituras |
| Pasarela **no configurada** (fases 4-5 y cualquier entorno sin credenciales) | 503 explícito nombrando la variable faltante; el proceso **bootea igual** | `PasarelaNoConfiguradaError` ⇒ 503 mapeado por el filtro |

---

## Secuencia de implementación (7 fases → PRs encadenados)

Cada PR deja `main` verde y arranca **por sus tests** (D6). El módulo crece incrementalmente.

| PR | Fase | Contenido | Por qué acá |
|---|---|---|---|
| **1** | 0 · groundwork | Migraciones `17a` + `17b`; 3 row types + 2 enums + `DB` + `nombre` en `OfferItemsTable`; tipos de `@repon/types`; `OrderRepository` final + `PaymentRepository`; `pedido.errors.ts`; reconciliación de prosa de C6 | Costuras puras. Una migración mal puesta con el dominio encima ya no es gratis |
| **2** | 1 · dominio | `crearPedidoPendiente`, máquina de `OrderStatus` (D-A.2), `CANTIDAD_LINEA`, invariante del total | Jest puro, sin contenedor Nest |
| **3** | 2 · persistencia | `KyselyOrderRepository` (traducción del `23505`) + `KyselyPaymentRepository`; mappers `numeric` **y `jsonb`** | Donde vive el gotcha nuevo |
| **4** | 3 · delta `ofertas` | `OfferItem` gana `id`/`nombre`; factories, mapper, casos de uso y tests de `ofertas`; `OfertaAceptadaPayload` gana `lineas`/`costoDespacho` | **Único PR que toca `ofertas`** — se aísla para que ese diff se lea solo (R8) |
| **5** | 4 · creación | `PaymentsModule` + `PasarelaNoConfiguradaAdapter` + `SharedKernelModule`; `CrearPedidoDesdeOfertaUseCase` + listener + payload local; e2e de contrato con `await moduleRef.init()` | El adaptador null va acá porque es lo que permite que Nest arranque de acá en adelante (R7) |
| **6** | 5 · ciclo de vida | `iniciarPago`, `obtenerEstadoPago`, `actualizarEstadoPedido`, los 2 controladores, filtro, DTOs, 404 cross-tenant | Cierra la mitad del flujo que el usuario ve |
| **7** | 6 · pasarela | **Q8**: elección + SDK + credenciales; `interpretarWebhook`; ruta `@Public()`; `procesarWebhookPago`; los 3 eventos; env vars; primer binding real | Última por D2. `sdd-tasks` puede partirla en 7a (adaptador + env) y 7b (webhook + firma + eventos) |

**Presupuesto de review (R10)**: los PRs 1, 5 y 7 son los pesados. La decisión de encadenamiento la toma `sdd-tasks` bajo `delivery_strategy`, no este documento.

---

## Estrategia de testing (D6: todo esto se escribe primero)

| Capa | Qué se prueba | ¿CI? |
|---|---|---|
| Unit | Un segundo `OfertaAceptada` con el mismo `offerId` ⇒ **cero escrituras, cero eventos** (R5) | Sí |
| Unit | El listener **captura y loguea, nunca re-lanza** — el handler resuelve aunque el caso de uso lance (D3/R8) | Sí |
| Unit | Máquina de estados: `pendiente_pago → preparando` ⇒ 409; `en_camino → preparando` ⇒ 409; `entregado → *` ⇒ 409; salto `confirmado → en_camino` ⇒ 409 | Sí |
| Unit | El proveedor **no puede** escribir `'confirmado'`: rechazado por el DTO (400) antes de llegar al caso de uso | Sí |
| Unit | Usuario A sobre pedido de B ⇒ `PedidoNoEncontradoError`; pedido inexistente ⇒ **el mismo error, byte a byte** (D4). Ídem empresa C sobre pedido ajeno | Sí |
| Unit | `total ≠ Σ(subtotal) + costoDespacho` ⇒ `PedidoInvalidoError` **antes** de cualquier insert (R6) | Sí |
| Unit | `cantidad === 1` y `precio_unitario === subtotal === linea.precio` en cada línea del snapshot (D-B.3) | Sí |
| Unit | Los 7 casos de la tabla adversaria del webhook (firma, duplicado, desconocido, cuerpo forjado, cross-pedido, timeout, no configurada) | Sí |
| Unit | `PagoFallido` **no mueve** el pedido: sigue `pendiente_pago` y un `iniciarPago` posterior es legal (C3) | Sí |
| Unit | `actualizarEstadoPedido`/`obtenerEstadoPago` **no inyectan `TRANSACTION_MANAGER`** (inspección del constructor) | Sí |
| Unit | `crearTransaccion` resuelve **antes** de que `runInTransaction`/el insert se invoquen (log de resolución, patrón D-C de `ofertas`) | Sí |
| Adaptador | `23505` sobre `orders_offer_id_uidx` ⇒ `PedidoYaExisteError`; sobre `payments_order_id_pagado_uidx` ⇒ error de dominio; cualquier otro se re-lanza | Sí |
| Adaptador | `alt_size`/`alt_qty`/`paid_at` `NULL` sobreviven como `undefined`, **jamás como `0`** ni como la época | Sí |
| Adaptador | `raw_payload` se escribe con `JSON.stringify` y **nunca** aparece en ningún DTO de respuesta | Sí |
| E2E | 401 sin token; 403 sin rol; **404 cross-tenant** en las 3 rutas con JWT; 409 de transición; **la ruta del webhook no exige JWT pero rechaza firma inválida**; 503 con la pasarela sin configurar | Sí |
| E2E contrato | Un `OfertaAceptada` **real** por el bus real ⇒ exactamente **una** fila de `orders` + sus `order_items`, con `await moduleRef.init()` — sin `init()` el `@OnEvent` no se registra y el test pasa sin probar nada | Sí |
| Integración (opt-in) | Contra Postgres real: el índice único parcial admite N pagos `fallido` y **rechaza el segundo `pagado`**; `UPDATE`/`DELETE` sobre `order_items` fallan con permission denied | No |
| Regresión | Suites completas de los 5 dominios previos. **`ofertas` importa especialmente**: la fase 3 lo toca | Sí |

---

## Riesgos residuales y preguntas abiertas

Los 11 riesgos de la proposal siguen vigentes. Lo que este documento agrega, precisa o **deja explícitamente sin cerrar**:

- [x] ~~**Q1** — máquina de estados y DDL~~ **Resuelta** (D-A): `pendiente_pago` + `expirado` en `17a`; `drop default` en `status`; `orders.offer_id` único.
- [x] ~~**Q2** — `nombre` y `cantidad`~~ **Resuelta** (D-B): `offer_items.nombre` poblada al componer; `cantidad = 1` constante; y el hueco extra de `offer_items.id`.
- [x] ~~**Q4** — dónde vive el adaptador~~ **Resuelta** (D-C): `shared/payments/payments.module.ts` en `SharedKernelModule`; `PasarelaNoConfiguradaAdapter` como rama permanente.
- [x] ~~**Q3** — cómo llega la `checkoutUrl`~~ **Adoptada** (D-D): `iniciarPago(orderId)` por HTTP. Queda la mitad de UX para producto: si la app lo llama automáticamente al aceptar o requiere un tap.
- [ ] **Q5 — superficie HTTP y roles: la decide `sdd-spec`.** D-E entrega 4 rutas, roles, códigos y la tabla de errores como insumo tabulado; lo que `sdd-spec` debe confirmar como regla escrita es la monotonía estricta y el hecho de que `orders`/`order_items` no lleven ruta propia.
- [ ] **Q6 — `audit_log` para transiciones y resultados de pago: ABIERTA, necesita producto.** Este documento **no** la resuelve. Evidencia que aporta para decidirla: `raw_payload` ya guarda el lado del gateway; `payments` con una fila **por intento** (D-A.3) ya conserva el rastro completo de intentos, incluidos los fallidos; y las transiciones de `orders` **no** dejan historia (solo `updated_at`). Si la respuesta es "sí", el candidato natural son las transiciones de proveedor, no los pagos.
- [ ] **Q7 — qué le pasa al pedido huérfano: mitad cerrada, mitad ABIERTA.** El **estado** `expirado` entra (D-A.1, precedente `'expirada'`). Siguen abiertas y son de producto: **cuánto tiempo** vive un `pendiente_pago` antes de expirar, si el usuario recibe aviso, y si expirar debe **reabrir** `offer_opportunities.cerrada_at` — que es, textualmente, la conversación que el `design.md` de `ofertas` anticipó que este cambio abriría. **No se abre acá.**
- [ ] **Q8 — elección de pasarela y forma de la firma: DIFERIDA a la fase 6 por D2.** Este documento solo fija que debe existir una rama "sin configurar" válida (D-C.2) y que la firma vive en el adaptador (D-C.3).
- [ ] **Q9 — reintento sin duplicar: mitad de esquema cerrada, mitad de producto ABIERTA.** El esquema se decide acá porque es inseparable del batch `17` (D-A.3: fila por intento + único parcial). Siguen abiertas y son de producto: **cuántos reintentos** se permiten, si un intento fallido es **visible** para el usuario, y si `GET /pedidos/:id/pago` muestra el último intento o un agregado. `EstadoPagoDto` hoy devuelve el último (D-E).
- [ ] **`crearTransaccion` cambia de forma en el kernel compartido** (D-C.3). Aditivo en el tipo de retorno, y hoy el puerto no tiene ningún implementador — pero es un contrato compartido y merece nombrarse, no descubrirse.
- [ ] **Ventana huérfana en el proveedor**: entre `crearTransaccion` y el insert de `payments` puede quedar una transacción creada en el sandbox del gateway sin correlato local (Diagrama 2). Aceptada; la alternativa exige `external_transaction_id` nullable.
- [ ] **`offer_items.nombre` se agrega con default `''` temporal**: cualquier fila preexistente en una base de desarrollo queda con nombre vacío. Aceptado (no hay datos productivos); un pedido creado desde una oferta vieja de dev tendría `nombre = ''`.
- [ ] **`cantidad` siempre `1` es una decisión de hoy, no una verdad eterna** (D-B.3). El día que el proveedor cotice cantidades, la columna existe y el cambio es de DTO — pero los pedidos históricos quedan con `1` y **no se pueden corregir** (R6).
- [ ] **El push al proveedor sigue sin existir** (C1): `PedidoConfirmado` se publica, nadie lo escucha. El paso 6 de `docs/ARCHITECTURE.md` queda a medias, declarado.
- [ ] **`verificarPago` en cada webhook agrega una llamada de red por entrega** (D-C.3). Se acepta a cambio de que el cuerpo del mensaje nunca sea autoridad sobre dinero. Si la pasarela elegida cobra o limita ese endpoint, la fase 6 lo revisa.

---

## Insumos para `sdd-spec` (este documento corrió primero, a propósito)

Lo que `sdd-spec` debe recoger **como fijado**, sin lenguaje provisional:

| # | Fijado acá | Spec afectado |
|---|---|---|
| 1 | `order_status` = `expirado < pendiente_pago < confirmado < preparando < en_camino < entregado`; `pendiente_pago` único inicial; `confirmado` inalcanzable por el proveedor | `db-schema-pedidos-pagos`, `core-api-pedidos-pagos` |
| 2 | `orders.status` **sin default**; `orders.costo_despacho` nueva; `orders.offer_id` único | `db-schema-pedidos-pagos` |
| 3 | `payments.order_id` **sin `UNIQUE`** + único parcial `where estado = 'pagado'` + único `(gateway, external_transaction_id)` | `db-schema-pedidos-pagos` |
| 4 | `offer_items.nombre` nueva, poblada al componer; **nunca** enviada por el cliente | `db-schema-ofertas`, `core-api-ofertas` |
| 5 | `order_items.cantidad = 1` siempre; `precio_unitario = subtotal = offer_items.precio` | `db-schema-pedidos-pagos`, `core-api-pedidos-pagos` |
| 6 | `OfferItem` gana `id` y `nombre`; `NuevoOfferItem` **no cambia** | `shared-types-package`, `core-api-ofertas` |
| 7 | `OfertaAceptadaPayload` gana `lineas[]` y `costoDespacho` | `core-api-ofertas` |
| 8 | `PaymentGatewayPort.crearTransaccion` devuelve `{ checkoutUrl, externalTransactionId }`; `interpretarWebhook` llega en la fase 6; **el cuerpo del webhook no es autoridad** | `shared-payments` |
| 9 | `iniciarPago(orderId)` es port-in por HTTP; el listener **no** llama a la pasarela | `core-api-pedidos-pagos` |
| 10 | Adaptador en `shared/payments/`, `PaymentsModule` en `SharedKernelModule`; `PasarelaNoConfiguradaError` → 503 | `core-api-hexagonal-layout`, `shared-payments` |
| 11 | 4 rutas, **2 controladores** (el `@Public()` aislado); `EstadoPagoDto` sin `raw_payload` ni `external_transaction_id` | `core-api-pedidos-pagos`, `core-api-hexagonal-layout` |
| 12 | Crear el pedido **no publica ningún evento**; los 3 eventos salen del camino de confirmación, después del commit y exactamente una vez | `core-api-pedidos-pagos` |
