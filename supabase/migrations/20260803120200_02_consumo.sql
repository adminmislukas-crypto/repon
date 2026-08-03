-- Batch 02 — consumo: pets, user_consumption, consumption_logs.
--
-- Owned entirely by the consumo domain (specs/db-schema-consumo/spec.md) --
-- no other domain writes here. pets and user_consumption ship together
-- because user_consumption.pet_id FKs to pets (nullable, only populated when
-- owner_type = 'pet'); consumption_logs closes the file since it FKs to
-- user_consumption. All three land in one migration per design.md D-3 ("una
-- tabla nunca existe en un commit sin su RLS").

-- ============================================================
-- 1. Enums
-- ============================================================
create type public.owner_type as enum ('self', 'pet');
create type public.consumption_kind as enum ('medicamento', 'alimento', 'vacuna', 'suplemento');

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.pets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  nombre text not null,
  especie text not null,
  raza text,
  peso_kg numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pets is
  'Mascotas del usuario dueño (user_id, physical-only -- fijado por db-schema-consumo, no por packages/types/SPEC.md que solo fija id/nombre/especie/raza/pesoKg).';

create table public.user_consumption (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  owner_type public.owner_type not null,
  pet_id uuid references public.pets (id),
  kind public.consumption_kind not null,
  nombre text not null,
  dosis_por_toma numeric not null,
  unidad text,
  frecuencia_dias integer not null,
  horarios text[] not null,
  stock_actual numeric not null,
  auto_crear_refill boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_consumption is
  'Configuración de dosis/porción para una persona o su mascota. user_id (physical-only) es siempre el dueño humano, incluso cuando owner_type = pet -- una mascota no tiene cuenta propia.';
comment on column public.user_consumption.pet_id is
  'NULL salvo cuando owner_type = pet. Igual que profiles.company_id/role=provider (lote 01a): el invariante se enforcea en el caso de uso de consumo (core-api), no como CHECK de DB.';

create table public.consumption_logs (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null references public.user_consumption (id),
  tomado_at timestamptz not null,
  cantidad numeric,
  created_at timestamptz not null default now()
);

comment on table public.consumption_logs is
  'Registro append-only de tomas/porciones dadas. Sin columna de dueño por diseño (db-access-control Q8, Owner-less Child Table Read Policy) -- la política SELECT usa EXISTS contra user_consumption.user_id (sección 7).';

-- ============================================================
-- 3. Constraints / FK diferidas
-- ============================================================
-- No aplica: sin ciclos en este lote (pets -> user_consumption ->
-- consumption_logs es una cadena estrictamente forward). Todas las FK van
-- inline en el CREATE TABLE de la sección 2.

-- ============================================================
-- 4. Indexes
-- ============================================================
create index pets_user_id_idx on public.pets (user_id);
create index user_consumption_user_id_idx on public.user_consumption (user_id);
create index consumption_logs_consumption_id_tomado_at_idx
  on public.consumption_logs (consumption_id, tomado_at desc);
-- El índice compuesto arriba es el requerido por db-schema-consumo Requirement
-- "Adherence index supports the daily cron without full scans"
-- (adherenciaUltimos7Dias / calcularDiasRestantes, ConsumptionRepository.findDueForCheck).

-- ============================================================
-- 5. Trigger updated_at
-- ============================================================
create trigger pets_set_updated_at
  before update on public.pets
  for each row execute function public.set_updated_at();

create trigger user_consumption_set_updated_at
  before update on public.user_consumption
  for each row execute function public.set_updated_at();

-- consumption_logs no tiene updated_at (append-only, db-schema-consumo spec:
-- solo id/consumption_id/tomado_at/cantidad/created_at).

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.pets enable row level security;
alter table public.user_consumption enable row level security;
alter table public.consumption_logs enable row level security;

revoke all on public.pets from anon, authenticated;
revoke all on public.user_consumption from anon, authenticated;
revoke all on public.consumption_logs from anon, authenticated;

grant select on public.pets to authenticated;
grant select on public.user_consumption to authenticated;
grant select on public.consumption_logs to authenticated;

-- ============================================================
-- 7. RLS: políticas
-- ============================================================
-- pets / user_consumption: solo lectura de las filas propias
-- (db-schema-consumo Requirement "SELECT allowlist for pets and
-- user_consumption").
create policy "pets_authenticated_select_own"
  on public.pets
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "user_consumption_authenticated_select_own"
  on public.user_consumption
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- consumption_logs: sin columna de dueño propia -- EXISTS contra el
-- user_consumption padre (db-access-control Owner-less Child Table Read
-- Policy, db-schema-consumo Requirement "consumption_logs SELECT via EXISTS
-- on parent (Q8 pattern)").
create policy "consumption_logs_authenticated_select_own"
  on public.consumption_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_consumption uc
      where uc.id = consumption_logs.consumption_id
        and uc.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 8. Realtime / publication
-- ============================================================
-- No aplica a este lote (solo offers, batch 05, design.md D-4).
