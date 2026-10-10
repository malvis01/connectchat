-- ConnectChat: 5% gift-card marketplace commission and finance reporting.
-- This records a fee estimate on order creation; it does NOT mark an order paid
-- or earned. Commission counts as earned only after status = 'fulfilled'.

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
    if v_order.buyer_id <> v_buyer then
      raise exception 'Idempotency key belongs to another account.';
    end if;
    return v_order;
  end if;

  select * into v_listing
  from public.gift_card_listings
  where id = p_listing_id
  for update;

  if not found or v_listing.status <> 'active' then
    raise exception 'This gift card is no longer available.';
  end if;
  if v_listing.seller_id = v_buyer then
    raise exception 'You cannot buy your own listing.';
  end if;

  -- Fixed agreed rate: 5% of asking price, rounded to two decimal places.
  v_platform_fee := round(v_listing.asking_price * 0.05, 2);

  insert into public.gift_card_orders(
    listing_id, buyer_id, seller_id, currency, amount, platform_fee, status, idempotency_key
  )
  values (
    v_listing.id, v_buyer, v_listing.seller_id, v_listing.currency,
    v_listing.asking_price, v_platform_fee, 'awaiting_payment', p_idempotency_key
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
      'fee_status', 'estimated_until_fulfilled'
    )
  );

  return v_order;
end;
$function$;

revoke all on function public.create_gift_card_order(uuid, uuid) from public, anon;
grant execute on function public.create_gift_card_order(uuid, uuid) to authenticated;

create or replace function public.gift_card_admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  result jsonb;
begin
  if not exists (
    select 1 from public.gift_card_marketplace_admins where user_id = auth.uid()
  ) then
    raise exception 'Marketplace administrator access required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'counts', jsonb_build_object(
      'pending_listings', (select count(*) from public.gift_card_listings where status = 'pending_review'),
      'pending_sellers', (select count(*) from public.gift_card_seller_profiles where verification_status = 'pending'),
      'open_disputes', (select count(*) from public.gift_card_disputes where status in ('open','under_review')),
      'orders', (select count(*) from public.gift_card_orders)
    ),
    'finance_by_currency', coalesce((
      select jsonb_agg(to_jsonb(finance_row) order by finance_row.currency)
      from (
        select
          currency,
          coalesce(sum(amount) filter (where status = 'fulfilled'), 0) as completed_sales,
          coalesce(sum(platform_fee) filter (where status = 'fulfilled'), 0) as commission_earned,
          coalesce(sum(amount) filter (where status in ('paid','fulfillment_pending','disputed')), 0) as paid_pending_fulfillment,
          coalesce(sum(amount) filter (where status = 'refunded'), 0) as refunded_amount,
          coalesce(sum(amount) filter (where status in ('awaiting_payment','payment_pending')), 0) as awaiting_payment_amount
        from public.gift_card_orders
        group by currency
      ) finance_row
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select id,seller_id,brand,country_code,currency,denomination,asking_price,card_type,description,status,moderation_note,created_at
        from public.gift_card_listings
        where status in ('pending_review','rejected','suspended')
        order by created_at desc limit 100
      ) x
    ), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select user_id,business_name,country_code,contact_email,verification_status,created_at
        from public.gift_card_seller_profiles
        where verification_status in ('pending','rejected','suspended')
        order by created_at desc limit 100
      ) x
    ), '[]'::jsonb),
    'disputes', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select id,order_id,opened_by,reason,details,status,resolution_note,created_at
        from public.gift_card_disputes
        where status in ('open','under_review')
        order by created_at desc limit 100
      ) x
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select id,listing_id,buyer_id,seller_id,currency,amount,platform_fee,status,payment_provider,provider_reference,created_at
        from public.gift_card_orders
        order by created_at desc limit 100
      ) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.gift_card_admin_overview() from public, anon;
grant execute on function public.gift_card_admin_overview() to authenticated;
