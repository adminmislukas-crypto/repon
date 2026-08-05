-- Batch 12 — catalogo_hidden_companies: the visibility deny-list projection
-- catalogo owns (D9/Q1, backend-core-api-catalogo design.md D-A).
--
-- Dedicated table, not a column on provider_catalog: O(1) write per event
-- regardless of catalog size, atomic effect (never partially hidden), no
-- backfill (empty table = nobody hidden, absent row = company visible),
-- and zero collision risk with cargarCatalogoMasivo's upsert DO UPDATE SET
-- (which never touches this table). See design.md D-A for the full
-- rationale table.
--
-- No FK to companies, deliberately: this row's source of truth is the
-- payload of another bounded context's event, not a local relation — an FK
-- would have to be dropped the day catalogo is extracted to its own
-- database anyway. Failure mode of not having one is inert and verifiable:
-- a garbage company_id matches no provider_catalog row, so it hides
-- nothing.
--
-- oculto boolean instead of physical DELETE: this schema grants no DELETE
-- anywhere (20260804090500_10_grants_domain_tables_service_role.sql is
-- explicit — "no DELETE anywhere in this schema"); every write here is an
-- idempotent upsert/update, and "restore" is UPDATE oculto = false.
--
-- RLS enabled, zero policies, zero grants to anon/authenticated: no client
-- ever reads this table — it is catalogo's internal state.
--
-- Genuinely new migration authored after the 01a-08 batch shipped and
-- archived (backend-supabase-migrations); own timestamp window, does not
-- reuse 20260803120000-20260803120800 nor 20260804090000/20260804090500
-- (design.md D-3).

-- ============================================================
-- 2. Tabla
-- ============================================================
create table public.catalog_hidden_companies (
  company_id  uuid primary key,
  oculto      boolean     not null default true,
  motivo      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.catalog_hidden_companies is
  'Proyección desnormalizada propiedad de catalogo (deny-list). La mantiene un listener @OnEvent sobre EmpresaSuspendida/EmpresaReactivada/EmpresaAprobada. Sin FK a companies A PROPÓSITO: la fuente de verdad es el payload de un evento de otro bounded context, y esta tabla debe sobrevivir la extracción de catalogo a su propia base. Fila ausente = empresa visible (sin backfill).';

-- ============================================================
-- 5. Trigger updated_at (función pública del lote 00)
-- ============================================================
create trigger catalog_hidden_companies_set_updated_at
  before update on public.catalog_hidden_companies
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.catalog_hidden_companies enable row level security;
revoke all on public.catalog_hidden_companies from anon, authenticated;
grant select, insert, update on public.catalog_hidden_companies to service_role;
-- Sin DELETE (convención uniforme del esquema): "restaurar" es UPDATE oculto = false.
-- Sin grant a authenticated y sin políticas RLS: ningún cliente lee esta tabla jamás.

-- ============================================================
-- 7. RLS: ninguna política, a propósito (ver arriba).
-- ============================================================
