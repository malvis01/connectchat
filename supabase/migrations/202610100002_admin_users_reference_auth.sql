-- Allow email/password-only administrators to be provisioned from Supabase Auth
-- without creating a fake phone-based public profile.
alter table public.gift_card_marketplace_admins
  drop constraint if exists gift_card_marketplace_admins_user_id_fkey;

alter table public.gift_card_marketplace_admins
  add constraint gift_card_marketplace_admins_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;