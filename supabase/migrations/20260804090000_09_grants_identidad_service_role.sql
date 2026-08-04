-- Batch 09 — grants_identidad_service_role: fix-forward grant for
-- service_role on companies, company_dispatch_zones, profiles, admin_roles
-- (lotes 01a/01b).
--
-- Bug: 20260803120100_01a_identidad_core.sql and
-- 20260803120110_01b_identidad_admin.sql never granted `service_role` any
-- privilege on these four tables. 01b's section 6 comment claimed this was
-- fine because "service_role hace bypass de RLS (BYPASSRLS) y no necesita
-- ningún grant explícito sobre esta tabla" -- that claim is factually wrong.
-- BYPASSRLS only skips row-security *policies*; it has no effect on
-- standard object-level GRANT/REVOKE table privileges, which is a
-- completely separate Postgres mechanism. Verified empirically against a
-- real local Postgres instance (discovered while wiring up
-- backend-core-api-foundation PR 4's database connection, which runs
-- `SET ROLE service_role` after connecting as `authenticator` -- the same
-- way PostgREST itself connects): connecting as `service_role` and
-- attempting SELECT/UPDATE against `companies` returned
-- "permission denied for table companies" via
-- information_schema.role_table_grants + direct DML.
--
-- core-api needs real read/write access to these four tables to do its
-- job (aprobarEmpresa, provisionar perfiles, gestionar admin_roles).
-- 20260803120700_07_auditoria.sql already got this right --
-- `grant insert, select on public.audit_log to service_role` alongside its
-- own `revoke` -- this migration applies the same correction to the four
-- tables that 01a/01b missed.
--
-- No DELETE anywhere below -- this schema has a "no physical delete, only
-- status" rule enforced throughout (companies.status, profiles.status; see
-- supabase/SPEC.md "Nota: ninguna tabla admite DELETE desde el cliente.
-- Todas las bajas son un UPDATE de status."). service_role gets exactly the
-- write surface core-api needs (select/insert/update), nothing more.
--
-- This is a genuinely new migration authored after the 01a-08 batch shipped
-- and archived (backend-supabase-migrations) -- it does not reuse any of
-- that batch's pre-assigned 20260803120000-20260803120800 timestamp window
-- (design.md D-3), and it does not touch schema (no new tables/enums/RLS),
-- so it does not follow the full 8-section skeleton -- only section 6
-- applies.

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
grant select, insert, update on public.companies to service_role;
grant select, insert, update on public.company_dispatch_zones to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert, update on public.admin_roles to service_role;
