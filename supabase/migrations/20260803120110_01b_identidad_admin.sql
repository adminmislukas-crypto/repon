-- Batch 01b — identidad admin: admin_roles, v_auth_orphans (D-1), bootstrap
-- runbook surface (D-5).
--
-- Ships after 01a (tasks.md Phase 2's corrected split rationale): admin_roles
-- has a clean forward-only FK dependency on the already-merged `profiles`
-- table, so it doesn't need to share a file with `companies`/`profiles` the
-- way 01a's circular RLS/FK coupling required. See tasks.md Phase 3.

-- ============================================================
-- 1. Enums
-- ============================================================
create type public.admin_role as enum ('super_admin', 'soporte', 'finanzas');

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  rol public.admin_role not null,
  granted_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint admin_roles_profile_id_key unique (profile_id)
);

comment on table public.admin_roles is
  'Sub-rol de administrador. UNIQUE(profile_id): "un sub-rol por admin" (db-schema-identidad) -- re-asignar reemplaza la fila. Cero políticas RLS de cliente: solo accesible vía service-role desde admin-web (sección 7 más abajo).';
comment on column public.admin_roles.granted_by is
  'FK a profiles(id), NOT NULL. La única excepción es el bootstrap manual (design.md D-5, supabase/seed/00_bootstrap_super_admin.sql): la primera fila super_admin se auto-otorga (granted_by = profile_id) porque el perfil ya existe cuando se inserta. Cualquier otra fila con esa forma es una anomalía auditable, no un patrón a repetir.';

-- ============================================================
-- View: v_auth_orphans (design.md D-1)
--
-- No es una tabla propia -- se ubica aquí, entre las secciones 2 y 3, porque
-- la estructura fija de 8 secciones (design.md D-3) no reserva un lugar
-- dedicado a vistas y esta tampoco encaja de forma natural en ninguna
-- sección posterior. Detecta filas de auth.users sin fila profiles
-- correspondiente, más viejas que la ventana de gracia de 15 minutos (flujo
-- de compensación, D-1). Es solo la superficie de detección: el job de
-- reconciliación que la consume se entrega en el cambio de Edge Functions,
-- no en este.
-- ============================================================
create view public.v_auth_orphans as
  select u.id, u.email, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p.id is null
    and u.created_at < now() - interval '15 minutes';

revoke all on public.v_auth_orphans from anon, authenticated;
grant select on public.v_auth_orphans to service_role;

comment on view public.v_auth_orphans is
  'Superficie de detección de filas auth.users que sobrevivieron a su borrado compensatorio (design.md D-1). Solo service_role -- la política es detectar y alertar, nunca auto-borrar; un huérfano de >15 min es estado histórico ambiguo.';

-- ============================================================
-- 3. Constraints / FK diferidas
-- ============================================================
-- No aplica: las FK de admin_roles van inline en el CREATE TABLE de la
-- sección 2.

-- ============================================================
-- 4. Indexes
-- ============================================================
-- admin_roles_profile_id_key (UNIQUE, sección 2) ya cubre el lookup por
-- profile_id. Sin más índices: tabla pequeña, sin acceso de cliente.

-- ============================================================
-- 5. Trigger updated_at
-- ============================================================
-- No aplica: admin_roles no tiene columna updated_at (db-schema-identidad
-- spec: solo id/profile_id/rol/granted_by/created_at).

-- ============================================================
-- 6. Grants (revoke-all -> grant estrecho)
-- ============================================================
alter table public.admin_roles enable row level security;
revoke all on public.admin_roles from anon, authenticated;
-- Sin grant de select/insert/update/delete para anon/authenticated: cero
-- acceso de cliente (db-schema-identidad Requirement "admin_roles has no
-- client access").
--
-- CORREGIDO (comment-only, ver 20260804090000_09_grants_identidad_service_role.sql):
-- esta nota afirmaba que admin-web/core-api podían leer/escribir vía
-- service-role "que hace bypass de RLS (BYPASSRLS) y no necesita ningún
-- grant explícito sobre esta tabla" -- eso es incorrecto. BYPASSRLS solo
-- omite las *políticas* de row-level security; no tiene ningún efecto sobre
-- los privilegios de objeto estándar (GRANT/REVOKE a nivel de tabla), que
-- son un mecanismo de Postgres completamente distinto. Verificado
-- empíricamente contra una instancia real de Postgres local
-- (backend-core-api-foundation PR 4): conectar como service_role e
-- intentar SELECT/UPDATE contra esta tabla devolvía "permission denied for
-- table admin_roles" hasta que el lote 09 le otorgó
-- select/insert/update explícitos. Este archivo no cambia (ya está
-- aplicado); el grant real vive en el lote 09.

-- ============================================================
-- 7. RLS: políticas
-- ============================================================
-- Intencionalmente cero políticas: RLS habilitado (sección 6) + revoke-all +
-- sin políticas = deny-all total para anon/authenticated, los dos
-- mecanismos de design.md D-2. No hay ninguna política que crear aquí
-- (db-schema-identidad Requirement "admin_roles has no client access").

-- ============================================================
-- 8. Realtime / publication
-- ============================================================
-- No aplica a este lote (solo offers, batch 05, design.md D-4).
