-- Pitch Snake: the ladder.
--
-- Run this in the SQL editor AFTER leaderboard.sql, auth.sql and rooms.sql,
-- and BEFORE re-running the updated rooms.sql, which writes into the rounds
-- table this file creates. Idempotent.
--
-- The design in one breath: a rated round is one the SERVER set up, seated
-- and scored. The server mints the seed at kickoff (rooms.sql), records the
-- round before the first input, each player claims its own seat by
-- auth.uid() while nobody yet knows who will win, and the finishing order
-- comes from a replay of the log rather than from anyone's word for it.
--
-- WHAT IS RATED, AND WHY SO LITTLE
--
-- Quick-match rooms only. A code room is a room you chose the occupants of,
-- and pairwise Elo against five accounts you control is a printing press.
-- Quick match seats you by region and availability and never by name, so the
-- one attack that survives everything else here is priced out of it. Friend
-- rooms stay exactly as they are: unrated, and now genuinely private, since
-- quick match no longer offers them to strangers.
--
-- Two or more players must agree on the log. Every peer holds a byte-
-- identical copy of a deterministic round, so agreement is free to ask for
-- and it closes the one hole a single submission cannot: a player who
-- fabricates a different log against the same seed, in which they win. The
-- modal log takes the round; a room where nobody corroborates is not rated.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- Margin. Elo asks who beat whom and not by how much, and that is the right
-- question in this game specifically: the engine's clinch rule ends a round
-- the moment the last survivor's score passes every fallen rival, so a
-- dominant win STOPS EARLY and records a margin of one point. Margins are
-- compressed exactly when someone is winning big, which makes them the
-- opposite of a quality signal here.
--
-- Rating-based matchmaking. Quick match still seats by region and
-- availability. Seeding by rating needs a population before it can do
-- anything but strand people in an empty queue.

-- ------------------------------------------------------------- the round ----
-- Written by pitch_snake_room_start at kickoff, before a single input
-- exists, so the seed, the seat count and the room's provenance are all
-- settled facts by the time anybody plays.
--
-- mode, placings and log_hash are what the room was found to AGREE on, and
-- are written at SEALING rather than at the first submission. That
-- distinction is the whole defence: filled in by whoever reported first,
-- they would let the fastest submitter plant the finishing order the rest of
-- the room is then rated against.
create table if not exists public.pitch_snake_rounds (
  id         bigint generated always as identity primary key,
  code       text        not null,
  start_n    integer     not null,
  seed       bigint      not null,
  players    smallint    not null,
  origin     text        not null default 'code',   -- 'quick' rates, 'code' does not
  mode       text,                                  -- the agreed mode, at sealing
  placings   jsonb,                                 -- the agreed [{seat, score, diedAt}], at sealing
  log_hash   bigint,                                -- the log the room agreed on
  started_at timestamptz not null default now(),
  sealed_at  timestamptz,                           -- when the rating ran, or was declined
  unique (code, start_n)
);

create index if not exists pitch_snake_rounds_due_idx
  on public.pitch_snake_rounds (started_at) where sealed_at is null;

alter table public.pitch_snake_rounds enable row level security;
revoke all on table public.pitch_snake_rounds from anon, authenticated;

-- -------------------------------------------------------------- the seats ----
-- One row per player who is willing to be rated. Claimed at KICKOFF and not
-- at full time, which is the whole point: at full time a loser could claim
-- the winner's seat, and at kickoff nobody knows yet which seat that is. The
-- unique on (round_id, user_id) stops one account holding two seats; the
-- primary key stops two accounts holding one.
--
-- Each seat also carries what its occupant REPORTED: the log's fingerprint,
-- the mode its knobs describe, and the finishing order a replay of it
-- produced. One report is a claim, not a fact, so it is stored against the
-- player who made it and never against the round, until the room agrees.
create table if not exists public.pitch_snake_seats (
  round_id   bigint      not null references public.pitch_snake_rounds (id) on delete cascade,
  seat       smallint    not null,
  user_id    uuid        not null,
  name       text        not null default 'YOU',
  log_hash   bigint,                                -- filled at submission
  mode       text,                                  -- as this reporter's log describes it
  placings   jsonb,                                 -- as this reporter's log replays
  place      smallint,                              -- filled at sealing
  delta      integer,                               -- the rating move, filled at sealing
  claimed_at timestamptz not null default now(),
  primary key (round_id, seat),
  unique (round_id, user_id)
);

-- older installs carried the report on the round; move it to the seat
alter table public.pitch_snake_seats add column if not exists mode     text;
alter table public.pitch_snake_seats add column if not exists placings jsonb;

alter table public.pitch_snake_seats enable row level security;
revoke all on table public.pitch_snake_seats from anon, authenticated;

-- ----------------------------------------------------------- the ratings ----
-- Per mode, because the boards already are: survival skill must not launder
-- into classic. Nothing here is ever written by a client.
create table if not exists public.pitch_snake_ratings (
  user_id    uuid        not null,
  mode       text        not null,
  rating     integer     not null default 1200,
  rounds     integer     not null default 0,
  wins       integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create index if not exists pitch_snake_ratings_board_idx
  on public.pitch_snake_ratings (mode, rating desc);

alter table public.pitch_snake_ratings enable row level security;
revoke all on table public.pitch_snake_ratings from anon, authenticated;

-- ------------------------------------------------------- take your seat ----
-- Called by every peer as the kickoff arrives, for itself and nobody else:
-- the user id comes from auth.uid() and is not a parameter, so this door
-- cannot seat someone else. Silent about everything. A seat already taken,
-- an unknown round, a signed-out caller and a code room all return the same
-- nothing, because none of them is a reason to interrupt a game.
drop function if exists public.pitch_snake_take_seat(text, integer, integer, text);

create or replace function public.pitch_snake_take_seat(
  p_code text, p_start_n integer, p_seat integer, p_name text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if auth.uid() is null then return; end if;
  select id, players into r
  from public.pitch_snake_rounds
  where code = upper(trim(coalesce(p_code, ''))) and start_n = p_start_n
    and started_at > now() - interval '15 minutes';
  if not found then return; end if;
  if p_seat is null or p_seat < 0 or p_seat >= r.players then return; end if;

  insert into public.pitch_snake_seats (round_id, seat, user_id, name)
  values (r.id, p_seat, auth.uid(),
          coalesce(nullif(left(upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g')), 5), ''), 'YOU'))
  on conflict do nothing;
end;
$$;

-- ------------------------------------------------------------ reporting ----
-- The validator's door, and the service role's alone: it takes a user id as
-- a parameter, which is exactly what no client may ever do.
--
-- A report goes on the REPORTER'S seat and never on the round. This looks
-- like bookkeeping and is not: writing the first report to the round would
-- let whoever submits fastest plant the finishing order the rest of the room
-- is then rated against, and a fabricated log against a real seed replays
-- perfectly well. Nothing becomes the round's until the room agrees on it,
-- which is pitch_snake_seal_round's job.
drop function if exists public.pitch_snake_record_round(bigint, uuid, text, jsonb, bigint);

create or replace function public.pitch_snake_record_round(
  p_round bigint, p_user uuid, p_mode text, p_placings jsonb, p_hash bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from public.pitch_snake_rounds where id = p_round for update;
  if not found then return 'no such round'; end if;
  if r.sealed_at is not null then return 'round already sealed'; end if;

  update public.pitch_snake_seats
  set log_hash = p_hash, mode = p_mode, placings = p_placings
  where round_id = p_round and user_id = p_user;
  if not found then return 'no seat'; end if;   -- never took one at kickoff
  return 'ok';
end;
$$;

-- --------------------------------------------------------------- the Elo ----
-- A five-player free-for-all is ten duels. Each pair is ordinary Elo against
-- the finishing order, and the sum is divided by (N-1) so a five-player
-- round moves a rating about as far as one duel does, which is what lets
-- rooms of two and rooms of five share a single pool. Splitting the pool by
-- room size would be more correct and would fragment matchmaking, which at
-- this game's size is the worse error.
--
-- Every expectation is computed from the ratings as they stood BEFORE the
-- round, so the result does not depend on the order the players are visited.
--
-- Disconnects need no special case, and that is worth saying out loud
-- because it is where most ladders leak. dropPeer only stops WAITING for a
-- peer's input: their snake stays in the simulation on its last heading and
-- crashes on its own, so a quitter still places, and places badly. Quitting
-- is not cheaper than losing. A peer dropped for lag and one who closed the
-- tab are indistinguishable to the engine and are treated identically here;
-- making lag unrated would be an invitation to fake it. Watch
-- pitch_snake_net_events instead.
drop function if exists public.pitch_snake_seal_round(bigint);

create or replace function public.pitch_snake_seal_round(p_round bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  s         record;
  agreed    bigint;
  agree_n   integer;
  n         integer;
  i         integer;
  j         integer;
  seats     integer[] := '{}';
  uids      uuid[]    := '{}';
  places    integer[] := '{}';
  before    numeric[] := '{}';
  kfac      numeric[] := '{}';
  adj       numeric;
  agreed_mode     text;
  agreed_placings jsonb;
  expect    numeric;
  actual    numeric;
  cur_rat   integer;
  cur_n     integer;
begin
  select * into r from public.pitch_snake_rounds where id = p_round for update;
  if not found or r.sealed_at is not null then return 0; end if;

  -- Not every round is a rated one, and the ones that are not are sealed
  -- rather than left to be reconsidered every minute for ever.
  if r.origin <> 'quick' then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- The log the room agrees on. Two witnesses minimum: one peer reporting a
  -- round it also played is not corroboration, and a fabricated log against
  -- a real seed replays perfectly well.
  select sh.log_hash, count(*) into agreed, agree_n
  from public.pitch_snake_seats sh
  where sh.round_id = p_round and sh.log_hash is not null
  group by sh.log_hash
  order by count(*) desc, sh.log_hash
  limit 1;
  if agreed is null or agree_n < 2 then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- What that log says happened. Taken from a seat holding the agreed hash
  -- and NOT from whoever reported first, which is the difference between a
  -- majority deciding the round and the fastest submitter deciding it. Every
  -- agreeing seat replayed the same log, so any of them will do.
  select sh.mode, sh.placings into agreed_mode, agreed_placings
  from public.pitch_snake_seats sh
  where sh.round_id = p_round and sh.log_hash = agreed
    and sh.mode is not null and sh.placings is not null
  order by sh.seat
  limit 1;
  if agreed_mode is null or agreed_placings is null then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  for s in
    select sh.seat, sh.user_id,
           (select ord::integer
            from jsonb_array_elements(agreed_placings) with ordinality pl(v, ord)
            where (pl.v->>'seat')::integer = sh.seat) as place
    from public.pitch_snake_seats sh
    where sh.round_id = p_round and sh.log_hash = agreed
    order by sh.seat
  loop
    if s.place is null then continue; end if;      -- a seat the round never had
    seats  := seats  || s.seat;
    uids   := uids   || s.user_id;
    places := places || s.place;
  end loop;

  n := coalesce(array_length(uids, 1), 0);
  if n < 2 then
    update public.pitch_snake_rounds set sealed_at = now() where id = p_round;
    return 0;
  end if;

  -- the standings as they stood before this round: a snapshot, so nothing
  -- below depends on the order these players are visited
  for i in 1..n loop
    select rt.rating, rt.rounds into cur_rat, cur_n
    from public.pitch_snake_ratings rt
    where rt.user_id = uids[i] and rt.mode = agreed_mode;
    if not found then cur_rat := 1200; cur_n := 0; end if;
    before := before || cur_rat::numeric;
    -- provisional players move fast and settle: K decays once a rating has
    -- something behind it
    kfac := kfac || (case when cur_n < 10 then 40 else 20 end)::numeric;
  end loop;

  for i in 1..n loop
    adj := 0;
    for j in 1..n loop
      if i = j then continue; end if;
      expect := 1.0 / (1.0 + power(10.0, (before[j] - before[i]) / 400.0));
      actual := case when places[i] < places[j] then 1.0
                     when places[i] > places[j] then 0.0
                     else 0.5 end;
      adj := adj + (actual - expect);
    end loop;
    adj := round(kfac[i] * adj / (n - 1));

    -- Added to the STORED rating rather than to the snapshot, so two rounds
    -- sealing at once compose instead of clobbering. A floor at 100 keeps a
    -- long losing run from running off the bottom of the scale.
    insert into public.pitch_snake_ratings (user_id, mode, rating, rounds, wins)
    values (uids[i], agreed_mode, greatest(100, (before[i] + adj)::integer), 1,
            case when places[i] = 1 then 1 else 0 end)
    on conflict (user_id, mode) do update
      set rating     = greatest(100, public.pitch_snake_ratings.rating + adj::integer),
          rounds     = public.pitch_snake_ratings.rounds + 1,
          wins       = public.pitch_snake_ratings.wins + case when places[i] = 1 then 1 else 0 end,
          updated_at = now();

    update public.pitch_snake_seats
    set place = places[i], delta = adj::integer
    where round_id = p_round and seat = seats[i];
  end loop;

  -- what the room was found to agree on becomes the round's own record
  update public.pitch_snake_rounds
  set sealed_at = now(), log_hash = agreed, mode = agreed_mode, placings = agreed_placings
  where id = p_round;
  return n;
end;
$$;

-- ------------------------------------------------------------- the sweep ----
-- Rounds seal on a delay rather than on the last submission, because there
-- is no way to know a submission is the last one: a player can close the tab
-- at full time and never send. Ninety seconds is far longer than the round
-- needs to report and short enough that a rating means something while the
-- room is still together.
drop function if exists public.pitch_snake_seal_due();

create or replace function public.pitch_snake_seal_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  done integer := 0;
begin
  for due in
    select id from public.pitch_snake_rounds
    where sealed_at is null and started_at < now() - interval '90 seconds'
    order by started_at
    limit 500
  loop
    perform public.pitch_snake_seal_round(due.id);
    done := done + 1;
  end loop;
  return done;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule(
  'pitch-snake-seal-rounds',
  '* * * * *',
  $$select public.pitch_snake_seal_due()$$
);

-- Rounds are evidence for as long as a rating dispute could be about them,
-- and litter after that. The seats cascade with them.
select cron.schedule(
  'pitch-snake-rounds-sweep',
  '41 4 * * *',
  $$delete from public.pitch_snake_rounds where started_at < now() - interval '90 days'$$
);

-- --------------------------------------------------------------- reading ----
-- Your own standing, per mode, and provisional until it means something: a
-- rating that has moved three times is noise, and showing it invites a
-- player to read a number that cannot yet be read.
drop function if exists public.pitch_snake_my_rating();

create or replace function public.pitch_snake_my_rating()
returns json
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(json_object_agg(t.mode, json_build_object(
           'rating', t.rating, 'rounds', t.rounds, 'wins', t.wins,
           'provisional', t.rounds < 10)), '{}'::json)
  from (
    select rt.mode, rt.rating, rt.rounds, rt.wins
    from public.pitch_snake_ratings rt
    where rt.user_id = auth.uid() and auth.uid() is not null
  ) t;
$$;

-- The ladder itself. Provisional players are left off: ten rounds is where
-- the number stops being a guess, and a board full of 1200s that have played
-- once tells a reader nothing.
drop function if exists public.pitch_snake_top_rated(text, integer);

create or replace function public.pitch_snake_top_rated(p_mode text, p_limit integer default 10)
returns table (name text, country text, rating integer, rounds integer, wins integer)
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(p.name, 'YOU'), p.country, rt.rating, rt.rounds, rt.wins
  from public.pitch_snake_ratings rt
  left join public.pitch_snake_profiles p on p.user_id = rt.user_id
  where rt.mode = p_mode and rt.rounds >= 10
  order by rt.rating desc, rt.updated_at
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function; take it back, then
-- hand it out deliberately. Note what is NOT handed out: record_round and
-- seal_round take a user id or decide a rating, so they belong to the service
-- role and to cron, never to a browser.
revoke all on function public.pitch_snake_take_seat(text, integer, integer, text)     from public;
revoke all on function public.pitch_snake_record_round(bigint, uuid, text, jsonb, bigint) from public;
revoke all on function public.pitch_snake_seal_round(bigint)                          from public;
revoke all on function public.pitch_snake_seal_due()                                  from public;
revoke all on function public.pitch_snake_my_rating()                                 from public;
revoke all on function public.pitch_snake_top_rated(text, integer)                    from public;

grant execute on function public.pitch_snake_take_seat(text, integer, integer, text)  to anon, authenticated;
grant execute on function public.pitch_snake_my_rating()                              to anon, authenticated;
grant execute on function public.pitch_snake_top_rated(text, integer)                 to anon, authenticated;
