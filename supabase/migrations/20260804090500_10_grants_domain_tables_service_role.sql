-- Batch 10 — grants_domain_tables_service_role: fix-forward grant for
-- service_role on the remaining 12 domain tables (lotes 02-06):
-- catalog_products, consumption_logs, offer_items, offers, order_items,
-- orders, payments, pets, provider_catalog, refill_items, refill_requests,
-- user_consumption.
--
-- Same bug, broader scope, as 20260804090000_09_grants_identidad_service_role.sql
-- -- see that migration's header for the full BYPASSRLS-is-not-a-GRANT
-- explanation, not repeated here. A follow-up audit against a real local
-- Postgres instance (the same `information_schema.role_table_grants` query
-- used to discover the 01a/01b bug) found the identical root cause in every
-- other domain migration: 02_consumo.sql through 06_pedidos_pagos.sql each
-- only ever wrote `grant select ... to authenticated` (direct client reads)
-- and `revoke all ... from anon, authenticated`, but never explicitly
-- granted `service_role` anything on their own tables -- relying on the same
-- incorrect BYPASSRLS assumption 01b's comment made. Only
-- 20260803120700_07_auditoria.sql got this right from the start
-- (`grant insert, select on public.audit_log to service_role`).
--
-- The fix: `grant select, insert, update on <tabla> to service_role` for the
-- 11 standard tables below -- no DELETE anywhere, same "no physical delete,
-- only status/estado" rule as lote 09 and the rest of this schema.
--
-- order_items is the one exception: 06_pedidos_pagos.sql already runs
-- `revoke update, delete on public.order_items from anon, authenticated,
-- service_role` to enforce the D-6 immutable-snapshot guarantee (core-api
-- writes it once at order-creation time and never touches it again, not
-- even via service-role). Granting `update` here would silently undo that
-- guarantee, so order_items gets `select, insert` only.
--
-- Like lote 09, this is a fix-forward migration authored after the 01a-08
-- batch shipped and archived (backend-supabase-migrations) -- it does not
-- reuse any of that batch's pre-assigned 20260803120000-20260803120800
-- timestamp window (design.md D-3), and it touches zero schema (no new
-- tables/enums/RLS), so only section 6 applies.

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
-- Standard tables: select, insert, update -- no DELETE anywhere in this
-- schema.
grant select, insert, update on public.pets to service_role;
grant select, insert, update on public.user_consumption to service_role;
grant select, insert, update on public.consumption_logs to service_role;
grant select, insert, update on public.catalog_products to service_role;
grant select, insert, update on public.provider_catalog to service_role;
grant select, insert, update on public.refill_requests to service_role;
grant select, insert, update on public.refill_items to service_role;
grant select, insert, update on public.offers to service_role;
grant select, insert, update on public.offer_items to service_role;
grant select, insert, update on public.orders to service_role;
grant select, insert, update on public.payments to service_role;

-- order_items: select, insert only -- NEVER update (D-6 immutable snapshot,
-- 06_pedidos_pagos.sql already revokes update/delete from service_role and
-- this migration must not undo that).
grant select, insert on public.order_items to service_role;
