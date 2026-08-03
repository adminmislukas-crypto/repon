-- Batch 03 — catalogo: catalog_products, provider_catalog.
--
-- catalog_products is the shared reference catalog (populated by
-- service-role/admin flows, out of this change's scope -- the client only
-- reads it). provider_catalog is each provider's own priced listing;
-- catalog_product_id stays nullable by design (Q4, db-schema-catalogo
-- Scenario "Provider loads a product not in the reference catalog"):
-- backfilling free text to an id later is lossy, while adding the FK column
-- later is cheap. Both ship in the same file -- provider_catalog FKs to
-- catalog_products, so per design.md D-3 ("una tabla nunca existe en un
-- commit sin su RLS") they land together.

-- ============================================================
-- 1. Enums
-- ============================================================
create type public.catalog_product_status as enum ('activo', 'inactivo');

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null,
  marca text,
  presentacion text,
  imagen_url text,
  status public.catalog_product_status not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.catalog_products is
  'Catálogo de referencia compartido. Solo lectura para el cliente (Q6, db-schema-catalogo) -- authenticated-only, sin política/grant anon. El proveedor lo referencia opcionalmente vía provider_catalog.catalog_product_id (nullable, Q4).';

create table public.provider_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  catalog_product_id uuid references public.catalog_products (id),
  nombre text not null,
  categoria text not null,
  precio_base numeric(12,2) not null,
  precio_maximo numeric(12,2) not null,
  stock integer not null default 0,
  disponible boolean not null default true,
  imagen_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_catalog_precio_base_check check (precio_base >= 0),
  constraint provider_catalog_precio_maximo_check check (precio_maximo >= precio_base),
  constraint provider_catalog_stock_check check (stock >= 0)
);

comment on table public.provider_catalog is
  'Listado propio de cada proveedor: precios y disponibilidad. nombre/categoria van denormalizados (fallback de matching) incluso cuando catalog_product_id no es NULL.';
comment on column public.provider_catalog.catalog_product_id is
  'NULL por diseño (Q4, db-schema-catalogo): un proveedor puede cargar un producto que no está en el catálogo de referencia, apoyándose en nombre/categoria para matching. Backfillear texto libre a un id después es lossy; agregar la FK después es barato -- se decide nullable, nunca NOT NULL. Mismo patrón de invariante-fuera-de-DB que profiles.company_id (lote 01a) y user_consumption.pet_id (lote 02).';

-- ============================================================
-- 3. Constraints / FK diferidas
-- ============================================================
-- No aplica: catalog_products no depende de nada posterior en este lote, y
-- provider_catalog.catalog_product_id ya va inline en el CREATE TABLE de la
-- sección 2 (nullable, sin ciclo que forzar a diferir).

-- ============================================================
-- 4. Indexes
-- ============================================================
create index catalog_products_nombre_trgm_idx
  on public.catalog_products using gin (nombre extensions.gin_trgm_ops);
create index catalog_products_categoria_trgm_idx
  on public.catalog_products using gin (categoria extensions.gin_trgm_ops);

create index provider_catalog_company_id_idx on public.provider_catalog (company_id);
create index provider_catalog_nombre_trgm_idx
  on public.provider_catalog using gin (nombre extensions.gin_trgm_ops);
create index provider_catalog_categoria_trgm_idx
  on public.provider_catalog using gin (categoria extensions.gin_trgm_ops);
-- Los 4 índices GIN trigram (tasks.md 5.1) soportan búsqueda difusa por
-- nombre/categoria en ambas tablas -- pg_trgm habilitado en el lote 00,
-- instalado en el schema `extensions` (de ahí el opclass calificado).

-- ============================================================
-- 5. Trigger updated_at
-- ============================================================
create trigger catalog_products_set_updated_at
  before update on public.catalog_products
  for each row execute function public.set_updated_at();

create trigger provider_catalog_set_updated_at
  before update on public.provider_catalog
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.catalog_products enable row level security;
alter table public.provider_catalog enable row level security;

revoke all on public.catalog_products from anon, authenticated;
revoke all on public.provider_catalog from anon, authenticated;

grant select on public.catalog_products to authenticated;
grant select on public.provider_catalog to authenticated;
-- Ninguna de las dos concede a `anon` (Q6, db-schema-catalogo Requirement
-- "catalog_products is authenticated-only"): las dos políticas de
-- provider_catalog (sección 7) también son `to authenticated` -- no hay
-- lectura pública sin sesión en este lote, ni siquiera para el marketplace
-- view. Ninguna de las dos tiene grant insert/update/delete: las mutaciones
-- (cargarProductoCatalogo, etc.) van por core-api con service-role, mismo
-- patrón que companies/profiles (lote 01a) y pets/user_consumption (lote 02).

-- ============================================================
-- 7. RLS: políticas
-- ============================================================
-- catalog_products: sin filtro de status -- Q6 solo exige sesión, no oculta
-- inactivos (un proveedor puede necesitar referenciar por id un producto ya
-- descontinuado).
create policy "catalog_products_authenticated_select_all"
  on public.catalog_products
  for select
  to authenticated
  using (true);

-- provider_catalog: dos políticas (db-schema-catalogo Requirement
-- "provider_catalog visibility splits public vs. owner"). EXISTS literal
-- contra profiles, mismo patrón que companies_authenticated_select_owner
-- (lote 01a) -- la spec documenta el predicado explícito, no
-- current_company_id(): ambas políticas quedan homogéneas con las de la
-- tabla `companies`.
create policy "provider_catalog_authenticated_select_public"
  on public.provider_catalog
  for select
  to authenticated
  using (disponible = true);

create policy "provider_catalog_authenticated_select_owner"
  on public.provider_catalog
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.company_id = provider_catalog.company_id
        and p.id = (select auth.uid())
    )
  );

-- ============================================================
-- 8. Realtime / publication
-- ============================================================
-- No aplica a este lote (solo offers, batch 05, design.md D-4).
