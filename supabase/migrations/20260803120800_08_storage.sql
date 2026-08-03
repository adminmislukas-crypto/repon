-- Batch 08 — storage: buckets for product images and provider catalog bulk
-- uploads (storage-buckets spec). "Comprobantes" (payment receipts /
-- delivery-proof photos) are explicitly out of scope (Q3, proposal.md "Out
-- of Scope") -- no bucket for them exists in this batch.
--
-- storage.buckets/storage.objects are not created here -- owned by
-- supabase_storage_admin, bootstrapped by the Storage service before user
-- migrations run (config.toml [storage]). This file only inserts bucket
-- rows and adds storage.objects policies, so it doesn't fill the fixed
-- 8-section structure 1:1 -- sections that don't apply to a shared,
-- pre-existing table are omitted, same adaptation batch 00 used.
--
-- Verified against the real local stack (2026-08-03): storage.objects
-- already has RLS enabled (zero policies) and a BEFORE DELETE FOR EACH
-- STATEMENT trigger (`storage.protect_objects_delete`) that raises 42501
-- for direct DELETE regardless of role/grants unless
-- `storage.allow_delete_query` is set -- this alone blocks physical delete
-- for every role incl. service_role/postgres (both have BYPASSRLS). The
-- explicit `revoke delete` below is redundant with that trigger but kept
-- for this change's own grant-based convention (audit_log/order_items,
-- D-6) and so the guarantee doesn't depend on an internal Storage
-- implementation detail we don't own.

-- ============================================================
-- 2. "Tables": bucket rows (storage.buckets is pre-existing, not created)
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('provider-catalog-uploads', 'provider-catalog-uploads', false)
on conflict (id) do nothing;

-- ============================================================
-- 6. Grants: scoped revoke on the shared storage.objects table
-- ============================================================
-- storage.objects is shared across every future bucket, not owned by this
-- migration set -- a full "revoke all -> grant narrow" (the pattern every
-- domain table in this change uses) would risk breaking buckets defined by
-- later changes. Scoped instead: only DELETE is revoked from the two
-- client roles (storage-buckets Requirement "No physical delete of storage
-- objects"); SELECT/INSERT/UPDATE stay on Supabase Storage's own default
-- grants, gated per-bucket by the RLS policies below.
revoke delete on storage.objects from anon, authenticated;

-- ============================================================
-- 7. RLS: políticas
-- ============================================================
-- No `alter table ... enable row level security` here: storage.objects is
-- owned by supabase_storage_admin, RLS ships already enabled by the
-- Storage service (verified against the real local stack), and the
-- migration role (postgres) lacks ALTER privilege on a table it doesn't
-- own -- unlike CREATE POLICY/REVOKE/GRANT, which the Storage service's own
-- bootstrap already permits postgres to run on this table.

-- product-images: public-read (storage-buckets Requirement "product-images
-- bucket is public-read, owner-write"). The bucket's `public = true` flag
-- already serves GET without auth at the Storage API's /object/public
-- route; this policy additionally covers the Postgres-RLS-level SELECT
-- (pgTAP queries storage.objects directly, not through the HTTP API).
-- Role combination (anon + authenticated) is a deliberate deviation from
-- this change's usual authenticated-only posture (Q6) -- storage-buckets
-- explicitly requires unauthenticated read for the public marketplace.
create policy "objects_select_product_images_public"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'product-images');

-- Owner-path-prefix INSERT/UPDATE on product-images: convention
-- `{company_id}/...`, first path segment must equal the caller's own
-- profiles.company_id. Literal EXISTS against profiles, same pattern every
-- other lote in this change uses instead of current_company_id() (lotes
-- 01a/03/05) -- consistency over the SECURITY DEFINER helper.
create policy "objects_insert_product_images_owner"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.company_id = ((storage.foldername(name))[1])::uuid
    )
  );

create policy "objects_update_product_images_owner"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.company_id = ((storage.foldername(name))[1])::uuid
    )
  )
  with check (
    bucket_id = 'product-images'
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.company_id = ((storage.foldername(name))[1])::uuid
    )
  );

-- provider-catalog-uploads: private, owner-only SELECT + INSERT. No UPDATE
-- policy on purpose (storage-buckets Requirement "provider-catalog-uploads
-- bucket is private, owner-only": "No client UPDATE/DELETE policy --
-- re-uploads create new objects").
create policy "objects_select_catalog_uploads_owner"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'provider-catalog-uploads'
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.company_id = ((storage.foldername(name))[1])::uuid
    )
  );

create policy "objects_insert_catalog_uploads_owner"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'provider-catalog-uploads'
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.company_id = ((storage.foldername(name))[1])::uuid
    )
  );

-- No DELETE policy on either bucket -- combined with the `revoke delete`
-- above and the pre-existing protect_objects_delete trigger, DELETE fails
-- with 42501 for every role, not just the client ones (storage-buckets
-- Requirement "No physical delete of storage objects", same no-physical-
-- delete convention as every table in this change).
