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
