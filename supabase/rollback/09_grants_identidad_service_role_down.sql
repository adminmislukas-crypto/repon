-- Rollback for supabase/migrations/20260804090000_09_grants_identidad_service_role.sql.
--
-- Revokes exactly what the migration granted, same order. Restores the
-- (buggy) pre-fix state where service_role has no explicit privilege on
-- these four tables -- only use this if the fix itself needs to be undone,
-- not as a template for future grants work.
revoke select, insert, update on public.companies from service_role;
revoke select, insert, update on public.company_dispatch_zones from service_role;
revoke select, insert, update on public.profiles from service_role;
revoke select, insert, update on public.admin_roles from service_role;
