-- Batch 04 — refill-matching: refill_requests, refill_items.
--
-- User-built refill requests and their line items. Matching against
-- provider catalogs happens in core-api (service-role, per
-- CatalogQueryPort/buscarProveedoresCompatibles) — never via RLS
-- (db-schema-refill-matching Purpose, D1). Both tables ship together
-- because refill_items.refill_request_id FKs to refill_requests, so per
-- design.md D-3 ("una tabla nunca existe en un commit sin su RLS") they
-- land in the same file.

-- ============================================================
-- 1. Enums
-- ============================================================
create type public.refill_urgencia as enum ('lo_antes_posible', 'hoy', 'manana', 'en_2_3_dias');
create type public.refill_estado as enum ('abierta', 'ofertada', 'confirmada');

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.refill_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  direccion text not null,
  comuna text not null,
  urgencia public.refill_urgencia not null,
  estado public.refill_estado not null default 'abierta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.refill_requests is
  'Solicitud de reposición armada por el usuario. user_id (physical-only) es el dueño. Matching de proveedores compatibles vive en core-api, nunca en RLS (db-schema-refill-matching Purpose).';
comment on column public.refill_requests.comuna is
  'Clave de join estructurada para matching de zona de despacho (Q2, db-schema-refill-matching), separada de la direccion en texto libre. Requerida en crearSolicitud -- ni la Edge Function de matching ni RLS pueden operar sobre direccion sin estructurar. Mismo patrón de columna que company_dispatch_zones.comuna (lote 01a): texto plano, sin FK a una tabla de comunas de referencia (no existe una en el modelo).';

create table public.refill_items (
  id uuid primary key default gen_random_uuid(),
  refill_request_id uuid not null references public.refill_requests (id),
  catalog_product_id uuid references public.catalog_products (id),
  nombre text not null,
  categoria text not null,
  precio_referencia numeric(12,2) not null,
  created_at timestamptz not null default now()
);

comment on table public.refill_items is
  'Ítems de una refill_request. Sin columna de dueño propia por diseño (Q8, db-access-control Owner-less Child Table Read Policy) -- la política SELECT usa EXISTS contra refill_requests.user_id (sección 7). Sin updated_at: inmutable una vez creada, igual que consumption_logs/order_items.';
comment on column public.refill_items.catalog_product_id is
  'NULL por diseño (Q4, misma filosofía nullable-FK que provider_catalog.catalog_product_id, lote 03): el usuario puede pedir un producto que no está en el catálogo de referencia, usando nombre/categoria para el matching.';

-- ============================================================
-- 3. Constraints / FK diferidas
-- ============================================================
-- No aplica: refill_requests -> refill_items es una cadena estrictamente
-- forward, sin ciclos en este lote. Ambas FK van inline en el CREATE TABLE
-- de la sección 2.

-- ============================================================
-- 4. Indexes
-- ============================================================
create index refill_requests_user_id_idx on public.refill_requests (user_id);
create index refill_items_refill_request_id_idx on public.refill_items (refill_request_id);
-- Mismo criterio que pets_user_id_idx/user_consumption_user_id_idx (lote 02)
-- y provider_catalog_company_id_idx (lote 03): índice sobre la columna que
-- respalda tanto la política RLS owner-only/EXISTS como las consultas del
-- caso de uso (listarMisSolicitudes). Índice de comuna para el matching por
-- zona queda fuera de este lote -- ese cómputo vive en la Edge Function
-- match-refill-request, explícitamente fuera de alcance de este cambio
-- (proposal.md "Out of Scope").

-- ============================================================
-- 5. Trigger updated_at
-- ============================================================
create trigger refill_requests_set_updated_at
  before update on public.refill_requests
  for each row execute function public.set_updated_at();

-- refill_items no tiene updated_at (inmutable una vez creada, ver comment on
-- table arriba).

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.refill_requests enable row level security;
alter table public.refill_items enable row level security;

revoke all on public.refill_requests from anon, authenticated;
revoke all on public.refill_items from anon, authenticated;

grant select on public.refill_requests to authenticated;
grant select on public.refill_items to authenticated;
-- Sin grant a anon en ninguna de las dos: una refill_request es información
-- privada del usuario, no hay vista pública. Sin insert/update/delete de
-- cliente: crearSolicitud y el resto de mutaciones van por core-api con
-- service-role, mismo patrón que todos los lotes anteriores.

-- ============================================================
-- 7. RLS: políticas
-- ============================================================
-- refill_requests: solo lectura de las filas propias. El matching hacia
-- proveedores compatibles NO es una política RLS -- es RLS-inexpresable sin
-- un predicado auto-derrotante (cross-tenant read), por eso vive en
-- core-api/buscarProveedoresCompatibles con service-role (D1,
-- db-schema-refill-matching Requirement "refill_requests SELECT is
-- owner-only -- provider matching is not an RLS concern").
create policy "refill_requests_authenticated_select_own"
  on public.refill_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- refill_items: sin columna de dueño propia -- EXISTS contra el
-- refill_requests padre (db-access-control Owner-less Child Table Read
-- Policy, db-schema-refill-matching Requirement "refill_items SELECT via
-- EXISTS on parent (Q8 pattern)").
create policy "refill_items_authenticated_select_own"
  on public.refill_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.refill_requests r
      where r.id = refill_items.refill_request_id
        and r.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 8. Realtime / publication
-- ============================================================
-- No aplica a este lote (solo offers, batch 05, design.md D-4).
