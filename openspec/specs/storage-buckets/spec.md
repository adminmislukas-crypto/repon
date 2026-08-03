# storage-buckets Specification

## Purpose

Supabase Storage buckets for product images and provider bulk-upload files, with `storage.objects` policies mirroring the `db-access-control` conventions. Excludes payment receipts and delivery-proof photos (Q3 — deferred, no domain use case yet).

## Requirements

### Requirement: product-images bucket is public-read, owner-write

A `product-images` bucket MUST exist, marked public for read (no RLS check needed for GET — served via public URL), with `storage.objects` INSERT/UPDATE restricted to the owning company writing under its own path prefix `{company_id}/...`.

#### Scenario: Public app displays a product image without auth

- GIVEN an image at `product-images/{company_id}/item-123.jpg`
- WHEN the app requests the public URL
- THEN the image loads without an authenticated session

#### Scenario: A company cannot write into another company's path

- GIVEN provider profile P belongs to company C1
- WHEN P attempts to upload to `product-images/{C2_id}/...`
- THEN the `storage.objects` INSERT policy rejects it because `(storage.foldername(name))[1] != C1.id`

### Requirement: provider-catalog-uploads bucket is private, owner-only

A `provider-catalog-uploads` bucket MUST exist, private (no public flag), with `storage.objects` SELECT and INSERT restricted to the owning company's own path prefix. No client `UPDATE`/`DELETE` policy — re-uploads create new objects. This bucket only stores the raw file; the parsing pipeline is out of scope for this change.

#### Scenario: Provider uploads their own bulk file

- GIVEN provider profile P (company C) uploads `provider-catalog-uploads/{C.id}/carga.xlsx`
- WHEN the INSERT policy checks `(storage.foldername(name))[1] = C.id`
- THEN the upload succeeds

#### Scenario: Provider cannot read another company's upload

- GIVEN a file at `provider-catalog-uploads/{C2.id}/carga.xlsx`
- WHEN a profile of C1 attempts to read it
- THEN the SELECT policy rejects it

### Requirement: No physical delete of storage objects (matches table convention)

Neither bucket MUST grant client-side `DELETE` on `storage.objects`, consistent with the no-physical-delete principle applied to table rows.

#### Scenario: Client cannot delete an uploaded file

- GIVEN a file uploaded by provider P
- WHEN P attempts to delete it via the client SDK
- THEN the `storage.objects` policy set has no DELETE grant and the operation fails

### Requirement: Comprobantes are explicitly out of scope

No bucket for delivery-proof photos or payment receipts is created in this change (Q3) — payment receipts are the gateway's system of record; delivery-proof photos have no domain use case yet. A future `orders.comprobante_url` nullable column and its bucket are a follow-up owned by `pedidos-pagos/SPEC.md`.

#### Scenario: No comprobantes bucket exists after this change

- GIVEN the completed migration set
- WHEN listing Storage buckets
- THEN only `product-images` and `provider-catalog-uploads` exist
