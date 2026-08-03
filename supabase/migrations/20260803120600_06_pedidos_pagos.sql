-- Batch 06 — pedidos-pagos: orders, order_items, payments.
-- order_items is an immutable snapshot (design.md D-6): copied by value at
-- INSERT, offer_item_id kept only for provenance. Immutability is grants-
-- based (revoke update/delete incl. service_role) -- service_role has
-- BYPASSRLS so RLS alone can't stop it, only grants can (same mechanism as
-- audit_log's append-only pattern). payments never gets a client SELECT
-- grant/policy (PCI scope avoidance, zero direct client read).

-- 1. Enums
create type public.order_status as enum ('confirmado', 'preparando', 'en_camino', 'entregado');
create type public.payment_status as enum ('pendiente', 'pagado', 'fallido', 'reembolsado');

-- 2. Tables
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  user_id uuid not null references public.profiles (id),
  company_id uuid not null references public.companies (id),
  status public.order_status not null default 'confirmado',
  total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.orders is 'Pedido creado al aceptar una offer. Visible para el usuario dueño y la empresa proveedora.';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  offer_item_id uuid not null references public.offer_items (id),
  nombre text not null,
  cantidad numeric not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  is_alt boolean not null default false,
  alt_size numeric,
  alt_qty numeric,
  alt_note text,
  created_at timestamptz not null default now()
);

comment on table public.order_items is 'Snapshot inmutable copiado por valor desde offer_items al crear el pedido (D-6). Sin updated_at, sin columna de dueño (Q8) -- SELECT via EXISTS contra orders.';
comment on column public.order_items.offer_item_id is 'Solo procedencia. NUNCA joinear para leer precio o descripcion -- este snapshot es la fuente de verdad post-compra.';

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id),
  gateway text not null check (gateway in ('webpay', 'mercadopago')),
  external_transaction_id text not null,
  monto numeric(12,2) not null check (monto > 0),
  moneda text not null default 'CLP',
  estado public.payment_status not null default 'pendiente',
  raw_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payments is 'Transacción del checkout hospedado (Webpay/MercadoPago). Nunca datos de tarjeta -- solo external_transaction_id y metadata del gateway. gateway usa CHECK, no enum, para que sumar un gateway sea una migracion de una linea.';

-- 3. Constraints / FK diferidas
-- (ninguna diferida en este lote)

-- 4. Indexes
create index orders_user_id_idx on public.orders (user_id);
create index orders_company_id_idx on public.orders (company_id);
create index orders_offer_id_idx on public.orders (offer_id);
create index order_items_order_id_idx on public.order_items (order_id);

-- 5. Trigger updated_at
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- 6. Grants (revoke-all -> grant estrecho)
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.payments from anon, authenticated;

-- Inmutabilidad de order_items via grants (D-6), no via RLS: service_role
-- tiene BYPASSRLS, solo la ausencia del privilegio lo detiene.
revoke update, delete on public.order_items from anon, authenticated, service_role;

grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;
-- payments: sin grant select para anon/authenticated -- cero lectura directa de cliente, a proposito.

-- 7. RLS: políticas
create policy "orders_authenticated_select_owner"
  on public.orders
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "orders_authenticated_select_company"
  on public.orders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.company_id = orders.company_id
        and p.id = (select auth.uid())
    )
  );

create policy "order_items_authenticated_select_own"
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.user_id = (select auth.uid())
    )
  );
-- payments: cero politicas a proposito -- ni owner ni company leen esta tabla directo, solo via core-api.

-- 8. Realtime / publication
-- (no aplica a este lote)
