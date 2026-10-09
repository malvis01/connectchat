-- ConnectChat Gift Card Marketplace (additive migration; does not modify chat tables)
create extension if not exists pgcrypto;

create table if not exists public.gift_card_seller_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  business_name text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  contact_email text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gift_card_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete restrict,
  brand text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  currency char(3) not null,
  denomination numeric(12,2) not null check (denomination > 0),
  asking_price numeric(12,2) not null check (asking_price > 0 and asking_price <= denomination),
  card_type text not null default 'digital' check (card_type in ('digital','physical')),
  description text not null default '',
  status text not null default 'pending_review' check (status in ('draft','pending_review','active','reserved','sold','rejected','suspended')),
  moderation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_card_listings_browse_idx on public.gift_card_listings(status, country_code, created_at desc);
create index if not exists gift_card_listings_seller_idx on public.gift_card_listings(seller_id, created_at desc);

create table if not exists public.gift_card_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.gift_card_listings(id) on delete restrict,
  buyer_id uuid not null references public.profiles(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  currency char(3) not null,
  amount numeric(12,2) not null check (amount > 0),
  platform_fee numeric(12,2) not null default 0 check (platform_fee >= 0),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','payment_pending','paid','fulfillment_pending','fulfilled','disputed','cancelled','refunded','failed')),
  payment_provider text,
  provider_reference text unique,
  idempotency_key uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
create index if not exists gift_card_orders_buyer_idx on public.gift_card_orders(buyer_id, created_at desc);
create index if not exists gift_card_orders_seller_idx on public.gift_card_orders(seller_id, created_at desc);

-- Never store gift card numbers or PINs in plaintext. Seller-side client encryption
-- must be implemented before a delivery payload is accepted into this table.
create table if not exists public.gift_card_deliveries (
  order_id uuid primary key references public.gift_card_orders(id) on delete restrict,
  encrypted_payload text not null,
  encryption_version text not null default 'v1',
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_card_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.gift_card_orders(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open','under_review','resolved_buyer','resolved_seller','closed')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists gift_card_disputes_order_idx on public.gift_card_disputes(order_id, created_at desc);

create table if not exists public.gift_card_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.gift_card_seller_profiles enable row level security;
alter table public.gift_card_listings enable row level security;
alter table public.gift_card_orders enable row level security;
alter table public.gift_card_deliveries enable row level security;
alter table public.gift_card_disputes enable row level security;
alter table public.gift_card_audit_events enable row level security;

drop policy if exists gift_card_seller_profile_read on public.gift_card_seller_profiles;
create policy gift_card_seller_profile_read on public.gift_card_seller_profiles
for select to authenticated using (user_id = (select auth.uid()) or verification_status = 'verified');
drop policy if exists gift_card_seller_profile_insert on public.gift_card_seller_profiles;
create policy gift_card_seller_profile_insert on public.gift_card_seller_profiles
for insert to authenticated with check (user_id = (select auth.uid()) and verification_status = 'pending');
drop policy if exists gift_card_seller_profile_update on public.gift_card_seller_profiles;
create policy gift_card_seller_profile_update on public.gift_card_seller_profiles
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and verification_status = 'pending');

drop policy if exists gift_card_listing_read on public.gift_card_listings;
create policy gift_card_listing_read on public.gift_card_listings
for select to authenticated using (status = 'active' or seller_id = (select auth.uid()));
drop policy if exists gift_card_listing_insert on public.gift_card_listings;
create policy gift_card_listing_insert on public.gift_card_listings
for insert to authenticated with check (seller_id = (select auth.uid()) and status in ('draft','pending_review') and exists (select 1 from public.gift_card_seller_profiles s where s.user_id = (select auth.uid()) and s.verification_status in ('pending','verified')));
drop policy if exists gift_card_listing_update on public.gift_card_listings;
create policy gift_card_listing_update on public.gift_card_listings
for update to authenticated using (seller_id = (select auth.uid()) and status in ('draft','pending_review','rejected'))
with check (seller_id = (select auth.uid()) and status in ('draft','pending_review'));

drop policy if exists gift_card_order_read_participant on public.gift_card_orders;
create policy gift_card_order_read_participant on public.gift_card_orders
for select to authenticated using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));
-- Orders are created atomically through this RPC to prevent two buyers reserving the same card.
drop policy if exists gift_card_order_create_buyer on public.gift_card_orders;
create or replace function public.create_gift_card_order(p_listing_id uuid, p_idempotency_key uuid default gen_random_uuid())
returns public.gift_card_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_buyer uuid := auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_order public.gift_card_orders%rowtype;
begin
  if v_buyer is null then raise exception 'Sign in to place an order.' using errcode = '28000'; end if;
  select * into v_order from public.gift_card_orders where idempotency_key = p_idempotency_key;
  if found then
    if v_order.buyer_id <> v_buyer then raise exception 'Idempotency key belongs to another account.'; end if;
    return v_order;
  end if;
  select * into v_listing from public.gift_card_listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'active' then raise exception 'This gift card is no longer available.'; end if;
  if v_listing.seller_id = v_buyer then raise exception 'You cannot buy your own listing.'; end if;
  insert into public.gift_card_orders(listing_id,buyer_id,seller_id,currency,amount,status,idempotency_key)
  values (v_listing.id,v_buyer,v_listing.seller_id,v_listing.currency,v_listing.asking_price,'awaiting_payment',p_idempotency_key)
  returning * into v_order;
  update public.gift_card_listings set status = 'reserved', updated_at = now() where id = v_listing.id;
  insert into public.gift_card_audit_events(actor_id,entity_type,entity_id,action,metadata)
  values (v_buyer,'gift_card_order',v_order.id,'order_created',jsonb_build_object('listing_id',v_listing.id,'amount',v_listing.asking_price,'currency',v_listing.currency));
  return v_order;
end;
$function$;
revoke all on function public.create_gift_card_order(uuid, uuid) from public, anon;
grant execute on function public.create_gift_card_order(uuid, uuid) to authenticated;

drop policy if exists gift_card_delivery_read_buyer_seller on public.gift_card_deliveries;
create policy gift_card_delivery_read_buyer_seller on public.gift_card_deliveries
for select to authenticated using (
  exists (select 1 from public.gift_card_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())))
);
-- Deliberately no client insert/update policy for encrypted deliveries or payment/order status.
-- These require a verified server-side payment/fulfilment function.

drop policy if exists gift_card_dispute_read_participant on public.gift_card_disputes;
create policy gift_card_dispute_read_participant on public.gift_card_disputes
for select to authenticated using (
  opened_by = (select auth.uid()) or exists (
    select 1 from public.gift_card_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid()))
  )
);
drop policy if exists gift_card_dispute_open_participant on public.gift_card_disputes;
create policy gift_card_dispute_open_participant on public.gift_card_disputes
for insert to authenticated with check (
  opened_by = (select auth.uid()) and exists (
    select 1 from public.gift_card_orders o where o.id = order_id and (o.buyer_id = (select auth.uid()) or o.seller_id = (select auth.uid())) and o.status in ('paid','fulfillment_pending','fulfilled')
  )
);
-- Audit log is server-only: no direct client policies.
