-- Rollback for supabase/migrations/20260803120300_03_catalogo.sql.
--
-- Drop order: child-before-parent on the FK graph -- provider_catalog
-- (references catalog_products) first, then catalog_products. Policies drop
-- implicitly with their table (DROP TABLE cascades to its own policies --
-- no CASCADE keyword needed for that). Enum drops last, reverse of creation
-- order.
drop table if exists public.provider_catalog;
drop table if exists public.catalog_products;

drop type if exists public.catalog_product_status;
