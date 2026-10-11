-- Marketplace safety follow-up: reservation expiry, seller eligibility and protected delivery.
-- This does not enable payments. Stripe approval is required before live checkout.

alter table public.gift_card_orders
  add column if not exists expires_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists refunded_at timestamptz;

update public.gift_card_orders
set expires_at = created_at + interval '20 minutes'
where expires_at is null and status in ('awaiting_payment','payment_pending');

create index if not exists gift_card_orders_expiry_idx
  on public.gift_card_orders(status, expires_at)
  where status in ('awaiting_payment','payment_pending');

-- Replaces the original reservation RPC. Repeated buyer clicks/retries for the
-- same listing return the existing live reservation instead of creating duplicates.
create or replace function public.create_gift_card_order(
  p_listing_id uuid,
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.gift_card_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_buyer uuid := auth.uid();
  v_listing public.gift_card_listings%rowtype;
  v_order public.gift_card_orders%rowtype;
  v_platform_fee numeric(12,2);
begin
  if v_buyer is null then
    raise exception 'Sign in to place an order.' using errcode = '28000';
  end if;

  select * into v_order
  from public.gift_card_orders
  where idempotency_key = p_idempotency_key;

  if found then
    if v_order.buyer_id <> v_buyer or v_order.listing_id <> p_listing_id then
      raise exception 'Idempotency key is already in use.' using errcode = '23505';
    end if;
    return v_order;
  end if;

  select * into v_listing
  from public.gift_card_listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'This gift card is no longer available.';
  end if;

  -- Recover a stale reservation atomically before deciding whether to reserve again.
  select * into v_order
  from public.gift_card_orders
  where listing_id = p_listing_id
    and status in ('awaiting_payment','payment_pending')
  order by created_at desc
  limit 1
  for update;

  if found then
    if v_order.expires_at is not null and v_order.expires_at <= now() then
      update public.gift_card_orders
      set status = 'cancelled', updated_at = now()
      where id = v_order.id;

      insert into public.gift_card_audit_events(actor_id, entity_type, entity_id, action, metadata)
      values (v_buyer, 'gift_card_order', v_order.id, 'reservation_expired_on_retry',
              jsonb_build_object('listing_id', p_listing_id));
      update public.gift_card_listings
      set status = 'active', updated_at = now()
      where id = p_listing_id and status = 'reserved';
    elsif v_order.buyer_id = v_buyer then
      return v_order;
    else
      raise exception 'This gift card is currently reserved. Try again after the reservation expires.';
    end if;
  end if;

  -- Paid/disputed orders must never be released by the unpaid-reservation path.
  if exists (
    select 1 from public.gift_card_orders
    where listing_id = p_listing_id
      and status in ('paid','fulfillment_pending','disputed')
  ) then
    raise exception 'This gift card is already in a paid or disputed order.';
  end if;

  if v_listing.status <> 'active' then
    raise exception 'This gift card is no longer available.';
  end if;
  if v_listing.seller_id = v_buyer then
    raise exception 'You cannot buy your own listing.';
  end if;
  if not exists (
    select 1 from public.gift_card_seller_profiles
    where user_id = v_listing.seller_id and verification_status = 'verified'
  ) then
    raise exception 'This seller has not completed marketplace verification.';
  end if;

  v_platform_fee := round(v_listing.asking_price * 0.05, 2);

  insert into public.gift_card_orders(
    listing_id, buyer_id, seller_id, currency, amount, platform_fee,
    status, idempotency_key, expires_at
  )
  values (
    v_listing.id, v_buyer, v_listing.seller_id, v_listing.currency,
    v_listing.asking_price, v_platform_fee, 'awaiting_payment',
    p_idempotency_key, now() + interval '20 minutes'
  )
  returning * into v_order;

  update public.gift_card_listings
  set status = 'reserved', updated_at = now()
  where id = v_listing.id;

  insert into public.gift_card_audit_events(actor_id, entity_type, entity_id, action, metadata)
  values (
    v_buyer, 'gift_card_order', v_order.id, 'order_created',
    jsonb_build_object(
      'listing_id', v_listing.id,
      'amount', v_listing.asking_price,
      'currency', v_listing.currency,
      'platform_fee', v_platform_fee,
      'commission_rate_percent', 5,
      'fee_status', 'estimated_until_fulfilled',
      'expires_at', v_order.expires_at
    )
  );

  return v_order;
end;
$function$;

revoke all on function public.create_gift_card_order(uuid, uuid) from public, anon;
grant execute on function public.create_gift_card_order(uuid, uuid) to authenticated;

-- A trusted scheduler calls this function periodically. It only expires unpaid
-- reservations; paid, fulfillment-pending and disputed orders are never released.
create or replace function public.expire_gift_card_reservations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order public.gift_card_orders%rowtype;
  v_count integer := 0;
begin
  for v_order in
    select * from public.gift_card_orders
    where status in ('awaiting_payment','payment_pending')
      and expires_at is not null and expires_at <= now()
    order by expires_at
    for update skip locked
  loop
    update public.gift_card_orders
    set status = 'cancelled', updated_at = now()
    where id = v_order.id
      and status in ('awaiting_payment','payment_pending');

    if found then
      update public.gift_card_listings l
      set status = 'active', updated_at = now()
      where l.id = v_order.listing_id
        and l.status = 'reserved'
        and not exists (
          select 1 from public.gift_card_orders o
          where o.listing_id = l.id
            and o.status in ('paid','fulfillment_pending','disputed')
        )
        and not exists (
          select 1 from public.gift_card_orders o
          where o.listing_id = l.id
            and o.status in ('awaiting_payment','payment_pending')
            and o.expires_at > now()
        );

      insert into public.gift_card_audit_events(actor_id, entity_type, entity_id, action, metadata)
      values (null, 'gift_card_order', v_order.id, 'reservation_expired',
              jsonb_build_object('listing_id', v_order.listing_id, 'expired_at', v_order.expires_at));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.expire_gift_card_reservations() from public, anon, authenticated;
grant execute on function public.expire_gift_card_reservations() to service_role;

-- Encrypted payloads remain inaccessible to buyers until the order is fulfilled.
-- No plaintext gift-card number/PIN is ever accepted by a client-side policy.
drop policy if exists gift_card_delivery_read_buyer_seller on public.gift_card_deliveries;
create policy gift_card_delivery_read_buyer_seller on public.gift_card_deliveries
for select to authenticated using (
  exists (
    select 1 from public.gift_card_orders o
    where o.id = order_id
      and (
        (o.seller_id = (select auth.uid()) and o.status in ('paid','fulfillment_pending','fulfilled','disputed'))
        or (o.buyer_id = (select auth.uid()) and o.status = 'fulfilled')
      )
  )
);

-- Refund and payout records are server-managed only. These are audit/workflow
-- records, not a claim that money movement is implemented or provider-approved.
create table if not exists public.gift_card_refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.gift_card_orders(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null,
  status text not null default 'requested'
    check (status in ('requested','under_review','approved','processed','rejected')),
  provider_reference text,
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_card_refund_requests_order_idx
  on public.gift_card_refund_requests(order_id, created_at desc);
alter table public.gift_card_refund_requests enable row level security;
revoke all on public.gift_card_refund_requests from anon, authenticated;
grant select, insert, update on public.gift_card_refund_requests to service_role;

create table if not exists public.gift_card_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete restrict,
  order_id uuid not null unique references public.gift_card_orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null,
  status text not null default 'blocked_pending_provider_approval'
    check (status in ('blocked_pending_provider_approval','pending','processing','paid','failed','reversed')),
  provider text,
  provider_reference text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gift_card_payouts_seller_idx
  on public.gift_card_payouts(seller_id, created_at desc);
alter table public.gift_card_payouts enable row level security;
revoke all on public.gift_card_payouts from anon, authenticated;
grant select, insert, update on public.gift_card_payouts to service_role;
