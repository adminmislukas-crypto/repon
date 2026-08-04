-- pgTAP test for
-- supabase/migrations/20260804090500_10_grants_domain_tables_service_role.sql.
--
-- Covers the same bug class as
-- supabase/tests/09_grants_identidad_service_role_test.sql, broader scope:
-- service_role previously had zero grants on the 12 tables below (each
-- domain migration 02_consumo.sql through 06_pedidos_pagos.sql only ever
-- granted `authenticated` select + revoked `anon`/`authenticated`, never
-- granting service_role anything -- see this migration's header comment).
-- Asserts service_role can now INSERT/SELECT/UPDATE all 11 standard tables
-- via direct DML (not `table_privs_are` -- same reasoning as
-- 09_grants_identidad_service_role_test.sql: a local Supabase project grants
-- service_role broad default privileges on `public` at project-init time,
-- independent of this migration, so an exact-privilege-set assertion would
-- conflate that baseline with what this migration actually controls).
--
-- order_items is the one negative case that matters most here: it gets
-- SELECT/INSERT only, and its UPDATE must still be rejected for
-- service_role -- a regression on that would silently break the D-6
-- immutable-snapshot guarantee that 06_pedidos_pagos.sql already
-- established (`revoke update, delete ... from ... service_role`).
--
-- Fixtures build one coherent chain across every domain (consumo ->
-- catalogo -> refill-matching -> ofertas -> pedidos-pagos) so each table's
-- own service_role INSERT test also produces the row the next table in the
-- chain needs as an FK target -- same "insert IS the assertion" pattern as
-- 09_grants_identidad_service_role_test.sql, just chained across more
-- tables. Base rows for auth.users/profiles/companies are inserted as table
-- owner (bypasses RLS+grants) since service_role's access to those tables
-- is already covered by 09_grants_identidad_service_role_test.sql.
begin;

select plan(36);

-- ============================================================
-- Base fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values ('d1111111-1111-1111-1111-111111111111', 'grants10@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.profiles (id, role, nombre, email) values
  ('d1111111-1111-1111-1111-111111111111', 'user', 'Grants Diez', 'grants10@test.com');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('dccccccc-cccc-cccc-cccc-cccccccccccc', 'Grants Diez Provider SPA', '88.888.888-8', 'venta de insumos', 'activo');

-- ============================================================
-- pets: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.pets (id, user_id, nombre, especie)
     values ('da111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'Firulais', 'perro') $$,
  'service_role INSERT on pets succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.pets where id = 'da111111-1111-1111-1111-111111111111' $$,
  'service_role SELECT on pets succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.pets set nombre = 'Firulais Actualizado' where id = 'da111111-1111-1111-1111-111111111111' $$,
  'service_role UPDATE on pets succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- user_consumption: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.user_consumption
       (id, user_id, owner_type, pet_id, kind, nombre, dosis_por_toma, frecuencia_dias, horarios, stock_actual, auto_crear_refill)
     values
       ('da222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', 'pet', 'da111111-1111-1111-1111-111111111111', 'alimento', 'Croquetas Firulais', 1, 1, array['08:00'], 10, true) $$,
  'service_role INSERT on user_consumption succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.user_consumption where id = 'da222222-2222-2222-2222-222222222222' $$,
  'service_role SELECT on user_consumption succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.user_consumption set stock_actual = 8 where id = 'da222222-2222-2222-2222-222222222222' $$,
  'service_role UPDATE on user_consumption succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- consumption_logs: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.consumption_logs (id, consumption_id, tomado_at, cantidad)
     values ('da333333-3333-3333-3333-333333333333', 'da222222-2222-2222-2222-222222222222', now(), 1) $$,
  'service_role INSERT on consumption_logs succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.consumption_logs where id = 'da333333-3333-3333-3333-333333333333' $$,
  'service_role SELECT on consumption_logs succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.consumption_logs set cantidad = 2 where id = 'da333333-3333-3333-3333-333333333333' $$,
  'service_role UPDATE on consumption_logs succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- catalog_products: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.catalog_products (id, nombre, categoria)
     values ('db111111-1111-1111-1111-111111111111', 'Alimento Perro Premium', 'alimento') $$,
  'service_role INSERT on catalog_products succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.catalog_products where id = 'db111111-1111-1111-1111-111111111111' $$,
  'service_role SELECT on catalog_products succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.catalog_products set marca = 'Marca Actualizada' where id = 'db111111-1111-1111-1111-111111111111' $$,
  'service_role UPDATE on catalog_products succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- provider_catalog: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.provider_catalog (id, company_id, catalog_product_id, nombre, categoria, precio_base, precio_maximo)
     values ('db222222-2222-2222-2222-222222222222', 'dccccccc-cccc-cccc-cccc-cccccccccccc', 'db111111-1111-1111-1111-111111111111', 'Alimento Perro Premium', 'alimento', 10000, 12000) $$,
  'service_role INSERT on provider_catalog succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.provider_catalog where id = 'db222222-2222-2222-2222-222222222222' $$,
  'service_role SELECT on provider_catalog succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.provider_catalog set stock = 5 where id = 'db222222-2222-2222-2222-222222222222' $$,
  'service_role UPDATE on provider_catalog succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- refill_requests: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.refill_requests (id, user_id, direccion, comuna, urgencia)
     values ('dc111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'Av. Siempre Viva 123', 'Ñuñoa', 'hoy') $$,
  'service_role INSERT on refill_requests succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.refill_requests where id = 'dc111111-1111-1111-1111-111111111111' $$,
  'service_role SELECT on refill_requests succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.refill_requests set estado = 'ofertada' where id = 'dc111111-1111-1111-1111-111111111111' $$,
  'service_role UPDATE on refill_requests succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- refill_items: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.refill_items (id, refill_request_id, catalog_product_id, nombre, categoria, precio_referencia)
     values ('dc222222-2222-2222-2222-222222222222', 'dc111111-1111-1111-1111-111111111111', 'db111111-1111-1111-1111-111111111111', 'Alimento Perro Premium', 'alimento', 10500) $$,
  'service_role INSERT on refill_items succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.refill_items where id = 'dc222222-2222-2222-2222-222222222222' $$,
  'service_role SELECT on refill_items succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.refill_items set precio_referencia = 10800 where id = 'dc222222-2222-2222-2222-222222222222' $$,
  'service_role UPDATE on refill_items succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- offers: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.offers (id, user_id, refill_request_id, company_id, kind, tiempo_entrega_horas, costo_despacho, total)
     values ('dd111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'dc111111-1111-1111-1111-111111111111', 'dccccccc-cccc-cccc-cccc-cccccccccccc', 'reactiva', 24, 1500, 12000) $$,
  'service_role INSERT on offers succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.offers where id = 'dd111111-1111-1111-1111-111111111111' $$,
  'service_role SELECT on offers succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.offers set status = 'aceptada' where id = 'dd111111-1111-1111-1111-111111111111' $$,
  'service_role UPDATE on offers succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- offer_items: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.offer_items (id, offer_id, refill_item_id, precio)
     values ('dd222222-2222-2222-2222-222222222222', 'dd111111-1111-1111-1111-111111111111', 'dc222222-2222-2222-2222-222222222222', 10500) $$,
  'service_role INSERT on offer_items succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.offer_items where id = 'dd222222-2222-2222-2222-222222222222' $$,
  'service_role SELECT on offer_items succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.offer_items set precio = 10700 where id = 'dd222222-2222-2222-2222-222222222222' $$,
  'service_role UPDATE on offer_items succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- orders: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.orders (id, offer_id, user_id, company_id, total)
     values ('de111111-1111-1111-1111-111111111111', 'dd111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111', 'dccccccc-cccc-cccc-cccc-cccccccccccc', 12000) $$,
  'service_role INSERT on orders succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.orders where id = 'de111111-1111-1111-1111-111111111111' $$,
  'service_role SELECT on orders succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.orders set status = 'preparando' where id = 'de111111-1111-1111-1111-111111111111' $$,
  'service_role UPDATE on orders succeeds -- grant exists (fix)'
);

reset role;

-- ============================================================
-- order_items: service_role can SELECT/INSERT, UPDATE stays rejected (D-6)
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.order_items (id, order_id, offer_item_id, nombre, cantidad, precio_unitario, subtotal)
     values ('de222222-2222-2222-2222-222222222222', 'de111111-1111-1111-1111-111111111111', 'dd222222-2222-2222-2222-222222222222', 'Alimento Perro Premium', 1, 10500, 10500) $$,
  'service_role INSERT on order_items succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.order_items where id = 'de222222-2222-2222-2222-222222222222' $$,
  'service_role SELECT on order_items succeeds -- grant exists (fix)'
);

select throws_ok(
  $$ update public.order_items set precio_unitario = 1 where id = 'de222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'service_role UPDATE on order_items is STILL rejected -- D-6 immutable snapshot, 06_pedidos_pagos.sql revokes update/delete from service_role explicitly and this migration must not grant it back'
);

reset role;

-- ============================================================
-- payments: service_role can SELECT/INSERT/UPDATE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.payments (id, order_id, gateway, external_transaction_id, monto)
     values ('de333333-3333-3333-3333-333333333333', 'de111111-1111-1111-1111-111111111111', 'webpay', 'wp-tx-grants-10', 12000) $$,
  'service_role INSERT on payments succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.payments where id = 'de333333-3333-3333-3333-333333333333' $$,
  'service_role SELECT on payments succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.payments set estado = 'pagado' where id = 'de333333-3333-3333-3333-333333333333' $$,
  'service_role UPDATE on payments succeeds -- grant exists (fix)'
);

reset role;

select * from finish();

rollback;
