-- pgTAP test for supabase/migrations/20260803120400_04_refill_matching.sql.
--
-- Covers schema (tables/columns/FKs/indexes/RLS-enabled/anon-zero-privileges)
-- plus the specs/db-schema-refill-matching/spec.md scenarios: comuna NOT
-- NULL rejection, owner-only SELECT on refill_requests (including the
-- explicit "provider cannot read another user's request directly" scenario
-- -- matching happens through core-api, never via RLS), the
-- EXISTS-against-parent pattern on refill_items (owner reads own items,
-- unrelated user reads none), and the nullable catalog_product_id insert
-- (Q4).
--
-- JWT-claim simulation (`request.jwt.claims` / `role = authenticated`) is
-- the standard Supabase pgTAP pattern, same as 01a/01b/02/03.
begin;

select plan(19);

-- ============================================================
-- Schema
-- ============================================================
select has_table('public', 'refill_requests', 'refill_requests table exists');
select has_table('public', 'refill_items', 'refill_items table exists');

select col_is_fk('public', 'refill_requests', 'user_id', 'refill_requests.user_id is a FK');
select col_is_fk('public', 'refill_items', 'refill_request_id', 'refill_items.refill_request_id is a FK');
select col_is_fk('public', 'refill_items', 'catalog_product_id', 'refill_items.catalog_product_id is a FK');

select col_type_is('public', 'refill_requests', 'urgencia', 'refill_urgencia', 'refill_requests.urgencia is the refill_urgencia enum');
select col_type_is('public', 'refill_requests', 'estado', 'refill_estado', 'refill_requests.estado is the refill_estado enum');

select has_index('public', 'refill_requests', 'refill_requests_user_id_idx', 'index on refill_requests.user_id exists');
select has_index('public', 'refill_items', 'refill_items_refill_request_id_idx', 'index on refill_items.refill_request_id exists');

select ok((select relrowsecurity from pg_class where oid = 'public.refill_requests'::regclass), 'RLS enabled on refill_requests');
select ok((select relrowsecurity from pg_class where oid = 'public.refill_items'::regclass), 'RLS enabled on refill_items');

select table_privs_are('public', 'refill_requests', 'anon', array[]::text[], 'anon has zero privileges on refill_requests');
select table_privs_are('public', 'refill_items', 'anon', array[]::text[], 'anon has zero privileges on refill_items');

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('d1111111-1111-1111-1111-111111111111', 'owner-a@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('d2222222-2222-2222-2222-222222222222', 'owner-b@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('d3333333-3333-3333-3333-333333333333', 'provider-p@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('dcccccc1-cccc-cccc-cccc-cccccccccccc', 'Proveedor P SPA', '55.555.555-5', 'venta de insumos', 'activo');

insert into public.profiles (id, role, nombre, email, company_id) values
  ('d1111111-1111-1111-1111-111111111111', 'user', 'Dueña A', 'owner-a@test.com', null),
  ('d2222222-2222-2222-2222-222222222222', 'user', 'Dueño B', 'owner-b@test.com', null),
  ('d3333333-3333-3333-3333-333333333333', 'provider', 'Proveedor P', 'provider-p@test.com', 'dcccccc1-cccc-cccc-cccc-cccccccccccc');

insert into public.catalog_products (id, nombre, categoria, status) values
  ('d4444444-4444-4444-4444-444444444444', 'Alimento Perro Adulto', 'alimento', 'activo');

insert into public.refill_requests (id, user_id, direccion, comuna, urgencia, estado) values
  ('d5555555-5555-5555-5555-555555555555', 'd1111111-1111-1111-1111-111111111111', 'Av. Siempre Viva 742', 'Ñuñoa', 'hoy', 'abierta');

insert into public.refill_items (id, refill_request_id, catalog_product_id, nombre, categoria, precio_referencia) values
  ('d6666666-6666-6666-6666-666666666666', 'd5555555-5555-5555-5555-555555555555', 'd4444444-4444-4444-4444-444444444444', 'Alimento Perro Adulto', 'alimento', 15000);

-- ============================================================
-- comuna NOT NULL rejection (db-schema-refill-matching Requirement "comuna
-- is a structured join key, not derived from free text") -- NOT NULL
-- constraint applies regardless of role, tested here as table owner before
-- any role switch.
-- ============================================================
select throws_ok(
  $$ insert into public.refill_requests (user_id, direccion, urgencia)
     values ('d1111111-1111-1111-1111-111111111111', 'Av. Siempre Viva 742', 'hoy') $$,
  '23502',
  null,
  'refill_requests insert without comuna is rejected by the NOT NULL constraint'
);

-- ============================================================
-- catalog_product_id stays nullable (Q4) -- item references a product not
-- in the reference catalog, row is created with catalog_product_id = NULL.
-- ============================================================
select lives_ok(
  $$ insert into public.refill_items (refill_request_id, catalog_product_id, nombre, categoria, precio_referencia)
     values ('d5555555-5555-5555-5555-555555555555', null, 'Producto Libre', 'higiene', 5000) $$,
  'refill_items row with catalog_product_id = NULL is accepted (Q4, no reference-catalog match required)'
);

-- ============================================================
-- RLS scenarios
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "d1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is(
  (select count(*) from public.refill_requests),
  1::bigint,
  'owner A sees their own refill_request'
);

select is(
  (select count(*) from public.refill_items where refill_request_id = 'd5555555-5555-5555-5555-555555555555'),
  2::bigint,
  'owner A reads both of their own request''s items via the EXISTS policy'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "d3333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);

select is(
  (select count(*) from public.refill_requests where id = 'd5555555-5555-5555-5555-555555555555'),
  0::bigint,
  'provider P cannot read owner A''s refill_request directly -- matching must go through core-api (buscarProveedoresCompatibles), not RLS'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "d2222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

select is(
  (select count(*) from public.refill_items where refill_request_id = 'd5555555-5555-5555-5555-555555555555'),
  0::bigint,
  'unrelated owner B cannot read owner A''s request items -- EXISTS policy against the parent finds no matching refill_requests row'
);

reset role;

select * from finish();

rollback;
