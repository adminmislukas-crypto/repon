-- pgTAP test for supabase/migrations/20260803120700_07_auditoria.sql.
-- Covers schema (entity_id has no FK, actor_profile_id does), grants
-- (zero client access; service_role insert/select only), the append-only
-- guarantee for every role incl. service_role (D-6 mechanism reused), and
-- the polymorphic-insert requirement (any entity_id uuid works, no
-- referential check).
begin;

select plan(10);

-- Schema
select has_table('public', 'audit_log', 'audit_log table exists');
select col_is_fk('public', 'audit_log', 'actor_profile_id', 'audit_log.actor_profile_id is a FK');

select is(
  (select count(*)::int
   from information_schema.key_column_usage kcu
   join information_schema.table_constraints tc
     on tc.constraint_name = kcu.constraint_name and tc.constraint_schema = kcu.constraint_schema
   where tc.table_schema = 'public' and tc.table_name = 'audit_log'
     and tc.constraint_type = 'FOREIGN KEY'
     and kcu.column_name = 'entity_id'),
  0,
  'audit_log.entity_id has no FK -- polymorphic by design'
);

select ok((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), 'RLS enabled on audit_log');

select table_privs_are('public', 'audit_log', 'anon', array[]::text[], 'anon has zero privileges on audit_log');
select table_privs_are('public', 'audit_log', 'authenticated', array[]::text[], 'authenticated has zero privileges on audit_log');

-- Fixtures (as table owner, bypasses RLS)
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values ('a1111111-1111-1111-1111-111111111111', 'admin-audit@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.profiles (id, role, nombre, email) values
  ('a1111111-1111-1111-1111-111111111111', 'admin', 'Admin Auditor', 'admin-audit@test.com');

-- Polymorphic insert: entity_id is a random uuid matching no real row of any
-- table -- succeeds because there is no FK to violate.
select lives_ok(
  $$ insert into public.audit_log (id, actor_profile_id, accion, entity_type, entity_id, cambios)
     values ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111',
             'aprobar_empresa', 'company', 'a9999999-9999-9999-9999-999999999999', '{"status": "activo"}'::jsonb) $$,
  'polymorphic insert succeeds -- entity_id has no FK, any uuid is accepted'
);

-- Direct client read denied
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "a1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select throws_ok(
  $$ select * from public.audit_log $$,
  '42501',
  null,
  'authenticated direct read of audit_log is rejected -- no SELECT grant exists'
);

reset role;

-- Append-only: UPDATE/DELETE rejected for service_role too (same mechanism
-- as order_items, D-6) -- service_role has BYPASSRLS but not the grant.
set local role service_role;

select throws_ok(
  $$ update public.audit_log set cambios = '{}'::jsonb where id = 'a2222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'service_role UPDATE on audit_log is rejected -- no UPDATE grant exists'
);

select throws_ok(
  $$ delete from public.audit_log where id = 'a2222222-2222-2222-2222-222222222222' $$,
  '42501',
  null,
  'service_role DELETE on audit_log is rejected -- no DELETE grant exists'
);

reset role;

select * from finish();

rollback;
