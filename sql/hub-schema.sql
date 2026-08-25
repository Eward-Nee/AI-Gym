-- =============================================================================
--  AI-GYM  ·  HUB SCHEMA  (the shared / app-wide Supabase project)
--
--  Run this ONCE, in the shared project only — not in a personal project.
--  Project used by this build:  https://uuljnonlnobsxfutruqq.supabase.co
--
--  What the hub stores
--  -------------------
--    profiles      one row per account: handle, display name, current rank
--    connections   each account's personal Supabase URL + publishable key.
--                  PRIVATE: readable only by the owner, and by accepted
--                  friends through get_friend_connection().
--    friendships   requests and accepted links
--    shared_stats  small cached roll-up so the VS screen renders instantly
--                  without hitting every friend's own project
--    invites       single-use codes; redeeming one IS the acceptance
--    user_keys     each account's data key, WRAPPED with their password
--    hub_keepalive one heartbeat per day, shared across all users
--
--  The hub never stores training data. It stores *where* a friend's data lives
--  and *whether* you are allowed to look at it.
--
--  Safe to re-run: every statement is idempotent.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. PROFILES
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text unique not null,
  display_name  text,
  avatar_emoji  text default '💪',
  units         text default 'kg',
  rank_id       text default 'wood',
  rank_points   int  default 0,
  bio           text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,24}$')
);

create index if not exists profiles_handle_idx on public.profiles (handle);
create index if not exists profiles_points_idx on public.profiles (rank_points desc);

alter table public.profiles enable row level security;

-- Everyone signed in can discover profiles (that is how you add a friend).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated using (id = auth.uid());

-- -----------------------------------------------------------------------------
-- 2. CONNECTIONS  (private — this is the sensitive table)
-- -----------------------------------------------------------------------------

-- anon_key and write_key arrive ALREADY ENCRYPTED by the client with the
-- account's data key, so this table holds ciphertext the hub cannot read. The
-- URL stays clear because a friend's app needs it to know where to connect.
create table if not exists public.connections (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  supabase_url   text not null,
  anon_key       text not null,
  write_key      text,
  encrypted      boolean not null default false,
  schema_version int default 1,
  verified_at    timestamptz,
  updated_at     timestamptz not null default now()
);

alter table public.connections add column if not exists write_key text;
alter table public.connections add column if not exists encrypted boolean not null default false;

alter table public.connections enable row level security;

-- Owner only. Friends never select this table directly — they call
-- get_friend_connection(), which checks the friendship first.
drop policy if exists connections_own on public.connections;
create policy connections_own on public.connections
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 3. FRIENDSHIPS
-- -----------------------------------------------------------------------------

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'blocked')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id),
  constraint friendships_unique_pair unique (requester_id, addressee_id)
);

create index if not exists friendships_requester_idx on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);

alter table public.friendships enable row level security;

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated with check (requester_id = auth.uid());

-- The addressee accepts or declines; the requester may cancel their own request.
drop policy if exists friendships_update on public.friendships;
create policy friendships_update on public.friendships
  for update to authenticated
  using (addressee_id = auth.uid() or requester_id = auth.uid())
  with check (addressee_id = auth.uid() or requester_id = auth.uid());

drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Are these two accounts actually connected?
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and ((f.requester_id = a and f.addressee_id = b)
         or (f.requester_id = b and f.addressee_id = a))
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. SHARED STATS  (cached roll-up for the VS screen)
-- -----------------------------------------------------------------------------

create table if not exists public.shared_stats (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  payload     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.shared_stats enable row level security;

drop policy if exists shared_stats_select on public.shared_stats;
create policy shared_stats_select on public.shared_stats
  for select to authenticated
  using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));

drop policy if exists shared_stats_write on public.shared_stats;
create policy shared_stats_write on public.shared_stats
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 5. RPCs
-- -----------------------------------------------------------------------------

-- Find people to add. Never exposes connection details.
drop function if exists public.search_profiles(text);
create or replace function public.search_profiles(q text)
returns table (id uuid, handle text, display_name text, avatar_emoji text,
               rank_id text, rank_points int, relation text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name, p.avatar_emoji, p.rank_id, p.rank_points,
         case
           when p.id = auth.uid() then 'self'
           when exists (select 1 from public.friendships f
                         where f.status = 'accepted'
                           and ((f.requester_id = auth.uid() and f.addressee_id = p.id)
                             or (f.requester_id = p.id and f.addressee_id = auth.uid())))
             then 'friend'
           when exists (select 1 from public.friendships f
                         where f.requester_id = auth.uid() and f.addressee_id = p.id
                           and f.status = 'pending') then 'outgoing'
           when exists (select 1 from public.friendships f
                         where f.requester_id = p.id and f.addressee_id = auth.uid()
                           and f.status = 'pending') then 'incoming'
           else 'none'
         end as relation
    from public.profiles p
   where lower(p.handle) like '%' || lower(trim(q)) || '%'
      or lower(coalesce(p.display_name, '')) like '%' || lower(trim(q)) || '%'
   order by (lower(p.handle) = lower(trim(q))) desc, p.rank_points desc
   limit 25;
$$;

-- The whole point of the hub: hand a friend's storage details to someone who
-- has actually been accepted as a friend, and nobody else.
drop function if exists public.get_friend_connection(uuid);
create or replace function public.get_friend_connection(friend uuid)
returns table (user_id uuid, handle text, display_name text,
               supabase_url text, anon_key text, encrypted boolean,
               schema_version int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if friend <> auth.uid() and not public.are_friends(auth.uid(), friend) then
    raise exception 'not connected to this account' using errcode = '42501';
  end if;

  return query
    select c.user_id, p.handle, p.display_name, c.supabase_url, c.anon_key,
           c.encrypted, c.schema_version
      from public.connections c
      join public.profiles p on p.id = c.user_id
     where c.user_id = friend;
end;
$$;

-- Everyone I am connected to, with their cached stats.
-- `id` is the other person's account id (use it for get_friend_connection and
-- remove_friend); `friendship_id` is the row id (use it for respond_friend).
--
-- NOTE the drop. Postgres refuses to change a function's return type through
-- CREATE OR REPLACE ("cannot change return type of existing function"), so
-- re-running an updated schema over an older install fails on that statement
-- and leaves the OLD function in place — which then errors at runtime when the
-- client asks for a column it does not return. Dropping first is what makes
-- this file genuinely safe to re-run across versions.
drop function if exists public.list_friends();
create or replace function public.list_friends()
returns table (id uuid, friendship_id uuid, handle text, display_name text,
               avatar_emoji text, rank_id text, rank_points int, status text,
               direction text, stats jsonb, has_connection boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, f.id as friendship_id, p.handle, p.display_name, p.avatar_emoji,
         p.rank_id, p.rank_points, f.status,
         case when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end as direction,
         coalesce(s.payload, '{}'::jsonb) as stats,
         (c.user_id is not null) as has_connection
    from public.friendships f
    join public.profiles p
      on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
    left join public.shared_stats s on s.user_id = p.id and f.status = 'accepted'
    left join public.connections  c on c.user_id = p.id
   where f.requester_id = auth.uid() or f.addressee_id = auth.uid()
   order by f.status, p.rank_points desc;
$$;

-- Send a request by handle, tolerating an existing row in either direction.
drop function if exists public.request_friend(text);
create or replace function public.request_friend(target_handle text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target uuid;
  existing public.friendships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select id into target from public.profiles
   where lower(handle) = lower(trim(target_handle));

  if target is null then
    raise exception 'no account with that handle' using errcode = 'P0002';
  end if;
  if target = auth.uid() then
    raise exception 'that is you' using errcode = 'P0001';
  end if;

  select * into existing from public.friendships
   where (requester_id = auth.uid() and addressee_id = target)
      or (requester_id = target and addressee_id = auth.uid());

  if existing.id is not null then
    if existing.status = 'accepted' then return 'already_friends'; end if;

    -- They asked first: accepting here completes the link.
    if existing.addressee_id = auth.uid() and existing.status = 'pending' then
      update public.friendships
         set status = 'accepted', responded_at = now()
       where id = existing.id;
      return 'accepted';
    end if;

    update public.friendships
       set status = 'pending', created_at = now(), responded_at = null
     where id = existing.id;
    return 'pending';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
       values (auth.uid(), target, 'pending');
  return 'pending';
end;
$$;

drop function if exists public.respond_friend(uuid, boolean);
create or replace function public.respond_friend(request_id uuid, accept boolean)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.friendships
     set status = case when accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = request_id and addressee_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'no pending request for this account' using errcode = 'P0002';
  end if;
  return case when accept then 'accepted' else 'declined' end;
end;
$$;

create or replace function public.remove_friend(other uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.friendships
   where (requester_id = auth.uid() and addressee_id = other)
      or (requester_id = other and addressee_id = auth.uid());
$$;

-- Leaderboard across everyone I am connected to, plus me.
drop function if exists public.friend_leaderboard();
create or replace function public.friend_leaderboard()
returns table (id uuid, handle text, display_name text, avatar_emoji text,
               rank_id text, rank_points int, is_self boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.display_name, p.avatar_emoji, p.rank_id, p.rank_points,
         (p.id = auth.uid()) as is_self
    from public.profiles p
   where p.id = auth.uid()
      or public.are_friends(auth.uid(), p.id)
   order by p.rank_points desc, p.handle;
$$;

-- -----------------------------------------------------------------------------
-- 5b. INVITES
--
--     A friend request by handle requires knowing the handle and gives the
--     recipient a prompt they did not ask for. An invite is the other way
--     round: you generate a code, hand it to one person through whatever
--     channel you like, and only someone holding that code can complete the
--     link. Redeeming IS the acceptance — there is no second approval step,
--     because possession of the code is the consent.
--
--     Codes are single-use, expire, and are revocable.
-- -----------------------------------------------------------------------------

create table if not exists public.invites (
  code         text primary key,
  inviter_id   uuid not null references auth.users(id) on delete cascade,
  label        text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  redeemed_by  uuid references auth.users(id) on delete set null,
  redeemed_at  timestamptz,
  revoked      boolean not null default false
);

create index if not exists invites_inviter_idx on public.invites (inviter_id, created_at desc);

alter table public.invites enable row level security;

-- Only the inviter can see or manage their own codes. Redemption happens
-- through the RPC, which is security definer, so a redeemer never needs select.
drop policy if exists invites_own on public.invites;
create policy invites_own on public.invites
  for all to authenticated
  using (inviter_id = auth.uid()) with check (inviter_id = auth.uid());

-- Readable codes: no ambiguous characters, grouped for reading aloud.
create or replace function public.gen_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..12 loop
    if i in (5, 9) then out := out || '-'; end if;
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

drop function if exists public.create_invite(text);
create or replace function public.create_invite(label text default null)
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c text;
  tries int := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  loop
    c := public.gen_invite_code();
    exit when not exists (select 1 from public.invites i where i.code = c);
    tries := tries + 1;
    if tries > 12 then raise exception 'could not allocate a code'; end if;
  end loop;

  insert into public.invites (code, inviter_id, label) values (c, auth.uid(), label);
  return query
    select i.code, i.expires_at from public.invites i where i.code = c;
end;
$$;

drop function if exists public.redeem_invite(text);
create or replace function public.redeem_invite(invite_code text)
returns table (status text, friend_id uuid, friend_handle text, friend_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  inv public.invites%rowtype;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into inv from public.invites
   where code = upper(trim(invite_code)) for update;

  if inv.code is null then
    raise exception 'that invite code does not exist' using errcode = 'P0002';
  end if;
  if inv.revoked then
    raise exception 'that invite has been revoked' using errcode = 'P0001';
  end if;
  if inv.redeemed_by is not null then
    raise exception 'that invite has already been used' using errcode = 'P0001';
  end if;
  if inv.expires_at < now() then
    raise exception 'that invite has expired' using errcode = 'P0001';
  end if;
  if inv.inviter_id = me then
    raise exception 'that is your own invite' using errcode = 'P0001';
  end if;

  update public.invites
     set redeemed_by = me, redeemed_at = now()
   where code = inv.code;

  -- Redeeming completes the link in one step, in whichever direction a row
  -- already exists, so an invite crossing an existing request still resolves.
  insert into public.friendships (requester_id, addressee_id, status, responded_at)
       values (inv.inviter_id, me, 'accepted', now())
  on conflict (requester_id, addressee_id)
  do update set status = 'accepted', responded_at = now();

  update public.friendships
     set status = 'accepted', responded_at = now()
   where requester_id = me and addressee_id = inv.inviter_id;

  return query
    select 'accepted'::text, p.id, p.handle, p.display_name
      from public.profiles p where p.id = inv.inviter_id;
end;
$$;

drop function if exists public.my_invites();
create or replace function public.my_invites()
returns table (code text, label text, created_at timestamptz, expires_at timestamptz,
               redeemed_by_handle text, redeemed_at timestamptz, revoked boolean)
language sql
stable
security definer
set search_path = public
as $$
  select i.code, i.label, i.created_at, i.expires_at,
         p.handle, i.redeemed_at, i.revoked
    from public.invites i
    left join public.profiles p on p.id = i.redeemed_by
   where i.inviter_id = auth.uid()
   order by i.created_at desc
   limit 25;
$$;

drop function if exists public.revoke_invite(text);
create or replace function public.revoke_invite(invite_code text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.invites set revoked = true
   where code = upper(trim(invite_code)) and inviter_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 5c. KEY ESCROW
--
--     The app encrypts everything it writes with a data key that never leaves
--     the device in the clear. To let you sign in on a second device, that key
--     is stored here WRAPPED with a key derived from your account password
--     (PBKDF2, client side). The hub therefore holds ciphertext it cannot read:
--     without the password the wrapped blob is useless.
--
--     Consequence worth being honest about: lose the password and the encrypted
--     data is gone. A password RESET through Supabase auth does not help,
--     because the old password was the only thing that could unwrap this.
-- -----------------------------------------------------------------------------

create table if not exists public.user_keys (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  salt       text not null,
  wrapped    text not null,
  iterations int  not null default 310000,
  algo       text not null default 'AES-GCM-256/PBKDF2-SHA256',
  updated_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;

drop policy if exists user_keys_own on public.user_keys;
create policy user_keys_own on public.user_keys
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. HUB KEEPALIVE  —  runs once per day for the whole app
--    The first user to open the app on any given day triggers the heartbeat;
--    every later call that day is a no-op and returns ran = false.
-- -----------------------------------------------------------------------------

create table if not exists public.hub_keepalive (
  id         int primary key default 1,
  last_run   date,
  run_count  int not null default 0,
  last_actor uuid,
  touched_at timestamptz not null default now(),
  constraint hub_keepalive_single_row check (id = 1)
);

insert into public.hub_keepalive (id, last_run) values (1, null) on conflict (id) do nothing;

alter table public.hub_keepalive enable row level security;
drop policy if exists hub_keepalive_read on public.hub_keepalive;
create policy hub_keepalive_read on public.hub_keepalive
  for select to anon, authenticated using (true);

create or replace function public.hub_keepalive()
returns table (ran boolean, last_run date, run_count int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  prev date;
  cnt  int;
begin
  select k.last_run, k.run_count into prev, cnt
    from public.hub_keepalive k where k.id = 1 for update;

  if prev is not null and prev >= current_date then
    return query select false, prev, cnt;
    return;
  end if;

  delete from public.hub_keepalive where id = 1;
  insert into public.hub_keepalive (id, last_run, run_count, last_actor, touched_at)
       values (1, current_date, coalesce(cnt, 0) + 1, auth.uid(), now());

  return query select true, current_date, coalesce(cnt, 0) + 1;
end;
$$;

create or replace function public.hub_ping()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'accounts', (select count(*) from public.profiles),
    'server_time', now()
  );
$$;

-- -----------------------------------------------------------------------------
-- 7. AUTO-PROFILE ON SIGN-UP
--    Creates a profile as soon as an account is confirmed, deriving a handle
--    from the email local part and de-duplicating if it is taken.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base) < 3 then base := 'lifter'; end if;
  base := left(base, 20);
  candidate := base;

  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := left(base, 20) || n::text;
  end loop;

  insert into public.profiles (id, handle, display_name)
       values (new.id, candidate, coalesce(new.raw_user_meta_data ->> 'display_name', candidate))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 8. GRANTS
-- -----------------------------------------------------------------------------

grant execute on function public.hub_ping()                       to anon, authenticated;
grant execute on function public.hub_keepalive()                  to anon, authenticated;
grant execute on function public.search_profiles(text)            to authenticated;
grant execute on function public.get_friend_connection(uuid)      to authenticated;
grant execute on function public.list_friends()                   to authenticated;
grant execute on function public.request_friend(text)             to authenticated;
grant execute on function public.respond_friend(uuid, boolean)    to authenticated;
grant execute on function public.remove_friend(uuid)              to authenticated;
grant execute on function public.friend_leaderboard()             to authenticated;
grant execute on function public.are_friends(uuid, uuid)          to authenticated;
grant execute on function public.create_invite(text)              to authenticated;
grant execute on function public.redeem_invite(text)              to authenticated;
grant execute on function public.my_invites()                     to authenticated;
grant execute on function public.revoke_invite(text)              to authenticated;

-- =============================================================================
--  DONE.
-- =============================================================================

select 'AI-Gym hub schema installed.' as status;
