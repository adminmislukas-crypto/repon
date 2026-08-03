-- supabase/seed.sql
--
-- Dev-local only (design.md D-5). Runs automatically on `supabase db reset`;
-- the Supabase CLI never runs this file against a remote/staging/prod
-- project. Creates a local Auth user + profile + self-granted super_admin
-- so a fresh `db reset` always leaves a usable admin for local development.
--
-- Production/staging bootstrap is a SEPARATE, manual, parametrized runbook:
-- see supabase/seed/00_bootstrap_super_admin.sql (design.md D-5, tasks.md
-- Phase 3). Do not reuse this file for anything beyond local dev -- it uses
-- a fixed, publicly-known password and a fixed UUID, both only acceptable
-- because this file never runs outside a disposable local stack.

do $$
declare
  v_admin_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  if not exists (select 1 from auth.users where id = v_admin_id) then
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      v_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'admin@local.dev', extensions.crypt('admin12345', extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}',
      now(), now()
    );
  end if;

  insert into public.profiles (id, role, status, nombre, email)
  values (v_admin_id, 'admin', 'activo', 'Local Admin', 'admin@local.dev')
  on conflict (id) do nothing;

  insert into public.admin_roles (profile_id, rol, granted_by)
  values (v_admin_id, 'super_admin', v_admin_id)
  on conflict (profile_id) do nothing;
end $$;
