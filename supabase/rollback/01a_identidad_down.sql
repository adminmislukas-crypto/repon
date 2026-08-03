-- Rollback for supabase/migrations/20260803120100_01a_identidad_core.sql.
--
-- Drop order: policies drop implicitly with their table (DROP TABLE cascades
-- to its own policies — no CASCADE keyword needed for that). Tables drop
-- child-before-parent on the FK graph: company_dispatch_zones and profiles
-- both reference companies, so they go first (no FK exists between the two,
-- either order is safe). Enums drop last, reverse of creation order.
--
-- Known open risk (out of Phase 2 scope, not resolved here): whether
-- public.current_company_id() (batch 00) holds a real catalog dependency on
-- public.profiles is unverified against a live Postgres instance — same
-- Docker-unavailable caveat as tasks.md 0.3/1.4. If it does, `drop table
-- public.profiles` below fails without CASCADE. Do not add CASCADE
-- speculatively here: that would silently drop the shared batch-00 function
-- too. If this rollback fails in a real environment, drop/recreate
-- current_company_id() around it manually rather than changing this file.
drop table if exists public.company_dispatch_zones;
drop table if exists public.profiles;
drop table if exists public.companies;

drop type if exists public.profile_status;
drop type if exists public.role;
drop type if exists public.company_status;
