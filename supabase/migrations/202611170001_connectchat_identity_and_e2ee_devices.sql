-- ConnectChat account handles and E2EE device foundation.
-- Additive: preserves existing profiles, conversations, messages and marketplace data.

alter table public.profiles
  add column if not exists connectchat_number text,
  add column if not exists e2ee_public_key text;

create sequence if not exists public.connectchat_number_seq
  as bigint start with 10000001 increment by 1;

create or replace function public.issue_connectchat_number()
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select 'CC-' || lpad(nextval('public.connectchat_number_seq')::text, 8, '0');
$$;

revoke all on function public.issue_connectchat_number() from public, anon, authenticated;
grant execute on function public.issue_connectchat_number() to service_role;

create or replace function public.assign_connectchat_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.connectchat_number is null or btrim(new.connectchat_number) = '' then
    new.connectchat_number := public.issue_connectchat_number();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_connectchat_number on public.profiles;
create trigger profiles_assign_connectchat_number
before insert on public.profiles
for each row execute function public.assign_connectchat_number();

update public.profiles
set connectchat_number = public.issue_connectchat_number()
where connectchat_number is null;

create unique index if not exists profiles_connectchat_number_uidx
  on public.profiles(connectchat_number);

-- Keep existing password hashes and sessions while changing the synthetic
-- Auth email to the newly assigned ConnectChat number.
update auth.users u
set email = 'p_' || lower(translate(regexp_replace(encode(convert_to(p.connectchat_number, 'UTF8'), 'base64'), '[=\n]', '', 'g'), '+/', '-_')) || '@qgsesjcpmvtykzzsleqx.supabase.co',
    email_confirmed_at = coalesce(u.email_confirmed_at, now()),
    updated_at = now()
from public.profiles p
where p.id = u.id
  and p.connectchat_number is not null;

create table if not exists public.e2ee_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text not null,
  public_key text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint e2ee_devices_user_public_key_key unique(user_id, public_key),
  constraint e2ee_devices_id_user_key unique(id, user_id)
);

create index if not exists e2ee_devices_user_active_idx
  on public.e2ee_devices(user_id, created_at)
  where revoked_at is null;

alter table public.e2ee_devices enable row level security;

drop policy if exists e2ee_devices_select_authenticated on public.e2ee_devices;
create policy e2ee_devices_select_authenticated
on public.e2ee_devices for select
to authenticated
using (true);

drop policy if exists e2ee_devices_insert_self on public.e2ee_devices;
create policy e2ee_devices_insert_self
on public.e2ee_devices for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists e2ee_devices_update_self on public.e2ee_devices;
create policy e2ee_devices_update_self
on public.e2ee_devices for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists e2ee_devices_delete_self on public.e2ee_devices;
create policy e2ee_devices_delete_self
on public.e2ee_devices for delete
to authenticated
using (user_id = (select auth.uid()));

create table if not exists public.e2ee_device_trust (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  contact_user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  fingerprint text not null,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint e2ee_device_trust_device_owner_fk
    foreign key (device_id, contact_user_id)
    references public.e2ee_devices(id, user_id) on delete cascade,
  constraint e2ee_device_trust_owner_device_key unique(owner_user_id, device_id),
  constraint e2ee_device_trust_not_self check (owner_user_id <> contact_user_id)
);

create index if not exists e2ee_device_trust_contact_idx
  on public.e2ee_device_trust(contact_user_id);

alter table public.e2ee_device_trust enable row level security;

drop policy if exists e2ee_device_trust_select_owner on public.e2ee_device_trust;
create policy e2ee_device_trust_select_owner
on public.e2ee_device_trust for select
to authenticated
using (owner_user_id = (select auth.uid()));

drop policy if exists e2ee_device_trust_insert_owner on public.e2ee_device_trust;
create policy e2ee_device_trust_insert_owner
on public.e2ee_device_trust for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.e2ee_devices d
    where d.id = device_id
      and d.user_id = contact_user_id
      and d.revoked_at is null
  )
);

drop policy if exists e2ee_device_trust_update_owner on public.e2ee_device_trust;
create policy e2ee_device_trust_update_owner
on public.e2ee_device_trust for update
to authenticated
using (owner_user_id = (select auth.uid()))
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.e2ee_devices d
    where d.id = device_id
      and d.user_id = contact_user_id
      and d.revoked_at is null
  )
);

drop policy if exists e2ee_device_trust_delete_owner on public.e2ee_device_trust;
create policy e2ee_device_trust_delete_owner
on public.e2ee_device_trust for delete
to authenticated
using (owner_user_id = (select auth.uid()));

-- A public account handle is stable and must not be editable by clients.
create or replace function public.prevent_connectchat_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.connectchat_number is not null
     and new.connectchat_number is distinct from old.connectchat_number then
    raise exception 'ConnectChat numbers cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_connectchat_number_immutable on public.profiles;
create trigger profiles_connectchat_number_immutable
before update of connectchat_number on public.profiles
for each row execute function public.prevent_connectchat_number_change();

-- A trust record must contain the fingerprint actually published by that device.
drop policy if exists e2ee_device_trust_insert_owner on public.e2ee_device_trust;
create policy e2ee_device_trust_insert_owner
on public.e2ee_device_trust for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.e2ee_devices d
    where d.id = device_id
      and d.user_id = contact_user_id
      and d.revoked_at is null
      and d.fingerprint = e2ee_device_trust.fingerprint
  )
);

drop policy if exists e2ee_device_trust_update_owner on public.e2ee_device_trust;
create policy e2ee_device_trust_update_owner
on public.e2ee_device_trust for update
to authenticated
using (owner_user_id = (select auth.uid()))
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.e2ee_devices d
    where d.id = device_id
      and d.user_id = contact_user_id
      and d.revoked_at is null
      and d.fingerprint = e2ee_device_trust.fingerprint
  )
);


-- Authenticated users may discover public ConnectChat profiles, but phone numbers
-- are private account data. Grant column-level reads for only the public fields.
revoke select on table public.profiles from authenticated;
grant select (
  id, connectchat_number, username, full_name, avatar_url,
  e2ee_public_key, about, is_online, last_seen_at, created_at, updated_at
) on table public.profiles to authenticated;
