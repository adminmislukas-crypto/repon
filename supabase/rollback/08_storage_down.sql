-- Rollback for supabase/migrations/20260803120800_08_storage.sql.
--
-- storage.objects/storage.buckets themselves are never dropped (owned by
-- supabase_storage_admin, shared with buckets any future change might
-- define) -- only what this migration added: the policies, the scoped
-- revoke, and the two bucket rows.
drop policy if exists "objects_select_product_images_public" on storage.objects;
drop policy if exists "objects_insert_product_images_owner" on storage.objects;
drop policy if exists "objects_update_product_images_owner" on storage.objects;
drop policy if exists "objects_select_catalog_uploads_owner" on storage.objects;
drop policy if exists "objects_insert_catalog_uploads_owner" on storage.objects;

grant delete on storage.objects to anon, authenticated;

-- Both storage.objects and storage.buckets carry a BEFORE DELETE FOR EACH
-- STATEMENT trigger (storage.protect_objects_delete /
-- storage.protect_buckets_delete -> storage.protect_delete()) that raises
-- 42501 on direct DELETE unless this session-level GUC is set -- verified
-- against the real local stack. Scoped to this script's session only.
set storage.allow_delete_query = 'true';

delete from storage.objects where bucket_id in ('product-images', 'provider-catalog-uploads');
delete from storage.buckets where id in ('product-images', 'provider-catalog-uploads');
