-- ConnectChat virtual wallet foundation (virtual credits only; not real deposits).
-- Keep this migration on feature/virtual-wallet-withdrawals until reviewed and tested.

create table if not exists public.virtual_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  is_frozen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virtual_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(18,2) not null check (amount <> 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  entry_type text not null check (entry_type in ('admin_credit','admin_debit','withdrawal_hold','withdrawal_release','withdrawal_complete','adjustment')),
  reason text not null check (length(trim(reason)) between 5 and 500),
  actor_id uuid references public.profiles(id) on delete set null,
  idempotency_key uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists virtual_wallet_ledger_user_created_idx on public.virtual_wallet_ledger(user_id, created_at desc);

create table if not exists public.virtual_wallet_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  bank_name text not null check (length(trim(bank_name)) between 2 and 120),
  account_number_ciphertext text not null,
  account_name text not null check (length(trim(account_name)) between 2 and 160),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists virtual_wallet_bank_accounts_user_idx on public.virtual_wallet_bank_accounts(user_id);

create table if not exists public.virtual_wallet_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  bank_account_id uuid not null references public.virtual_wallet_bank_accounts(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending_verification'
    check (status in ('pending_verification','approved','rejected','processing','completed','cancelled')),
  user_note text,
  admin_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists virtual_wallet_withdrawals_user_created_idx on public.virtual_wallet_withdrawals(user_id, created_at desc);
create index if not exists virtual_wallet_withdrawals_status_created_idx on public.virtual_wallet_withdrawals(status, created_at desc);

create table if not exists public.virtual_wallet_withdrawal_codes (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.virtual_wallet_withdrawals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  used_at timestamptz,
  revoked_at timestamptz,
  issued_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists virtual_wallet_codes_pending_idx on public.virtual_wallet_withdrawal_codes(withdrawal_id, user_id, expires_at desc) where used_at is null and revoked_at is null;

create table if not exists public.virtual_wallet_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  amount numeric(18,2),
  currency text,
  reference_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.virtual_wallets enable row level security;
alter table public.virtual_wallet_ledger enable row level security;
alter table public.virtual_wallet_bank_accounts enable row level security;
alter table public.virtual_wallet_withdrawals enable row level security;
alter table public.virtual_wallet_withdrawal_codes enable row level security;
alter table public.virtual_wallet_admin_audit enable row level security;

revoke all on public.virtual_wallets, public.virtual_wallet_ledger, public.virtual_wallet_bank_accounts,
  public.virtual_wallet_withdrawals, public.virtual_wallet_withdrawal_codes, public.virtual_wallet_admin_audit
from anon, authenticated;

grant select on public.virtual_wallets, public.virtual_wallet_ledger, public.virtual_wallet_bank_accounts,
  public.virtual_wallet_withdrawals to authenticated;

create policy virtual_wallet_select_self on public.virtual_wallets for select to authenticated
  using (user_id = (select auth.uid()));
create policy virtual_wallet_ledger_select_self on public.virtual_wallet_ledger for select to authenticated
  using (user_id = (select auth.uid()));
create policy virtual_wallet_bank_select_self on public.virtual_wallet_bank_accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy virtual_wallet_withdrawals_select_self on public.virtual_wallet_withdrawals for select to authenticated
  using (user_id = (select auth.uid()));

-- Intentionally no client write policies. Writes must go through reviewed server-side handlers
-- that verify the administrator role, validate state transitions, and encrypt bank data.
