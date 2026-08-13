-- Batch 16 -- ofertas: la proyeccion de descubrimiento (D1/D4/D5,
-- design.md D-A). Delta declarado sobre db-schema-ofertas.
-- NO edita 20260803120500_05_ofertas.sql: fix-forward.
--
-- Las 3 tablas son estado INTERNO de `ofertas` (D4), mismo encuadre literal
-- que catalog_hidden_companies (batch 12): RLS habilitada, CERO politicas,
-- cero grants a anon/authenticated. Ningun cliente las lee jamas --
-- listarSolicitudesElegibles es el unico camino de acceso, por HTTP, porque
-- la elegibilidad es logica de negocio (docs/ARCHITECTURE.md reserva el
-- acceso directo a Postgres para "lecturas simples sin logica asociada").
-- Divergencia deliberada respecto de offers/offer_items, que SI tienen
-- politicas y grant a authenticated: esos los exige Realtime.
--
-- SIN FK a refill_requests / refill_items / companies / profiles (D4): la
-- fuente de verdad de estas filas es el payload de un evento de otro
-- bounded context, no una relacion que este dominio posea. Una FK habria
-- que dropearla el dia que ofertas se extraiga. El modo de falla esta
-- acotado: offers.refill_request_id SI tiene FK real, y es el cerrojo final.
--
-- urgencia es `text` y NO public.refill_urgencia (design.md D-A.1): reusar
-- el enum de otro dominio es el equivalente a nivel de TIPO de la FK que el
-- parrafo anterior rechaza. Sin CHECK enumerando los valores, por lo mismo.
--
-- `vigente boolean` y no DELETE fisico (D5/design.md D-A.2): este esquema no
-- otorga DELETE en ningun lado (batch 10, literal). El reemplazo por
-- solicitud es UPDATE-en-bloque + upsert, en una sola transaccion.

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.offer_opportunities (
  refill_request_id uuid primary key,
  user_id           uuid        not null,
  comuna            text        not null,
  urgencia          text        not null,
  matched_at        timestamptz not null default now(),
  cerrada_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.offer_opportunities is
  'Cabecera de la proyeccion de descubrimiento propiedad de ofertas (D1). La mantiene un listener @OnEvent sobre MatchEncontrado. PK = refill_request_id SIN FK a proposito. user_id es de donde enviarOferta saca offers.user_id, sin joinear jamas contra refill_requests (D7 de refill-matching: no existe camino sincrono).';
comment on column public.offer_opportunities.cerrada_at is
  'La setea aceptarOferta (D12) y NADIE la vuelve a NULL: cerrar es monotono (design.md D-A.3). Un MatchEncontrado posterior refresca la cabecera pero NO reabre la oportunidad -- reabrirla devolveria la solicitud a la lista de todos los proveedores despues de que el usuario ya acepto.';
comment on column public.offer_opportunities.urgencia is
  'text, no public.refill_urgencia (design.md D-A.1). Vocabulario de refill-matching que viaja por evento; se valida al entrar (el payload local del listener lo tipa como Urgencia de @repon/types), nunca en Postgres.';

create table public.offer_opportunity_companies (
  refill_request_id uuid        not null,
  company_id        uuid        not null,
  vigente           boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (refill_request_id, company_id)
);

comment on table public.offer_opportunity_companies is
  'El HECHO de elegibilidad: una fila por empresa actualmente elegible sobre una solicitud (D1). vigente = false es la baja logica del reemplazo de D5 -- el repo no otorga DELETE en ningun lado. Toda lectura filtra vigente = true.';

create table public.offer_opportunity_items (
  refill_item_id     uuid primary key,
  refill_request_id  uuid          not null,
  nombre             text          not null,
  categoria          text          not null,
  precio_referencia  numeric(12,2) not null,
  catalog_product_id uuid,
  vigente            boolean       not null default true,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now()
);

comment on table public.offer_opportunity_items is
  'Los items de la solicitud, RE-DECLARADOS en el vocabulario de refill-matching -- nunca un snapshot de un tipo de catalogo (D8). Contra esta tabla se valida que cada refillItemId de una oferta reactiva pertenezca a esa solicitud, y de aca sale el RefillItem[] con el que enviarOferta llama a buscarCoincidencias. SIN columna de provider_catalog: una proyeccion que guarda ids de catalogo es un evento congelado con otra forma (D8).';
comment on column public.offer_opportunity_items.categoria is
  'NOT NULL, a diferencia de refill_items.categoria (nullable desde el batch 15): MatchEncontrado SOLO se publica sobre una solicitud activa, y RefillRequestActiva garantiza categoria/precio_referencia. La completitud la garantiza el contrato del evento, no un CHECK.';

-- ============================================================
-- 4. Indexes
-- ============================================================
-- listarSolicitudesElegibles busca por company_id, que NO es prefijo de la
-- PK (refill_request_id, company_id). Parcial sobre vigente: el indice tiene
-- exactamente la forma del unico predicado que este dominio ejecuta.
create index offer_opportunity_companies_company_id_idx
  on public.offer_opportunity_companies (company_id)
  where vigente;

-- El retire-en-bloque de D5 y la lectura de items filtran por
-- refill_request_id, que no es la PK de esta tabla.
create index offer_opportunity_items_refill_request_id_idx
  on public.offer_opportunity_items (refill_request_id);

-- D10: "existe alguna oportunidad de este usuario donde esta empresa figure".
create index offer_opportunities_user_id_idx
  on public.offer_opportunities (user_id);

-- ============================================================
-- 5. Triggers updated_at (funcion publica del lote 00)
-- ============================================================
create trigger offer_opportunities_set_updated_at
  before update on public.offer_opportunities
  for each row execute function public.set_updated_at();
create trigger offer_opportunity_companies_set_updated_at
  before update on public.offer_opportunity_companies
  for each row execute function public.set_updated_at();
create trigger offer_opportunity_items_set_updated_at
  before update on public.offer_opportunity_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.offer_opportunities         enable row level security;
alter table public.offer_opportunity_companies enable row level security;
alter table public.offer_opportunity_items     enable row level security;

revoke all on public.offer_opportunities         from anon, authenticated;
revoke all on public.offer_opportunity_companies from anon, authenticated;
revoke all on public.offer_opportunity_items     from anon, authenticated;

grant select, insert, update on public.offer_opportunities         to service_role;
grant select, insert, update on public.offer_opportunity_companies to service_role;
grant select, insert, update on public.offer_opportunity_items     to service_role;
-- Sin DELETE (convencion uniforme del esquema): la baja es vigente = false.

-- ============================================================
-- 7. RLS: ninguna politica, a proposito (ver cabecera).
-- ============================================================
