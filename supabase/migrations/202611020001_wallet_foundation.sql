-- ConnectChat wallet foundation
-- Ledger-first wallet accounting. No payment gateway is enabled by this migration.
-- Deposits must only be credited by a verified server-side provider webhook.

create extension if not exists pgcrypto;

create table if not exists public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  available_balance numeric(20,2) not null default 0 check (available_balance >= 0),
  pending_balance numeric(20,2) not null default 0 check (pending_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, currency)
);

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  entry_type text not null check (entry_type in (
    'deposit','withdrawal_reserved','withdrawal_released','withdrawal_paid',
    'purchase','sale_proceeds','platform_fee','refund','adjustment'
  )),
  direction text not null check (direction in ('credit','debit')),
  amount numeric(20,2) not null check (amount > 0),
  available_balance_after numeric(20,2) not null check (available_balance_after >= 0),
  pending_balance_after numeric(20,2) not null check (pending_balance_after >= 0),
  reference_type text,
  reference_id uuid,
  idempotency_key uuid not null unique,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_wallet_user_currency_fk
    foreign key (wallet_id, user_id, currency)
    references public.wallet_accounts(id, user_id, currency)
    on delete restrict
);

create table if not exists public.wallet_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null,
  bank_code text not null,
  bank_name text not null,
  account_name text not null,
  account_number_last4 char(4) not null check (account_number_last4 ~ '^[0-9]{4}$'),
  currency char(3) not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','failed','disabled')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wallet_bank_accounts_one_default_per_user_currency
  on public.wallet_bank_accounts(user_id, currency) where is_default = true;
create index if not exists wallet_bank_accounts_user_idx
  on public.wallet_bank_accounts(user_id, created_at desc);

create table if not exists public.wallet_withdrawals (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  bank_account_id uuid not null references public.wallet_bank_accounts(id) on delete restrict,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(20,2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending','processing','paid','failed','cancelled')),
  provider_reference text unique,
  idempotency_key uuid not null unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_withdrawals_wallet_user_currency_fk
    foreign key (wallet_id, user_id, currency)
    references public.wallet_accounts(id, user_id, currency)
    on delete restrict
);

create index if not exists wallet_ledger_user_created_idx
  on public.wallet_ledger(user_id, created_at desc);
create index if not exists wallet_withdrawals_user_created_idx
  on public.wallet_withdrawals(user_id, created_at desc);
create index if not exists wallet_withdrawals_status_created_idx
  on public.wallet_withdrawals(status, created_at);

drop trigger if exists wallet_accounts_set_updated_at on public.wallet_accounts;
create trigger wallet_accounts_set_updated_at
before update on public.wallet_accounts
for each row execute function public.set_updated_at();

drop trigger if exists wallet_bank_accounts_set_updated_at on public.wallet_bank_accounts;
create trigger wallet_bank_accounts_set_updated_at
before update on public.wallet_bank_accounts
for each row execute function public.set_updated_at();

drop trigger if exists wallet_withdrawals_set_updated_at on public.wallet_withdrawals;
create trigger wallet_withdrawals_set_updated_at
before update on public.wallet_withdrawals
for each row execute function public.set_updated_at();

-- Ledger rows are append-only. Corrections must be new compensating entries.
create or replace function public.prevent_wallet_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception 'Wallet ledger entries are immutable.';
end;
$function$;

drop trigger if exists wallet_ledger_no_update on public.wallet_ledger;
create trigger wallet_ledger_no_update
before update or delete on public.wallet_ledger
for each row execute function public.prevent_wallet_ledger_mutation();

alter table public.wallet_accounts enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_bank_accounts enable row level security;
alter table public.wallet_withdrawals enable row level security;

drop policy if exists wallet_accounts_select_own on public.wallet_accounts;
create policy wallet_accounts_select_own on public.wallet_accounts
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists wallet_ledger_select_own on public.wallet_ledger;
create policy wallet_ledger_select_own on public.wallet_ledger
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists wallet_bank_accounts_select_own on public.wallet_bank_accounts;
create policy wallet_bank_accounts_select_own on public.wallet_bank_accounts
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists wallet_withdrawals_select_own on public.wallet_withdrawals;
create policy wallet_withdrawals_select_own on public.wallet_withdrawals
for select to authenticated using (user_id = (select auth.uid()));

-- No direct client writes to balances, ledger entries, bank records, or withdrawals.
revoke insert, update, delete on public.wallet_accounts from anon, authenticated;
revoke insert, update, delete on public.wallet_ledger from anon, authenticated;
revoke insert, update, delete on public.wallet_bank_accounts from anon, authenticated;
revoke insert, update, delete on public.wallet_withdrawals from anon, authenticated;

create or replace function public.get_or_create_wallet(p_currency text default 'NGN')
returns public.wallet_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_wallet public.wallet_accounts%rowtype;
  v_currency char(3) := upper(trim(coalesce(p_currency, 'NGN')))::char(3);
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_currency::text !~ '^[A-Z]{3}$' then
    raise exception 'A valid three-letter currency code is required.';
  end if;

  insert into public.wallet_accounts(user_id, currency)
  values (v_user_id, v_currency)
  on conflict (user_id, currency) do nothing;

  select * into v_wallet
  from public.wallet_accounts
  where user_id = v_user_id and currency = v_currency;

  return v_wallet;
end;
$function$;

revoke all on function public.get_or_create_wallet(text) from public, anon;
grant execute on function public.get_or_create_wallet(text) to authenticated;

-- A withdrawal request reserves funds atomically. Only trusted server-side
-- payment processing may mark it paid or failed and settle/release the reserve.
create or replace function public.request_wallet_withdrawal(
  p_bank_account_id uuid,
  p_amount numeric,
  p_currency text default 'NGN',
  p_idempotency_key uuid default gen_random_uuid()
)
returns public.wallet_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_currency char(3) := upper(trim(coalesce(p_currency, 'NGN')))::char(3);
  v_wallet public.wallet_accounts%rowtype;
  v_bank public.wallet_bank_accounts%rowtype;
  v_withdrawal public.wallet_withdrawals%rowtype;
  v_new_available numeric(20,2);
  v_new_pending numeric(20,2);
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid withdrawal amount with no more than two decimal places.';
  end if;
  if v_currency::text !~ '^[A-Z]{3}$' or p_idempotency_key is null then
    raise exception 'Invalid currency or idempotency key.';
  end if;

  select * into v_withdrawal
  from public.wallet_withdrawals
  where idempotency_key = p_idempotency_key;

  if found then
    if v_withdrawal.user_id <> v_user_id then
      raise exception 'Idempotency key belongs to another account.';
    end if;
    return v_withdrawal;
  end if;

  select * into v_bank
  from public.wallet_bank_accounts
  where id = p_bank_account_id
    and user_id = v_user_id
    and currency = v_currency
    and verification_status = 'verified'
  for share;

  if not found then
    raise exception 'Choose a verified bank account for this currency.';
  end if;

  select * into v_wallet
  from public.wallet_accounts
  where user_id = v_user_id and currency = v_currency
  for update;

  if not found then
    raise exception 'Wallet not found. Open your wallet first.';
  end if;
  if v_wallet.available_balance < p_amount then
    raise exception 'Insufficient available balance.';
  end if;

  v_new_available := v_wallet.available_balance - p_amount;
  v_new_pending := v_wallet.pending_balance + p_amount;

  update public.wallet_accounts
  set available_balance = v_new_available,
      pending_balance = v_new_pending
  where id = v_wallet.id
  returning * into v_wallet;

  insert into public.wallet_withdrawals(
    wallet_id,user_id,bank_account_id,currency,amount,status,idempotency_key
  ) values (
    v_wallet.id,v_user_id,v_bank.id,v_currency,p_amount,'pending',p_idempotency_key
  ) returning * into v_withdrawal;

  insert into public.wallet_ledger(
    wallet_id,user_id,currency,entry_type,direction,amount,
    available_balance_after,pending_balance_after,
    reference_type,reference_id,idempotency_key,description
  ) values (
    v_wallet.id,v_user_id,v_currency,'withdrawal_reserved','debit',p_amount,
    v_new_available,v_new_pending,'withdrawal',v_withdrawal.id,
    gen_random_uuid(),'Withdrawal requested; funds reserved pending payout.'
  );

  return v_withdrawal;
end;
$function$;

revoke all on function public.request_wallet_withdrawal(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.request_wallet_withdrawal(uuid, numeric, text, uuid) to authenticated;
