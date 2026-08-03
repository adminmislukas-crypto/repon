-- Rollback for supabase/migrations/20260803120400_04_refill_matching.sql.
--
-- Drop order: child-before-parent on the FK graph -- refill_items
-- (references refill_requests) first, then refill_requests. Policies drop
-- implicitly with their table (DROP TABLE cascades to its own policies --
-- no CASCADE keyword needed for that). Enums drop last, reverse of creation
-- order.
drop table if exists public.refill_items;
drop table if exists public.refill_requests;

drop type if exists public.refill_estado;
drop type if exists public.refill_urgencia;
