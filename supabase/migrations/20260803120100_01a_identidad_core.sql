-- Batch 01a — identidad core: companies, company_dispatch_zones, profiles.
--
-- Ships together, not split by table (tasks.md Phase 2 rationale): companies'
-- owner-visibility SELECT policy needs `profiles` to exist via EXISTS at
-- CREATE POLICY time (unlike a `language sql` function body, a policy body IS
-- validated against the catalog when created), while profiles.company_id FKs
-- to companies. Both tables — plus company_dispatch_zones, which inherits
-- companies' visibility — must land in the same file so the whole batch is
-- internally complete per design.md D-3 ("una tabla nunca existe en un
-- commit sin su RLS").
--
-- admin_roles is intentionally NOT here — see batch 01b (Phase 3).

-- ============================================================
-- 1. Enums
-- ============================================================
create type public.company_status as enum ('pendiente', 'activo', 'suspendido');
create type public.role as enum ('user', 'provider', 'admin');
create type public.profile_status as enum ('activo', 'suspendido');

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  razon_social text not null,
  rut text not null,
  giro text not null,
  status public.company_status not null default 'pendiente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_rut_key unique (rut)
);

comment on table public.companies is
  'Proveedores. status arranca en pendiente; aprobarEmpresa es core-api-only, no hay política UPDATE para el cliente (db-schema-identidad).';

create table public.company_dispatch_zones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  comuna text not null,
  region text not null,
  constraint company_dispatch_zones_company_comuna_key unique (company_id, comuna)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  role public.role not null,
  status public.profile_status not null default 'activo',
  nombre text not null,
  email text not null,
  telefono text,
  company_id uuid references public.companies (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'FK a auth.users ON DELETE RESTRICT (design.md D-1): el borrado de un Auth user solo puede tener éxito cuando no existe fila profiles, que es exactamente el caso que compensa el adaptador AuthProvider. No confundir con dar de baja (status).';
comment on column public.profiles.company_id is
  'NULL salvo cuando role = provider. El invariante role=provider <=> company_id not null se enforcea en el caso de uso de identidad (core-api), no como CHECK de DB — mismo patrón que el invariante offers.user_id documentado en design.md D-2.';

-- ============================================================
-- 3. Constraints / FK diferidas
-- ============================================================
-- No aplica: el único ciclo de este lote es a nivel de política RLS
-- (companies necesita profiles vía EXISTS, sección 7), no a nivel de FK de
-- tabla. Todas las FK van inline en el CREATE TABLE de la sección 2.

-- ============================================================
-- 4. Indexes
-- ============================================================
create index companies_status_idx on public.companies (status);
create index profiles_company_id_idx on public.profiles (company_id) where company_id is not null;
-- company_dispatch_zones_company_comuna_key (UNIQUE, sección 2) ya cubre
-- lookups por company_id como columna líder del índice compuesto.

-- ============================================================
-- 5. Trigger updated_at
-- ============================================================
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- company_dispatch_zones no tiene updated_at (db-schema-identidad spec: solo
-- id/company_id/comuna/region + UNIQUE).

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.companies enable row level security;
alter table public.company_dispatch_zones enable row level security;
alter table public.profiles enable row level security;

revoke all on public.companies from anon, authenticated;
revoke all on public.company_dispatch_zones from anon, authenticated;
revoke all on public.profiles from anon, authenticated;

grant select on public.companies to authenticated;
grant select on public.company_dispatch_zones to authenticated;
grant select on public.profiles to authenticated;

-- ============================================================
-- 7. RLS: políticas
-- ============================================================
-- companies: público ve solo activo; el dueño ve su propia empresa en
-- cualquier status (db-schema-identidad Requirement "SELECT allowlist for
-- companies and dispatch zones"). EXISTS literal contra profiles, no
-- current_company_id(): la spec documenta el predicado EXISTS explícito, y
-- profiles ya existe en este punto del archivo (sección 2, mismo lote).
create policy "companies_authenticated_select_public"
  on public.companies
  for select
  to authenticated
  using (status = 'activo');

create policy "companies_authenticated_select_owner"
  on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.company_id = companies.id
    )
  );

-- company_dispatch_zones: "inherits companies visibility" (tasks.md 2.3) — la
-- misma condición pública-activa-o-dueño, evaluada contra la companies padre.
create policy "company_dispatch_zones_authenticated_select"
  on public.company_dispatch_zones
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.companies c
      where c.id = company_dispatch_zones.company_id
        and (
          c.status = 'activo'
          or exists (
            select 1
            from public.profiles p
            where p.id = (select auth.uid())
              and p.company_id = c.id
          )
        )
    )
  );

-- profiles: solo lectura de la propia fila. Sin política UPDATE — las
-- mutaciones (suspenderUsuario, etc.) van por core-api con service-role
-- (db-schema-identidad Requirement "profiles has no client-side mutation
-- policy"; supabase/SPEC.md delta de este lote documenta el conflicto con la
-- prosa previa en vez de sobrescribirla en silencio).
create policy "profiles_authenticated_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- ============================================================
-- 8. Realtime / publication
-- ============================================================
-- No aplica a este lote (solo offers, batch 05, design.md D-4).
