-- Batch 15 -- refill-matching: completitud diferida (D4) + clave de
-- correlacion del borrador automatico (design.md D-D).
-- Delta declarado sobre db-schema-refill-matching. Depende del batch 14 YA
-- COMMITEADO: el indice de la seccion 4 usa el valor 'borrador'.
-- Secciones 2 y 4 del layout estandar: cero tablas nuevas, cero enums, cero RLS.

-- ============================================================
-- 2. Tables (relajacion de NOT NULL + columna de correlacion)
-- ============================================================
alter table public.refill_requests
  alter column direccion drop not null,
  alter column comuna    drop not null,
  add  column consumption_id uuid;

alter table public.refill_items
  alter column categoria         drop not null,
  alter column precio_referencia drop not null;

comment on column public.refill_requests.direccion is
  'Nullable desde el batch 15 (backend-core-api-refill-matching D3/D4). NULL solo es legal mientras estado = ''borrador'': el sistema no tiene de donde leer una direccion cuando consumo dispara RefillAutoSolicitado (profiles no tiene ninguna columna de direccion en ninguna migracion). La completitud se enforcea en la transicion ''borrador'' -> ''abierta'', en el caso de uso, NO en Postgres -- un CHECK no es expresable porque la completitud de los items es cross-tabla. Mismo encuadre literal que ofertas/SPEC.md ya usa para offers.user_id ("Regla enforceada aqui, no en Postgres").';
comment on column public.refill_requests.comuna is
  'Nullable desde el batch 15 (D3/D4), misma regla que direccion. CORRECCION DECLARADA (D9) del comentario original: el matching NO corre en una Edge Function -- corre en core-api via buscarProveedoresCompatibles + CatalogQueryPort. Y en este cambio NO se filtra por comuna (D1): la columna se persiste desde el dia 1 para que el filtro futuro sea aditivo, pero el matching es nacional.';
comment on column public.refill_requests.consumption_id is
  'Clave de correlacion hacia consumo.user_consumption.id, recibida en el payload de RefillAutoSolicitado (design.md D-D). NULL para toda solicitud creada manualmente. SIN FOREIGN KEY a proposito: es una clave que llega por el bus de eventos, no una relacion que este dominio posea o pueda validar; una FK haria fallar la escritura de refill-matching por el estado de una tabla ajena y se rompe el dia que consumo se extraiga a su propio servicio. Deliberadamente distinto de refill_items.catalog_product_id, que SI es FK porque el usuario elige ese producto y catalogo se consulta sincronicamente por contrato.';
comment on column public.refill_items.categoria is
  'Nullable desde el batch 15 (D3/D4). NULL solo es legal en un item de una solicitud en ''borrador'': UserConsumption no tiene categoria (tiene kind, un enum de otro vocabulario) y consumo se niega explicitamente a mapear kind -> categoria porque no tiene autoridad sobre el vocabulario del catalogo. Se rechazo el centinela categoria = '''': produce una solicitud que parece valida, entra al matching y no matchea nada -- falla silenciosa.';
comment on column public.refill_items.precio_referencia is
  'Nullable desde el batch 15 (D3/D4). Se rechazo el centinela precio_referencia = 0 por el mismo motivo que categoria = ''''. OJO en el mapper: node-postgres devuelve numeric como string, y Number(null) === 0 -- una conversion ingenua reintroduce exactamente el centinela que esta decision rechaza (design.md, callout de row types).';

-- ============================================================
-- 4. Indexes
-- ============================================================
-- Invariante de D-D.2 expresada en Postgres, no solo en el caso de uso: como
-- maximo UN borrador abierto por (usuario, consumo). El caso de uso igual hace
-- el read-and-skip para que el camino normal sea un no-op limpio; este indice
-- es la red que cubre el TOCTOU de dos eventos concurrentes. Mismo patron de
-- indice parcial unico que provider_catalog_company_catalog_product_uidx
-- (batch 11). Usa 'borrador': por eso este archivo NO puede fusionarse con el
-- batch 14 (ver su cabecera).
create unique index refill_requests_borrador_por_consumo_uidx
  on public.refill_requests (user_id, consumption_id)
  where estado = 'borrador' and consumption_id is not null;
