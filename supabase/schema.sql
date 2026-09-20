-- ConnectChat application schema
-- This file is intentionally independent from all existing projects.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  username text unique,
  full_name text not null,
  avatar_url text,
  about text,
  is_online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind = 'direct'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  message_type text not null default 'text'
    check (message_type in ('text','image','video','file','voice','sticker','system')),
  reply_to_id uuid references public.messages(id) on delete set null,
  forwarded_from_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  constraint message_has_content check (
    body is not null or message_type <> 'text'
  )
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size >= 0),
  width integer,
  height integer,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  call_type text not null check (call_type in ('voice','video')),
  status text not null default 'ringing'
    check (status in ('ringing','active','ended','missed','declined','failed','reconnecting')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.call_participants (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);

create table if not exists public.sticker_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  cover_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.sticker_packs(id) on delete cascade,
  name text not null,
  image_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc);
create index if not exists conversation_members_user_idx
  on public.conversation_members(user_id);
create index if not exists profiles_username_idx
  on public.profiles(username);
create index if not exists profiles_phone_idx
  on public.profiles(phone);
create index if not exists calls_conversation_created_idx
  on public.calls(conversation_id, created_at desc);

create table if not exists public.direct_conversations (
  user_one uuid not null references public.profiles(id) on delete cascade,
  user_two uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_one, user_two),
  check (user_one < user_two)
);

create index if not exists direct_conversations_conversation_idx
  on public.direct_conversations(conversation_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.blocked_users enable row level security;
alter table public.calls enable row level security;
alter table public.call_participants enable row level security;
alter table public.sticker_packs enable row level security;
alter table public.stickers enable row level security;

-- Profiles: authenticated users can discover basic profiles for starting chats.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Conversation membership controls all private conversation access.
drop policy if exists conversation_members_select_member on public.conversation_members;
create policy conversation_members_select_member
on public.conversation_members for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member
on public.conversations for select
to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversations.id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists conversation_members_insert_self on public.conversation_members;
-- Membership is created only by the trusted direct-conversation RPC below.
-- Clients cannot add themselves to arbitrary private conversations.

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists messages_insert_sender_member on public.messages;
create policy messages_insert_sender_member
on public.messages for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists messages_update_sender on public.messages;
create policy messages_update_sender
on public.messages for update
to authenticated
using (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
)
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists messages_delete_sender on public.messages;
create policy messages_delete_sender
on public.messages for delete
to authenticated
using (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists attachments_insert_sender_member on public.message_attachments;
create policy attachments_insert_sender_member
on public.message_attachments for insert
to authenticated
with check (
  exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_attachments.message_id
      and m.sender_id = (select auth.uid())
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists reactions_insert_member on public.message_reactions;
create policy reactions_insert_member
on public.message_reactions for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_reactions.message_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists attachments_select_member on public.message_attachments;
create policy attachments_select_member
on public.message_attachments for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_attachments.message_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists reactions_select_member on public.message_reactions;
create policy reactions_select_member
on public.message_reactions for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id
    where m.id = message_reactions.message_id
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists reactions_insert_self on public.message_reactions;
create policy reactions_insert_self
on public.message_reactions for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists reactions_delete_self on public.message_reactions;
create policy reactions_delete_self
on public.message_reactions for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists blocks_select_self on public.blocked_users;
create policy blocks_select_self
on public.blocked_users for select
to authenticated
using ((select auth.uid()) = blocker_id);

drop policy if exists blocks_insert_self on public.blocked_users;
create policy blocks_insert_self
on public.blocked_users for insert
to authenticated
with check ((select auth.uid()) = blocker_id);

drop policy if exists blocks_delete_self on public.blocked_users;
create policy blocks_delete_self
on public.blocked_users for delete
to authenticated
using ((select auth.uid()) = blocker_id);

drop policy if exists calls_select_participant on public.calls;
create policy calls_select_participant
on public.calls for select
to authenticated
using (
  exists (
    select 1 from public.call_participants cp
    where cp.call_id = calls.id
      and cp.user_id = (select auth.uid())
  )
);

drop policy if exists call_participants_select_self on public.call_participants;
create policy call_participants_select_self
on public.call_participants for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists stickers_select_authenticated on public.stickers;
create policy stickers_select_authenticated
on public.stickers for select
to authenticated
using (true);

drop policy if exists sticker_packs_select_authenticated on public.sticker_packs;
create policy sticker_packs_select_authenticated
on public.sticker_packs for select
to authenticated
using (is_active = true);


create or replace function public.get_or_create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  first_user uuid;
  second_user uuid;
  existing_id uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if other_user_id is null or other_user_id = me then
    raise exception 'Invalid conversation participant';
  end if;

  first_user := least(me, other_user_id);
  second_user := greatest(me, other_user_id);

  select conversation_id into existing_id
  from public.direct_conversations
  where user_one = first_user and user_two = second_user;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.conversations(kind)
  values ('direct')
  returning id into new_id;

  insert into public.direct_conversations(user_one, user_two, conversation_id)
  values (first_user, second_user, new_id)
  on conflict (user_one, user_two) do update
    set conversation_id = excluded.conversation_id
  returning conversation_id into existing_id;

  if existing_id <> new_id then
    delete from public.conversations where id = new_id;
    return existing_id;
  end if;

  insert into public.conversation_members(conversation_id, user_id)
  values (new_id, first_user), (new_id, second_user);

  return new_id;
end;
$$;

revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

drop policy if exists direct_conversations_select_member on public.direct_conversations;
create policy direct_conversations_select_member
on public.direct_conversations for select
to authenticated
using (auth.uid() in (user_one, user_two));


-- Private ConnectChat media bucket. Apply only to the dedicated ConnectChat Supabase project.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'connectchat-media',
  'connectchat-media',
  false,
  26214400,
  array[
    'image/*',
    'video/*',
    'audio/*',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists connectchat_media_select_member on storage.objects;
create policy connectchat_media_select_member
on storage.objects for select
to authenticated
using (
  bucket_id = 'connectchat-media'
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = split_part(name, '/', 1)::uuid
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists connectchat_media_insert_self on storage.objects;
create policy connectchat_media_insert_self
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'connectchat-media'
  and split_part(name, '/', 2)::uuid = (select auth.uid())
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = split_part(name, '/', 1)::uuid
      and cm.user_id = (select auth.uid())
  )
);

drop policy if exists connectchat_media_update_self on storage.objects;
create policy connectchat_media_update_self
on storage.objects for update
to authenticated
using (
  bucket_id = 'connectchat-media'
  and split_part(name, '/', 2)::uuid = (select auth.uid())
)
with check (
  bucket_id = 'connectchat-media'
  and split_part(name, '/', 2)::uuid = (select auth.uid())
);

drop policy if exists connectchat_media_delete_self on storage.objects;
create policy connectchat_media_delete_self
on storage.objects for delete
to authenticated
using (
  bucket_id = 'connectchat-media'
  and split_part(name, '/', 2)::uuid = (select auth.uid())
);

-- Call signaling metadata and participant state are persisted here.
-- WebRTC media itself stays peer-to-peer; Supabase Realtime carries signaling.
create index if not exists calls_conversation_created_idx on public.calls(conversation_id, created_at desc);
create index if not exists call_participants_user_created_idx on public.call_participants(user_id, joined_at desc);

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;

drop policy if exists calls_select_member on public.calls;
create policy calls_select_member on public.calls for select to authenticated
using (exists (
  select 1 from public.conversation_members cm
  where cm.conversation_id = calls.conversation_id and cm.user_id = (select auth.uid())
));

drop policy if exists calls_insert_member on public.calls;
create policy calls_insert_member on public.calls for insert to authenticated
with check (initiated_by = (select auth.uid()) and exists (
  select 1 from public.conversation_members cm
  where cm.conversation_id = calls.conversation_id and cm.user_id = (select auth.uid())
));

drop policy if exists calls_update_member on public.calls;
create policy calls_update_member on public.calls for update to authenticated
using (exists (
  select 1 from public.conversation_members cm
  where cm.conversation_id = calls.conversation_id and cm.user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.conversation_members cm
  where cm.conversation_id = calls.conversation_id and cm.user_id = (select auth.uid())
));

drop policy if exists call_participants_select_member on public.call_participants;
create policy call_participants_select_member on public.call_participants for select to authenticated
using (exists (
  select 1 from public.calls c join public.conversation_members cm on cm.conversation_id = c.conversation_id
  where c.id = call_participants.call_id and cm.user_id = (select auth.uid())
));

drop policy if exists call_participants_insert_self on public.call_participants;
create policy call_participants_insert_self on public.call_participants for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.calls c join public.conversation_members cm on cm.conversation_id = c.conversation_id
  where c.id = call_participants.call_id and cm.user_id = (select auth.uid())
));

drop policy if exists call_participants_update_self on public.call_participants;
create policy call_participants_update_self on public.call_participants for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Realtime is required for live chat and call signaling metadata.
do $$
declare
  t text;
begin
  foreach t in array array['messages','calls','call_participants'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
