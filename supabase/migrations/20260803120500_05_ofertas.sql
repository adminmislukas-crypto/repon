-- Batch 05 — ofertas: offers, offer_items.
-- Proactive offers (enviarOfertaProactiva) have no refill_request, hence
-- offers.user_id NOT NULL + denormalized (D-2). Both tables ship together
-- per D-3. Realtime (D-4) is scoped to offers only.

-- 1. Enums
create type public.offer_kind as enum ('reactiva', 'proactiva');
create type public.offer_status as enum ('pendiente', 'aceptada', 'rechazada', 'expirada');

-- 2. Tables
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  refill_request_id uuid references public.refill_requests (id),
  company_id uuid not null references public.companies (id),
  kind public.offer_kind not null,
  status public.offer_status not null default 'pendiente',
  tiempo_entrega_horas integer not null,
  costo_despacho numeric(12,2) not null,
  total numeric(12,2) not null,
  mensaje text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.offers is 'Oferta reactiva (sobre una refill_request) o proactiva (enviarOfertaProactiva, sin solicitud previa).';
comment on column public.offers.user_id is 'Destinatario, NOT NULL siempre: una oferta proactiva no tiene refill_request de la cual derivar dueño. La política SELECT del destinatario compara esta columna directo (user_id = auth.uid()), nunca via EXISTS -- así son visibles las proactivas.';
comment on column public.offers.refill_request_id is 'NULL cuando kind = proactiva. Si no es NULL debe coincidir con refill_requests.user_id -- invariante validada en core-api, no en Postgres.';

create table public.offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  refill_item_id uuid references public.refill_items (id),
  provider_catalog_item_id uuid references public.provider_catalog (id),
  is_alt boolean not null default false,
  alt_size numeric,
  alt_qty numeric,
  alt_note text,
  precio numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint offer_items_item_source_check
    check ((refill_item_id is not null) <> (provider_catalog_item_id is not null))
);

comment on table public.offer_items is 'Ítems de una offer. Sin columna de dueño propia (Q8) -- SELECT via EXISTS contra offers.user_id. Sin updated_at: inmutable una vez creada.';
comment on column public.offer_items.refill_item_id is 'NULLABLE -- set solo cuando la offer padre es reactiva (dual-nullable con provider_catalog_item_id, ver CHECK).';
comment on column public.offer_items.provider_catalog_item_id is 'NULLABLE -- set solo cuando la offer padre es proactiva (dual-nullable con refill_item_id, ver CHECK).';

-- 3. Constraints / FK diferidas
-- Partial (no plana): ignora filas no-aceptadas y ofertas proactivas sin refill_request_id.
create unique index offers_refill_request_id_aceptada_uidx
  on public.offers (refill_request_id)
  where status = 'aceptada' and refill_request_id is not null;

-- 4. Indexes
create index offers_user_id_idx on public.offers (user_id);
create index offers_company_id_idx on public.offers (company_id);
create index offers_refill_request_id_idx on public.offers (refill_request_id);
create index offer_items_offer_id_idx on public.offer_items (offer_id);

-- 5. Trigger updated_at
create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

-- 6. Grants (revoke-all -> grant estrecho)
alter table public.offers enable row level security;
alter table public.offer_items enable row level security;

revoke all on public.offers from anon, authenticated;
revoke all on public.offer_items from anon, authenticated;

grant select on public.offers to authenticated;
grant select on public.offer_items to authenticated;
-- grant select on offers es requisito duro de Realtime (D-4): sin él no se entregan eventos pase lo que pase con RLS.

-- 7. RLS: políticas
create policy "offers_authenticated_select_recipient"
  on public.offers
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "offers_authenticated_select_provider"
  on public.offers
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.company_id = offers.company_id
        and p.id = (select auth.uid())
    )
  );

create policy "offer_items_authenticated_select_own"
  on public.offer_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.offers o
      where o.id = offer_items.offer_id
        and o.user_id = (select auth.uid())
    )
  );

-- 8. Realtime / publication
-- Solo offers (D-4): el evento es señal de invalidación, el cliente refetch por REST. offer_items no se publica.
alter publication supabase_realtime add table public.offers;
