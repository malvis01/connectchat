create or replace function public.virtual_wallet_admin_recent_ledger()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.gift_card_marketplace_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select id,user_id,amount,currency,entry_type,reason,created_at
      from public.virtual_wallet_ledger order by created_at desc limit 100
    ) x
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.virtual_wallet_admin_recent_ledger() from public,anon;
grant execute on function public.virtual_wallet_admin_recent_ledger() to authenticated;
