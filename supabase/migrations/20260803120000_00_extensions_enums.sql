-- Batch 00 — shared extensions + cross-cutting functions.
--
-- This batch has no tables/enums of its own (tasks.md 1.2: no enum is
-- cross-domain across the finalized specs — each domain's enum ships
-- inside its own batch, per design.md D-3's fixed internal file order).
-- This file exists solely to create the primitives every later batch
-- depends on: `pgcrypto`/`pg_trgm` extensions, the shared `updated_at`
-- trigger function (design.md D-3), and the `current_company_id()`
-- SECURITY DEFINER helper used by child-table RLS policies (design.md D-2).
--
-- Because there are no tables/enums to create, this batch does not fill
-- all 8 sections of the fixed per-batch structure (design.md D-3) — only
-- the sections that apply to shared primitives are used below.

-- ============================================================
-- Extensions (precede section 1 "enums": extensions must exist before
-- anything that could depend on them, including later batches' enums,
-- indexes, and defaults)
-- ============================================================
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ============================================================
-- Section 5 primitive: shared `updated_at` trigger function.
--
-- Created once here; attached per-table (`create trigger ... before update
-- ... execute function public.set_updated_at()`) in every later batch that
-- has an `updated_at` column (design.md D-3: "una implementación").
-- ============================================================
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger function: sets updated_at = now(). Attached per-table in every later batch (design.md D-3). One implementation only, never redefined per-domain.';

-- ============================================================
-- Section 7 primitive: RLS helper function.
--
-- This batch creates no tables, so there is no section-7 RLS to enable
-- here — this is the SECURITY DEFINER primitive that every later batch's
-- RLS policies on company-owned tables call, instead of nesting an EXISTS
-- against `profiles` (which would re-evaluate `profiles`' own RLS from
-- inside another table's policy — cost + recursion risk, design.md D-2).
--
-- CORRECTION (found during PR 4, batch 02, via a real `supabase db reset`):
-- this function body references `public.profiles`, which does not exist
-- until batch 01a. The original comment here claimed a `language sql`
-- function body is not validated against the catalog at `CREATE FUNCTION`
-- time — that's wrong. Postgres resolves a SQL-language function's body
-- immediately to determine its result projection, so `CREATE FUNCTION`
-- fails outright when the referenced table doesn't exist yet. `language
-- plpgsql` defers that resolution to first call, which is what forward
-- references across migration batches actually require. Verified: a clean
-- `supabase db reset` fails at this statement with `language sql`, and
-- succeeds through the full chain with `language plpgsql`.
-- ============================================================
create function public.current_company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select company_id from public.profiles where id = (select auth.uid()));
end;
$$;

comment on function public.current_company_id() is
  'Returns the calling user''s company_id via profiles, without triggering profiles RLS evaluation (SECURITY DEFINER). Used by RLS policies on company-owned tables from batch 01a onward (design.md D-2).';
