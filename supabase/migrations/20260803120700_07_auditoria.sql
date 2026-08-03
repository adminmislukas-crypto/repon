-- Batch 07 — auditoria: audit_log, append-only trail of admin actions.
-- entity_id is polymorphic (no FK, spans every domain table). Append-only
-- is grants-based (revoke update/delete incl. service_role) -- same
-- mechanism as order_items (D-6): service_role has BYPASSRLS, only grants
-- stop it. anon/authenticated get zero access; admin-web reads via
-- core-api's service-role connection only.

-- 1. Enums
-- (ninguno: accion/entity_type son text, no cross-domain -- spec finalizada)

-- 2. Tables
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid not null references public.profiles (id),
  accion text not null,
  entity_type text not null,
  entity_id uuid not null,
  cambios jsonb not null,
  motivo text,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is 'Trail append-only de acciones administrativas. Nunca UPDATE/DELETE, ni para service_role -- ver sección 6.';
comment on column public.audit_log.entity_id is 'Polimórfico (companies/profiles/offers/etc según entity_type). Sin FK a propósito -- una FK no puede apuntar a múltiples tablas.';

-- 3. Constraints / FK diferidas
-- (ninguna: la única FK, actor_profile_id, va inline en el CREATE TABLE)

-- 4. Indexes
create index audit_log_actor_profile_id_idx on public.audit_log (actor_profile_id);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- 5. Trigger updated_at
-- (no aplica: sin columna updated_at, tabla append-only)

-- 6. Grants (revoke-all -> grant estrecho)
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant insert, select on public.audit_log to service_role;
-- Append-only incl. service_role (D-6, mismo mecanismo que order_items):
-- service_role tiene BYPASSRLS, solo la ausencia del grant lo detiene.
revoke update, delete on public.audit_log from anon, authenticated, service_role;

-- 7. RLS: políticas
-- Cero políticas a propósito -- RLS habilitado + revoke-all + sin políticas
-- = deny-all total para anon/authenticated (design.md D-2). admin-web lee
-- exclusivamente vía service-role desde core-api.

-- 8. Realtime / publication
-- (no aplica a este lote)
