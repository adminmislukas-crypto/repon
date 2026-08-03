-- pgTAP test for supabase/migrations/20260803120600_06_pedidos_pagos.sql.
-- Covers schema, grants, RLS (owner+company on orders, EXISTS-owner-only on
-- order_items, zero SELECT on payments), the D-6 immutability guarantee
-- (order_items UPDATE rejected for authenticated AND service_role), and the
-- no-card-data-columns requirement on payments.
begin;

select plan(32);

-- Schema
select has_table('public', 'orders', 'orders table exists');
select has_table('public', 'order_items', 'order_items table exists');
select has_table('public', 'payments', 'payments table exists');

select col_is_fk('public', 'orders', 'offer_id', 'orders.offer_id is a FK');
select col_is_fk('public', 'orders', 'user_id', 'orders.user_id is a FK');
select col_is_fk('public', 'orders', 'company_id', 'orders.company_id is a FK');
select col_is_fk('public', 'order_items', 'order_id', 'order_items.order_id is a FK');
select col_is_fk('public', 'order_items', 'offer_item_id', 'order_items.offer_item_id is a FK');
select col_is_fk('public', 'payments', 'order_id', 'payments.order_id is a FK');

select col_type_is('public', 'orders', 'status', 'order_status', 'orders.status is the order_status enum');
select col_type_is('public', 'payments', 'estado', 'payment_status', 'payments.estado is the payment_status enum');

select has_index('public', 'orders', 'orders_user_id_idx', 'index on orders.user_id exists');
select has_index('public', 'orders', 'orders_company_id_idx', 'index on orders.company_id exists');
select has_index('public', 'orders', 'orders_offer_id_idx', 'index on orders.offer_id exists');
select has_index('public', 'order_items', 'order_items_order_id_idx', 'index on order_items.order_id exists');

select ok((select relrowsecurity from pg_class where oid = 'public.orders'::regclass), 'RLS enabled on orders');
select ok((select relrowsecurity from pg_class where oid = 'public.order_items'::regclass), 'RLS enabled on order_items');
select ok((select relrowsecurity from pg_class where oid = 'public.payments'::regclass), 'RLS enabled on payments');

select table_privs_are('public', 'orders', 'anon', array[]::text[], 'anon has zero privileges on orders');
select table_privs_are('public', 'order_items', 'anon', array[]::text[], 'anon has zero privileges on order_items');
select table_privs_are('public', 'payments', 'anon', array[]::text[], 'anon has zero privileges on payments');
select table_privs_are('public', 'payments', 'authenticated', array[]::text[], 'authenticated has zero privileges on payments -- no direct client read of raw_payload, ever');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'payments'
     and column_name ~* 'card|cvv|pan|expiry'),
  0,
  'payments has no card-data columns (PCI scope avoidance)'
);

-- Fixtures (as table owner, bypasses RLS)
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('f1111111-1111-1111-1111-111111111111', 'owner-a@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('f2222222-2222-2222-2222-222222222222', 'unrelated-b@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('f3333333-3333-3333-3333-333333333333', 'provider-q@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('fccccccc-cccc-cccc-cccc-cccccccccccc', 'Proveedor Q SPA', '77.777.777-7', 'venta de insumos', 'activo');

insert into public.profiles (id, role, nombre, email, company_id) values
  ('f1111111-1111-1111-1111-111111111111', 'user', 'Dueña A', 'owner-a@test.com', null),
  ('f2222222-2222-2222-2222-222222222222', 'user', 'Sin Relación B', 'unrelated-b@test.com', null),
  ('f3333333-3333-3333-3333-333333333333', 'provider', 'Proveedor Q', 'provider-q@test.com', 'fccccccc-cccc-cccc-cccc-cccccccccccc');

insert into public.provider_catalog (id, company_id, nombre, categoria, precio_base, precio_maximo) values
  ('fddddddd-dddd-dddd-dddd-dddddddddddd', 'fccccccc-cccc-cccc-cccc-cccccccccccc', 'Alimento Gato Premium', 'alimento', 11000, 12500);

insert into public.offers (id, user_id, company_id, kind, status, tiempo_entrega_horas, costo_despacho, total) values
  ('feeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'f1111111-1111-1111-1111-111111111111', 'fccccccc-cccc-cccc-cccc-cccccccccccc', 'proactiva', 'aceptada', 24, 2000, 13000);

insert into public.offer_items (id, offer_id, provider_catalog_item_id, is_alt, precio) values
  ('fffffff1-ffff-ffff-ffff-ffffffffffff', 'feeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'fddddddd-dddd-dddd-dddd-dddddddddddd', false, 11000);

insert into public.orders (id, offer_id, user_id, company_id, total) values
  ('fa111111-1111-1111-1111-111111111111', 'feeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'f1111111-1111-1111-1111-111111111111', 'fccccccc-cccc-cccc-cccc-cccccccccccc', 13000);

insert into public.order_items (id, order_id, offer_item_id, nombre, cantidad, precio_unitario, subtotal) values
  ('fa222222-2222-2222-2222-222222222222', 'fa111111-1111-1111-1111-111111111111', 'fffffff1-ffff-ffff-ffff-ffffffffffff', 'Alimento Gato Premium', 1, 11000, 11000);

insert into public.payments (id, order_id, gateway, external_transaction_id, monto) values
  ('fa333333-3333-3333-3333-333333333333', 'fa111111-1111-1111-1111-111111111111', 'webpay', 'wp-tx-000111', 13000);

-- RLS scenarios -- orders (owner + company, both must see it; unrelated sees nothing)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "f1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is(
  (select count(*) from public.orders),
  1::bigint,
  'owner A sees their order via the direct user_id compare'
);

select is(
  (select count(*) from public.order_items where order_id = 'fa111111-1111-1111-1111-111111111111'),
  1::bigint,
  'owner A reads the order''s items via the EXISTS-against-orders policy'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "f3333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);

select is(
  (select count(*) from public.orders),
  1::bigint,
  'the provider''s profile (matching orders.company_id) also sees the order -- both parties to an order can read it'
);

select is(
  (select count(*) from public.order_items),
  0::bigint,
  'the provider reads zero order_items directly via RLS -- keyed on orders.user_id (owner) only, same carve-out as offer_items'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "f2222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

select is(
  (select count(*) from public.orders),
  0::bigint,
  'unrelated user B sees no orders -- neither owner nor company policy matches'
);

select is(
  (select count(*) from public.order_items),
  0::bigint,
  'unrelated user B sees no order_items'
);

select throws_ok(
  $$ select * from public.payments $$,
  '42501',
  null,
  'direct read of payments is denied even for the owning user -- zero SELECT grant/policy exists for any client role'
);

-- D-6: order_items UPDATE is rejected for every role, including service_role
select throws_ok(
  $$ update public.order_items set precio_unitario = 1 where id = 'fa222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'authenticated UPDATE on order_items is rejected -- no UPDATE grant exists'
);

reset role;
set local role service_role;

select throws_ok(
  $$ update public.order_items set precio_unitario = 1 where id = 'fa222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'service_role UPDATE on order_items is rejected too -- service_role has BYPASSRLS but not the UPDATE grant, which was explicitly revoked (D-6)'
);

reset role;

select * from finish();

rollback;
