-- Rollback for supabase/migrations/00000000000000_enable_pgtap.sql.
--
-- Safe at any point: pgTAP is test-only tooling, no domain data or domain
-- migration depends on it. Only consequence of dropping it is that
-- `supabase test db` stops working until it's re-enabled.
drop extension if exists pgtap;
