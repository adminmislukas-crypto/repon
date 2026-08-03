-- pgTAP test for supabase/migrations/20260803120500_05_ofertas.sql.
-- Covers schema, dual-nullable offer_items CHECK, partial unique index, and
-- RLS -- incl. the critical case: a PROACTIVE offer (no refill_request_id)
-- must still be visible via the direct offers.user_id compare.
begin;

select plan(31);

-- Schema
select has_table('public', 'offers', 'offers table exists');
select has_table('public', 'offer_items', 'offer_items table exists');

select col_is_fk('public', 'offers', 'user_id', 'offers.user_id is a FK');
select col_is_fk('public', 'offers', 'refill_request_id', 'offers.refill_request_id is a FK');
select col_is_fk('public', 'offers', 'company_id', 'offers.company_id is a FK');
select col_is_fk('public', 'offer_items', 'offer_id', 'offer_items.offer_id is a FK');
select col_is_fk('public', 'offer_items', 'refill_item_id', 'offer_items.refill_item_id is a FK');
select col_is_fk('public', 'offer_items', 'provider_catalog_item_id', 'offer_items.provider_catalog_item_id is a FK');

select col_type_is('public', 'offers', 'kind', 'offer_kind', 'offers.kind is the offer_kind enum');
select col_type_is('public', 'offers', 'status', 'offer_status', 'offers.status is the offer_status enum');

select has_index('public', 'offers', 'offers_user_id_idx', 'index on offers.user_id exists');
select has_index('public', 'offers', 'offers_company_id_idx', 'index on offers.company_id exists');
select has_index('public', 'offers', 'offers_refill_request_id_idx', 'index on offers.refill_request_id exists');
select has_index('public', 'offer_items', 'offer_items_offer_id_idx', 'index on offer_items.offer_id exists');

select ok((select relrowsecurity from pg_class where oid = 'public.offers'::regclass), 'RLS enabled on offers');
select ok((select relrowsecurity from pg_class where oid = 'public.offer_items'::regclass), 'RLS enabled on offer_items');

select table_privs_are('public', 'offers', 'anon', array[]::text[], 'anon has zero privileges on offers');
select table_privs_are('public', 'offer_items', 'anon', array[]::text[], 'anon has zero privileges on offer_items');

-- Fixtures (as table owner, bypasses RLS)
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('e1111111-1111-1111-1111-111111111111', 'recipient-a@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('e2222222-2222-2222-2222-222222222222', 'recipient-b@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('e3333333-3333-3333-3333-333333333333', 'unrelated-c@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('e4444444-4444-4444-4444-444444444444', 'provider-q@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('eccccccc-cccc-cccc-cccc-cccccccccccc', 'Proveedor Q SPA', '66.666.666-6', 'venta de insumos', 'activo');

insert into public.profiles (id, role, nombre, email, company_id) values
  ('e1111111-1111-1111-1111-111111111111', 'user', 'Destinataria A', 'recipient-a@test.com', null),
  ('e2222222-2222-2222-2222-222222222222', 'user', 'Destinatario B', 'recipient-b@test.com', null),
  ('e3333333-3333-3333-3333-333333333333', 'user', 'Sin Relación C', 'unrelated-c@test.com', null),
  ('e4444444-4444-4444-4444-444444444444', 'provider', 'Proveedor Q', 'provider-q@test.com', 'eccccccc-cccc-cccc-cccc-cccccccccccc');

insert into public.refill_requests (id, user_id, direccion, comuna, urgencia, estado) values
  ('e5555555-5555-5555-5555-555555555555', 'e1111111-1111-1111-1111-111111111111', 'Av. Siempre Viva 742', 'Providencia', 'hoy', 'ofertada');

insert into public.refill_items (id, refill_request_id, nombre, categoria, precio_referencia) values
  ('e6666666-6666-6666-6666-666666666666', 'e5555555-5555-5555-5555-555555555555', 'Alimento Gato Adulto', 'alimento', 14000);

insert into public.provider_catalog (id, company_id, nombre, categoria, precio_base, precio_maximo) values
  ('e7777777-7777-7777-7777-777777777777', 'eccccccc-cccc-cccc-cccc-cccccccccccc', 'Alimento Gato Premium', 'alimento', 11000, 12500);

-- O1: reactive offer, recipient A, already aceptada.
insert into public.offers (id, user_id, refill_request_id, company_id, kind, status, tiempo_entrega_horas, costo_despacho, total) values
  ('e8888888-8888-8888-8888-888888888888', 'e1111111-1111-1111-1111-111111111111', 'e5555555-5555-5555-5555-555555555555', 'eccccccc-cccc-cccc-cccc-cccccccccccc', 'reactiva', 'aceptada', 24, 2000, 15000);

-- O2: proactive offer, recipient B, NO refill_request_id -- critical regression scenario.
insert into public.offers (id, user_id, refill_request_id, company_id, kind, status, tiempo_entrega_horas, costo_despacho, total, mensaje) values
  ('e9999999-9999-9999-9999-999999999999', 'e2222222-2222-2222-2222-222222222222', null, 'eccccccc-cccc-cccc-cccc-cccccccccccc', 'proactiva', 'pendiente', 48, 1500, 12000, 'Vimos que se te acaba pronto, aquí una oferta');

-- offer_items dual-nullable CHECK
select lives_ok(
  $$ insert into public.offer_items (offer_id, refill_item_id, is_alt, precio)
     values ('e8888888-8888-8888-8888-888888888888', 'e6666666-6666-6666-6666-666666666666', false, 15000) $$,
  'reactive offer_items row (refill_item_id set, provider_catalog_item_id NULL) is accepted'
);

select lives_ok(
  $$ insert into public.offer_items (offer_id, provider_catalog_item_id, is_alt, precio)
     values ('e9999999-9999-9999-9999-999999999999', 'e7777777-7777-7777-7777-777777777777', false, 12000) $$,
  'proactive offer_items row (provider_catalog_item_id set, refill_item_id NULL) is accepted'
);

select throws_ok(
  $$ insert into public.offer_items (offer_id, refill_item_id, provider_catalog_item_id, is_alt, precio)
     values ('e8888888-8888-8888-8888-888888888888', 'e6666666-6666-6666-6666-666666666666', 'e7777777-7777-7777-7777-777777777777', false, 1000) $$,
  '23514',
  null,
  'offer_items row with BOTH refill_item_id and provider_catalog_item_id set is rejected by the CHECK'
);

select throws_ok(
  $$ insert into public.offer_items (offer_id, is_alt, precio)
     values ('e8888888-8888-8888-8888-888888888888', false, 1000) $$,
  '23514',
  null,
  'offer_items row with NEITHER refill_item_id nor provider_catalog_item_id set is rejected by the CHECK'
);

-- Partial unique index: at most one 'aceptada' per refill_request_id (O1 already is, for e5555555...).
select throws_ok(
  $$ insert into public.offers (user_id, refill_request_id, company_id, kind, status, tiempo_entrega_horas, costo_despacho, total)
     values ('e1111111-1111-1111-1111-111111111111', 'e5555555-5555-5555-5555-555555555555', 'eccccccc-cccc-cccc-cccc-cccccccccccc', 'reactiva', 'aceptada', 12, 1000, 9000) $$,
  '23505',
  null,
  'a second aceptada offer for the same refill_request_id is rejected by the partial unique index'
);

-- RLS scenarios — offers
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offers),
  1::bigint,
  'recipient A sees only their own offer (O1, reactive) via the direct user_id compare'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e2222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offers),
  1::bigint,
  'recipient B sees their proactive offer (O2, refill_request_id IS NULL)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e4444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offers),
  2::bigint,
  'provider Q sees both offers it sent (O1 reactive and O2 proactive)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e3333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offers),
  0::bigint,
  'unrelated user C sees no offers -- neither recipient nor provider policy matches'
);

-- RLS scenarios — offer_items (EXISTS against offers.user_id)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offer_items where offer_id = 'e8888888-8888-8888-8888-888888888888'),
  1::bigint,
  'recipient A reads their own offer''s (O1) items via the EXISTS-against-offers policy'
);

select is(
  (select count(*) from public.offer_items where offer_id = 'e9999999-9999-9999-9999-999999999999'),
  0::bigint,
  'recipient A cannot read O2''s items -- O2 belongs to recipient B, not A'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e4444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offer_items),
  0::bigint,
  'provider Q reads zero offer_items directly via RLS -- keyed on offers.user_id (recipient) only'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "e3333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);

select is(
  (select count(*) from public.offer_items),
  0::bigint,
  'unrelated user C reads zero offer_items'
);

reset role;

select * from finish();

rollback;
