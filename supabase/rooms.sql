-- Pitch Snake: versus rooms.
--
-- Run this once in the SQL editor of the same project that carries
-- supabase/leaderboard.sql (Dashboard -> SQL Editor -> New query -> paste ->
-- Run). It is idempotent: tables are created if missing, functions are
-- dropped by signature and recreated, and the cron job re-schedules itself
-- by name.
--
-- Same shape as the boards: the table is never exposed to the Data API (RLS
-- on, no policies, no grants), and the SECURITY DEFINER functions below are
-- the only doors. What a room row adds over the phase-2 serverless rooms is
-- an ARBITER: one server-side counter and seed per kickoff, pushed to every
-- member through realtime.send, so two people mashing REMATCH can never fork
-- the room, and nobody's client picks the dice. Presence on the room channel
-- stays the roster; the row only needs a host-reported headcount so QUICK
-- MATCH can steer newcomers into the fullest fresh waiting room.
--
-- The page works without any of this (it falls back to client-hosted
-- kickoffs); with it, starts are atomic and quick match exists.

create table if not exists public.pitch_snake_rooms (
  id            bigint generated always as identity primary key,
  code          text        not null unique,
  status        text        not null default 'waiting',   -- waiting | playing
  start_n       integer     not null default 0,
  seed          bigint,
  player_count  integer     not null default 1,           -- host-reported, a matchmaking hint
  last_seen     timestamptz not null default now(),
  started_at    timestamptz,
  last_results  jsonb,
  created_at    timestamptz not null default now()
);

-- the room's running series: round wins keyed by player name, kept for the
-- row's lifetime so a family evening has a score that survives reloads
alter table public.pitch_snake_rooms add column if not exists wins jsonb not null default '{}'::jsonb;

alter table public.pitch_snake_rooms enable row level security;
revoke all on table public.pitch_snake_rooms from anon, authenticated;

-- ---------------------------------------------------------------- create ----
-- Five characters from the tournament alphabet (no 0/O or 1/I), generated
-- server-side, retried on the (astronomical) collision.
drop function if exists public.pitch_snake_room_create();

create or replace function public.pitch_snake_room_create()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  new_code text;
  i integer;
begin
  for attempt in 1..20 loop
    new_code := '';
    for i in 1..5 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * 32)::integer, 1);
    end loop;
    begin
      insert into public.pitch_snake_rooms (code) values (new_code);
      return new_code;
    exception when unique_violation then
      -- roll the dice again
    end;
  end loop;
  raise exception 'could not allocate a code';
end;
$$;

-- ----------------------------------------------------------------- touch ----
-- The host pings while the room waits, so quick match only ever offers rooms
-- that are demonstrably alive. The count is a hint, never authority: presence
-- on the channel is what actually seats players.
drop function if exists public.pitch_snake_room_touch(text, integer);

create or replace function public.pitch_snake_room_touch(p_code text, p_count integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pitch_snake_rooms
  set player_count = least(greatest(coalesce(p_count, 1), 0), 5),
      last_seen = now()
  where code = upper(trim(coalesce(p_code, '')));
$$;

-- ------------------------------------------------------------ quick match ----
-- The fullest waiting room with a live host and a free seat, else a fresh
-- one. SKIP LOCKED keeps two simultaneous searchers off the same row.
drop function if exists public.pitch_snake_room_quickmatch();

create or replace function public.pitch_snake_room_quickmatch()
returns table (code text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_code text;
begin
  select r.code into found_code
  from public.pitch_snake_rooms r
  where r.status = 'waiting'
    and r.player_count between 1 and 4
    and r.last_seen > now() - interval '25 seconds'
  order by r.player_count desc, r.created_at desc
  limit 1
  for update skip locked;
  if found_code is not null then
    update public.pitch_snake_rooms set last_seen = now() where public.pitch_snake_rooms.code = found_code;
    return query select found_code, false;
    return;
  end if;
  return query select public.pitch_snake_room_create(), true;
end;
$$;

-- ----------------------------------------------------------------- start ----
-- The kickoff arbiter. Any member may call it (the page offers the button to
-- the acting host); the row serializes rivals: the first caller flips the
-- room to playing and everyone else is told a round is mid-flight. The
-- roster the caller gathered from presence is sanitized and broadcast
-- verbatim to the room topic together with a server-minted seed and counter,
-- via realtime.send, so every member (the caller included) begins the same
-- round from the same message. Rooms the server never made (the page's
-- serverless fallback codes) are adopted by upsert, which keeps mixed
-- old/new clients in one working world. A playing room older than 15
-- minutes is treated as abandoned rather than mid-round.
drop function if exists public.pitch_snake_room_start(text, jsonb, integer);

create or replace function public.pitch_snake_room_start(p_code text, p_roster jsonb, p_ev integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_code   text;
  r            record;
  clean_roster jsonb;
  n            integer;
  sd           bigint;
  w            jsonb;
begin
  clean_code := upper(trim(coalesce(p_code, '')));
  if clean_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$' then
    raise exception 'bad room code';
  end if;
  if p_roster is null or jsonb_typeof(p_roster) <> 'array'
     or jsonb_array_length(p_roster) < 2 or jsonb_array_length(p_roster) > 5 then
    raise exception 'roster must list 2 to 5 players';
  end if;
  select jsonb_agg(jsonb_build_object(
           'ref',  left(coalesce(e.value->>'ref', ''), 16),
           'name', coalesce(nullif(left(upper(regexp_replace(coalesce(e.value->>'name', ''), '[^A-Za-z0-9]', '', 'g')), 5), ''), 'YOU'))
         order by e.ordinality)
  into clean_roster
  from jsonb_array_elements(p_roster) with ordinality e;

  insert into public.pitch_snake_rooms (code) values (clean_code)
  on conflict (code) do nothing;
  select id, status, started_at into r
  from public.pitch_snake_rooms where public.pitch_snake_rooms.code = clean_code
  for update;
  if r.status = 'playing' and r.started_at > now() - interval '15 minutes' then
    raise exception 'room is mid-round';
  end if;

  update public.pitch_snake_rooms
  set status = 'playing', start_n = public.pitch_snake_rooms.start_n + 1,
      started_at = now(), last_seen = now(),
      seed = floor(random() * 4294967296)::bigint
  where id = r.id
  returning public.pitch_snake_rooms.start_n, public.pitch_snake_rooms.seed,
            public.pitch_snake_rooms.wins into n, sd, w;

  -- The kickoff carries the room's running series, so a late joiner or a
  -- reloaded tab inherits the tally with the same message that seats them.
  -- 'at' is the server's own clock in epoch ms: clients whose copy arrived
  -- late pre-elapse their countdown by the difference, so every screen
  -- whistles at the same absolute moment.
  perform realtime.send(
    jsonb_build_object('t', 'start', 'n', n, 'seed', sd, 'roster', clean_roster, 'ev', p_ev,
                       'wins', coalesce(w, '{}'::jsonb),
                       'at', (extract(epoch from now()) * 1000)::bigint),
    'lobby',
    'ps-' || clean_code,
    false);
  return n;
end;
$$;

-- ---------------------------------------------------------------- finish ----
-- Any member reports full time; the first one lands it (status guards the
-- rest out), reopens the room for the rematch, and credits the round to the
-- winner: the first row of the reported placings. Every client computes the
-- same placings from the same deterministic round, so first-caller is as
-- good as consensus.
drop function if exists public.pitch_snake_room_finish(text, jsonb);

create or replace function public.pitch_snake_room_finish(p_code text, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  winner text;
begin
  if p_results is not null and pg_column_size(p_results) > 8192 then
    raise exception 'results too large';
  end if;
  winner := left(upper(regexp_replace(coalesce(p_results->'scores'->0->>'n', ''), '[^A-Za-z0-9]', '', 'g')), 5);
  update public.pitch_snake_rooms
  set status = 'waiting',
      last_results = p_results,
      last_seen = now(),
      wins = case when winner <> ''
                  then jsonb_set(coalesce(wins, '{}'::jsonb), array[winner],
                                 to_jsonb(coalesce((wins->>winner)::integer, 0) + 1))
                  else coalesce(wins, '{}'::jsonb) end
  where code = upper(trim(coalesce(p_code, ''))) and status = 'playing';
end;
$$;

-- ----------------------------------------------------------------- sweep ----
-- Rooms are ephemeral by construction; a day-old row is litter. The job
-- re-schedules itself by name, so re-running this file never stacks jobs.
create extension if not exists pg_cron;
select cron.schedule(
  'pitch-snake-room-sweep',
  '17 * * * *',
  $$ delete from public.pitch_snake_rooms where created_at < now() - interval '24 hours' $$
);

-- Postgres grants EXECUTE to PUBLIC on every new function; take it back,
-- then hand it out deliberately (see the note in leaderboard.sql: these
-- SECURITY DEFINER doors ARE the design, not an advisor finding to fix).
revoke all on function public.pitch_snake_room_create()                    from public;
revoke all on function public.pitch_snake_room_touch(text, integer)        from public;
revoke all on function public.pitch_snake_room_quickmatch()                from public;
revoke all on function public.pitch_snake_room_start(text, jsonb, integer) from public;
revoke all on function public.pitch_snake_room_finish(text, jsonb)         from public;
grant execute on function public.pitch_snake_room_create()                    to anon, authenticated;
grant execute on function public.pitch_snake_room_touch(text, integer)        to anon, authenticated;
grant execute on function public.pitch_snake_room_quickmatch()                to anon, authenticated;
grant execute on function public.pitch_snake_room_start(text, jsonb, integer) to anon, authenticated;
grant execute on function public.pitch_snake_room_finish(text, jsonb)         to anon, authenticated;
