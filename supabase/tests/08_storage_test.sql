-- pgTAP test for supabase/migrations/20260803120800_08_storage.sql.
-- Covers: bucket rows (public flag), the exact policy set on
-- storage.objects, cross-company path-prefix rejection on INSERT for both
-- buckets, public unauthenticated SELECT on product-images,
-- unauthenticated/cross-company SELECT denial on provider-catalog-uploads,
-- and the no-physical-DELETE guarantee for anon/authenticated/service_role
-- (D-6-style, grant + pre-existing Storage trigger both block it).
begin;

select plan(15);

-- ============================================================
-- Bucket rows
-- ============================================================
select is((select public from storage.buckets where id = 'product-images'), true, 'product-images bucket is public');
select is((select public from storage.buckets where id = 'provider-catalog-uploads'), false, 'provider-catalog-uploads bucket is private');

-- ============================================================
-- Policy set on storage.objects (exact match -- this migration is the only
-- one that ever adds policies to this shared table)
-- ============================================================
select ok((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), 'RLS enabled on storage.objects');

select policies_are(
  'storage', 'objects',
  array[
    'objects_select_product_images_public',
    'objects_insert_product_images_owner',
    'objects_update_product_images_owner',
    'objects_select_catalog_uploads_owner',
    'objects_insert_catalog_uploads_owner'
  ],
  'storage.objects has exactly the 5 policies this batch creates'
);

select policy_cmd_is('storage', 'objects', 'objects_update_product_images_owner', 'UPDATE', 'owner UPDATE policy exists on product-images');

-- ============================================================
-- Fixtures (as table owner, bypasses RLS)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('d1111111-1111-1111-1111-111111111111', 'owner-a-storage@test.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('d2222222-2222-2222-2222-222222222222', 'owner-b-storage@test.com', '{}', '{}', 'authenticated', 'authenticated');

insert into public.companies (id, razon_social, rut, giro, status) values
  ('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proveedor Storage A SPA', '55.555.555-5', 'venta de insumos', 'activo'),
  ('dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proveedor Storage B SPA', '66.666.666-6', 'venta de insumos', 'activo');

insert into public.profiles (id, role, nombre, email, company_id) values
  ('d1111111-1111-1111-1111-111111111111', 'provider', 'Dueño Storage A', 'owner-a-storage@test.com', 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('d2222222-2222-2222-2222-222222222222', 'provider', 'Dueño Storage B', 'owner-b-storage@test.com', 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into storage.objects (bucket_id, name) values
  ('product-images', 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/item-a.jpg'),
  ('product-images', 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/item-b.jpg'),
  ('provider-catalog-uploads', 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/carga-a.xlsx'),
  ('provider-catalog-uploads', 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/carga-b.xlsx');

-- ============================================================
-- product-images: public SELECT, incl. unauthenticated (Scenario "Public
-- app displays a product image without auth")
-- ============================================================
set local role anon;

select is(
  (select count(*) from storage.objects where bucket_id = 'product-images'),
  2::bigint,
  'anon (unauthenticated) sees both companies'' product-images -- public bucket'
);

-- provider-catalog-uploads: unauthenticated read denied (Scenario "Provider
-- cannot read another company's upload", extended to zero session).
select is(
  (select count(*) from storage.objects where bucket_id = 'provider-catalog-uploads'),
  0::bigint,
  'anon (unauthenticated) sees zero provider-catalog-uploads rows -- private bucket, no policy for anon'
);

reset role;

-- ============================================================
-- provider-catalog-uploads: owner-only read (Scenario "Provider cannot read
-- another company's upload")
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "d1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is(
  (select count(*) from storage.objects where bucket_id = 'provider-catalog-uploads'),
  1::bigint,
  'company A owner sees only their own provider-catalog-uploads row, not company B''s'
);

-- ============================================================
-- INSERT: owner path succeeds (both buckets)
-- ============================================================
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('product-images', 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/item-a2.jpg') $$,
  'company A owner uploads into their own product-images path -- succeeds'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('provider-catalog-uploads', 'daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/carga-a2.xlsx') $$,
  'company A owner uploads into their own provider-catalog-uploads path -- succeeds'
);

-- ============================================================
-- INSERT: cross-company path-prefix rejection (Scenario "A company cannot
-- write into another company's path", both buckets)
-- ============================================================
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('product-images', 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/hijack.jpg') $$,
  '42501',
  null,
  'company A owner cannot write into company B''s product-images path prefix'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('provider-catalog-uploads', 'dbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/hijack.xlsx') $$,
  '42501',
  null,
  'company A owner cannot write into company B''s provider-catalog-uploads path prefix'
);

reset role;

-- ============================================================
-- No physical DELETE for any role -- grant revoked for anon/authenticated
-- (section 6) plus the pre-existing storage.protect_objects_delete trigger
-- blocks it unconditionally, so even service_role (BYPASSRLS) is rejected.
-- ============================================================
set local role anon;
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'product-images' $$,
  '42501',
  null,
  'anon DELETE on storage.objects is rejected'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "d1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'product-images' $$,
  '42501',
  null,
  'authenticated DELETE on storage.objects is rejected, even on the caller''s own path'
);
reset role;

set local role service_role;
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'product-images' $$,
  '42501',
  null,
  'service_role DELETE on storage.objects is rejected -- BYPASSRLS does not bypass the protect_objects_delete trigger'
);
reset role;

select * from finish();

rollback;
