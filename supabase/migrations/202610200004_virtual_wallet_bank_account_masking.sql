alter table public.virtual_wallet_bank_accounts
  add column if not exists account_number_last4 char(4);

comment on column public.virtual_wallet_bank_accounts.account_number_ciphertext is
  'AES-256-GCM envelope encrypted by a server-only key; never store plaintext here.';
comment on column public.virtual_wallet_bank_accounts.account_number_last4 is
  'Non-sensitive last four digits used only for display.';
