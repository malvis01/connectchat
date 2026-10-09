-- ConnectChat gift-card marketplace operations and moderation controls
create table if not exists public.gift_card_marketplace_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.gift_card_marketplace_admins enable row level security;
-- No client policies: only service-role provisioning can appoint an admin.

create or replace function public.is_gift_card_marketplace_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists(select 1 from public.gift_card_marketplace_admins where user_id = auth.uid());
$function$;
revoke all on function public.is_gift_card_marketplace_admin() from public, anon;
grant execute on function public.is_gift_card_marketplace_admin() to authenticated;

create or replace function public.gift_card_admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare result jsonb;
begin
  if not exists(select 1 from public.gift_card_marketplace_admins where user_id = auth.uid()) then
    raise exception 'Marketplace administrator access required.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'pending_listings', (select count(*) from public.gift_card_listings where status = 'pending_review'),
      'pending_sellers', (select count(*) from public.gift_card_seller_profiles where verification_status = 'pending'),
      'open_disputes', (select count(*) from public.gift_card_disputes where status in ('open','under_review')),
      'orders', (select count(*) from public.gift_card_orders)
    ),
    'listings', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id,seller_id,brand,country_code,currency,denomination,asking_price,card_type,description,status,moderation_note,created_at
      from public.gift_card_listings where status in ('pending_review','rejected','suspended') order by created_at desc limit 100
    ) x), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select user_id,business_name,country_code,contact_email,verification_status,created_at
      from public.gift_card_seller_profiles where verification_status in ('pending','rejected','suspended') order by created_at desc limit 100
    ) x), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id,order_id,opened_by,reason,details,status,resolution_note,created_at
      from public.gift_card_disputes where status in ('open','under_review') order by created_at desc limit 100
    ) x), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select id,listing_id,buyer_id,seller_id,currency,amount,platform_fee,status,payment_provider,provider_reference,created_at
      from public.gift_card_orders order by created_at desc limit 100
    ) x), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;
revoke all on function public.gift_card_admin_overview() from public, anon;
grant execute on function public.gift_card_admin_overview() to authenticated;

create or replace function public.gift_card_admin_moderate_listing(p_listing_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare listing_seller uuid;
begin
  if not exists(select 1 from public.gift_card_marketplace_admins where user_id = auth.uid()) then
    raise exception 'Marketplace administrator access required.' using errcode = '42501';
  end if;
  if p_status not in ('active','rejected','suspended') then raise exception 'Invalid moderation status.'; end if;
  select seller_id into listing_seller from public.gift_card_listings where id = p_listing_id and status in ('pending_review','rejected','suspended');
  if not found then raise exception 'Listing not found or not available for moderation.'; end if;
  if p_status = 'active' and not exists(select 1 from public.gift_card_seller_profiles where user_id = listing_seller and verification_status = 'verified') then
    raise exception 'Seller must be verified before listing approval.';
  end if;
  update public.gift_card_listings set status=p_status, moderation_note=left(p_note,1000), updated_at=now() where id=p_listing_id;
  insert into public.gift_card_audit_events(actor_id,entity_type,entity_id,action,metadata)
  values(auth.uid(),'gift_card_listing',p_listing_id,'moderated',jsonb_build_object('status',p_status,'note',left(p_note,1000)));
end;
$function$;
revoke all on function public.gift_card_admin_moderate_listing(uuid,text,text) from public, anon;
grant execute on function public.gift_card_admin_moderate_listing(uuid,text,text) to authenticated;

create or replace function public.gift_card_admin_set_seller(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not exists(select 1 from public.gift_card_marketplace_admins where user_id = auth.uid()) then
    raise exception 'Marketplace administrator access required.' using errcode = '42501';
  end if;
  if p_status not in ('verified','rejected','suspended','pending') then raise exception 'Invalid seller status.'; end if;
  update public.gift_card_seller_profiles set verification_status=p_status, updated_at=now() where user_id=p_user_id;
  if not found then raise exception 'Seller application not found.'; end if;
  insert into public.gift_card_audit_events(actor_id,entity_type,entity_id,action,metadata)
  values(auth.uid(),'gift_card_seller',p_user_id,'verification_changed',jsonb_build_object('status',p_status));
end;
$function$;
revoke all on function public.gift_card_admin_set_seller(uuid,text) from public, anon;
grant execute on function public.gift_card_admin_set_seller(uuid,text) to authenticated;

create or replace function public.gift_card_admin_resolve_dispute(p_dispute_id uuid, p_status text, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if not exists(select 1 from public.gift_card_marketplace_admins where user_id = auth.uid()) then
    raise exception 'Marketplace administrator access required.' using errcode = '42501';
  end if;
  if p_status not in ('under_review','resolved_buyer','resolved_seller','closed') then raise exception 'Invalid dispute status.'; end if;
  update public.gift_card_disputes set status=p_status,resolution_note=left(p_note,2000),resolved_by=auth.uid(),
    resolved_at=case when p_status in ('resolved_buyer','resolved_seller','closed') then now() else null end
    where id=p_dispute_id and status in ('open','under_review');
  if not found then raise exception 'Dispute not found or already resolved.'; end if;
  insert into public.gift_card_audit_events(actor_id,entity_type,entity_id,action,metadata)
  values(auth.uid(),'gift_card_dispute',p_dispute_id,'dispute_updated',jsonb_build_object('status',p_status,'note',left(p_note,2000)));
end;
$function$;
revoke all on function public.gift_card_admin_resolve_dispute(uuid,text,text) from public, anon;
grant execute on function public.gift_card_admin_resolve_dispute(uuid,text,text) to authenticated;

create index if not exists gift_card_audit_events_actor_idx on public.gift_card_audit_events(actor_id);
create index if not exists gift_card_deliveries_submitted_by_idx on public.gift_card_deliveries(submitted_by);
create index if not exists gift_card_disputes_opened_by_idx on public.gift_card_disputes(opened_by);
create index if not exists gift_card_disputes_resolved_by_idx on public.gift_card_disputes(resolved_by);
create index if not exists gift_card_orders_listing_id_idx on public.gift_card_orders(listing_id);
