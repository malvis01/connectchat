create or replace function public.virtual_wallet_admin_withdrawals()
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
      select w.id,w.user_id,w.amount,w.currency,w.status,w.user_note,w.admin_note,w.created_at,w.updated_at,
        b.bank_name,b.account_name,b.country_code,b.account_number_last4
      from public.virtual_wallet_withdrawals w
      join public.virtual_wallet_bank_accounts b on b.id=w.bank_account_id
      order by w.created_at desc limit 200
    ) x
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.virtual_wallet_admin_withdrawals() from public,anon;
grant execute on function public.virtual_wallet_admin_withdrawals() to authenticated;
