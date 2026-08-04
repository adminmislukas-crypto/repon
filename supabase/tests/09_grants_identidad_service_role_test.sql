-- pgTAP test for
-- supabase/migrations/20260804090000_09_grants_identidad_service_role.sql.
--
-- Covers the actual bug: `service_role` previously had zero grants on
-- companies/company_dispatch_zones/profiles/admin_roles (01a/01b never
-- granted them, wrongly assuming BYPASSRLS made a grant unnecessary --
-- see this migration's header comment). Asserts `service_role` can now
-- SELECT/INSERT/UPDATE all four tables via direct DML (not
-- `table_privs_are`: a local Supabase project grants `service_role` broad
-- default privileges on `public` at project-init time independent of this
-- migration, so asserting an exact privilege set would conflate that
-- pre-existing baseline with what this migration actually controls --
-- same reasoning as supabase/tests/01b_identidad_test.sql's note on
-- v_auth_orphans). Also asserts DELETE is still rejected for all four --
-- no DELETE grant should ever exist (no physical delete, only status).
begin;

select plan(16);

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values ('c4444444-4444-4444-4444-444444444444', 'grants-fix@test.com', '{}', '{}', 'authenticated', 'authenticated');

-- ============================================================
-- companies: service_role can SELECT/INSERT/UPDATE, cannot DELETE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.companies (id, razon_social, rut, giro)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Grants Fix SPA', '99.999.999-9', 'testing') $$,
  'service_role INSERT on companies succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.companies where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'service_role SELECT on companies succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.companies set giro = 'testing actualizado' where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'service_role UPDATE on companies succeeds -- grant exists (fix)'
);

select throws_ok(
  $$ delete from public.companies where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  '42501',
  null,
  'service_role DELETE on companies is rejected -- no DELETE grant exists (no physical delete, only status)'
);

reset role;

-- ============================================================
-- company_dispatch_zones: same root cause, same fix (D-3 batch scope)
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.company_dispatch_zones (company_id, comuna, region)
     values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Ñuñoa', 'Metropolitana') $$,
  'service_role INSERT on company_dispatch_zones succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.company_dispatch_zones where company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'service_role SELECT on company_dispatch_zones succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.company_dispatch_zones set region = 'Metropolitana actualizada' where company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'service_role UPDATE on company_dispatch_zones succeeds -- grant exists (fix)'
);

select throws_ok(
  $$ delete from public.company_dispatch_zones where company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  '42501',
  null,
  'service_role DELETE on company_dispatch_zones is rejected -- no DELETE grant exists'
);

reset role;

-- ============================================================
-- profiles: service_role can SELECT/INSERT/UPDATE, cannot DELETE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.profiles (id, role, nombre, email)
     values ('c4444444-4444-4444-4444-444444444444', 'admin', 'Grants Fix', 'grants-fix@test.com') $$,
  'service_role INSERT on profiles succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.profiles where id = 'c4444444-4444-4444-4444-444444444444' $$,
  'service_role SELECT on profiles succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.profiles set nombre = 'Grants Fix Actualizado' where id = 'c4444444-4444-4444-4444-444444444444' $$,
  'service_role UPDATE on profiles succeeds -- grant exists (fix)'
);

select throws_ok(
  $$ delete from public.profiles where id = 'c4444444-4444-4444-4444-444444444444' $$,
  '42501',
  null,
  'service_role DELETE on profiles is rejected -- no DELETE grant exists (design.md D-1: only auth-compensation deletes auth.users, never profiles directly)'
);

reset role;

-- ============================================================
-- admin_roles: service_role can SELECT/INSERT/UPDATE, cannot DELETE
-- ============================================================
set local role service_role;

select lives_ok(
  $$ insert into public.admin_roles (profile_id, rol, granted_by)
     values ('c4444444-4444-4444-4444-444444444444', 'soporte', 'c4444444-4444-4444-4444-444444444444') $$,
  'service_role INSERT on admin_roles succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ select 1 from public.admin_roles where profile_id = 'c4444444-4444-4444-4444-444444444444' $$,
  'service_role SELECT on admin_roles succeeds -- grant exists (fix)'
);

select lives_ok(
  $$ update public.admin_roles set rol = 'finanzas' where profile_id = 'c4444444-4444-4444-4444-444444444444' $$,
  'service_role UPDATE on admin_roles succeeds -- grant exists (fix)'
);

select throws_ok(
  $$ delete from public.admin_roles where profile_id = 'c4444444-4444-4444-4444-444444444444' $$,
  '42501',
  null,
  'service_role DELETE on admin_roles is rejected -- no DELETE grant exists'
);

reset role;

select * from finish();

rollback;
