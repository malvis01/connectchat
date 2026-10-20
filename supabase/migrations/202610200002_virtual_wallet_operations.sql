-- Atomic virtual wallet operations for ConnectChat.
-- These credits are internal ledger units only; they are not bank deposits or withdrawable cash.
-- Keep on feature/virtual-wallet-withdrawals until reviewed, tested, and explicitly approved for deployment.

alter table public.virtual_wallet_withdrawals
  add column if not exists idempotency_key uuid unique;

-- All balance changes are append-only ledger entries. A withdrawal hold is a negative entry;
-- rejection/cancellation adds a positive release entry; completion does not deduct twice.
create or replace function public.virtual_wallet_my_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_currency text;
  v_balance numeric(18,2);
  v_frozen boolean;
begin
  if v_user is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select w.currency, w.is_frozen into v_currency, v_frozen
  from public.virtual_wallets w where w.user_id = v_user;

  if not found then
    v_currency := 'NGN';
    v_frozen := false;
    insert into public.virtual_wallets(user_id, currency) values (v_user, v_currency)
    on conflict (user_id) do nothing;
  end if;

  select coalesce(sum(l.amount), 0)::numeric(18,2) into v_balance
  from public.virtual_wallet_ledger l where l.user_id = v_user and l.currency = v_currency;

  return jsonb_build_object('currency',v_currency,'balance',v_balance,'is_frozen',v_frozen);
end;
$function$;

create or replace function public.virtual_wallet_admin_adjust(
  p_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_reason text,
  p_idempotency_key uuid,
  p_action text default 'credit'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_entry_id uuid;
  v_signed_amount numeric(18,2);
begin
  if v_actor is null or not exists (
    select 1 from public.gift_card_marketplace_admins a where a.user_id = v_actor
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_user_id is null or p_amount is null or p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Enter a valid positive amount.' using errcode = '22023';
  end if;
  if p_currency !~ '^[A-Z]{3}$' or p_action not in ('credit','debit') then
    raise exception 'Invalid currency or adjustment action.' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 or length(trim(p_reason)) > 500 then
    raise exception 'A reason of 5–500 characters is required.' using errcode = '22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;
  if not exists(select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Target user was not found.' using errcode = 'P0002';
  end if;

  insert into public.virtual_wallets(user_id,currency)
  values (p_user_id,p_currency) on conflict(user_id) do nothing;

  perform 1 from public.virtual_wallets w where w.user_id = p_user_id for update;

  if exists(select 1 from public.virtual_wallet_ledger l where l.idempotency_key = p_idempotency_key) then
    select l.id into v_entry_id from public.virtual_wallet_ledger l where l.idempotency_key = p_idempotency_key;
    return v_entry_id;
  end if;

  if exists(select 1 from public.virtual_wallets w where w.user_id=p_user_id and (w.is_frozen or w.currency <> p_currency)) then
    raise exception 'Wallet is frozen or its currency does not match.' using errcode = '55000';
  end if;

  v_signed_amount := case when p_action = 'credit' then round(p_amount,2) else -round(p_amount,2) end;
  if p_action = 'debit' and (
    select coalesce(sum(l.amount),0) from public.virtual_wallet_ledger l
    where l.user_id=p_user_id and l.currency=p_currency
  ) < round(p_amount,2) then
    raise exception 'Insufficient virtual balance.' using errcode = '22003';
  end if;

  insert into public.virtual_wallet_ledger(user_id,amount,currency,entry_type,reason,actor_id,idempotency_key)
  values (p_user_id,v_signed_amount,p_currency,case when p_action='credit' then 'admin_credit' else 'admin_debit' end,
    trim(p_reason),v_actor,p_idempotency_key)
  returning id into v_entry_id;

  insert into public.virtual_wallet_admin_audit(actor_id,target_user_id,action,amount,currency,reference_id,reason)
  values(v_actor,p_user_id,'wallet_'||p_action,round(p_amount,2),p_currency,v_entry_id,trim(p_reason));
  return v_entry_id;
end;
$function$;

create or replace function public.virtual_wallet_request_withdrawal(
  p_bank_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_user_note text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_wallet public.virtual_wallets%rowtype;
  v_withdrawal_id uuid;
  v_balance numeric(18,2);
begin
  if v_user is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Invalid amount or currency.' using errcode = '22023';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key required.' using errcode = '22023'; end if;
  if p_user_note is not null and length(p_user_note)>500 then raise exception 'Note is too long.' using errcode = '22023'; end if;

  if exists(select 1 from public.virtual_wallet_withdrawals x where x.idempotency_key=p_idempotency_key) then
    select x.id into v_withdrawal_id from public.virtual_wallet_withdrawals x where x.idempotency_key=p_idempotency_key;
    if exists(select 1 from public.virtual_wallet_withdrawals x where x.id=v_withdrawal_id and x.user_id=v_user) then return v_withdrawal_id; end if;
    raise exception 'Idempotency key already used.' using errcode = '23505';
  end if;

  select * into v_wallet from public.virtual_wallets w where w.user_id=v_user for update;
  if not found then raise exception 'Wallet is not initialized.' using errcode = 'P0002'; end if;
  if v_wallet.is_frozen or v_wallet.currency <> p_currency then raise exception 'Wallet is frozen or currency mismatch.' using errcode = '55000'; end if;
  if not exists(select 1 from public.virtual_wallet_bank_accounts b where b.id=p_bank_account_id and b.user_id=v_user and b.currency=p_currency) then
    raise exception 'Select a saved bank account in the same currency.' using errcode = '22023';
  end if;

  select coalesce(sum(l.amount),0) into v_balance from public.virtual_wallet_ledger l
    where l.user_id=v_user and l.currency=p_currency;
  if v_balance < round(p_amount,2) then raise exception 'Insufficient virtual balance.' using errcode = '22003'; end if;

  insert into public.virtual_wallet_withdrawals(user_id,bank_account_id,amount,currency,status,user_note,idempotency_key)
  values(v_user,p_bank_account_id,round(p_amount,2),p_currency,'pending_verification',nullif(trim(p_user_note),''),p_idempotency_key)
  returning id into v_withdrawal_id;

  insert into public.virtual_wallet_ledger(user_id,amount,currency,entry_type,reason,actor_id,idempotency_key)
  values(v_user,-round(p_amount,2),p_currency,'withdrawal_hold','Withdrawal hold: '||v_withdrawal_id::text,v_user,gen_random_uuid());

  return v_withdrawal_id;
end;
$function$;

create or replace function public.virtual_wallet_admin_issue_code(
  p_withdrawal_id uuid,
  p_code_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_withdrawal public.virtual_wallet_withdrawals%rowtype;
  v_code_id uuid;
begin
  if v_actor is null or not exists(select 1 from public.gift_card_marketplace_admins a where a.user_id=v_actor) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_code_hash !~ '^[a-f0-9]{64}$' or p_expires_at <= now() or p_expires_at > now()+interval '30 minutes' then
    raise exception 'Invalid code hash or expiry. Code lifetime must be 30 minutes or less.' using errcode = '22023';
  end if;
  select * into v_withdrawal from public.virtual_wallet_withdrawals w where w.id=p_withdrawal_id for update;
  if not found or v_withdrawal.status <> 'pending_verification' then raise exception 'Withdrawal is not awaiting verification.' using errcode = '55000'; end if;

  update public.virtual_wallet_withdrawal_codes set revoked_at=now()
    where withdrawal_id=p_withdrawal_id and used_at is null and revoked_at is null;
  insert into public.virtual_wallet_withdrawal_codes(withdrawal_id,user_id,code_hash,expires_at,issued_by)
  values(p_withdrawal_id,v_withdrawal.user_id,p_code_hash,p_expires_at,v_actor) returning id into v_code_id;
  insert into public.virtual_wallet_admin_audit(actor_id,target_user_id,action,amount,currency,reference_id,reason)
  values(v_actor,v_withdrawal.user_id,'withdrawal_code_issued',v_withdrawal.amount,v_withdrawal.currency,p_withdrawal_id,'One-time support verification code issued');
  return v_code_id;
end;
$function$;

create or replace function public.virtual_wallet_verify_withdrawal_code(
  p_withdrawal_id uuid,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_code public.virtual_wallet_withdrawal_codes%rowtype;
begin
  if v_user is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if p_code_hash !~ '^[a-f0-9]{64}$' then return false; end if;

  select * into v_code from public.virtual_wallet_withdrawal_codes c
  where c.withdrawal_id=p_withdrawal_id and c.user_id=v_user and c.used_at is null and c.revoked_at is null
    and c.expires_at>now() and c.failed_attempts<5
  order by c.created_at desc limit 1 for update;

  if not found then return false; end if;
  if v_code.code_hash <> p_code_hash then
    update public.virtual_wallet_withdrawal_codes set failed_attempts=least(failed_attempts+1,5) where id=v_code.id;
    return false;
  end if;

  update public.virtual_wallet_withdrawal_codes set used_at=now() where id=v_code.id;
  update public.virtual_wallet_withdrawals set status='approved',updated_at=now()
    where id=p_withdrawal_id and user_id=v_user and status='pending_verification';
  if not found then raise exception 'Withdrawal state changed; request support.' using errcode = '55000'; end if;
  return true;
end;
$function$;

create or replace function public.virtual_wallet_admin_review_withdrawal(
  p_withdrawal_id uuid,
  p_status text,
  p_admin_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_withdrawal public.virtual_wallet_withdrawals%rowtype;
begin
  if v_actor is null or not exists(select 1 from public.gift_card_marketplace_admins a where a.user_id=v_actor) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
  if p_status not in ('rejected','processing','completed') then raise exception 'Invalid withdrawal status.' using errcode = '22023'; end if;
  if p_admin_note is null or length(trim(p_admin_note))<5 or length(trim(p_admin_note))>500 then raise exception 'A review note is required.' using errcode = '22023'; end if;

  select * into v_withdrawal from public.virtual_wallet_withdrawals w where w.id=p_withdrawal_id for update;
  if not found then raise exception 'Withdrawal not found.' using errcode = 'P0002'; end if;

  if p_status='rejected' then
    if v_withdrawal.status not in ('pending_verification','approved','processing') then raise exception 'Withdrawal cannot be rejected from its current state.' using errcode = '55000'; end if;
    update public.virtual_wallet_withdrawals set status='rejected',admin_note=trim(p_admin_note),reviewed_by=v_actor,reviewed_at=now(),updated_at=now() where id=p_withdrawal_id;
    if v_withdrawal.status <> 'completed' then
      insert into public.virtual_wallet_ledger(user_id,amount,currency,entry_type,reason,actor_id,idempotency_key)
      values(v_withdrawal.user_id,v_withdrawal.amount,v_withdrawal.currency,'withdrawal_release','Release rejected withdrawal: '||p_withdrawal_id::text,v_actor,gen_random_uuid());
    end if;
  elsif p_status='processing' then
    if v_withdrawal.status <> 'approved' then raise exception 'User must verify the support code before processing.' using errcode = '55000'; end if;
    update public.virtual_wallet_withdrawals set status='processing',admin_note=trim(p_admin_note),reviewed_by=v_actor,reviewed_at=now(),updated_at=now() where id=p_withdrawal_id;
  else
    if v_withdrawal.status <> 'processing' then raise exception 'Only processing withdrawals can be completed.' using errcode = '55000'; end if;
    update public.virtual_wallet_withdrawals set status='completed',admin_note=trim(p_admin_note),reviewed_by=v_actor,reviewed_at=now(),updated_at=now() where id=p_withdrawal_id;
  end if;

  insert into public.virtual_wallet_admin_audit(actor_id,target_user_id,action,amount,currency,reference_id,reason)
  values(v_actor,v_withdrawal.user_id,'withdrawal_'||p_status,v_withdrawal.amount,v_withdrawal.currency,p_withdrawal_id,trim(p_admin_note));
end;
$function$;

revoke all on function public.virtual_wallet_my_summary() from public,anon;
revoke all on function public.virtual_wallet_admin_adjust(uuid,numeric,text,text,uuid,text) from public,anon;
revoke all on function public.virtual_wallet_request_withdrawal(uuid,numeric,text,text,uuid) from public,anon;
revoke all on function public.virtual_wallet_admin_issue_code(uuid,text,timestamptz) from public,anon;
revoke all on function public.virtual_wallet_verify_withdrawal_code(uuid,text) from public,anon;
revoke all on function public.virtual_wallet_admin_review_withdrawal(uuid,text,text) from public,anon;

grant execute on function public.virtual_wallet_my_summary() to authenticated;
grant execute on function public.virtual_wallet_admin_adjust(uuid,numeric,text,text,uuid,text) to authenticated;
grant execute on function public.virtual_wallet_request_withdrawal(uuid,numeric,text,text,uuid) to authenticated;
grant execute on function public.virtual_wallet_admin_issue_code(uuid,text,timestamptz) to authenticated;
grant execute on function public.virtual_wallet_verify_withdrawal_code(uuid,text) to authenticated;
grant execute on function public.virtual_wallet_admin_review_withdrawal(uuid,text,text) to authenticated;
