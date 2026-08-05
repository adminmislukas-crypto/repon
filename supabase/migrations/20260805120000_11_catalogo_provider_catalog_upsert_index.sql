-- Batch 11 — catalogo_provider_catalog_upsert_index: gives
-- cargarCatalogoMasivo / cargarProductoCatalogo a real ON CONFLICT target
-- (D15/Q5b, backend-core-api-catalogo design.md D-C).
--
-- Two mutually-exclusive, mutually-exhaustive partial unique indexes: every
-- row falls into exactly one of the two (never both, never neither), so
-- ON CONFLICT always resolves to a single valid target and no unique
-- violation (23505) can ever escape the upsert as a raw driver error.
--
-- This is a genuinely new migration authored after the 01a-08 batch shipped
-- and archived (backend-supabase-migrations) — it does not reuse any of
-- that batch's pre-assigned 20260803120000-20260803120800 timestamp window,
-- nor batch 09/10's 20260804090000/20260804090500 grants window
-- (design.md D-3). It touches zero tables/RLS (provider_catalog is empty —
-- no existing writer in this repo — so CREATE UNIQUE INDEX cannot fail on
-- pre-existing duplicates and CONCURRENTLY is not needed), so only
-- section 4 of the full 8-section skeleton applies.

-- ============================================================
-- 4. Indexes
-- ============================================================
-- Sección 4 (Indexes) del layout estándar. Cero tablas, cero RLS: solo índices.
create unique index provider_catalog_company_catalog_product_uidx
  on public.provider_catalog (company_id, catalog_product_id)
  where catalog_product_id is not null;

create unique index provider_catalog_company_nombre_categoria_uidx
  on public.provider_catalog (company_id, lower(btrim(nombre)), lower(btrim(categoria)))
  where catalog_product_id is null;

comment on index public.provider_catalog_company_nombre_categoria_uidx is
  'Predicado complementario EXACTO del índice ..._catalog_product_uidx: toda fila cae en uno y solo uno, de modo que ON CONFLICT siempre tiene un único target válido y ninguna violación 23505 puede escaparse del upsert.';
