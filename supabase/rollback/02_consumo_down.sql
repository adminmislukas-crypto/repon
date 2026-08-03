-- Rollback for supabase/migrations/20260803120200_02_consumo.sql.
--
-- Drop order: child-before-parent on the FK graph -- consumption_logs
-- (references user_consumption) first, then user_consumption (references
-- pets), then pets. Policies drop implicitly with their table (DROP TABLE
-- cascades to its own policies -- no CASCADE keyword needed for that).
-- Enums drop last, reverse of creation order.
drop table if exists public.consumption_logs;
drop table if exists public.user_consumption;
drop table if exists public.pets;

drop type if exists public.consumption_kind;
drop type if exists public.owner_type;
