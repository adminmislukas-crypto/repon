-- Rollback for
-- supabase/migrations/20260804090500_10_grants_domain_tables_service_role.sql.
--
-- Revokes exactly what the migration granted, same order. Restores the
-- (buggy) pre-fix state where service_role has no explicit privilege on
-- these 12 tables -- only use this if the fix itself needs to be undone,
-- not as a template for future grants work.
revoke select, insert, update on public.pets from service_role;
revoke select, insert, update on public.user_consumption from service_role;
revoke select, insert, update on public.consumption_logs from service_role;
revoke select, insert, update on public.catalog_products from service_role;
revoke select, insert, update on public.provider_catalog from service_role;
revoke select, insert, update on public.refill_requests from service_role;
revoke select, insert, update on public.refill_items from service_role;
revoke select, insert, update on public.offers from service_role;
revoke select, insert, update on public.offer_items from service_role;
revoke select, insert, update on public.orders from service_role;
revoke select, insert, update on public.payments from service_role;
revoke select, insert on public.order_items from service_role;
