-- supabase/seed/00_bootstrap_super_admin.sql
--
-- Staging/production admin bootstrap (design.md D-5, Q5). Manual,
-- parametrized, NEVER automatic -- the Supabase CLI does not run this file
-- on its own. Run it exactly as documented below.
--
-- ============================================================
-- Runbook (design.md D-5)
-- ============================================================
-- 1. Supabase Dashboard -> Authentication -> Users -> Add user. Strong
--    password, Auto Confirm User = ON. Copy the generated uid. Never via a
--    public endpoint -- there is no admin self-registration and none will
--    be built (specs/auth-provisioning Requirement "Admin bootstrap is a
--    manual, documented runbook").
-- 2. Export SUPABASE_DB_URL in the operator's shell. The service-role key
--    is never committed, never pasted into a ticket.
-- 3. Run this script with psql, passing the three variables (note the
--    embedded quotes -- the shell variable carries them, this script
--    references them unquoted as :admin_uid / :admin_email / :admin_nombre):
--
--      psql "$SUPABASE_DB_URL" \
--        -v admin_uid="'<uid-del-paso-1>'" \
--        -v admin_email="'admin@repon.cl'" \
--        -v admin_nombre="'Nombre Apellido'" \
--        -f supabase/seed/00_bootstrap_super_admin.sql
--
-- 4. This script is idempotent and self-defensive: it inserts nothing at
--    all (both statements below) if a super_admin already exists anywhere
--    in the system. This is a ONE-TIME bootstrap, not a re-run-safe admin
--    creator for every environment.
-- 5. Verify: select count(*) from public.admin_roles where rol =
--    'super_admin';  -> must return exactly 1. (Also printed automatically
--    at the end of this script.)
-- 6. Rotate the password from the dashboard after first login. Record the
--    operator and date in the ops runbook.
--
-- ============================================================
-- Bootstrap signature (design.md D-5)
-- ============================================================
-- admin_roles.granted_by = admin_roles.profile_id is the sole legitimate
-- self-grant in the system (specs/db-schema-identidad Scenario "Bootstrap
-- self-grant is valid"; documented on the column itself via `comment on
-- column` in the 01b migration). Any other row with that shape is an
-- auditable anomaly, not a pattern to repeat.

insert into public.profiles (id, role, status, nombre, email)
select :admin_uid, 'admin', 'activo', :admin_nombre, :admin_email
where not exists (
  select 1 from public.admin_roles where rol = 'super_admin'
)
on conflict (id) do nothing;

insert into public.admin_roles (profile_id, rol, granted_by)
select :admin_uid, 'super_admin', :admin_uid
where not exists (
  select 1 from public.admin_roles where rol = 'super_admin'
)
on conflict (profile_id) do nothing;

-- ============================================================
-- audit_log row (design.md D-5) -- COMMENTED OUT ON PURPOSE
--
-- public.audit_log does not exist yet: it ships in batch 07 (tasks.md
-- Phase 9, spec db-schema-auditoria). Referencing it here today would break
-- this script against every environment before batch 07 lands. Uncomment
-- once batch 07 is merged. Columns per specs/db-schema-auditoria:
-- id (PK), actor_profile_id, accion, entity_type, entity_id, cambios
-- (jsonb NOT NULL), motivo, created_at.
-- ============================================================
-- insert into public.audit_log (actor_profile_id, accion, entity_type, entity_id, cambios, motivo)
-- values (
--   :admin_uid,
--   'bootstrap_super_admin',
--   'admin_roles',
--   :admin_uid,
--   jsonb_build_object('rol', 'super_admin', 'granted_by', :admin_uid),
--   'bootstrap manual fuera de banda'
-- );

-- ============================================================
-- Verification (runbook step 5) -- confirm manually too, this is just a
-- convenience echo.
-- ============================================================
select count(*) as super_admin_count
from public.admin_roles
where rol = 'super_admin';
