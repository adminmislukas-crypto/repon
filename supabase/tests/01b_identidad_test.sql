-- pgTAP test for supabase/migrations/20260803120110_01b_identidad_admin.sql.
--
-- Covers schema (table/view/FKs/unique) plus the two scenarios from
-- specs/db-schema-identidad/spec.md Requirement "admin_roles has no client
-- access; bootstrap self-grant is the sole FK exception": zero client
-- access to admin_roles (no policies, no grants for anon/authenticated),
-- and the bootstrap self-grant FK case (granted_by = profile_id is valid).
-- Also covers v_auth_orphans being service-role-only (design.md D-1,
-- specs/auth-provisioning testing table).
--
-- JWT-claim simulation (`request.jwt.claims` / `role = authenticated`) is
-- the standard Supabase pgTAP pattern; not verified end-to-end against a
-- running local stack (Docker daemon unavailable in this sandbox -- same
-- caveat as tasks.md 0.3/1.4/2.5).
begin;

select plan(14);

-- ============================================================
-- Schema
-- ============================================================
select has_table('public', 'admin_roles', 'admin_roles table exists');
select has_view('public', 'v_auth_orphans', 'v_auth_orphans view exists');

select col_is_fk('public', 'admin_roles', 'profile_id', 'admin_roles.profile_id is a FK');
select col_is_fk('public', 'admin_roles', 'granted_by', 'admin_roles.granted_by is a FK');
select col_is_unique('public', 'admin_roles', array['profile_id'], 'admin_roles.profile_id is unique (one sub-role per admin)');

select ok((select relrowsecurity from pg_class where oid = 'public.admin_roles'::regclass), 'RLS enabled on admin_roles');

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_roles'),
  0::bigint,
  'admin_roles has zero RLS policies -- RLS-enabled + no policies is deny-all'
);

-- ============================================================
-- Grants: zero client access on admin_roles, service-role-only on the view
-- ============================================================
select table_privs_are('public', 'admin_roles', 'anon', array[]::text[], 'anon has zero privileges on admin_roles');
select table_privs_are('public', 'admin_roles', 'authenticated', array[]::text[], 'authenticated has zero privileges on admin_roles');

select table_privs_are('public', 'v_auth_orphans', 'anon', array[]::text[], 'anon has zero privileges on v_auth_orphans');
select table_privs_are('public', 'v_auth_orphans', 'authenticated', array[]::text[], 'authenticated has zero privileges on v_auth_orphans');
-- Positive check only (not `table_privs_are` exact-set): a local Supabase
-- project grants `service_role` broad default privileges on `public` at
-- project-init time, independent of this migration's own explicit
-- `grant select ... to service_role` -- verified against a real local
-- stack (see tasks.md 3.6 note). Asserting an exact privilege set here
-- would fail on that pre-existing baseline, not on anything this file
-- controls.
select ok(
  has_table_privilege('service_role', 'public.v_auth_orphans', 'SELECT'),
  'service_role has SELECT privilege on v_auth_orphans'
);

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values ('33333333-3333-3333-3333-333333333333', 'bootstrap-admin@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.profiles (id, role, nombre, email) values
  ('33333333-3333-3333-3333-333333333333', 'admin', 'Bootstrap Admin', 'bootstrap-admin@test.com');

-- Bootstrap self-grant scenario (design.md D-5): granted_by = profile_id is
-- the sole legitimate self-reference, valid because the profile already
-- exists (db-schema-identidad Scenario "Bootstrap self-grant is valid").
select lives_ok(
  $$ insert into public.admin_roles (profile_id, rol, granted_by)
     values ('33333333-3333-3333-3333-333333333333', 'super_admin', '33333333-3333-3333-3333-333333333333') $$,
  'bootstrap self-grant (granted_by = profile_id) satisfies the FK because the profile already exists'
);

-- ============================================================
-- RLS scenario: zero client access is enforced at the grant level -- no
-- SELECT privilege at all, so a direct read raises permission denied
-- rather than returning an empty result set.
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);

select throws_ok(
  $$ select * from public.admin_roles $$,
  '42501',
  null,
  'authenticated direct read of admin_roles is rejected -- no SELECT grant exists'
);

reset role;

select * from finish();

rollback;
