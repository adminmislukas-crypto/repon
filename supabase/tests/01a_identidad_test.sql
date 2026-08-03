-- pgTAP test for supabase/migrations/20260803120100_01a_identidad_core.sql.
--
-- Covers schema (tables/columns/FKs/indexes/RLS-enabled) plus the identidad
-- RLS scenarios from specs/db-schema-identidad/spec.md: public sees only
-- active companies, the owner sees their own pending company,
-- company_dispatch_zones inherits companies visibility, profiles is
-- owner-only SELECT, and a direct client UPDATE on profiles is rejected
-- because no UPDATE policy exists.
--
-- JWT-claim simulation (`request.jwt.claims` / `role = authenticated`) is
-- the standard Supabase pgTAP pattern; not verified end-to-end against a
-- running local stack (Docker daemon unavailable in this sandbox — same
-- caveat as tasks.md 0.3/1.4).
begin;

select plan(20);

-- ============================================================
-- Schema
-- ============================================================
select has_table('public', 'companies', 'companies table exists');
select has_table('public', 'company_dispatch_zones', 'company_dispatch_zones table exists');
select has_table('public', 'profiles', 'profiles table exists');

select col_type_is('public', 'companies', 'status', 'company_status', 'companies.status is company_status enum');
select col_is_unique('public', 'companies', array['rut'], 'companies.rut is unique');

select col_is_fk('public', 'company_dispatch_zones', 'company_id', 'company_dispatch_zones.company_id is a FK');
select col_is_unique('public', 'company_dispatch_zones', array['company_id', 'comuna'], 'company_dispatch_zones (company_id, comuna) is unique');

select col_is_fk('public', 'profiles', 'id', 'profiles.id is a FK to auth.users');
select col_is_fk('public', 'profiles', 'company_id', 'profiles.company_id is a FK');
select col_type_is('public', 'profiles', 'role', 'role', 'profiles.role is the role enum');

select has_index('public', 'companies', 'companies_status_idx', 'index on companies.status exists');
select has_index('public', 'profiles', 'profiles_company_id_idx', 'index on profiles.company_id exists');

select ok((select relrowsecurity from pg_class where oid = 'public.companies'::regclass), 'RLS enabled on companies');
select ok((select relrowsecurity from pg_class where oid = 'public.company_dispatch_zones'::regclass), 'RLS enabled on company_dispatch_zones');
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'RLS enabled on profiles');

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'owner-b@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'no-relation@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Activa SPA', '11.111.111-1', 'venta de alimentos', 'activo'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Pendiente SPA', '22.222.222-2', 'venta de alimentos', 'pendiente');

insert into public.profiles (id, role, nombre, email, company_id) values
  ('11111111-1111-1111-1111-111111111111', 'provider', 'Dueña B', 'owner-b@test.com', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('22222222-2222-2222-2222-222222222222', 'user', 'Sin relación', 'no-relation@test.com', null);

insert into public.company_dispatch_zones (company_id, comuna, region) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Providencia', 'Metropolitana');

-- ============================================================
-- RLS scenarios
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

select results_eq(
  $$ select status::text from public.companies order by status $$,
  $$ values ('activo') $$,
  'unrelated authenticated user sees only the active company'
);

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'unrelated authenticated user sees only their own profile row'
);

select throws_ok(
  $$ update public.profiles set status = 'suspendido' where id = '22222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'direct profile UPDATE is rejected: no UPDATE policy exists'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select results_eq(
  $$ select razon_social from public.companies order by razon_social $$,
  $$ values ('Activa SPA'), ('Pendiente SPA') $$,
  'owner sees the active company plus their own pending company'
);

select is(
  (select count(*) from public.company_dispatch_zones),
  1::bigint,
  'company_dispatch_zones inherits the owner''s visibility into their pending company'
);

reset role;

select * from finish();

rollback;
