-- =============================================================================
--  AI-GYM  ·  PERSONAL PROJECT SCHEMA
--  Run this in YOUR OWN Supabase project (SQL Editor -> New query -> Run).
--
--  This is the database that holds your exercises, workouts and training
--  history. Friends you accept can READ it; only your own devices can WRITE.
--
--  Security model
--  --------------
--  There is no per-user login on this project — it is already your project.
--  Instead:
--    * SELECT is open to the anon key, so a friend holding your publishable
--      key can read your training data. That key is only ever shared with
--      friends you accept, through the hub.
--    * INSERT / UPDATE / DELETE additionally require a secret write key sent
--      as the `x-gym-write-key` header. The app claims that key ONCE, right
--      after setup, and stores it on your device. Friends never receive it,
--      so a shared read key can never be used to modify or delete your data.
--
--  Safe to re-run: every statement is idempotent.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. WRITE-KEY CONFIG
-- -----------------------------------------------------------------------------

create table if not exists public.gym_config (
  id            int primary key default 1,
  write_key     uuid not null default gen_random_uuid(),
  claimed_at    timestamptz,
  schema_version int not null default 1,
  created_at    timestamptz not null default now(),
  constraint gym_config_single_row check (id = 1)
);

insert into public.gym_config (id) values (1) on conflict (id) do nothing;

alter table public.gym_config enable row level security;

-- Nobody reads this table directly; the RPCs below are the only way in.
drop policy if exists gym_config_no_access on public.gym_config;
create policy gym_config_no_access on public.gym_config
  for all to anon, authenticated using (false) with check (false);

-- Does the current request carry the correct write key?
create or replace function public.gym_has_write_access()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr text;
  key uuid;
begin
  begin
    hdr := current_setting('request.headers', true)::json ->> 'x-gym-write-key';
  exception when others then
    return false;
  end;

  if hdr is null or hdr = '' then
    return false;
  end if;

  select write_key into key from public.gym_config where id = 1;

  begin
    return key = hdr::uuid;
  exception when others then
    return false;
  end;
end;
$$;

-- One-time claim: returns the write key only while it is unclaimed.
-- After the first successful call this always raises, so a leaked read key
-- can never be escalated later.
create or replace function public.gym_claim_write_key()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  k uuid;
begin
  update public.gym_config
     set claimed_at = now()
   where id = 1 and claimed_at is null
  returning write_key into k;

  if k is null then
    raise exception 'write key already claimed — use gym_rotate_write_key with the existing key'
      using errcode = 'P0001';
  end if;

  return k;
end;
$$;

-- Rotate: needs the current key. Use if a device is lost.
create or replace function public.gym_rotate_write_key()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  k uuid;
begin
  if not public.gym_has_write_access() then
    raise exception 'current write key required' using errcode = '42501';
  end if;
  update public.gym_config
     set write_key = gen_random_uuid(), claimed_at = now()
   where id = 1
  returning write_key into k;
  return k;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. DATA TABLES
--    `data` holds the full record as JSONB so the app can evolve its shape
--    without a migration; the promoted columns exist for indexing and for
--    friends who want to query without parsing JSON.
-- -----------------------------------------------------------------------------

create table if not exists public.gym_exercises (
  id          text primary key,
  name        text not null,
  equipment   text,
  pattern     text,
  muscles     jsonb not null default '{}'::jsonb,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table if not exists public.gym_workouts (
  id          text primary key,
  name        text not null,
  item_count  int  not null default 0,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table if not exists public.gym_sessions (
  id           text primary key,
  workout_id   text,
  name         text,
  date         date not null,
  volume       numeric not null default 0,
  duration_sec int not null default 0,
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.gym_profile (
  id          int primary key default 1,
  display_name text,
  handle       text,
  bodyweight   numeric,
  units        text default 'kg',
  rank_id      text,
  rank_points  int default 0,
  stats        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  constraint gym_profile_single_row check (id = 1)
);

insert into public.gym_profile (id) values (1) on conflict (id) do nothing;

create index if not exists gym_sessions_date_idx    on public.gym_sessions (date desc);
create index if not exists gym_sessions_updated_idx on public.gym_sessions (updated_at desc);
create index if not exists gym_workouts_updated_idx on public.gym_workouts (updated_at desc);
create index if not exists gym_exercises_updated_idx on public.gym_exercises (updated_at desc);

-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY — read open, write gated by the write key
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['gym_exercises','gym_workouts','gym_sessions','gym_profile']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to anon, authenticated
         with check (public.gym_has_write_access())',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to anon, authenticated
         using (public.gym_has_write_access()) with check (public.gym_has_write_access())',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to anon, authenticated
         using (public.gym_has_write_access())',
      t || '_delete', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. KEEPALIVE
--    Supabase pauses free projects after a stretch of inactivity. The app calls
--    gym_keepalive() on the first launch of each day: it deletes and re-inserts
--    a heartbeat row (a genuine write) inside one transaction, and reports
--    whether it actually ran. Your training data is never touched.
-- -----------------------------------------------------------------------------

create table if not exists public.gym_keepalive (
  id          int primary key default 1,
  last_run    date,
  run_count   int not null default 0,
  touched_at  timestamptz not null default now(),
  constraint gym_keepalive_single_row check (id = 1)
);

insert into public.gym_keepalive (id, last_run) values (1, null) on conflict (id) do nothing;

alter table public.gym_keepalive enable row level security;
drop policy if exists gym_keepalive_read on public.gym_keepalive;
create policy gym_keepalive_read on public.gym_keepalive
  for select to anon, authenticated using (true);

create or replace function public.gym_keepalive()
returns table (ran boolean, last_run date, run_count int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  prev  date;
  cnt   int;
begin
  select k.last_run, k.run_count into prev, cnt
    from public.gym_keepalive k where k.id = 1 for update;

  if prev is not null and prev >= current_date then
    return query select false, prev, cnt;
    return;
  end if;

  -- delete + re-insert, as a real write, atomically
  delete from public.gym_keepalive where id = 1;
  insert into public.gym_keepalive (id, last_run, run_count, touched_at)
       values (1, current_date, coalesce(cnt, 0) + 1, now());

  return query select true, current_date, coalesce(cnt, 0) + 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. HEALTH CHECK + FRIEND-FACING SUMMARY
-- -----------------------------------------------------------------------------

create or replace function public.gym_ping()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'schema_version', (select schema_version from public.gym_config where id = 1),
    'write_key_claimed', (select claimed_at is not null from public.gym_config where id = 1),
    'exercises', (select count(*) from public.gym_exercises where not deleted),
    'workouts',  (select count(*) from public.gym_workouts  where not deleted),
    'sessions',  (select count(*) from public.gym_sessions  where not deleted),
    'last_session', (select max(date) from public.gym_sessions where not deleted),
    'server_time', now()
  );
$$;

-- Compact roll-up a friend's app can read in one call for the VS screen.
create or replace view public.gym_public_summary as
  select
    p.display_name,
    p.handle,
    p.rank_id,
    p.rank_points,
    p.units,
    p.stats,
    (select count(*) from public.gym_sessions where not deleted)             as session_count,
    (select coalesce(sum(volume), 0) from public.gym_sessions where not deleted) as total_volume,
    (select max(date) from public.gym_sessions where not deleted)            as last_session,
    p.updated_at
  from public.gym_profile p
  where p.id = 1;

grant select on public.gym_public_summary to anon, authenticated;

grant execute on function public.gym_ping()              to anon, authenticated;
grant execute on function public.gym_keepalive()         to anon, authenticated;
grant execute on function public.gym_claim_write_key()   to anon, authenticated;
grant execute on function public.gym_rotate_write_key()  to anon, authenticated;
grant execute on function public.gym_has_write_access()  to anon, authenticated;

-- =============================================================================
--  DONE. Go back to the app -> Control Panel -> Your Supabase -> "Test
--  connection". It will verify the schema, claim the write key once, and then
--  offer to upload everything already stored on this device.
-- =============================================================================

select 'AI-Gym personal schema installed. Return to the app and press Test connection.' as status;
