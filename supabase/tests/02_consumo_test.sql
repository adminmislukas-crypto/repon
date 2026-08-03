-- pgTAP test for supabase/migrations/20260803120200_02_consumo.sql.
--
-- Covers schema (tables/columns/FKs/indexes/RLS-enabled) plus the
-- specs/db-schema-consumo/spec.md scenarios: owner-only SELECT on
-- pets/user_consumption, the EXISTS-against-parent pattern on
-- consumption_logs (both the positive "owner reads own history" and the
-- negative "other user cannot read" scenarios), and an index-usage check for
-- the adherence query shape.
--
-- JWT-claim simulation (`request.jwt.claims` / `role = authenticated`) is
-- the standard Supabase pgTAP pattern; not verified end-to-end against a
-- running local stack (Docker daemon unavailable in this sandbox -- same
-- caveat as tasks.md 0.3/1.4/2.5/3.6), except where noted below.
--
-- Index-usage assertion note: with pgTAP fixture-scale data (a handful of
-- rows), the planner will pick a Seq Scan over an Index Scan regardless of
-- whether the index exists, because a seq scan is genuinely cheaper at that
-- cardinality. `set local enable_seqscan = off` forces the planner to prefer
-- an index path when one exists for the query shape, which is what this
-- test actually verifies: that the composite index IS a valid, chosen plan
-- for the adherence query -- not that Postgres would pick it unforced at
-- production scale.
begin;

select plan(18);

-- ============================================================
-- Schema
-- ============================================================
select has_table('public', 'pets', 'pets table exists');
select has_table('public', 'user_consumption', 'user_consumption table exists');
select has_table('public', 'consumption_logs', 'consumption_logs table exists');

select col_is_fk('public', 'pets', 'user_id', 'pets.user_id is a FK');
select col_is_fk('public', 'user_consumption', 'user_id', 'user_consumption.user_id is a FK');
select col_is_fk('public', 'user_consumption', 'pet_id', 'user_consumption.pet_id is a FK');
select col_is_fk('public', 'consumption_logs', 'consumption_id', 'consumption_logs.consumption_id is a FK');

select col_type_is('public', 'user_consumption', 'owner_type', 'owner_type', 'user_consumption.owner_type is the owner_type enum');
select col_type_is('public', 'user_consumption', 'kind', 'consumption_kind', 'user_consumption.kind is the consumption_kind enum');

select has_index('public', 'consumption_logs', 'consumption_logs_consumption_id_tomado_at_idx', 'composite adherence index exists on consumption_logs');

select ok((select relrowsecurity from pg_class where oid = 'public.pets'::regclass), 'RLS enabled on pets');
select ok((select relrowsecurity from pg_class where oid = 'public.user_consumption'::regclass), 'RLS enabled on user_consumption');
select ok((select relrowsecurity from pg_class where oid = 'public.consumption_logs'::regclass), 'RLS enabled on consumption_logs');

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('44444444-4444-4444-4444-444444444444', 'owner-a@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('55555555-5555-5555-5555-555555555555', 'owner-b@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.profiles (id, role, nombre, email) values
  ('44444444-4444-4444-4444-444444444444', 'user', 'Dueña A', 'owner-a@test.com'),
  ('55555555-5555-5555-5555-555555555555', 'user', 'Dueño B', 'owner-b@test.com');

insert into public.pets (id, user_id, nombre, especie) values
  ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 'Firulais', 'perro'),
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'Michi', 'gato');

insert into public.user_consumption
  (id, user_id, owner_type, pet_id, kind, nombre, dosis_por_toma, frecuencia_dias, horarios, stock_actual, auto_crear_refill)
values
  ('88888888-8888-8888-8888-888888888888', '44444444-4444-4444-4444-444444444444', 'self', null, 'medicamento', 'Losartan', 1, 1, array['08:00'], 30, false),
  ('99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 'pet', '77777777-7777-7777-7777-777777777777', 'alimento', 'Croquetas Michi', 1, 1, array['09:00'], 10, true);

insert into public.consumption_logs (id, consumption_id, tomado_at, cantidad) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '88888888-8888-8888-8888-888888888888', now() - interval '1 day', 1),
  ('aaaaaaaa-2222-2222-2222-222222222222', '88888888-8888-8888-8888-888888888888', now(), 1);

-- ============================================================
-- RLS scenarios
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);

select results_eq(
  $$ select nombre from public.pets order by nombre $$,
  $$ values ('Firulais') $$,
  'owner A sees only their own pet'
);

select is(
  (select count(*) from public.user_consumption),
  1::bigint,
  'owner A sees only their own user_consumption row'
);

select is(
  (select count(*) from public.consumption_logs),
  2::bigint,
  'owner A reads both of their own dose-history rows via the EXISTS policy'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}', true);

select is(
  (select count(*) from public.consumption_logs),
  0::bigint,
  'owner B cannot read owner A''s dose history -- EXISTS policy against the parent finds no matching user_consumption row'
);

reset role;

-- ============================================================
-- Index-usage assertion for the adherence query pattern
-- (db-schema-consumo Requirement "Adherence index supports the daily cron
-- without full scans")
-- ============================================================
-- EXPLAIN is a top-level command, not composable inside a plain SQL SELECT,
-- so it needs a small plpgsql wrapper to capture its output as text.
create or replace function pg_temp.explain_text(query_text text)
returns text
language plpgsql
as $wrap$
declare
  plan_line text;
  result text := '';
begin
  for plan_line in execute 'explain ' || query_text loop
    result := result || plan_line || E'\n';
  end loop;
  return result;
end;
$wrap$;

set local enable_seqscan = off;

select ok(
  pg_temp.explain_text($q$
    select tomado_at, cantidad
    from public.consumption_logs
    where consumption_id = '88888888-8888-8888-8888-888888888888'
    order by tomado_at desc
    limit 7
  $q$) ilike '%consumption_logs_consumption_id_tomado_at_idx%',
  'adherence query plan (WHERE consumption_id = ... ORDER BY tomado_at DESC LIMIT 7) can use the composite index'
);

reset enable_seqscan;

select * from finish();

rollback;
