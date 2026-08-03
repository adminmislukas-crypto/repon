-- pgTAP test for supabase/migrations/20260803120300_03_catalogo.sql.
--
-- Covers schema (tables/columns/FKs/indexes/RLS-enabled) plus the
-- specs/db-schema-catalogo/spec.md scenarios: anon is denied on
-- catalog_products (Q6, authenticated-only), the public-vs-owner visibility
-- split on provider_catalog, the precio_maximo >= precio_base CHECK, and the
-- nullable catalog_product_id insert (Q4).
--
-- JWT-claim simulation (`request.jwt.claims` / `role = authenticated`) is
-- the standard Supabase pgTAP pattern, same as 01a/01b/02.
begin;

select plan(20);

-- ============================================================
-- Schema
-- ============================================================
select has_table('public', 'catalog_products', 'catalog_products table exists');
select has_table('public', 'provider_catalog', 'provider_catalog table exists');

select col_is_fk('public', 'provider_catalog', 'company_id', 'provider_catalog.company_id is a FK');
select col_is_fk('public', 'provider_catalog', 'catalog_product_id', 'provider_catalog.catalog_product_id is a FK');
select col_type_is('public', 'catalog_products', 'status', 'catalog_product_status', 'catalog_products.status is the catalog_product_status enum');

select has_index('public', 'catalog_products', 'catalog_products_nombre_trgm_idx', 'trigram index on catalog_products.nombre exists');
select has_index('public', 'catalog_products', 'catalog_products_categoria_trgm_idx', 'trigram index on catalog_products.categoria exists');
select has_index('public', 'provider_catalog', 'provider_catalog_company_id_idx', 'index on provider_catalog.company_id exists');

select ok((select relrowsecurity from pg_class where oid = 'public.catalog_products'::regclass), 'RLS enabled on catalog_products');
select ok((select relrowsecurity from pg_class where oid = 'public.provider_catalog'::regclass), 'RLS enabled on provider_catalog');

-- ============================================================
-- Grants: no anon privilege on either table (Q6)
-- ============================================================
select table_privs_are('public', 'catalog_products', 'anon', array[]::text[], 'anon has zero privileges on catalog_products');
select table_privs_are('public', 'provider_catalog', 'anon', array[]::text[], 'anon has zero privileges on provider_catalog');

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('c1111111-1111-1111-1111-111111111111', 'owner-a@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('c2222222-2222-2222-2222-222222222222', 'no-relation@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proveedor A SPA', '33.333.333-3', 'venta de insumos', 'activo'),
  ('cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proveedor B SPA', '44.444.444-4', 'venta de insumos', 'activo');

insert into public.profiles (id, role, nombre, email, company_id) values
  ('c1111111-1111-1111-1111-111111111111', 'provider', 'Dueño A', 'owner-a@test.com', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('c2222222-2222-2222-2222-222222222222', 'user', 'Sin relación', 'no-relation@test.com', null);

insert into public.catalog_products (id, nombre, categoria, status) values
  ('cd111111-1111-1111-1111-111111111111', 'Alimento Perro Adulto', 'alimento', 'activo'),
  ('cd222222-2222-2222-2222-222222222222', 'Shampoo Antipulgas', 'higiene', 'inactivo');

-- I1 (disponible), I2 (no disponible) from company A -- spec fixture names.
insert into public.provider_catalog (id, company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo, disponible) values
  ('ce111111-1111-1111-1111-111111111111', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cd111111-1111-1111-1111-111111111111', 'Alimento Perro Adulto', 'alimento', 10000, 12000, true),
  ('ce222222-2222-2222-2222-222222222222', 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'Bolsa Premium 15kg', 'alimento', 20000, 25000, false);

-- I3 from company B, disponible = false -- used to check company A cannot
-- read it via the client path.
insert into public.provider_catalog (id, company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo, disponible) values
  ('ce333333-3333-3333-3333-333333333333', 'cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null, 'Shampoo Antipulgas', 'higiene', 5000, 6000, false);

-- ============================================================
-- precio_maximo >= precio_base CHECK (db-schema-catalogo Requirement
-- "precio_maximo cannot be below precio_base") -- CHECK constraints apply
-- regardless of role, tested here as table owner before any role switch.
-- ============================================================
select throws_ok(
  $$ insert into public.provider_catalog (company_id, nombre, categoria, precio_base, precio_maximo)
     values ('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Producto Invalido', 'alimento', 10000, 8000) $$,
  '23514',
  null,
  'precio_maximo < precio_base is rejected by the CHECK constraint'
);

-- ============================================================
-- catalog_product_id stays nullable (Q4) -- provider loads a product not in
-- the reference catalog, row is created with catalog_product_id = NULL.
-- ============================================================
select lives_ok(
  $$ insert into public.provider_catalog (company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo)
     values ('caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'Producto Libre', 'higiene', 1000, 2000) $$,
  'provider_catalog row with catalog_product_id = NULL is accepted (Q4, no reference-catalog match required)'
);

-- ============================================================
-- RLS scenarios
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "c2222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

select is(
  (select count(*) from public.catalog_products),
  2::bigint,
  'authenticated user sees all catalog_products rows regardless of status (Q6: no status filter, session-only gate)'
);

select is(
  (select count(*) from public.provider_catalog where company_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2::bigint,
  'unaffiliated authenticated user sees only company A''s disponible = true items (I1 + the nullable-FK row inserted above, both default/explicit disponible = true) -- never I2'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "c1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is(
  (select count(*) from public.provider_catalog where company_id = 'caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  3::bigint,
  'owner of company A sees I1, I2 (own, incl. disponible = false) plus the nullable-FK row just inserted'
);

select is(
  (select count(*) from public.provider_catalog where id = 'ce333333-3333-3333-3333-333333333333'),
  0::bigint,
  'company A owner cannot read company B''s disponible = false item (I3) via the client path -- neither policy matches'
);

reset role;

-- ============================================================
-- anon is denied (Q6, db-schema-catalogo Requirement
-- "catalog_products is authenticated-only") -- no grant exists for anon on
-- either table, so a direct read raises permission denied rather than
-- returning an empty result set.
-- ============================================================
set local role anon;

select throws_ok(
  $$ select * from public.catalog_products $$,
  '42501',
  null,
  'anon direct read of catalog_products is rejected -- no SELECT grant exists'
);

select throws_ok(
  $$ select * from public.provider_catalog $$,
  '42501',
  null,
  'anon direct read of provider_catalog is rejected -- no SELECT grant exists'
);

reset role;

select * from finish();

rollback;
