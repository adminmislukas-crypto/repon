-- Rollback for supabase/migrations/20260803120110_01b_identidad_admin.sql.
--
-- Drop order: view before table, mirroring creation order reversed. The
-- view depends on auth.users + profiles (neither owned by this batch), so
-- there is no dependency ordering hazard either way, but reversing creation
-- order keeps this file symmetric with 01a's rollback convention.
-- admin_roles has zero RLS policies to drop explicitly (section 7 of the
-- migration created none) -- DROP TABLE removes the RLS setting along with
-- the table itself. Enum drops last.
drop view if exists public.v_auth_orphans;
drop table if exists public.admin_roles;

drop type if exists public.admin_role;
