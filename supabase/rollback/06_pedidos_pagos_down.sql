-- Rollback for supabase/migrations/20260803120600_06_pedidos_pagos.sql.
-- Child-before-parent: payments, order_items, orders. Enums last.
drop table if exists public.payments;
drop table if exists public.order_items;
drop table if exists public.orders;

drop type if exists public.payment_status;
drop type if exists public.order_status;
