-- Rollback for supabase/migrations/20260803120500_05_ofertas.sql.
--
-- Drop offers from the Realtime publication first (not auto-removed by DROP
-- TABLE), then child-before-parent: offer_items before offers. Enums last.
alter publication supabase_realtime drop table public.offers;

drop table if exists public.offer_items;
drop table if exists public.offers;

drop type if exists public.offer_status;
drop type if exists public.offer_kind;
